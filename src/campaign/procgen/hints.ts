/**
 * Derive `--avoid-themes` + `--gentle` from the LibraryIndex.
 *
 * Rules (architect §9):
 *  - `tutorial` and `demo-*` campaigns are excluded from both the
 *    gentle gate and the avoid-themes list. The tutorial doesn't
 *    count as a "played procgen run", and built-in demo theme names
 *    aren't relevant signal for procgen diversity.
 *  - `gentle` is true iff there are zero qualifying entries.
 *  - `avoidThemes` is the de-duped, most-recently-played-first list,
 *    capped at 8 (keeps the CLI's user-prompt envelope finite).
 *
 * Companion: docs/architecture/procgen-integration.md §9.
 */

import { readLibrary } from '../saves';
import type { StorageBackend } from '../storage';

export interface ProcgenHints {
  readonly avoidThemes: readonly string[];
  readonly gentle: boolean;
}

const MAX_AVOID_THEMES = 8;

function isExcludedFromHints(campaignId: string): boolean {
  if (campaignId === 'tutorial') return true;
  if (campaignId.startsWith('demo-')) return true;
  return false;
}

export function computeHintsFromLibrary(storage: StorageBackend): ProcgenHints {
  const lib = readLibrary(storage);
  // `readLibrary` already sorts by lastPlayed desc on writes; defensive
  // re-sort here in case the index was loaded raw and the order shifts
  // in a future migration.
  const played = lib.entries
    .filter((e) => !isExcludedFromHints(e.campaignId))
    .slice()
    .sort((a, b) => b.lastPlayed - a.lastPlayed);
  const seen = new Set<string>();
  const avoidThemes: string[] = [];
  for (const e of played) {
    if (seen.has(e.themeName)) continue;
    seen.add(e.themeName);
    avoidThemes.push(e.themeName);
    if (avoidThemes.length >= MAX_AVOID_THEMES) break;
  }
  return { avoidThemes, gentle: played.length === 0 };
}
