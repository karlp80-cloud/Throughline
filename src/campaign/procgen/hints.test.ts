// @vitest-environment node
/**
 * Unit tests for `computeHintsFromLibrary` — the helper that derives
 * the `--avoid-themes` list and the `--gentle` flag from the
 * LibraryIndex before invoking `generate_campaign`.
 *
 * Matrix from architect §9.3:
 *   - first run defaults gentle=true; subsequent runs default false
 *   - built-in / tutorial themes are excluded from avoidThemes
 *   - avoidThemes capped at 8 entries
 */

import { describe, expect, test } from 'vitest';
import { MemoryStorageBackend } from '../storage';
import { upsertLibraryEntry } from '../saves';
import { computeHintsFromLibrary } from './hints';

describe('computeHintsFromLibrary', () => {
  test('empty library → gentle=true, avoidThemes=[]', () => {
    const s = new MemoryStorageBackend();
    expect(computeHintsFromLibrary(s)).toEqual({ avoidThemes: [], gentle: true });
  });

  test('first procgen entry flips gentle to false and seeds avoidThemes', () => {
    const s = new MemoryStorageBackend();
    upsertLibraryEntry(s, {
      campaignId: 'procgen-x-1',
      themeName: 'Workshop',
      lastPlayed: 1,
      completed: false,
    });
    expect(computeHintsFromLibrary(s)).toEqual({
      avoidThemes: ['Workshop'],
      gentle: false,
    });
  });

  test('tutorial-only library leaves gentle=true and avoidThemes=[]', () => {
    const s = new MemoryStorageBackend();
    upsertLibraryEntry(s, {
      campaignId: 'tutorial',
      themeName: "The Apprentice's Manual",
      lastPlayed: 1,
      completed: true,
    });
    expect(computeHintsFromLibrary(s)).toEqual({ avoidThemes: [], gentle: true });
  });

  test('demo- entries are excluded from avoidThemes (and don’t flip gentle)', () => {
    const s = new MemoryStorageBackend();
    upsertLibraryEntry(s, {
      campaignId: 'demo-two-act',
      themeName: 'The Workshop',
      lastPlayed: 1,
      completed: false,
    });
    upsertLibraryEntry(s, {
      campaignId: 'demo-alchemy',
      themeName: 'Distillery',
      lastPlayed: 2,
      completed: false,
    });
    expect(computeHintsFromLibrary(s)).toEqual({ avoidThemes: [], gentle: true });
  });

  test('avoidThemes capped at 8 entries (most-recent first)', () => {
    const s = new MemoryStorageBackend();
    for (let i = 0; i < 12; i++) {
      upsertLibraryEntry(s, {
        campaignId: `procgen-${i}`,
        themeName: `Theme${i}`,
        lastPlayed: i,
        completed: false,
      });
    }
    const { avoidThemes, gentle } = computeHintsFromLibrary(s);
    expect(avoidThemes).toHaveLength(8);
    expect(gentle).toBe(false);
    // Most-recent first (upsert sorts by lastPlayed descending).
    expect(avoidThemes[0]).toBe('Theme11');
  });

  test('dedupes repeat theme names (same theme, two procgen runs)', () => {
    const s = new MemoryStorageBackend();
    upsertLibraryEntry(s, {
      campaignId: 'procgen-a',
      themeName: 'Same',
      lastPlayed: 1,
      completed: false,
    });
    upsertLibraryEntry(s, {
      campaignId: 'procgen-b',
      themeName: 'Same',
      lastPlayed: 2,
      completed: false,
    });
    expect(computeHintsFromLibrary(s).avoidThemes).toEqual(['Same']);
  });
});
