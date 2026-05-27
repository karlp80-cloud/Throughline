/**
 * Audio public types. See docs/architecture/audio.md.
 */

export type SfxName =
  | 'tile_place'
  | 'tile_rotate'
  | 'tile_delete'
  | 'agent_step'
  | 'cargo_grab'
  | 'cargo_drop'
  | 'success'
  | 'failure';

export type LoopName = 'intro' | 'hub' | 'puzzle';

export type Waveform = 'sine' | 'triangle' | 'sawtooth' | 'square';

export interface SfxSpec {
  readonly freq: number;
  readonly wave: Waveform;
  readonly durationMs: number;
  readonly gain: number;
  /** Optional linear frequency sweep over the note duration. */
  readonly sweepTo?: number;
}

/**
 * One step in a chord progression. Each chord is rendered as a
 * vertical stack of notes at the same `durationBeats`.
 */
export interface Chord {
  readonly notes: readonly string[]; // e.g. ['A3', 'C4', 'E4', 'G4']
  readonly durationBeats: number;
}

export type ChordProgression = readonly Chord[];

export interface AudioBackend {
  ensureRunning(): Promise<void>;
  playSfx(spec: SfxSpec): void;
  startLoop(name: LoopName, progression: ChordProgression): void;
  stopLoop(name: LoopName): void;
  setMusicGain(gain01: number): void;
  setSfxGain(gain01: number): void;
}
