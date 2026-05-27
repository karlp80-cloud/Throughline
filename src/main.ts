/**
 * Throughline — entry point.
 *
 * Phase 2 contract: render a named fixture into #app. Query string
 * `?fixture=NAME` selects from `src/app/fixtures.ts` (default:
 * `fullPreRun`). Used by both the dev demo page and Playwright's
 * screenshot tests.
 */
import { mountCanvasFromQueryString } from './app/canvasMount';

const app = document.getElementById('app');
if (app) {
  // Heading so the old Phase 0 smoke test (asserts "Throughline" is in
  // the body) still passes alongside the canvas demo.
  const h = document.createElement('h1');
  h.textContent = 'Throughline';
  h.style.cssText = 'font-family: sans-serif; color: var(--fg, #e8d8b0); margin: 12px;';
  app.appendChild(h);
  const container = document.createElement('div');
  container.id = 'canvas-container';
  app.appendChild(container);
  mountCanvasFromQueryString(container);
}
