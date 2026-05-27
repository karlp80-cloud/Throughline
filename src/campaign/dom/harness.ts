/**
 * Campaign harness: orchestrates the state machine and renders the
 * matching screen. Owns the loaded RawCampaign + CampaignSave and
 * persists every transition.
 *
 * All LLM-supplied strings go through `textContent` — never
 * innerHTML. The reviewer's `<script>` injection test will fail if
 * this invariant breaks.
 */

import type { AudioController } from '../../audio';
import type { ChallengeResult } from '../../completion/detector';
import { mountPuzzleSession } from '../../app/puzzleSession';
import {
  parseCampaign,
  type RawAct,
  type RawCampaign,
  type RawPuzzle,
} from '../../schema/campaign';
import { applyTheme, substitute, type AppliedTheme, type Vocab } from '../../theme';
import { toEnginePuzzle } from '../load';
import {
  canFinishAct,
  initialState,
  isPuzzleComplete,
  optionalsEarnedCount,
  reduce,
  type CampaignAction,
  type CampaignState,
} from '../state';
import {
  emptySave,
  loadSave,
  markPuzzleComplete,
  readLibrary,
  removeLibraryEntry,
  upsertLibraryEntry,
  writeSave,
  type CampaignSave,
  type LibraryEntry,
} from '../saves';
import { LocalStorageBackend, type StorageBackend } from '../storage';
import { BUILT_IN_CAMPAIGNS, type BuiltInCampaign } from '../builtins';
import { manifestHash } from '../hash';
import { mountNewCampaignButton } from './newCampaignButton';

export interface CampaignHarnessHandle {
  state(): CampaignState;
  campaign(): RawCampaign | null;
  save(): CampaignSave | null;
  /** The applied theme for the current campaign (null in main_menu). */
  appliedTheme(): AppliedTheme | null;
  dispatch(action: CampaignAction): void;
  /** Force-load a campaign (e.g. for tests). */
  loadCampaign(id: string): void;
  /**
   * Load a procgen-generated manifest already in memory. Synthesizes
   * a campaign id, save, and library entry, then transitions to the
   * first act intro. Throws on JSON syntax error or
   * `CampaignParseError` — callers (`newCampaignButton`'s glue) show
   * the appropriate error modal.
   */
  loadGeneratedManifest(manifestJson: string, sourcePath: string, seedUsed: string): void;
  /**
   * Resume-on-launch path: given an on-disk path, read its contents
   * via the supplied reader, then `loadGeneratedManifest`. The reader
   * is injected so tests can drive the path without a Tauri host.
   * Rejects with the reader's error if the file can't be read.
   */
  loadCampaignFromSourcePath(
    sourcePath: string,
    seedUsed: string,
    reader: (path: string) => Promise<string>,
  ): Promise<void>;
  /**
   * Hook for the New Campaign button. The harness binds these so the
   * caller can re-render the main menu from outside (e.g. when the
   * library list changes after a successful generation). Optional;
   * production wiring is in mountCampaignHarness.
   */
  refreshMainMenu(): void;
  destroy(): void;
}

/**
 * Glue surface for the New Campaign flow. Passed to
 * `mountCampaignHarness` so the host (src/main.ts) can wire the
 * Tauri-aware flow without dragging Tauri imports into harness.ts.
 */
export interface NewCampaignFlowDeps {
  /** True when running inside the Tauri webview. */
  isTauri(): boolean;
  /** Open the Tauri pre-gen + generating modal flow. */
  openTauriFlow(): Promise<void>;
  /** Open the browser file-picker fallback. */
  openBrowserFlow(): Promise<void>;
}

export interface MountOptions {
  readonly builtIns?: readonly BuiltInCampaign[];
  readonly audio?: AudioController;
  readonly storage?: StorageBackend;
  readonly now?: () => number;
  /**
   * Wiring for the Phase 11 New Campaign button. When provided, the
   * button is mounted on the main menu and dispatches to these flows
   * on click. When omitted, the button is not rendered (tests that
   * don't exercise the procgen path don't need to supply it).
   */
  readonly newCampaignFlow?: NewCampaignFlowDeps;
  /**
   * Reader the harness uses to resume a procgen campaign from its
   * on-disk LibraryEntry.sourcePath. Production wires this to
   * `readCampaignFile` from `src/campaign/procgen/api.ts`. Omitted
   * in browser mode (the library still renders the entries but
   * Resume is disabled).
   */
  readonly procgenReader?: (path: string) => Promise<string>;
  /**
   * Surface called when a procgen library load fails. Lets main.ts
   * show the per-class error modal without dragging that module into
   * harness.ts.
   */
  readonly onProcgenLoadError?: (
    err: unknown,
    entry: { campaignId: string; sourcePath: string },
  ) => void;
}

