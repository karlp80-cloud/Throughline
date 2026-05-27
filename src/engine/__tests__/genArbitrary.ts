/**
 * fast-check generators for property tests. Builds well-formed Puzzle
 * + Solution pairs over a small space (4–6 wide grids, 1–3 agents,
 * 1–2 inputs/outputs, simple programs). The puzzles aren't necessarily
 * solvable — the goal is to exercise engine invariants under arbitrary
 * inputs, not to win.
 */

import * as fc from 'fast-check';
import type {
  AgentId,
  CargoType,
  Direction,
  Op,
  PlacedTile,
  Pos,
  Puzzle,
  Solution,
  TileKind,
} from '../types';
import { posKey } from '../types';

const directionArb = fc.constantFrom<Direction>('N', 'E', 'S', 'W');

const leafOpArb = fc.constantFrom<Op>(
  { kind: 'MOVE' },
  { kind: 'GRAB' },
  { kind: 'DROP' },
  { kind: 'WAIT' },
);

const cargoTypeArb = fc.constantFrom<CargoType>('alpha', 'beta', 'gamma');

const tileSlotArb = fc.tuple(
  fc.constantFrom<TileKind>('conveyor', 'splitter', 'merger', 'filter'),
  directionArb,
  cargoTypeArb,
);

export interface ScenarioSpec {
  readonly w: number;
  readonly h: number;
  readonly inputCount: number;
  readonly outputCount: number;
  readonly agentCount: number;
  readonly tileCount: number;
  readonly rate: number;
  readonly emitsType: CargoType;
  readonly outputType: CargoType;
  readonly tileSlots: readonly (readonly [TileKind, Direction, CargoType])[];
  readonly agentPrograms: readonly (readonly Op[])[];
}

export const scenarioSpecArb: fc.Arbitrary<ScenarioSpec> = fc.record({
  w: fc.integer({ min: 3, max: 6 }),
  h: fc.integer({ min: 2, max: 4 }),
  inputCount: fc.integer({ min: 1, max: 2 }),
  outputCount: fc.integer({ min: 1, max: 2 }),
  agentCount: fc.integer({ min: 0, max: 2 }),
  tileCount: fc.integer({ min: 0, max: 6 }),
  rate: fc.integer({ min: 1, max: 3 }),
  emitsType: cargoTypeArb,
  outputType: cargoTypeArb,
  tileSlots: fc.array(tileSlotArb, { minLength: 0, maxLength: 12 }),
  agentPrograms: fc.array(fc.array(leafOpArb, { minLength: 1, maxLength: 6 }), {
    minLength: 0,
    maxLength: 3,
  }),
});

export function buildScenario(spec: ScenarioSpec): { puzzle: Puzzle; solution: Solution } {
  // Enumerate cells in row-major order for deterministic placement.
  const cells: Pos[] = [];
  for (let y = 0; y < spec.h; y++) {
    for (let x = 0; x < spec.w; x++) {
      cells.push([x, y]);
    }
  }
  const total = cells.length;

  // Inputs: first N cells.
  const inputs = cells
    .slice(0, Math.min(spec.inputCount, total))
    .map((pos) => ({ pos, emits: [spec.emitsType] as const, rate: spec.rate }));

  // Outputs: last N cells (avoiding overlap with inputs).
  const outputStart = Math.max(spec.inputCount, total - spec.outputCount);
  const outputs = cells.slice(outputStart).map((pos) => ({
    pos,
    required: [{ type: spec.outputType, count: 99 }] as const,
  }));

  // Agents + tiles share the "middle".
  const usedKeys = new Set<string>([
    ...inputs.map((i) => posKey(i.pos)),
    ...outputs.map((o) => posKey(o.pos)),
  ]);
  const middle = cells.filter((c) => !usedKeys.has(posKey(c)));

  const agents = middle.slice(0, spec.agentCount).map((pos, i) => ({
    id: `a${i}` as AgentId,
    startPos: pos,
    maxOps: 16,
  }));
  for (const a of agents) usedKeys.add(posKey(a.startPos));

  // Tile cells: remaining middle.
  const tileCells = middle.slice(spec.agentCount);
  const tiles: PlacedTile[] = [];
  for (let i = 0; i < Math.min(spec.tileCount, tileCells.length, spec.tileSlots.length); i++) {
    const pos = tileCells[i]!;
    const slot = spec.tileSlots[i]!;
    const [kind, facing, filterType] = slot;
    const tile: PlacedTile =
      kind === 'filter' ? { pos, kind, facing, filterType } : { pos, kind, facing };
    tiles.push(tile);
  }

  // Paths: each agent gets a 1-cell path (its start). MOVE → no-op.
  // Programs: from spec, defaulting to [WAIT] when missing.
  const paths: Record<AgentId, readonly Pos[]> = {};
  const programs: Record<AgentId, readonly Op[]> = {};
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i]!;
    paths[agent.id] = [agent.startPos];
    programs[agent.id] = spec.agentPrograms[i] ?? [{ kind: 'WAIT' }];
  }

  const puzzle: Puzzle = {
    id: 'arb',
    grid: { w: spec.w, h: spec.h },
    inputs,
    outputs,
    agents,
    obstacles: [],
    availableTiles: ['conveyor', 'splitter', 'merger', 'filter', 'reactor'],
    availableOps: ['MOVE', 'GRAB', 'DROP', 'WAIT', 'SENSE'],
    constraints: { maxTiles: 40, maxCycles: 30 },
  };

  return { puzzle, solution: { tiles, paths, programs } };
}
