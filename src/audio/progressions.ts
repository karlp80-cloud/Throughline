/**
 * Chord progressions — pure data. Phase 6 ships the default;
 * Phase 8 wires the theme picker to choose among these by name.
 *
 * Notes use scientific pitch notation (A3, C4, E4, G4...). Each
 * chord holds for `durationBeats` at the loop tempo.
 */

import type { ChordProgression } from './types';

/**
 * 8-chord progression in A minor. First half is the "classic"
 * Am7 / Fmaj7 / Cmaj7 / G7 turnaround; second half pivots through
 * Dm7 → Em7 → Am7 → Fmaj7 to give the loop a clear A/B feel and
 * delay the obvious "we're repeating" moment.
 */
export const DEFAULT_PROGRESSION: ChordProgression = [
  { notes: ['A3', 'C4', 'E4', 'G4'], durationBeats: 4 }, // Am7
  { notes: ['F3', 'A3', 'C4', 'E4'], durationBeats: 4 }, // Fmaj7
  { notes: ['C3', 'E3', 'G3', 'B3'], durationBeats: 4 }, // Cmaj7
  { notes: ['G3', 'B3', 'D4', 'F4'], durationBeats: 4 }, // G7
  { notes: ['D3', 'F3', 'A3', 'C4'], durationBeats: 4 }, // Dm7
  { notes: ['E3', 'G3', 'B3', 'D4'], durationBeats: 4 }, // Em7
  { notes: ['A3', 'C4', 'E4', 'G4'], durationBeats: 4 }, // Am7
  { notes: ['F3', 'A3', 'C4', 'E4'], durationBeats: 4 }, // Fmaj7
];

/**
 * Twelve named progressions. Phase 6 only uses DEFAULT; this map
 * is here so Phase 8's theme system can resolve a theme's
 * `progressionName` field to a real progression.
 */
export const PROGRESSIONS: Readonly<Record<string, ChordProgression>> = {
  default_minor7: DEFAULT_PROGRESSION,
  // Placeholders for Phase 8 — same default for now, theme picks
  // override later. Authoring 11 distinct progressions is content
  // work for Phase 8.
  alchemy_mystical: DEFAULT_PROGRESSION,
  forensics_tense: DEFAULT_PROGRESSION,
  scifi_pulsing: DEFAULT_PROGRESSION,
  mythic_modal: DEFAULT_PROGRESSION,
  modernist_minor: DEFAULT_PROGRESSION,
  bright_major: DEFAULT_PROGRESSION,
  somber_lydian: DEFAULT_PROGRESSION,
  industrial_grind: DEFAULT_PROGRESSION,
  pastoral_open: DEFAULT_PROGRESSION,
  arcane_chromatic: DEFAULT_PROGRESSION,
  cosmic_suspended: DEFAULT_PROGRESSION,
};
