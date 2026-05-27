/**
 * New Campaign modal: pre-gen form → generating view.
 *
 * Architecturally split between this module (UI mechanics) and the
 * harness (manifest validation + load). The Promise this module
 * resolves carries either the raw `GenerateOk` bytes (validated by
 * the harness) or a category telling the caller what to do next:
 * close, retry, or surface an error.
 *
 * Cancel + safety timer per architect §5.3: the Cancel button is
 * always rendered; a configurable `safetyTimerMs` (default 5:30)
 * forces the cancel path if the Rust side never responds.
 *
 * Companion: docs/architecture/procgen-integration.md §7.2 / §7.3.
 */

import type { GenerateOk, GenerateOpts, ProcgenError, ProgressPayload } from '../procgen/api';
import type { ProcgenHints } from '../procgen/hints';

// UI safety timer that fires if both `generate()` and `cancel()` hang.
// Set comfortably above the Rust-side wall clock (15 min) so the UI
// only escapes in the genuinely-stuck case, never just because the LLM
// took longer than the architect originally guessed.
const DEFAULT_SAFETY_MS = 15 * 60 * 1000 + 30 * 1000; // 15:30

export interface NewCampaignModalDeps {
  generate(opts: GenerateOpts): Promise<GenerateOk>;
  cancel(jobId: string): Promise<void>;
  onProgress(cb: (p: ProgressPayload) => void): Promise<() => void>;
  hints: ProcgenHints;
  /** UI-side timeout that wraps the Rust timeout. Defaults to 5:30. */
  safetyTimerMs?: number;
  newJobId(): string;
  newSeed(): string;
}

export type GeneratedManifestResult =
  | { kind: 'generated'; manifestJson: string; path: string; seedUsed: string; elapsedMs: number }
  | { kind: 'cancelled' }
  | { kind: 'closed' }
  | { kind: 'safety-timeout' }
  | { kind: 'error'; error: ProcgenError };

export interface NewCampaignModalHandle {
  /** Force-close the modal (no further user interaction). */
  close(): void;
  /** Promise resolves with the user's outcome. */
  result: Promise<GeneratedManifestResult>;
}

const SEED_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ACTS_LO = 1;
const ACTS_HI = 8;
const PPA_LO = 1;
const PPA_HI = 16;

