/**
 * Save / library types + the persistence + migration logic.
 *
 * Each campaign gets its own save under `throughline:campaign:<id>`.
 * The library index lives under `throughline:library`.
 *
 * Failure modes — all surface as a `LoadResult`:
 *   - missing       → no save on disk; player starts fresh.
 *   - parsed        → save loaded, possibly migrated.
 *   - hash_mismatch → save loaded but its manifestHash doesn't match
 *                     the current manifest. Caller decides (typically
 *                     warns + offers reset).
 *   - corrupted     → JSON parse error or schema mismatch. Caller
 *                     should ignore the saved data and start fresh
 *                     (the corrupted blob is left in place; the user
 *                     can delete it if they wish).
 *   - too_new       → save's `version` > currentVersion. Refuse.
 */

import { manifestHash as computeManifestHash } from './hash';
import type { StorageBackend } from './storage';

export const SAVE_VERSION = 1 as const;
export const LIBRARY_VERSION = 1 as const;

export type ActId = string;
export type PuzzleId = string;
export type ChallengeId = string;

export interface ActProgress {
  readonly completedPuzzleIds: readonly PuzzleId[];
  readonly optionalsEarned: Readonly<Record<PuzzleId, readonly ChallengeId[]>>;
}

export interface CampaignSave {
  readonly version: number;
  readonly campaignId: string;
  readonly manifestHash: string;
  readonly progress: Readonly<Record<ActId, ActProgress>>;
  readonly lastPlayed: number;
}

export interface LibraryEntry {
  readonly campaignId: string;
  readonly themeName: string;
  readonly lastPlayed: number;
  readonly completed: boolean;
  /**
   * Absolute path of the on-disk manifest for procgen-generated
   * campaigns; absent for built-ins (whose manifest is bundled).
   * Phase 11 addition — additive optional, no LIBRARY_VERSION bump.
   */
  readonly sourcePath?: string;
}

export interface LibraryIndex {
  readonly version: number;
  readonly entries: readonly LibraryEntry[];
}

export type LoadResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'parsed'; readonly save: CampaignSave }
  | { readonly kind: 'hash_mismatch'; readonly save: CampaignSave }
  | { readonly kind: 'corrupted' }
  | { readonly kind: 'too_new'; readonly seenVersion: number };

// ─── Keys ───────────────────────────────────────────────────────────
const CAMPAIGN_KEY_PREFIX = 'throughline:campaign:';
const LIBRARY_KEY = 'throughline:library';

export function campaignKey(id: string): string {
  return CAMPAIGN_KEY_PREFIX + id;
}

// ─── Migration registry ────────────────────────────────────────────
type Migrator = (data: unknown) => unknown;
const migrators = new Map<number, Migrator>();

/**
 * Register a `from → from+1` save migrator. Phase 7 ships no
 * migrators; later phases append here. Tests register synthetic
 * migrators to exercise the chain.
 */
export function registerMigration(from: number, migrate: Migrator): void {
  migrators.set(from, migrate);
}

/** Drop a registered migrator. For test isolation only. */
export function clearMigration(from: number): void {
  migrators.delete(from);
}

function tryMigrate(
  raw: unknown,
):
  | { ok: true; save: CampaignSave }
  | { ok: false; reason: 'too_new' | 'corrupted'; seenVersion?: number } {
  let current: unknown = raw;
  // Run a loose shape check first.
  if (
    current === null ||
    typeof current !== 'object' ||
    typeof (current as { version?: unknown }).version !== 'number'
  ) {
    return { ok: false, reason: 'corrupted' };
  }
  let safety = 0;
  while ((current as { version: number }).version < SAVE_VERSION) {
    const v = (current as { version: number }).version;
    const m = migrators.get(v);
    if (!m) return { ok: false, reason: 'corrupted' };
    current = m(current);
    if (++safety > 20) return { ok: false, reason: 'corrupted' };
  }
  if ((current as { version: number }).version > SAVE_VERSION) {
    return { ok: false, reason: 'too_new', seenVersion: (current as { version: number }).version };
  }
  if (!isCampaignSave(current)) {
    return { ok: false, reason: 'corrupted' };
  }
  return { ok: true, save: current };
}

function isCampaignSave(v: unknown): v is CampaignSave {
  if (v === null || typeof v !== 'object') return false;
  const s = v as Partial<CampaignSave>;
  return (
    typeof s.version === 'number' &&
    typeof s.campaignId === 'string' &&
    typeof s.manifestHash === 'string' &&
    typeof s.progress === 'object' &&
    s.progress !== null &&
    typeof s.lastPlayed === 'number'
  );
}

