/**
 * Glyph families.
 *
 * Each family is a `Partial<Record<GlyphKey, PathData>>`. The
 * `default` family is canonical and complete — it overrides nothing
 * because it IS the baseline. Other families specify only the keys
 * they want to re-skin; missing keys fall back to default.
 *
 * Adding a family is purely content work: define new path-data
 * strings, list them under a new family id, and (for Phase 10) the
 * CLI's prompt builder gets a curated catalog from `families.json`.
 *
 * All paths are normalized to the [0,100] viewBox per glyphs/index.ts
 * conventions.
 */

import { GLYPHS, type GlyphKey } from './index';

export interface GlyphFamily {
  readonly id: string;
  readonly displayName: string;
  readonly variants: Readonly<Partial<Record<GlyphKey, string>>>;
}

export const DEFAULT_FAMILY_ID = 'default' as const;

const ALCHEMY: GlyphFamily = {
  id: 'alchemy',
  displayName: 'Alchemy',
  variants: {
    // Alembic — bulbous flask with a beak.
    input: 'M 30 35 A 18 22 0 1 0 70 35 L 78 70 L 22 70 Z M 70 30 L 90 18',
    // Phial — narrow vial with a stopper.
    output: 'M 35 25 H 65 V 35 H 60 V 80 H 40 V 35 H 35 Z',
    // Homunculus — small humanoid figure.
    agent: 'M 50 18 A 12 12 0 1 1 49.99 18 Z M 38 32 H 62 V 60 L 50 80 L 38 60 Z',
    // Leyline — flowing arrow with serifs.
    tile_conveyor: 'M 18 50 L 70 50 M 55 35 L 75 50 L 55 65 M 18 42 V 58',
    // Mortar — splitter as a Y crucible with a wide rim.
    tile_splitter:
      'M 50 18 V 78 M 18 48 L 50 48 M 8 40 L 18 40 L 18 56 L 8 56 Z M 50 48 L 18 30 M 50 48 L 18 66',
    // Distillation funnel — merger as two arms into a spout.
    tile_merger:
      'M 50 18 V 78 M 50 48 L 84 48 M 84 40 L 94 48 L 84 56 Z M 50 48 L 18 30 M 50 48 L 18 66',
    // Athanor furnace — filter as a peaked hourglass.
    tile_filter: 'M 25 20 H 75 L 50 50 L 75 80 H 25 L 50 50 Z M 50 14 V 24',
    // Transmutation circle — hexagonal reactor with inscribed triangle.
    tile_reactor:
      'M 50 18 L 78 34 L 78 66 L 50 82 L 22 66 L 22 34 Z M 50 36 L 68 64 L 32 64 Z M 50 50 A 4 4 0 1 1 49.99 50 Z',
  },
};

const FORENSICS: GlyphFamily = {
  id: 'forensics',
  displayName: 'Forensics',
  variants: {
    // Evidence locker — boxed envelope.
    input: 'M 22 30 H 78 V 75 H 22 Z M 22 30 L 50 50 L 78 30',
    // Case file — folder.
    output: 'M 22 30 H 50 V 38 H 78 V 78 H 22 Z',
    // Investigator — silhouette head + collar.
    agent: 'M 50 22 A 14 14 0 1 1 49.99 22 Z M 30 60 Q 50 48 70 60 V 80 H 30 Z',
    // Evidence arrow — outlined chevron.
    tile_conveyor: 'M 22 38 H 56 V 28 L 78 50 L 56 72 V 62 H 22 Z',
    // Splitter — branching pipe.
    tile_splitter: 'M 50 22 V 78 M 18 50 L 50 50 M 6 44 H 18 V 56 H 6 Z',
    // Merger — converging arrows.
    tile_merger: 'M 50 22 V 78 M 50 50 L 82 50 M 82 44 L 92 50 L 82 56 Z',
    // Filter — magnifying glass.
    tile_filter:
      'M 60 40 A 18 18 0 1 1 24 40 A 18 18 0 1 1 60 40 Z M 56 56 L 80 80 M 32 40 H 52 M 42 30 V 50',
    // Reactor — clipboard with checked circle.
    tile_reactor:
      'M 30 18 H 70 V 82 H 30 Z M 50 50 A 14 14 0 1 1 49.99 50 Z M 42 50 L 48 56 L 60 42',
  },
};