export function mountCampaignHarness(
  container: HTMLElement,
  opts: MountOptions = {},
): CampaignHarnessHandle {
  const builtIns = opts.builtIns ?? BUILT_IN_CAMPAIGNS;
  const storage = opts.storage ?? new LocalStorageBackend();
  const audio = opts.audio;
  const now = opts.now ?? (() => Date.now());

  let state: CampaignState = initialState();
  let campaign: RawCampaign | null = null;
  let save: CampaignSave | null = null;
  let activeBuiltIn: BuiltInCampaign | null = null;
  /**
   * Phase 11: when a procgen campaign is loaded, the harness keeps
   * its synthesized id + on-disk source path so the LibraryIndex
   * entry can be upserted correctly on every render. Both `null` for
   * the main menu / when no procgen is loaded.
   */
  let activeProcgen: { campaignId: string; sourcePath: string } | null = null;
  let activeSession: ReturnType<typeof mountPuzzleSession> | null = null;
  let applied: AppliedTheme | null = null;

  function dispatch(action: CampaignAction): void {
    if (!campaign) {
      if (action.type === 'RETURN_TO_MENU') {
        state = { kind: 'main_menu' };
        render();
      }
      return;
    }
    state = reduce(state, action, campaign);
    render();
  }

  function loadCampaign(id: string): void {
    const b = builtIns.find((c) => c.id === id);
    if (!b) return;
    let parsed: RawCampaign;
    try {
      parsed = parseCampaign(b.manifest);
    } catch (e) {
      renderError(container, `Couldn't load "${b.displayName}": ${(e as Error).message}`);
      return;
    }
    campaign = parsed;
    activeBuiltIn = b;
    activeProcgen = null;
    // Load or initialize save.
    const hash = manifestHash(b.manifest);
    const result = loadSave(storage, b.id, hash);
    if (result.kind === 'parsed') {
      save = result.save;
    } else if (result.kind === 'hash_mismatch') {
      // Defensive: warn console + start fresh save.
      console.warn(`Save for "${b.id}" doesn't match the loaded manifest; resetting progress.`);
      save = emptySave(b.id, b.manifest);
      writeSave(storage, save);
    } else if (result.kind === 'too_new') {
      renderError(
        container,
        `Save for "${b.displayName}" was created by a newer build (v${result.seenVersion}). Please update the game.`,
      );
      return;
    } else {
      // missing or corrupted — fresh save.
      save = emptySave(b.id, b.manifest);
      writeSave(storage, save);
    }
    // Apply the theme — palette to CSS vars, glyphs to renderer, audio
    // progression routing. Warnings (bad contrast, unknown glyph
    // variant) are non-fatal and exposed on the harness handle.
    const themeOpts = audio ? { audio } : {};
    applied = applyTheme(parsed.theme, themeOpts);
    if (typeof window !== 'undefined') {
      (window as Window & typeof globalThis).__theme = applied;
    }
    // Soft resume: jump straight to the first incomplete act's intro.
    // If all acts are complete, show the ending.
    state = resumeStateFor(parsed, save);
    render();
  }

  function currentVocab(): Vocab {
    return applied?.vocab ?? {};
  }

  function loadGeneratedManifest(manifestJson: string, sourcePath: string, seedUsed: string): void {
    // 1. JSON.parse — `SyntaxError` thrown to caller.
    const parsedJson: unknown = JSON.parse(manifestJson);
    // 2. parseCampaign — `CampaignParseError` thrown to caller.
    const parsed = parseCampaign(parsedJson);
    // 3. Synthesize a unique campaign id. Time-stamped so repeated
    //    regenerations with the same seed don't collide.
    const campaignId = `procgen-${seedUsed}-${now()}`;
    // 4. Build an empty save and store it.
    save = emptySave(campaignId, parsedJson);
    writeSave(storage, save);
    // 5. Set in-memory state.
    campaign = parsed;
    activeBuiltIn = null;
    activeProcgen = { campaignId, sourcePath };
    const themeOpts = audio ? { audio } : {};
    applied = applyTheme(parsed.theme, themeOpts);
    if (typeof window !== 'undefined') {
      (window as Window & typeof globalThis).__theme = applied;
    }
    // 6. Library upsert is handled by persist() inside render().
    state = { kind: 'act_intro', actIndex: 0 };
    render();
  }

  async function loadCampaignFromSourcePath(
    sourcePath: string,
    seedUsed: string,
    reader: (path: string) => Promise<string>,
  ): Promise<void> {
    const text = await reader(sourcePath);
    loadGeneratedManifest(text, sourcePath, seedUsed);
  }

  function renderProcgenLibrary(host: HTMLElement): void {
    const lib = readLibrary(storage);
    const builtInIds = new Set(builtIns.map((b) => b.id));
    const procgenEntries = lib.entries.filter(
      (e) => !builtInIds.has(e.campaignId) && e.campaignId !== 'tutorial',
    );
    if (procgenEntries.length === 0) return;
    const header = document.createElement('h3');
    header.textContent = 'Generated campaigns';
    header.style.cssText = 'margin: 8px 0 4px 0; font-size: 14px; color: var(--muted);';
    host.appendChild(header);
    const list = document.createElement('div');
    list.dataset['role'] = 'procgen-library';
    list.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    for (const e of procgenEntries) {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; gap: 6px; align-items: stretch;';
      row.dataset['campaignId'] = e.campaignId;
      if (e.sourcePath) row.dataset['sourcePath'] = e.sourcePath;

      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.dataset['role'] = 'load-procgen';
      loadBtn.textContent = `${e.completed ? '✓ ' : ''}${e.themeName}`;
      const hasDisk = typeof e.sourcePath === 'string' && e.sourcePath.length > 0;
      const canLoad = hasDisk && typeof opts.procgenReader === 'function';
      loadBtn.disabled = !canLoad;
      loadBtn.title = canLoad
        ? `Resume ${e.themeName}`
        : hasDisk
          ? 'Re-import the manifest file to continue.'
          : 'File not available in browser mode.';
      loadBtn.style.cssText = `
        flex: 1; text-align: left; padding: 8px 12px;
        background: var(--surface); color: var(--fg);
        border: 1px solid var(--muted); border-radius: 4px;
        cursor: ${canLoad ? 'pointer' : 'not-allowed'};
        font: inherit;
      `;
      if (canLoad) {
        const reader = opts.procgenReader!;
        const sourcePath = e.sourcePath!;
        // Recover the seed prefix from the synthesized campaignId
        // ("procgen-<seed>-<ts>"). Falls back to '' if the format is
        // unexpected; loadGeneratedManifest will re-derive from the
        // manifest itself anyway.
        const seedUsed = recoverSeedFromCampaignId(e.campaignId);
        loadBtn.addEventListener('click', () => {
          void loadCampaignFromSourcePath(sourcePath, seedUsed, reader).catch((err) => {
            opts.onProcgenLoadError?.(err, { campaignId: e.campaignId, sourcePath });
          });
        });
      }
      row.appendChild(loadBtn);

      const rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.dataset['role'] = 'remove-procgen';
      rmBtn.textContent = '✕';
      rmBtn.title = 'Remove from library';
      rmBtn.style.cssText = `
        padding: 4px 8px; background: var(--bg); color: var(--muted);
        border: 1px solid var(--muted); border-radius: 4px; cursor: pointer;
        font: inherit;
      `;
      rmBtn.addEventListener('click', () => {
        removeLibraryEntry(storage, e.campaignId);
        render();
      });
      row.appendChild(rmBtn);

      list.appendChild(row);
    }
    host.appendChild(list);
  }

  function resumeStateFor(c: RawCampaign, s: CampaignSave): CampaignState {
    for (let i = 0; i < c.acts.length; i++) {
      const act = c.acts[i]!;
      const completed = s.progress[act.id]?.completedPuzzleIds.length ?? 0;
      if (completed < act.required_completions) {
        return { kind: 'act_intro', actIndex: i };
      }
    }
    return { kind: 'ending' };
  }

  function persist(): void {
    if (!save || !campaign) return;
    save = { ...save, lastPlayed: now() };
    writeSave(storage, save);
    if (activeBuiltIn) {
      upsertLibraryEntry(storage, {
        campaignId: activeBuiltIn.id,
        themeName: campaign.theme.name,
        lastPlayed: save.lastPlayed,
        completed: state.kind === 'ending',
      });
    } else if (activeProcgen) {
      const entry: LibraryEntry = {
        campaignId: activeProcgen.campaignId,
        themeName: campaign.theme.name,
        lastPlayed: save.lastPlayed,
        completed: state.kind === 'ending',
        // Only persist the path when we actually have one; the
        // browser-import path passes '' since there's no on-disk file.
        ...(activeProcgen.sourcePath.length > 0 ? { sourcePath: activeProcgen.sourcePath } : {}),
      };
      upsertLibraryEntry(storage, entry);
    }
  }

  function render(): void {
    activeSession?.destroy();
    activeSession = null;
    container.replaceChildren();
    container.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding: 12px;';

    switch (state.kind) {
      case 'main_menu':
        renderMainMenu(container, builtIns, (id) => loadCampaign(id));
        // Phase 11: prepend the New Campaign button + the procgen
        // library entries above the built-in list. The architect
        // doc places it above the built-ins because procgen is the
        // expected post-tutorial entry point.
        if (opts.newCampaignFlow) {
          const ncfHost = document.createElement('div');
          ncfHost.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
          // Insert at the top of `container`, before the existing
          // "Pick a campaign…" intro.
          container.insertBefore(ncfHost, container.firstChild);
          mountNewCampaignButton(ncfHost, opts.newCampaignFlow);
        }
        // Render any procgen LibraryEntry that isn't a built-in.
        renderProcgenLibrary(container);
        break;
      case 'act_intro':
        if (!campaign) return;
        renderActIntro(container, campaign.acts[state.actIndex]!, currentVocab(), () =>
          dispatch({ type: 'BEGIN_ACT' }),
        );
        break;
      case 'hub':
        if (!campaign || !save) return;
        renderHub(
          container,
          campaign,
          save,
          state.actIndex,
          currentVocab(),
          (puzzleIndex) => dispatch({ type: 'OPEN_PUZZLE', puzzleIndex }),
          () => dispatch({ type: 'FINISH_ACT' }),
          () => dispatch({ type: 'RETURN_TO_MENU' }),
        );
        break;
      case 'puzzle': {
        if (!campaign || !save) return;
        // Capture indices now — `state` may transition away before
        // the onVictory callback fires.
        const ai = state.actIndex;
        const pi = state.puzzleIndex;
        renderPuzzle(
          container,
          campaign.acts[ai]!,
          pi,
          currentVocab(),
          (optionals) => {
            const act = campaign!.acts[ai]!;
            const puzzle = act.puzzles[pi]!;
            const earnedIds = optionals.filter((o) => o.passed).map((o) => o.id);
            save = markPuzzleComplete(save!, act.id, puzzle.id, earnedIds, now());
            writeSave(storage, save);
          },
          () => {
            persist();
            dispatch({ type: 'LEAVE_PUZZLE' });
          },
          audio,
          (session) => {
            activeSession = session;
          },
        );
        break;
      }
      case 'act_outro':
        if (!campaign) return;
        renderActOutro(container, campaign.acts[state.actIndex]!, currentVocab(), () =>
          dispatch({ type: 'ACT_OUTRO_NEXT' }),
        );
        break;
      case 'ending':
        if (!campaign) return;
        renderEnding(container, campaign, currentVocab(), () =>
          dispatch({ type: 'RETURN_TO_MENU' }),
        );
        // Update library with completed=true.
        persist();
        break;
    }
    persist();
  }

  render();

  return {
    state: () => state,
    campaign: () => campaign,
    save: () => save,
    appliedTheme: () => applied,
    dispatch,
    loadCampaign,
    loadGeneratedManifest,
    loadCampaignFromSourcePath,
    refreshMainMenu(): void {
      if (state.kind === 'main_menu') render();
    },
    destroy() {
      activeSession?.destroy();
      activeSession = null;
      container.replaceChildren();
    },
  };
}

