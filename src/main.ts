/**
 * Throughline — entry point.
 *
 * Routes by query string:
 *   ?editor=1                      → Phase 3 editor with a default puzzle
 *   ?fixture=NAME                  → Phase 2 static render of a named fixture
 *   (no params)                    → defaults to fixture=fullPreRun
 */
import { mountCanvasFromQueryString } from './app/canvasMount';
import { FIXTURES } from './app/fixtures';
import { mountEditor, type EditorHandle } from './editor';

declare global {
  interface Window {
    __editor?: EditorHandle;
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
  if (params.get('editor') === '1') {
    const sub = document.createElement('div');
    sub.style.cssText = 'margin: 0 12px; max-width: 600px;';
    app.appendChild(sub);
    // Default to a small editable puzzle.
    const fixture = FIXTURES['fullPreRun']!;
    const handle = mountEditor(sub, fixture.puzzle);
    window.__editor = handle;
  } else {
    const container = document.createElement('div');
    container.id = 'canvas-container';
    container.style.cssText = 'margin: 8px 12px;';
    app.appendChild(container);
    mountCanvasFromQueryString(container);
  }
}
