/**
 * AudioController — public API surface.
 *
 * Holds a backend (real Web-Audio one in browsers, mock one in tests).
 * Tracks active loops to deduplicate `startLoop` calls and to crossfade
 * cleanly when switching.
 *
 * See docs/architecture/audio.md.
 */

import { DEFAULT_PROGRESSION, PROGRESSIONS } from './progressions';
import { SFX } from './sfxBank';
import type { AudioBackend, ChordProgression, LoopName, SfxName } from './types';

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export class AudioController {
  private musicVolume = 1;
  private sfxVolume = 0.7;
  private activeLoops = new Set<LoopName>();
  private currentProgression: ChordProgression = DEFAULT_PROGRESSION;

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
    this.backend.startLoop(name, this.currentProgression);
    this.activeLoops.add(name);
  }

  /**
   * Switch the active chord progression. If a loop is currently
   * playing, restart it on the new progression so the change is
   * audible immediately. Phase 8's theme applier calls this when
   * applying a theme with a `progression_name`.
   *
   * Unknown names fall back to DEFAULT_PROGRESSION and return false.
   */
  setProgressionByName(name: string): boolean {
    const progression = PROGRESSIONS[name];
    if (!progression) {
      this.currentProgression = DEFAULT_PROGRESSION;
      return false;
    }
    this.currentProgression = progression;
    // Restart any active loops on the new progression.
    const wasPlaying = Array.from(this.activeLoops);
    for (const loop of wasPlaying) {
      this.backend.stopLoop(loop);
    }
    this.activeLoops.clear();
    for (const loop of wasPlaying) {
      this.backend.startLoop(loop, this.currentProgression);
      this.activeLoops.add(loop);
    }
    return true;
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
