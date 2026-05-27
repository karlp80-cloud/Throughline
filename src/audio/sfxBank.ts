/**
 * SFX bank — pure data.
 *
 * Frequencies and waveforms tuned to be punchy without being shrill.
 * ADSR is implicit and applied by the backend: 5ms attack, 20ms
 * decay, hold for most of the duration, 30ms release.
 *
 * `sweepTo` causes a linear frequency ramp over the note duration —
 * used for grab/drop (up/down sweeps) and success/failure stings.
 */

import type { SfxName, SfxSpec } from './types';

export const SFX: Readonly<Record<SfxName, SfxSpec>> = {
  tile_place: { freq: 440, wave: 'triangle', durationMs: 80, gain: 0.4 },
  tile_rotate: { freq: 660, wave: 'sine', durationMs: 60, gain: 0.3 },
  tile_delete: { freq: 220, wave: 'sawtooth', durationMs: 120, gain: 0.35, sweepTo: 110 },
  agent_step: { freq: 880, wave: 'sine', durationMs: 40, gain: 0.2 },
  cargo_grab: { freq: 523, wave: 'triangle', durationMs: 70, gain: 0.35, sweepTo: 698 },
  cargo_drop: { freq: 523, wave: 'triangle', durationMs: 70, gain: 0.35, sweepTo: 349 },
  success: { freq: 523, wave: 'sine', durationMs: 400, gain: 0.4, sweepTo: 1047 },
  failure: { freq: 220, wave: 'triangle', durationMs: 500, gain: 0.4, sweepTo: 110 },
};
