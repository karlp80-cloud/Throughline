/**
 * Throughline — entry point.
 *
 * Default route (`/`) mounts the Phase 7 campaign harness — main menu,
 * library, per-act flow, puzzle session, ending. `?fixture=NAME` keeps
 * the static Phase-2 render used by screenshot diff tests.
 *
 * Window handles published for tests / dev console:
 *   window.__campaign — campaign state machine + dispatch
 *   window.__editor / __playback — exposed inside an active puzzle session
 *   window.__audio   — audio controller
 */

import { mountCanvasFromQueryString } from './app/canvasMount';
import { AudioController, mountVolumeMixer, WebAudioBackend } from './audio';
import { mountCampaignHarness, type CampaignHarnessHandle } from './campaign/dom/harness';
import type { EditorHandle } from './editor';
import type { PlaybackHandle } from './playback';

declare global {
  interface Window {
    __audio?: AudioController;
    __campaign?: CampaignHarnessHandle;
    /**
     * Editor / playback handles published by the active puzzle session
     * (see src/app/puzzleSession.ts). Mutually exclusive: only one is
     * present at a time; both are absent when no puzzle is active.
     */
    __editor?: EditorHandle;
    __playback?: PlaybackHandle;
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
    const audio = createAudio();
    if (audio) {
      const mixerEl = document.createElement('div');
      mixerEl.style.cssText = 'margin: 0 12px;';
      app.appendChild(mixerEl);
      mountVolumeMixer(mixerEl, audio);
    }
    const sub = document.createElement('div');
    sub.id = 'campaign-root';
    sub.style.cssText = 'margin: 0 12px; max-width: 700px;';
    app.appendChild(sub);
    const harness = mountCampaignHarness(sub, audio ? { audio } : {});
    window.__campaign = harness;
  }
}

function createAudio(): AudioController | null {
  if (typeof window === 'undefined') return null;
  if (typeof (window as { AudioContext?: unknown }).AudioContext === 'undefined') return null;
  const controller = new AudioController(new WebAudioBackend());
  window.__audio = controller;
  const onFirstGesture = (): void => {
    void controller.ensureRunning();
    window.removeEventListener('pointerdown', onFirstGesture);
    window.removeEventListener('keydown', onFirstGesture);
  };
  window.addEventListener('pointerdown', onFirstGesture);
  window.addEventListener('keydown', onFirstGesture);
  return controller;
}