// ─── Per-screen renderers ──────────────────────────────────────────

function renderMainMenu(
  container: HTMLElement,
  builtIns: readonly BuiltInCampaign[],
  onSelect: (id: string) => void,
): void {
  const h = document.createElement('h2');
  h.textContent = 'Throughline';
  h.style.cssText = 'margin: 0; font-size: 18px;';
  container.appendChild(h);

  const intro = document.createElement('p');
  intro.textContent = 'Pick a campaign to begin.';
  intro.style.cssText = 'color: var(--muted); margin: 0;';
  container.appendChild(intro);

  const list = document.createElement('div');
  list.dataset['role'] = 'campaign-list';
  list.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
  for (const b of builtIns) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset['campaignId'] = b.id;
    btn.textContent = b.displayName;
    btn.style.cssText = `
      text-align: left; padding: 8px 12px; background: var(--surface); color: var(--fg);
      border: 1px solid var(--muted); border-radius: 4px; cursor: pointer; font: inherit;
    `;
    btn.addEventListener('click', () => onSelect(b.id));
    list.appendChild(btn);
  }
  container.appendChild(list);
}

function renderActIntro(
  container: HTMLElement,
  act: RawAct,
  vocab: Vocab,
  onBegin: () => void,
): void {
  const title = document.createElement('h2');
  title.dataset['role'] = 'act-title';
  title.textContent = substitute(act.title, vocab);
  title.style.cssText = 'margin: 0;';
  container.appendChild(title);

  const intro = document.createElement('p');
  intro.dataset['role'] = 'act-intro-text';
  intro.textContent = substitute(act.intro_text, vocab);
  intro.style.cssText = 'white-space: pre-wrap; color: var(--fg);';
  container.appendChild(intro);

  const begin = document.createElement('button');
  begin.type = 'button';
  begin.dataset['role'] = 'begin-act';
  begin.textContent = 'Begin →';
  begin.style.cssText = primaryButtonCss();
  begin.addEventListener('click', onBegin);
  container.appendChild(begin);
}