const SCIFI: GlyphFamily = {
  id: 'scifi',
  displayName: 'Sci-fi',
  variants: {
    // Reactor inlet — angular hopper.
    input: 'M 22 22 H 78 L 70 38 L 70 70 L 60 80 H 40 L 30 70 L 30 38 Z',
    // Containment vessel — cylinder with rings.
    output: 'M 30 22 H 70 V 78 H 30 Z M 30 38 H 70 M 30 62 H 70',
    // Drone — diamond core + tail.
    agent: 'M 50 20 L 70 50 L 50 80 L 30 50 Z M 50 50 A 6 6 0 1 1 49.99 50 Z',
    // Energy beam — thick directional shaft.
    tile_conveyor: 'M 18 42 H 60 V 30 L 82 50 L 60 70 V 58 H 18 Z',
    // Phase splitter — circuit fork.
    tile_splitter:
      'M 50 18 V 78 M 14 50 H 50 M 6 42 H 14 V 58 H 6 Z M 50 30 L 30 18 M 50 70 L 30 82',
    // Phase merger — circuit converge.
    tile_merger:
      'M 50 18 V 78 M 50 50 H 86 M 86 42 L 96 50 L 86 58 Z M 50 30 L 70 18 M 50 70 L 70 82',
    // Particle filter — diamond barrier.
    tile_filter: 'M 50 18 L 78 50 L 50 82 L 22 50 Z M 22 50 H 78 M 50 18 V 82',
    // Fusion chamber — gear/cog reactor.
    tile_reactor:
      'M 50 16 L 56 24 L 66 22 L 70 32 L 80 36 L 76 46 L 84 54 L 76 62 L 80 72 L 70 76 L 66 86 L 56 84 L 50 92 L 44 84 L 34 86 L 30 76 L 20 72 L 24 62 L 16 54 L 24 46 L 20 36 L 30 32 L 34 22 L 44 24 Z M 50 38 A 12 12 0 1 1 49.99 38 Z',
  },
};

export const GLYPH_FAMILIES: readonly GlyphFamily[] = [
  { id: DEFAULT_FAMILY_ID, displayName: 'Default', variants: GLYPHS },
  ALCHEMY,
  FORENSICS,
  SCIFI,
];

const FAMILY_BY_ID = new Map<string, GlyphFamily>(GLYPH_FAMILIES.map((f) => [f.id, f]));

/**
 * Resolve a single glyph key against a family-qualified variant
 * name (`"alchemy.alembic"`). The current variant grammar is
 * `<family>.<variant>` where the variant is "any name unique within
 * the family". For Phase 8, variants ARE the glyph_keys themselves —
 * each family has at most one variant per key. The grammar leaves
 * room for multiple variants per key (e.g. `alchemy.alembic-tall`)
 * which Phase 9+ can use to add per-tile-context skins.
 *
 * Returns the resolved path-data string. On any failure (unknown
 * family, unknown variant), returns the default family's path and
 * pushes a string to `warnings`.
 */
export function resolveGlyph(
  key: GlyphKey,
  variantRef: string | undefined,
  warnings: string[],
): string {
  if (variantRef) {
    const [familyId, variantName] = variantRef.includes('.')
      ? (variantRef.split('.', 2) as [string, string])
      : [variantRef, key];
    const family = FAMILY_BY_ID.get(familyId);
    if (!family) {
      warnings.push(`unknown glyph family '${familyId}' for key '${key}'; using default`);
    } else {
      // For Phase 8 the "variant name" equals the key; later phases
      // may add multi-variant families keyed by name.
      const path = family.variants[variantName as GlyphKey] ?? family.variants[key];
      if (path) return path;
      warnings.push(
        `family '${familyId}' has no variant for key '${key}'; falling back to default`,
      );
    }
  }
  // Default fallback.
  return GLYPHS[key];
}
