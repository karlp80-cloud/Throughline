/**
 * Post-victory results panel.
 *
 * Mounted by the playback harness when the animator reaches
 * status='finished' with haltStatus='victory'. Displays the four
 * stats and a row per optional challenge.
 *
 * All text rendered via textContent — the challenge labels come
 * from `campaign.json` which is eventually LLM-emitted. Never
 * innerHTML.
 */

import type { CompletionResult } from '../detector';

export interface ResultsPanelHandle {
  destroy(): void;
}

export function mountResultsPanel(
  container: HTMLElement,
  result: CompletionResult,
  haltStatus: 'victory' | 'cycle_limit_exceeded' | 'agent_deadlock',
): ResultsPanelHandle {
  container.classList.add('results');
  container.style.cssText = `
    margin: 8px 0;
    padding: 12px;
    background: var(--surface);
    border: 1px solid var(--muted);
    border-radius: 6px;
    color: var(--fg);
    font-family: ui-sans-serif, system-ui, sans-serif;
  `;
  container.replaceChildren();

  const heading = document.createElement('div');
  heading.style.cssText = `font-size: 16px; font-weight: 600; margin-bottom: 8px;`;
  heading.textContent =
    haltStatus === 'victory'
      ? '✅ Victory'
      : haltStatus === 'cycle_limit_exceeded'
        ? '⌛ Cycle limit reached'
        : haltStatus;
  container.appendChild(heading);

  const stats = document.createElement('div');
  stats.dataset['role'] = 'stats';
  stats.style.cssText = `
    display: grid;
    grid-template-columns: max-content max-content;
    gap: 2px 16px;
    font-family: ui-monospace, monospace;
    font-size: 13px;
    margin-bottom: 12px;
  `;
  appendStatRow(stats, 'cycles', result.stats.cycles);
  appendStatRow(stats, 'tiles_used', result.stats.tiles_used);
  appendStatRow(stats, 'agent_count', result.stats.agent_count);
  appendStatRow(stats, 'ops_total', result.stats.ops_total);
  container.appendChild(stats);

  if (result.optionals.length > 0) {
    const opsHeading = document.createElement('div');
    opsHeading.textContent = 'Optional challenges:';
    opsHeading.style.cssText = `font-size: 13px; margin-bottom: 4px; color: var(--muted);`;
    container.appendChild(opsHeading);

    const list = document.createElement('div');
    list.dataset['role'] = 'optionals';
    list.style.cssText = `font-size: 13px;`;
    for (const opt of result.optionals) {
      const row = document.createElement('div');
      row.dataset['challengeId'] = opt.id;
      row.dataset['passed'] = opt.passed ? 'true' : 'false';
      row.style.cssText = `padding: 2px 0; display: flex; align-items: center; gap: 8px;`;
      const icon = document.createElement('span');
      icon.textContent = opt.passed ? '☑' : '☐';
      icon.style.cssText = `font-size: 16px; color: ${opt.passed ? 'var(--success)' : 'var(--muted)'};`;
      const label = document.createElement('span');
      label.textContent = opt.label;
      if (!opt.passed) label.style.color = 'var(--muted)';
      row.append(icon, label);
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  return {
    destroy() {
      container.replaceChildren();
    },
  };
}

function appendStatRow(container: HTMLElement, label: string, value: number): void {
  const k = document.createElement('span');
  k.textContent = `${label}:`;
  k.style.color = 'var(--muted)';
  const v = document.createElement('span');
  v.textContent = String(value);
  container.append(k, v);
}