function renderHub(
  container: HTMLElement,
  campaign: RawCampaign,
  save: CampaignSave,
  actIndex: number,
  vocab: Vocab,
  onOpenPuzzle: (idx: number) => void,
  onFinishAct: () => void,
  onReturn: () => void,
): void {
  const act = campaign.acts[actIndex];
  if (!act) return;
  const title = document.createElement('h2');
  title.textContent = substitute(act.title, vocab);
  title.style.cssText = 'margin: 0;';
  container.appendChild(title);

  const completedCount = save.progress[act.id]?.completedPuzzleIds.length ?? 0;
  const progressLine = document.createElement('p');
  progressLine.dataset['role'] = 'hub-progress';
  progressLine.textContent = `${completedCount} / ${act.required_completions} required completed`;
  progressLine.style.cssText = 'color: var(--muted); margin: 0;';
  container.appendChild(progressLine);

  const list = document.createElement('div');
  list.dataset['role'] = 'puzzle-list';
  list.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
  for (let i = 0; i < act.puzzles.length; i++) {
    const p = act.puzzles[i]!;
    const done = isPuzzleComplete(campaign, save, actIndex, i);
    const earned = optionalsEarnedCount(campaign, save, actIndex, i);
    const total = p.optional_challenges.length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset['puzzleId'] = p.id;
    btn.dataset['done'] = done ? 'true' : 'false';
    const titleText = substitute(p.title, vocab);
    const label = `${done ? '✓ ' : '  '}${titleText}${total > 0 ? `  (${earned}/${total} optional)` : ''}`;
    btn.textContent = label;
    btn.style.cssText = `
      text-align: left; padding: 8px 12px;
      background: ${done ? 'var(--surface)' : 'var(--bg)'};
      color: var(--fg); border: 1px solid var(--muted);
      border-radius: 4px; cursor: pointer; font: inherit;
    `;
    btn.addEventListener('click', () => onOpenPuzzle(i));
    list.appendChild(btn);
  }
  container.appendChild(list);

  if (canFinishAct({ kind: 'hub', actIndex }, campaign, save)) {
    const finish = document.createElement('button');
    finish.type = 'button';
    finish.dataset['role'] = 'finish-act';
    finish.textContent = 'Finish act →';
    finish.style.cssText = primaryButtonCss();
    finish.addEventListener('click', onFinishAct);
    container.appendChild(finish);
  }

  const back = document.createElement('button');
  back.type = 'button';
  back.dataset['role'] = 'return-to-menu';
  back.textContent = '← Main menu';
  back.style.cssText = secondaryButtonCss();
  back.addEventListener('click', onReturn);
  container.appendChild(back);
}

