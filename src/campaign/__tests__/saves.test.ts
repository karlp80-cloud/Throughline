// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest';
import { fnv1a, manifestHash } from '../hash';
import {
  clearMigration,
  deleteSave,
  emptySave,
  loadSave,
  markPuzzleComplete,
  readLibrary,
  registerMigration,
  removeLibraryEntry,
  SAVE_VERSION,
  upsertLibraryEntry,
  writeSave,
} from '../saves';
import { MemoryStorageBackend } from '../storage';

const FAKE_MANIFEST = { id: 'x', acts: [] };
const HASH = manifestHash(FAKE_MANIFEST);

describe('hash', () => {
  test('same input → same hash', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
  });
  test('tiny change → different hash', () => {
    expect(fnv1a('hello')).not.toBe(fnv1a('hellp'));
  });
  test('manifest hash is order-independent', () => {
    const a = { foo: 1, bar: 2 };
    const b = { bar: 2, foo: 1 };
    expect(manifestHash(a)).toBe(manifestHash(b));
  });
});

describe('save round-trip', () => {
  test('missing save → kind: missing', () => {
    const r = loadSave(new MemoryStorageBackend(), 'c1', HASH);
    expect(r.kind).toBe('missing');
  });

  test('write then load round-trips intact', () => {
    const s = new MemoryStorageBackend();
    const save = emptySave('c1', FAKE_MANIFEST);
    writeSave(s, save);
    const r = loadSave(s, 'c1', HASH);
    expect(r.kind).toBe('parsed');
    if (r.kind === 'parsed') expect(r.save).toEqual(save);
  });

  test('corrupted JSON → kind: corrupted, no crash', () => {
    const s = new MemoryStorageBackend();
    s.write('throughline:campaign:c1', '{not valid json');
    expect(loadSave(s, 'c1', HASH).kind).toBe('corrupted');
  });

  test('schema-shaped but wrong types → corrupted', () => {
    const s = new MemoryStorageBackend();
    s.write(
      'throughline:campaign:c1',
      JSON.stringify({ version: 1, campaignId: 'c1' /* missing rest */ }),
    );
    expect(loadSave(s, 'c1', HASH).kind).toBe('corrupted');
  });

  test('hash mismatch → kind: hash_mismatch with save still returned', () => {
    const s = new MemoryStorageBackend();
    const save = emptySave('c1', { ...FAKE_MANIFEST, somethingElse: 1 });
    writeSave(s, save);
    const r = loadSave(s, 'c1', HASH);
    expect(r.kind).toBe('hash_mismatch');
    if (r.kind === 'hash_mismatch') expect(r.save.campaignId).toBe('c1');
  });

  test('future-version save → kind: too_new', () => {
    const s = new MemoryStorageBackend();
    s.write(
      'throughline:campaign:c1',
      JSON.stringify({
        version: 999,
        campaignId: 'c1',
        manifestHash: HASH,
        progress: {},
        lastPlayed: 0,
      }),
    );
    const r = loadSave(s, 'c1', HASH);
    expect(r.kind).toBe('too_new');
    if (r.kind === 'too_new') expect(r.seenVersion).toBe(999);
  });

  test('deleteSave removes the entry', () => {
    const s = new MemoryStorageBackend();
    writeSave(s, emptySave('c1', FAKE_MANIFEST));
    deleteSave(s, 'c1');
    expect(loadSave(s, 'c1', HASH).kind).toBe('missing');
  });
});

describe('migration harness', () => {
  afterEach(() => {
    // Reset any migrations between tests so they don't bleed.
    for (let v = 0; v < SAVE_VERSION; v++) clearMigration(v);
  });

  test('a registered v0 → v1 migrator runs on load', () => {
    if (SAVE_VERSION !== 1) {
      // If the current version moves, the registration below must too.
      return;
    }
    registerMigration(0, (raw) => {
      const o = raw as { campaignId: string; thingFromV0: string };
      return {
        version: 1,
        campaignId: o.campaignId,
        manifestHash: HASH,
        progress: {},
        lastPlayed: 0,
        // thingFromV0 dropped in v1
      };
    });
    const s = new MemoryStorageBackend();
    s.write(
      'throughline:campaign:c1',
      JSON.stringify({ version: 0, campaignId: 'c1', thingFromV0: 'gone' }),
    );
    const r = loadSave(s, 'c1', HASH);
    expect(r.kind).toBe('parsed');
    if (r.kind === 'parsed') expect(r.save.version).toBe(1);
  });

  test('missing migrator for an older version → corrupted', () => {
    if (SAVE_VERSION !== 1) return;
    const s = new MemoryStorageBackend();
    s.write('throughline:campaign:c1', JSON.stringify({ version: 0, campaignId: 'c1' }));
    // No migrator registered.
    expect(loadSave(s, 'c1', HASH).kind).toBe('corrupted');
  });
});

