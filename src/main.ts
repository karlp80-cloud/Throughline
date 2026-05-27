/**
 * Throughline — entry point.
 *
 * Default route (`/`) mounts the editor and a top-level "Run" button
 * that swaps the view to playback. `?fixture=NAME` shows a static
 * Phase-2 render used by screenshot diff tests.
 *
 * Editor handle is published on `window.__editor`; playback handle on
 * `window.__playback`. The two are mutually exclusive at any time.
 */
import { mountCanvasFromQueryString } from './app/canvasMount';
import { FIXTURES } from './app/fixtures';
import { AudioController, mountVolumeMixer, WebAudioBackend } from './audio';
import { mountEditor, type EditorHandle } from './editor';
import type { Solution } from './engine';
import { mountPlayback, type PlaybackHandle } from './playback';

declare global {
  interface Window {
    __editor?: EditorHandle;
    __playback?: PlaybackHandle;
    __audio?: AudioController;
  }
}

const app = document.getElementById('app');
if (app) {
  const h = document.createElement('h1');
  h.textContent = 'Throughline';
  h.style.cssText =
    'font-family: sans-serif; color: var(--fg, #e8d8b0); margin: 12px 12px 4px 12px; font-size: 18px;';
  app.appendChild(h);

  const params = new URLSearchParams(window.location.search);
  if (params.has('fixture')) {
    const container = document.createElement('div');
    container.id = 'canvas-container';
    container.style.cssText = 'margin: 8px 12px;';
    app.appendChild(container);
    mountCanvasFromQueryString(container);
  } else {
    mountEditorAndPlaybackHarness(app);
  }
}

function mountEditorAndPlaybackHarness(app: HTMLElement): void {
  // Use the small solvable fixture by default so Run produces a
  // satisfying ~6-cycle playthrough. `fullPreRun` etc. remain
  // available via `?fixture=NAME` for screenshot tests.
  const fixture = FIXTURES['editorDefault']!;
  const puzzle = fixture.puzzle;

  // Audio: construct the controller eagerly. The underlying
  // AudioContext is suspended until the first SFX call, which
  // resumes it (browser autoplay policy). Skip in headless test
  // environments where window.AudioContext isn't present.
  const audio = createAudio();

  // Top-level actions toolbar (above the editor/playback view).
  const actions = document.createElement('div');
  actions.style.cssText = 'margin: 0 12px 8px; display: flex; gap: 8px; align-items: center;';
  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.id = 'run-button';
  runBtn.textContent = '▶ Run';
  runBtn.style.cssText = `
    padding: 6px 14px; background: var(--accent); color: var(--bg);
    border: 1px solid var(--accent); border-radius: 4px; cursor: pointer;
    font: inherit; font-weight: 600;
  `;
  actions.appendChild(runBtn);
  if (audio) {
    const mixerEl = document.createElement('div');
    actions.appendChild(mixerEl);
    mountVolumeMixer(mixerEl, audio);
  }
  app.appendChild(actions);

  const sub = document.createElement('div');
  sub.style.cssText = 'margin: 0 12px; max-width: 700px;';
  app.appendChild(sub);

  // Last draft, persisted across Run → Reset so the player doesn't
  // lose their solution when the simulation ends.
  let lastDraft: Solution | undefined;

  function switchToEdit(): void {
    if (window.__playback) {
      window.__playback.destroy();
      delete window.__playback;
    }
    const handle = mountEditor(sub, puzzle, lastDraft, audio ?? undefined);
    window.__editor = handle;
    runBtn.disabled = false;
  }

  function switchToPlay(): void {
    const editor = window.__editor;
    if (!editor) return;
    lastDraft = editor.getState().draft;
    editor.destroy();
    delete window.__editor;
    // Resume the audio context on user gesture (Run click is the gesture).
    audio?.startLoop('puzzle');
    const handle = mountPlayback(sub, puzzle, lastDraft, () => switchToEdit(), audio ?? undefined);
    window.__playback = handle;
    runBtn.disabled = true;
  }

  runBtn.addEventListener('click', () => switchToPlay());

  // Initial state: editor.
  switchToEdit();
}

function createAudio(): AudioController | null {
  if (typeof window === 'undefined') return null;
  if (typeof (window as { AudioContext?: unknown }).AudioContext === 'undefined') return null;
  const controller = new AudioController(new WebAudioBackend());
  window.__audio = controller;
  // Resume the underlying AudioContext on the FIRST user click anywhere.
  // Browsers block AudioContext until a user gesture; this is the cheapest
  // way to ensure SFX work without a "click to enable audio" prompt.
  const onFirstGesture = (): void => {
    void controller.ensureRunning();
    window.removeEventListener('pointerdown', onFirstGesture);
    window.removeEventListener('keydown', onFirstGesture);
  };
  window.addEventListener('pointerdown', onFirstGesture);
  window.addEventListener('keydown', onFirstGesture);
  return controller;
}