function renderPuzzle(
  container: HTMLElement,
  act: RawAct,
  puzzleIndex: number,
  vocab: Vocab,
  onVictory: (optionals: readonly ChallengeResult[]) => void,
  onLeave: () => void,
  audio: AudioController | undefined,
  registerSession: (session: ReturnType<typeof mountPuzzleSession>) => void,
): void {
  const raw: RawPuzzle | undefined = act.puzzles[puzzleIndex];
  if (!raw) return;

  const header = document.createElement('div');
  header.style.cssText = 'display: flex; gap: 8px; align-items: baseline;';
  const title = document.createElement('h2');
  title.dataset['role'] = 'puzzle-title';
  title.textContent = substitute(raw.title, vocab);
  title.style.cssText = 'margin: 0; flex: 1;';
  header.appendChild(title);
  const back = document.createElement('button');
  back.type = 'button';
  back.dataset['role'] = 'back-to-hub';
  back.textContent = '← Hub';
  back.style.cssText = secondaryButtonCss();
  back.addEventListener('click', onLeave);
  header.appendChild(back);
  container.appendChild(header);

  if (raw.briefing) {
    const briefing = document.createElement('p');
    briefing.dataset['role'] = 'puzzle-briefing';
    briefing.textContent = substitute(raw.briefing, vocab);
    briefing.style.cssText = 'color: var(--muted); margin: 0; white-space: pre-wrap;';
    container.appendChild(briefing);
  }

  const sessionEl = document.createElement('div');
  container.appendChild(sessionEl);
  const session = mountPuzzleSession(sessionEl, toEnginePuzzle(raw), { onVictory, onLeave }, audio);
  registerSession(session);
}

