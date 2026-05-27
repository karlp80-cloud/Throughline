/**
 * AudioController — public API surface.
 *
 * Holds a backend (real Web-Audio one in browsers, mock one in tests).
 * Tracks active loops to deduplicate `startLoop` calls and to crossfade
 * cleanly when switching.
 *
 * See docs/architecture/audio.md.
 */

import { DEFAULT_PROGRESSION } from './progressions';
import { SFX } from './sfxBank';
import type { AudioBackend, LoopName, SfxName } from './types';

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export class AudioController {
  private musicVolume = 1;
  private sfxVolume = 0.7;
  private activeLoops = new Set<LoopName>();

  constructor(private readonly backend: AudioBackend) {
    // Push the initial volumes so the backend's internal gain nodes
    // match getVolumes() from cycle 0.
    this.backend.setMusicGain(this.musicVolume);
    this.backend.setSfxGain(this.sfxVolume);
  }

  /**
   * Wake the underlying audio context (browsers require a user
   * gesture). Returns a promise but failures are swallowed — audio
   * silently degrades to no-op if the gesture requirement isn't met.
   */
  async ensureRunning(): Promise<void> {
    try {
      await this.backend.ensureRunning();
    } catch {
      // ignore
    }
  }

  playSfx(name: SfxName): void {
    if (this.sfxVolume <= 0) return;
    this.backend.playSfx(SFX[name]);
  }

  startLoop(name: LoopName): void {
    if (this.activeLoops.has(name)) return;
    // Crossfade: stop any currently-playing loops before starting the
    // new one. The backend handles the actual fade timing.
    for (const playing of this.activeLoops) {
      this.backend.stopLoop(playing);
      this.activeLoops.delete(playing);
    }
    this.backend.startLoop(name, DEFAULT_PROGRESSION);
    this.activeLoops.add(name);
  }

  stopLoop(name: LoopName): void {
    if (!this.activeLoops.has(name)) return;
    this.backend.stopLoop(name);
    this.activeLoops.delete(name);
  }

  stopAllLoops(): void {
    for (const name of this.activeLoops) {
      this.backend.stopLoop(name);
    }
    this.activeLoops.clear();
  }

  setMusicVolume(v: number): void {
    this.musicVolume = clamp01(v);
    this.backend.setMusicGain(this.musicVolume);
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = clamp01(v);
    this.backend.setSfxGain(this.sfxVolume);
  }

  getVolumes(): { music: number; sfx: number } {
    return { music: this.musicVolume, sfx: this.sfxVolume };
  }
}
