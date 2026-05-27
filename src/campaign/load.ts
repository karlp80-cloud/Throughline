/**
 * Convert a validated `RawCampaign` (snake_case from the JSON schema)
 * into engine-shaped `Puzzle` records (camelCase). The non-engine
 * metadata — title, briefing, intro/outro text — stays accessible
 * via the original RawCampaign which the UI consults directly.
 */

import type { Puzzle } from '../engine';
import type { RawPuzzle } from '../schema/campaign';

export function toEnginePuzzle(p: RawPuzzle): Puzzle {
  return {
    id: p.id,
    grid: p.grid,
    inputs: p.inputs.map((i) => ({
      pos: i.pos,
      emits: i.emits,
      rate: i.rate,
      ...(i.facing ? { facing: i.facing } : {}),
    })),
    outputs: p.outputs.map((o) => ({
      pos: o.pos,
      required: o.required.map((r) => ({ type: r.type, count: r.count })),
    })),
    agents: p.agents.map((a) => ({
      id: a.id,
      startPos: a.start_pos,
      maxOps: a.max_ops,
    })),
    obstacles: p.obstacles,
    availableTiles: p.available_tiles,
    availableOps: p.available_ops,
    constraints: {
      maxTiles: p.constraints.max_tiles,
      maxCycles: p.constraints.max_cycles,
    },
    optionalChallenges: p.optional_challenges.map((c) => ({
      id: c.id,
      label: c.label,
      rule: c.rule,
    })),
  };
}