// ─── Persistence API ───────────────────────────────────────────────
export function loadSave(
  storage: StorageBackend,
  campaignId: string,
  expectedManifestHash: string,
): LoadResult {
  const raw = storage.read(campaignKey(campaignId));
  if (raw === null) return { kind: 'missing' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'corrupted' };
  }
  const m = tryMigrate(parsed);
  if (!m.ok) {
    if (m.reason === 'too_new') return { kind: 'too_new', seenVersion: m.seenVersion ?? -1 };
    return { kind: 'corrupted' };
  }
  if (m.save.manifestHash !== expectedManifestHash) {
    return { kind: 'hash_mismatch', save: m.save };
  }
  return { kind: 'parsed', save: m.save };
}

export function writeSave(storage: StorageBackend, save: CampaignSave): void {
  storage.write(campaignKey(save.campaignId), JSON.stringify(save));
}

export function deleteSave(storage: StorageBackend, campaignId: string): void {
  storage.delete(campaignKey(campaignId));
}

// ─── Library API ───────────────────────────────────────────────────
export function readLibrary(storage: StorageBackend): LibraryIndex {
  const raw = storage.read(LIBRARY_KEY);
  if (raw === null) return { version: LIBRARY_VERSION, entries: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<LibraryIndex>;
    if (typeof parsed?.version !== 'number' || !Array.isArray(parsed.entries)) {
      return { version: LIBRARY_VERSION, entries: [] };
    }
    // Defensive: filter entries that don't match the expected shape.
    // Phase 11: `sourcePath` is optional but, when present, must be a
    // string. A wrong-typed `sourcePath` is treated as corruption and
    // the whole entry is dropped (not silently coerced).
    const cleaned = parsed.entries.filter(
      (e): e is LibraryEntry =>
        e !== null &&
        typeof e === 'object' &&
        typeof (e as LibraryEntry).campaignId === 'string' &&
        typeof (e as LibraryEntry).themeName === 'string' &&
        typeof (e as LibraryEntry).lastPlayed === 'number' &&
        typeof (e as LibraryEntry).completed === 'boolean' &&
        (typeof (e as LibraryEntry).sourcePath === 'undefined' ||
          typeof (e as LibraryEntry).sourcePath === 'string'),
    );
    return { version: LIBRARY_VERSION, entries: cleaned };
  } catch {
    return { version: LIBRARY_VERSION, entries: [] };
  }
}

export function writeLibrary(storage: StorageBackend, lib: LibraryIndex): void {
  storage.write(LIBRARY_KEY, JSON.stringify(lib));
}

export function upsertLibraryEntry(storage: StorageBackend, entry: LibraryEntry): LibraryIndex {
  const lib = readLibrary(storage);
  const without = lib.entries.filter((e) => e.campaignId !== entry.campaignId);
  // Most-recently-played first.
  const next: LibraryIndex = {
    version: LIBRARY_VERSION,
    entries: [entry, ...without].sort((a, b) => b.lastPlayed - a.lastPlayed),
  };
  writeLibrary(storage, next);
  return next;
}

export function removeLibraryEntry(storage: StorageBackend, campaignId: string): LibraryIndex {
  const lib = readLibrary(storage);
  const next: LibraryIndex = {
    version: LIBRARY_VERSION,
    entries: lib.entries.filter((e) => e.campaignId !== campaignId),
  };
  writeLibrary(storage, next);
  return next;
}

// ─── Helpers ───────────────────────────────────────────────────────
export function emptySave(campaignId: string, manifest: unknown): CampaignSave {
  return {
    version: SAVE_VERSION,
    campaignId,
    manifestHash: computeManifestHash(manifest),
    progress: {},
    lastPlayed: 0,
  };
}

export function markPuzzleComplete(
  save: CampaignSave,
  actId: ActId,
  puzzleId: PuzzleId,
  earnedOptionals: readonly ChallengeId[],
  nowMs: number,
): CampaignSave {
  const prev: ActProgress = save.progress[actId] ?? {
    completedPuzzleIds: [],
    optionalsEarned: {},
  };
  const completed = prev.completedPuzzleIds.includes(puzzleId)
    ? prev.completedPuzzleIds
    : [...prev.completedPuzzleIds, puzzleId];
  const earned = {
    ...prev.optionalsEarned,
    [puzzleId]: dedupedSorted([...(prev.optionalsEarned[puzzleId] ?? []), ...earnedOptionals]),
  };
  return {
    ...save,
    lastPlayed: nowMs,
    progress: {
      ...save.progress,
      [actId]: { completedPuzzleIds: completed, optionalsEarned: earned },
    },
  };
}

function dedupedSorted<T>(items: readonly T[]): readonly T[] {
  return Array.from(new Set(items)).sort();
}
