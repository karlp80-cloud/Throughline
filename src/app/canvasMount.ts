/**
 * Mount a canvas into a container and render a fixture's world.
 *
 * Used by `main.ts` to power the dev demo page and by Playwright's
 * screenshot tests via the query-string router (`?fixture=NAME`).
 */

import type { Puzzle, Solution, WorldState } from '../engine';
import { canvasSizeFor, render } from '../render/renderer';
import { FIXTURES, worldForFixture } from './fixtures';

export function mountCanvasFromQueryString(container: HTMLElement): void {
  const params = new URLSearchParams(window.location.search);
  const name = params.get('fixture') ?? 'fullPreRun';
  const fixture = FIXTURES[name] ?? FIXTURES['fullPreRun']!;
  mountCanvas(container, fixture.puzzle, fixture.solution, worldForFixture(fixture));
}

export function mountCanvas(
  container: HTMLElement,
  puzzle: Puzzle,
  solution: Solution,
  world: WorldState,
): HTMLCanvasElement {
  const { width, height } = canvasSizeFor(puzzle);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = 'block';
  // No CSS scaling — render at 1:1 device pixels for stable screenshots.
  container.replaceChildren(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  render(ctx, world, puzzle, solution);
  return canvas;
}
