/**
 * Playback toolbar.
 *
 * Renders Play/Pause, Step, Reset, and a Speed selector. Updates
 * the displayed state on every animator `onUpdate`.
 */

import type { Animator, Speed } from '../animator';

const SPEEDS: readonly Speed[] = [0.5, 1, 2, 4];

export function mountControls(
  container: HTMLElement,
  animator: Animator,
  onReset: () => void,
): { destroy: () => void } {
  container.classList.add('playback');
  container.style.cssText = `
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px;
    background: var(--surface);
    border-radius: 6px;
    margin: 8px 0;
  `;

  const playBtn = mkBtn('▶ Run', () => animator.play());
  const pauseBtn = mkBtn('❚❚ Pause', () => animator.pause());
  const stepBtn = mkBtn('Step ▸', () => animator.step());
  const resetBtn = mkBtn('⟲ Reset', () => onReset());

  const speedLabel = document.createElement('span');
  speedLabel.style.cssText = 'color: var(--muted); font-size: 13px; margin-left: 8px;';
  speedLabel.textContent = 'Speed:';

  const speedSel = document.createElement('select');
  speedSel.dataset['role'] = 'speed';
  speedSel.style.cssText =
    'background: var(--bg); color: var(--fg); border: 1px solid var(--muted); padding: 4px;';
  for (const s of SPEEDS) {
    const o = document.createElement('option');
    o.value = String(s);
    o.textContent = `×${s}`;
    speedSel.appendChild(o);
  }
  speedSel.value = String(animator.speed());
  speedSel.addEventListener('change', () => {
    const v = Number(speedSel.value) as Speed;
    animator.setSpeed(v);
  });

  const status = document.createElement('span');
  status.dataset['role'] = 'status';
  status.style.cssText = 'color: var(--muted); font-size: 13px; margin-left: auto;';

  container.append(playBtn, pauseBtn, stepBtn, resetBtn, speedLabel, speedSel, status);

  function update(): void {
    const s = animator.status();
    const isRunning = s === 'running';
    const isFinished = s === 'finished';
    playBtn.disabled = isRunning || isFinished;
    pauseBtn.disabled = !isRunning;
    stepBtn.disabled = isRunning || isFinished;
    // Reset is always enabled — Reset from idle is a no-op but harmless.
    resetBtn.disabled = false;
    speedSel.value = String(animator.speed());
    const haltLabel =
      animator.haltStatus() === 'victory'
        ? '✅ Victory'
        : animator.haltStatus() === 'cycle_limit_exceeded'
          ? '⌛ Cycle limit'
          : animator.haltStatus();
    const frameLabel = animator.frame() < 0 ? 'pre-run' : `cycle ${animator.frame()}`;
    status.textContent = `${s} · ${frameLabel}${s === 'finished' ? ` · ${haltLabel}` : ''}`;
  }
  update();
  const off = animator.onUpdate(update);

  return {
    destroy() {
      off();
      container.replaceChildren();
    },
  };
}

function mkBtn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.style.cssText = `
    padding: 4px 12px; background: var(--bg); color: var(--fg);
    border: 1px solid var(--muted); border-radius: 4px; cursor: pointer; font: inherit;
  `;
  b.addEventListener('click', onClick);
  return b;
}
