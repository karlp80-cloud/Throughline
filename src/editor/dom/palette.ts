/**
 * Tile-palette toolbar. Hand-written DOM (no framework).
 *
 * Renders a button per `puzzle.availableTiles` value. Clicking a
 * button dispatches `SELECT_TILE_KIND`; the currently-selected kind
 * gets accent styling.
 *
 * When the active placement is reactor or filter, a second row of
 * pickers appears showing the puzzle's pre-declared recipes / filter
 * types. The currently-selected option gets accent styling. Tutorial
 * puzzles declare exactly one option, so the row is informational;
 * richer puzzles can declare multiple and the player chooses.
 */

import type { CargoType, ReactorRecipe, TileKind } from '../../engine/types';
import type { EditorAction, EditorState } from '../state';

const TILE_LABELS: Record<TileKind, string> = {
  conveyor: 'Conveyor',
  splitter: 'Splitter',
  merger: 'Merger',
  filter: 'Filter',
  reactor: 'Reactor',
};

const CARGO_LETTERS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
};

function cargoLabel(t: CargoType): string {
  return CARGO_LETTERS[t] ?? t;
}

function recipeLabel(r: ReactorRecipe): string {
  return `${r.inputs.map(cargoLabel).join(' + ')} → ${cargoLabel(r.output)}`;
}

function recipesEqual(a: ReactorRecipe, b: ReactorRecipe): boolean {
  return (
    a.output === b.output &&
    a.inputs.length === b.inputs.length &&
    a.inputs.every((t, i) => t === b.inputs[i])
  );
}

const BTN_STYLE = `
  padding: 6px 12px;
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--muted);
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
`;

export function mountPalette(
  container: HTMLElement,
  getState: () => EditorState,
  dispatch: (a: EditorAction) => void,
): { update: () => void; destroy: () => void } {
  container.classList.add('palette');
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: var(--surface);
    border-radius: 6px;
    margin: 8px 0;
  `;

  // Row 1 — tile-kind buttons.
  const tileRow = document.createElement('div');
  tileRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px;';
  container.appendChild(tileRow);

  // Row 2 — recipe/filter picker (visible only in matching placement mode).
  const configRow = document.createElement('div');
  configRow.dataset['role'] = 'placement-config';
  configRow.style.cssText =
    'display: none; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 13px; color: var(--muted);';
  container.appendChild(configRow);

  const buttons = new Map<TileKind, HTMLButtonElement>();
  const state0 = getState();
  for (const kind of state0.puzzle.availableTiles) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset['tileKind'] = kind;
    btn.textContent = TILE_LABELS[kind];
    btn.style.cssText = BTN_STYLE;
    btn.addEventListener('click', () => {
      dispatch({ type: 'SELECT_TILE_KIND', tileKind: kind });
    });
    tileRow.appendChild(btn);
    buttons.set(kind, btn);
  }

  function update(): void {
    const s = getState();
    const activeKind = s.mode.kind === 'placing-tile' ? s.mode.tileKind : null;
    for (const [kind, btn] of buttons) {
      if (kind === activeKind) {
        btn.style.background = 'var(--accent)';
        btn.style.color = 'var(--bg)';
      } else {
        btn.style.background = 'var(--bg)';
        btn.style.color = 'var(--fg)';
      }
    }
    renderConfigRow(s);
  }

  function renderConfigRow(s: EditorState): void {
    configRow.replaceChildren();
    if (s.mode.kind !== 'placing-tile') {
      configRow.style.display = 'none';
      return;
    }
    if (s.mode.tileKind === 'reactor') {
      const recipes = s.puzzle.reactorRecipes ?? [];
      if (recipes.length === 0) {
        configRow.style.display = 'none';
        return;
      }
      configRow.style.display = 'flex';
      const label = document.createElement('span');
      label.textContent = 'Recipe:';
      configRow.appendChild(label);
      const current = s.mode.recipe;
      for (const r of recipes) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset['role'] = 'recipe-option';
        btn.dataset['recipeOutput'] = r.output;
        btn.textContent = recipeLabel(r);
        btn.style.cssText = BTN_STYLE;
        if (current && recipesEqual(current, r)) {
          btn.style.background = 'var(--accent)';
          btn.style.color = 'var(--bg)';
        }
        btn.addEventListener('click', () => {
          dispatch({ type: 'SELECT_PLACEMENT_RECIPE', recipe: r });
        });
        configRow.appendChild(btn);
      }
      return;
    }
    if (s.mode.tileKind === 'filter') {
      const types = s.puzzle.filterTypes ?? [];
      if (types.length === 0) {
        configRow.style.display = 'none';
        return;
      }
      configRow.style.display = 'flex';
      const label = document.createElement('span');
      label.textContent = 'Allow:';
      configRow.appendChild(label);
      const current = s.mode.filterType;
      for (const t of types) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset['role'] = 'filter-option';
        btn.dataset['filterType'] = t;
        btn.textContent = cargoLabel(t);
        btn.style.cssText = BTN_STYLE;
        if (current === t) {
          btn.style.background = 'var(--accent)';
          btn.style.color = 'var(--bg)';
        }
        btn.addEventListener('click', () => {
          dispatch({ type: 'SELECT_PLACEMENT_FILTER_TYPE', filterType: t });
        });
        configRow.appendChild(btn);
      }
      return;
    }
    configRow.style.display = 'none';
  }

  update();

  return {
    update,
    destroy() {
      container.replaceChildren();
    },
  };
}