describe('markPuzzleComplete', () => {
  test('adds a new puzzle to the act’s completion list', () => {
    const base = emptySave('c1', FAKE_MANIFEST);
    const after = markPuzzleComplete(base, 'act1', 'p1', ['opt_fast'], 1234);
    expect(after.progress['act1']?.completedPuzzleIds).toEqual(['p1']);
    expect(after.progress['act1']?.optionalsEarned['p1']).toEqual(['opt_fast']);
    expect(after.lastPlayed).toBe(1234);
  });

  test('does not duplicate an already-completed puzzle', () => {
    let s = emptySave('c1', FAKE_MANIFEST);
    s = markPuzzleComplete(s, 'act1', 'p1', ['opt_fast'], 1);
    s = markPuzzleComplete(s, 'act1', 'p1', ['opt_lean'], 2);
    expect(s.progress['act1']?.completedPuzzleIds).toEqual(['p1']);
    // The newly earned optional is added to the existing set.
    expect(s.progress['act1']?.optionalsEarned['p1']).toEqual(['opt_fast', 'opt_lean']);
  });
});

describe('library', () => {
  test('upsert sorts by lastPlayed descending', () => {
    const s = new MemoryStorageBackend();
    upsertLibraryEntry(s, { campaignId: 'a', themeName: 'A', lastPlayed: 100, completed: false });
    upsertLibraryEntry(s, { campaignId: 'b', themeName: 'B', lastPlayed: 300, completed: false });
    upsertLibraryEntry(s, { campaignId: 'c', themeName: 'C', lastPlayed: 200, completed: false });
    const after = JSON.parse(s.read('throughline:library')!) as {
      entries: { campaignId: string }[];
    };
    expect(after.entries.map((e) => e.campaignId)).toEqual(['b', 'c', 'a']);
  });

  test('upsert replaces an existing entry rather than duplicating', () => {
    const s = new MemoryStorageBackend();
    upsertLibraryEntry(s, { campaignId: 'a', themeName: 'A', lastPlayed: 100, completed: false });
    upsertLibraryEntry(s, { campaignId: 'a', themeName: 'A', lastPlayed: 200, completed: true });
    const after = JSON.parse(s.read('throughline:library')!) as { entries: unknown[] };
    expect(after.entries).toHaveLength(1);
  });

  test('removeLibraryEntry removes', () => {
    const s = new MemoryStorageBackend();
    upsertLibraryEntry(s, { campaignId: 'a', themeName: 'A', lastPlayed: 100, completed: false });
    removeLibraryEntry(s, 'a');
    const after = JSON.parse(s.read('throughline:library')!) as { entries: unknown[] };
    expect(after.entries).toEqual([]);
  });

  test('corrupted library JSON yields an empty index, not a crash', () => {
    const s = new MemoryStorageBackend();
    s.write('throughline:library', 'not json');
    upsertLibraryEntry(s, { campaignId: 'a', themeName: 'A', lastPlayed: 100, completed: false });
    const after = JSON.parse(s.read('throughline:library')!) as { entries: unknown[] };
    expect(after.entries).toHaveLength(1);
  });

  // Phase 11: additive optional `sourcePath` field on LibraryEntry.
  // Generated campaigns store the absolute path of the on-disk
  // manifest so the harness can re-load it from the LibraryIndex on
  // launch. Built-in entries omit the field; the defensive shape
  // filter in `readLibrary` must accept both.

  test('sourcePath round-trips intact through write/read', () => {
    const s = new MemoryStorageBackend();
    upsertLibraryEntry(s, {
      campaignId: 'procgen-abc-1',
      themeName: 'Generated Theme',
      lastPlayed: 100,
      completed: false,
      sourcePath: 'C:\\Users\\karlp\\AppData\\Roaming\\org.throughline.app\\campaigns\\abc-1.json',
    });
    const lib = readLibrary(s);
    expect(lib.entries).toHaveLength(1);
    expect(lib.entries[0]?.sourcePath).toBe(
      'C:\\Users\\karlp\\AppData\\Roaming\\org.throughline.app\\campaigns\\abc-1.json',
    );
  });

  test('entries without sourcePath continue to round-trip (built-ins)', () => {
    const s = new MemoryStorageBackend();
    upsertLibraryEntry(s, {
      campaignId: 'demo-two-act',
      themeName: 'The Workshop',
      lastPlayed: 50,
      completed: true,
    });
    const lib = readLibrary(s);
    expect(lib.entries).toHaveLength(1);
    expect(lib.entries[0]?.sourcePath).toBeUndefined();
  });

  test('defensive filter rejects entries with non-string sourcePath', () => {
    const s = new MemoryStorageBackend();
    // Hand-craft a library blob with one valid entry and one
    // entry whose `sourcePath` is a wrong type (number). The
    // filter must drop the bad entry and keep the good one.
    s.write(
      'throughline:library',
      JSON.stringify({
        version: 1,
        entries: [
          {
            campaignId: 'good',
            themeName: 'OK',
            lastPlayed: 1,
            completed: false,
            sourcePath: '/x/y.json',
          },
          {
            campaignId: 'bad',
            themeName: 'NO',
            lastPlayed: 2,
            completed: false,
            sourcePath: 42, // wrong type
          },
        ],
      }),
    );
    const lib = readLibrary(s);
    expect(lib.entries.map((e) => e.campaignId)).toEqual(['good']);
  });
});