function renderActOutro(
  container: HTMLElement,
  act: RawAct,
  vocab: Vocab,
  onContinue: () => void,
): void {
  const title = document.createElement('h2');
  title.textContent = substitute(act.title, vocab) + ' — done';
  title.style.cssText = 'margin: 0;';
  container.appendChild(title);
  const outro = document.createElement('p');
  outro.dataset['role'] = 'act-outro-text';
  outro.textContent = substitute(act.outro_text, vocab);
  outro.style.cssText = 'white-space: pre-wrap;';
  container.appendChild(outro);
  const cont = document.createElement('button');
  cont.type = 'button';
  cont.dataset['role'] = 'act-outro-next';
  cont.textContent = 'Continue →';
  cont.style.cssText = primaryButtonCss();
  cont.addEventListener('click', onContinue);
  container.appendChild(cont);
}

function renderEnding(
  container: HTMLElement,
  campaign: RawCampaign,
  vocab: Vocab,
  onReturn: () => void,
): void {
  const title = document.createElement('h2');
  title.textContent = '✦ Ending';
  title.style.cssText = 'margin: 0;';
  container.appendChild(title);
  const body = document.createElement('p');
  body.dataset['role'] = 'ending-text';
  body.textContent = substitute(campaign.ending.good, vocab);
  body.style.cssText = 'white-space: pre-wrap;';
  container.appendChild(body);
  const back = document.createElement('button');
  back.type = 'button';
  back.dataset['role'] = 'return-to-menu';
  back.textContent = '← Main menu';
  back.style.cssText = primaryButtonCss();
  back.addEventListener('click', onReturn);
  container.appendChild(back);
}

/**
 * Procgen library ids are synthesized as `procgen-<seed>-<unix-ts>`.
 * Recover the `<seed>` for resume convenience. The actual manifest
 * carries the seed too — this is only useful before the manifest is
 * parsed, e.g. in the read-pipeline error path.
 */
function recoverSeedFromCampaignId(id: string): string {
  if (!id.startsWith('procgen-')) return '';
  const rest = id.slice('procgen-'.length);
  const lastDash = rest.lastIndexOf('-');
  return lastDash < 0 ? rest : rest.slice(0, lastDash);
}

function renderError(container: HTMLElement, message: string): void {
  container.replaceChildren();
  const p = document.createElement('p');
  p.textContent = message;
  p.style.cssText = 'color: var(--danger);';
  container.appendChild(p);
}

function primaryButtonCss(): string {
  return `
    padding: 6px 14px; background: var(--accent); color: var(--bg);
    border: 1px solid var(--accent); border-radius: 4px; cursor: pointer;
    font: inherit; font-weight: 600; align-self: flex-start;
  `;
}

function secondaryButtonCss(): string {
  return `
    padding: 4px 10px; background: var(--bg); color: var(--fg);
    border: 1px solid var(--muted); border-radius: 4px; cursor: pointer;
    font: inherit; align-self: flex-start;
  `;
}