function clampInt(raw: string, lo: number, hi: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function isValidForm(seedStr: string, actsStr: string, ppaStr: string): boolean {
  if (!SEED_RE.test(seedStr)) return false;
  const a = Number(actsStr);
  if (!Number.isInteger(a) || a < ACTS_LO || a > ACTS_HI) return false;
  const p = Number(ppaStr);
  if (!Number.isInteger(p) || p < PPA_LO || p > PPA_HI) return false;
  return true;
}

export function openNewCampaignModal(
  host: HTMLElement,
  deps: NewCampaignModalDeps,
): NewCampaignModalHandle {
  const initialSeed = deps.newSeed();
  const initialGentle = deps.hints.gentle;
  const safetyMs = deps.safetyTimerMs ?? DEFAULT_SAFETY_MS;
  const jobId = deps.newJobId();

  const dialog = document.createElement('dialog');
  dialog.dataset['role'] = 'new-campaign-modal';
  dialog.style.cssText =
    'min-width: 420px; max-width: 560px; padding: 16px; border: 1px solid var(--muted); ' +
    'border-radius: 6px; background: var(--surface); color: var(--fg);';
  host.appendChild(dialog);

  let resolved = false;
  let resolveOuter!: (r: GeneratedManifestResult) => void;
  const resultPromise = new Promise<GeneratedManifestResult>((res) => {
    resolveOuter = res;
  });

  function finalize(r: GeneratedManifestResult): void {
    if (resolved) return;
    resolved = true;
    try {
      if (dialog.open) dialog.close();
    } catch {
      // jsdom safety
    }
    dialog.remove();
    resolveOuter(r);
  }

  // ─── Pre-gen view ───────────────────────────────────────────────
  function renderPregen(): void {
    dialog.replaceChildren();
    const h = document.createElement('h2');
    h.textContent = 'New Campaign';
    h.style.cssText = 'margin: 0 0 8px 0; font-size: 16px;';
    dialog.appendChild(h);

    const sub = document.createElement('p');
    sub.textContent = 'Pick parameters and the generator will produce a fresh campaign.';
    sub.style.cssText = 'margin: 0 0 12px 0; color: var(--muted);';
    dialog.appendChild(sub);

    const grid = document.createElement('div');
    grid.style.cssText =
      'display: grid; grid-template-columns: max-content 1fr; gap: 8px 12px; align-items: center; margin-bottom: 12px;';

    function addRow(labelText: string, role: string, input: HTMLInputElement): void {
      const lab = document.createElement('label');
      lab.textContent = labelText;
      grid.appendChild(lab);
      input.dataset['role'] = role;
      input.style.cssText =
        'padding: 4px 6px; background: var(--bg); color: var(--fg); border: 1px solid var(--muted); border-radius: 3px; font: inherit;';
      grid.appendChild(input);
    }

    const seedInput = document.createElement('input');
    seedInput.type = 'text';
    seedInput.value = initialSeed;
    seedInput.maxLength = 64;
    addRow('Seed', 'seed', seedInput);

    const actsInput = document.createElement('input');
    actsInput.type = 'number';
    actsInput.min = String(ACTS_LO);
    actsInput.max = String(ACTS_HI);
    actsInput.value = '3';
    addRow('Acts', 'acts', actsInput);

    const ppaInput = document.createElement('input');
    ppaInput.type = 'number';
    ppaInput.min = String(PPA_LO);
    ppaInput.max = String(PPA_HI);
    ppaInput.value = '4';
    addRow('Puzzles per act', 'puzzles-per-act', ppaInput);

    // Gentle row uses a checkbox.
    const gentleLab = document.createElement('label');
    gentleLab.textContent = 'Gentle mode';
    grid.appendChild(gentleLab);
    const gentleInput = document.createElement('input');
    gentleInput.type = 'checkbox';
    gentleInput.dataset['role'] = 'gentle';
    gentleInput.checked = initialGentle;
    grid.appendChild(gentleInput);

    dialog.appendChild(grid);

    if (deps.hints.avoidThemes.length > 0) {
      const at = document.createElement('div');
      at.dataset['role'] = 'avoid-themes';
      at.style.cssText = 'margin: 0 0 12px 0; color: var(--muted); font-size: 12px;';
      const title = document.createElement('strong');
      title.textContent = 'Avoiding themes: ';
      at.appendChild(title);
      const list = document.createElement('span');
      list.textContent = deps.hints.avoidThemes.join(', ');
      at.appendChild(list);
      dialog.appendChild(at);
    }

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';
    dialog.appendChild(buttonRow);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.dataset['role'] = 'cancel';
    cancelBtn.style.cssText =
      'padding: 6px 14px; background: var(--bg); color: var(--fg); border: 1px solid var(--muted); border-radius: 4px; cursor: pointer; font: inherit;';
    cancelBtn.addEventListener('click', () => finalize({ kind: 'closed' }));
    buttonRow.appendChild(cancelBtn);

    const genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.textContent = 'Generate';
    genBtn.dataset['role'] = 'generate';
    genBtn.style.cssText =
      'padding: 6px 14px; background: var(--accent); color: var(--bg); border: 1px solid var(--accent); border-radius: 4px; cursor: pointer; font: inherit; font-weight: 600;';
    buttonRow.appendChild(genBtn);

    function updateGenEnabled(): void {
      genBtn.disabled = !isValidForm(seedInput.value, actsInput.value, ppaInput.value);
    }
    updateGenEnabled();
    seedInput.addEventListener('input', updateGenEnabled);
    actsInput.addEventListener('input', updateGenEnabled);
    ppaInput.addEventListener('input', updateGenEnabled);

    genBtn.addEventListener('click', () => {
      if (genBtn.disabled) return;
      const opts: GenerateOpts = {
        jobId,
        seed: seedInput.value,
        acts: clampInt(actsInput.value, ACTS_LO, ACTS_HI, 3),
        puzzlesPerAct: clampInt(ppaInput.value, PPA_LO, PPA_HI, 4),
        gentle: gentleInput.checked,
        avoidThemes: deps.hints.avoidThemes,
      };
      renderGenerating(opts);
    });

    try {
      dialog.showModal();
    } catch {
      // jsdom: showModal isn't implemented, ignore.
    }
  }

  // ─── Generating view ────────────────────────────────────────────
  function renderGenerating(opts: GenerateOpts): void {
    dialog.replaceChildren();
    dialog.dataset['view'] = 'generating';
    const wrap = document.createElement('div');
    wrap.dataset['role'] = 'generating';
    dialog.appendChild(wrap);

    const h = document.createElement('h2');
    h.textContent = 'Generating…';
    h.style.cssText = 'margin: 0 0 8px 0; font-size: 16px;';
    wrap.appendChild(h);

    const body = document.createElement('p');
    body.textContent = 'Generating a fresh campaign. This usually takes 30 seconds to 2 minutes.';
    body.style.cssText = 'margin: 0 0 12px 0;';
    wrap.appendChild(body);

    const elapsedEl = document.createElement('div');
    elapsedEl.dataset['role'] = 'elapsed';
    elapsedEl.textContent = '0s elapsed';
    elapsedEl.style.cssText = 'margin: 0 0 12px 0; color: var(--muted);';
    wrap.appendChild(elapsedEl);

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';
    wrap.appendChild(buttonRow);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.dataset['role'] = 'cancel-generation';
    cancelBtn.style.cssText =
      'padding: 6px 14px; background: var(--bg); color: var(--fg); border: 1px solid var(--muted); border-radius: 4px; cursor: pointer; font: inherit;';
    buttonRow.appendChild(cancelBtn);

    let unlisten: (() => void) | null = null;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function teardown(): void {
      if (safetyTimer !== null) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      try {
        unlisten?.();
      } catch {
        // ignore
      }
      unlisten = null;
    }

    safetyTimer = setTimeout(() => {
      // The Rust side hasn't responded within the budget. Force cancel
      // (best-effort) and resolve with the safety-timeout class so the
      // caller surfaces a timeout error.
      cancelled = true;
      void deps.cancel(opts.jobId).catch(() => undefined);
      teardown();
      finalize({ kind: 'safety-timeout' });
    }, safetyMs);

    cancelBtn.addEventListener('click', () => {
      cancelled = true;
      void deps.cancel(opts.jobId).catch(() => undefined);
      teardown();
      finalize({ kind: 'cancelled' });
    });

    // Subscribe to progress heartbeats (best-effort).
    void deps
      .onProgress((p) => {
        if (cancelled || resolved) return;
        if (p.jobId !== opts.jobId) return;
        const secs = Math.floor(p.elapsedMs / 1000);
        elapsedEl.textContent = `${secs}s elapsed`;
      })
      .then((un) => {
        if (resolved) {
          un();
          return;
        }
        unlisten = un;
      })
      .catch(() => undefined);

    // Kick off generation.
    void deps.generate(opts).then(
      (ok) => {
        if (cancelled || resolved) return;
        teardown();
        finalize({
          kind: 'generated',
          manifestJson: ok.manifestJson,
          path: ok.path,
          seedUsed: ok.seedUsed,
          elapsedMs: ok.elapsedMs,
        });
      },
      (err: unknown) => {
        if (cancelled || resolved) return;
        teardown();
        const procErr = (err as ProcgenError | undefined) ?? {
          kind: 'internal-error',
          message: String(err),
        };
        if (procErr.kind === 'cancelled') {
          finalize({ kind: 'cancelled' });
          return;
        }
        finalize({ kind: 'error', error: procErr });
      },
    );
  }

  renderPregen();

  return {
    close: () => finalize({ kind: 'closed' }),
    result: resultPromise,
  };
}
