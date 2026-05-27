/**
 * Two-slider volume mixer (Music / SFX).
 *
 * Persists last-set values to localStorage under
 * `throughline:audio:volumes` and restores on mount.
 */

import type { AudioController } from '../controller';

const STORAGE_KEY = 'throughline:audio:volumes';

interface Persisted {
  music: number;
  sfx: number;
}

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { music?: unknown; sfx?: unknown };
    if (typeof v.music !== 'number' || typeof v.sfx !== 'number') return null;
    return { music: v.music, sfx: v.sfx };
  } catch {
    return null;
  }
}

function save(p: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Storage may be unavailable (private mode). Ignore.
  }
}

export interface VolumeMixerHandle {
  destroy(): void;
}

export function mountVolumeMixer(
  container: HTMLElement,
  controller: AudioController,
): VolumeMixerHandle {
  const persisted = loadPersisted();
  if (persisted) {
    controller.setMusicVolume(persisted.music);
    controller.setSfxVolume(persisted.sfx);
  }

  container.replaceChildren();
  container.style.cssText =
    'display: flex; gap: 16px; align-items: center; padding: 6px 10px; background: var(--surface); border-radius: 6px; margin: 8px 0; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; color: var(--muted);';

  const music = mkSlider('Music', controller.getVolumes().music, (v) => {
    controller.setMusicVolume(v);
    save({ music: v, sfx: controller.getVolumes().sfx });
  });
  const sfx = mkSlider('SFX', controller.getVolumes().sfx, (v) => {
    controller.setSfxVolume(v);
    save({ music: controller.getVolumes().music, sfx: v });
  });

  container.append(music.el, sfx.el);

  return {
    destroy() {
      container.replaceChildren();
    },
  };
}

function mkSlider(
  label: string,
  initial: number,
  onChange: (v: number) => void,
): { el: HTMLElement } {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display: flex; gap: 6px; align-items: center;';
  const text = document.createElement('span');
  text.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.value = String(Math.round(initial * 100));
  input.dataset['role'] = `volume-${label.toLowerCase()}`;
  input.style.cssText = 'width: 100px;';
  input.addEventListener('input', () => {
    onChange(Number(input.value) / 100);
  });
  wrap.append(text, input);
  return { el: wrap };
}
