/**
 * fast-check generators for property tests.
 *
 * Builds well-formed Puzzle + Solution pairs over a small space
 * (3–6 wide grids, 2–4 tall; 1–3 agents; 1–2 inputs/outputs at the
 * left/right edges; simple programs). Puzzles aren't necessarily
 * solvable — the goal is to exercise engine invariants under
 * arbitrary inputs, not to win.
 *
 * Critically: a conveyor is auto-placed at EVERY input cell facing
 * east, so emitted cargo immediately enters the tile-transport
 * machinery. Additional random tiles in middle cells extend the
 * pipeline. Without this, the reviewer noticed the generator never
 * exercised tile intent application during the 200 random runs.
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

// Includes 'reactor' so the generator actually exercises consume/produce.
const tileSlotArb = fc.tuple(
  fc.constantFrom<TileKind>('conveyor', 'splitter', 'merger', 'filter', 'reactor'),
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
  // Inputs at left edge (col 0), outputs at right edge (col w-1), capped by h.
  const inputCells: Pos[] = [];
  for (let i = 0; i < Math.min(spec.inputCount, spec.h); i++) {
    inputCells.push([0, i]);
  }
  const outputCells: Pos[] = [];
  for (let i = 0; i < Math.min(spec.outputCount, spec.h); i++) {
    outputCells.push([spec.w - 1, i]);
  }

  const inputs = inputCells.map((pos) => ({
    pos,
    emits: [spec.emitsType] as readonly CargoType[],
    rate: spec.rate,
  }));
  const outputs = outputCells.map((pos) => ({
    pos,
    // Count 99 so 25 cycles can't satisfy it — keeps a running stream
    // and makes the conservation invariant non-trivial.
    required: [{ type: spec.outputType, count: 99 }] as const,
  }));

  // All grid cells in row-major order.
  const cells: Pos[] = [];
  for (let y = 0; y < spec.h; y++) {
    for (let x = 0; x < spec.w; x++) {
      cells.push([x, y]);
    }
  }

  const reservedKeys = new Set<string>([
    ...inputCells.map((p) => posKey(p)),
    ...outputCells.map((p) => posKey(p)),
  ]);
  const middle = cells.filter((c) => !reservedKeys.has(posKey(c)));

  // Agents: first agentCount middle cells. Avoid input/output overlap.
  const agents = middle.slice(0, spec.agentCount).map((pos, i) => ({
    id: `a${i}` as AgentId,
    startPos: pos,
    maxOps: 16,
  }));
  for (const a of agents) reservedKeys.add(posKey(a.startPos));

  // Tiles:
  //   1) Auto-place a conveyor at each input cell facing E, so cargo
  //      emitted on it immediately enters the transport pipeline.
  //   2) Add up to spec.tileCount more tiles in remaining middle cells.
  const tiles: PlacedTile[] = [];
  for (const pos of inputCells) {
    tiles.push({ pos, kind: 'conveyor', facing: 'E' });
  }
  const remainingMiddle = middle.filter((c) => !reservedKeys.has(posKey(c)));
  for (
    let i = 0;
    i < Math.min(spec.tileCount, remainingMiddle.length, spec.tileSlots.length);
    i++
  ) {
    const pos = remainingMiddle[i]!;
    const [kind, facing, filterType] = spec.tileSlots[i]!;
    if (kind === 'filter') {
      tiles.push({ pos, kind, facing, filterType });
    } else if (kind === 'reactor') {
      // Single-input recipe consuming the emitted type. Keeps generator
      // simple — the reactor exercises consume+produce+transport paths
      // without needing to coordinate with a second input stream.
      tiles.push({
        pos,
        kind,
        facing,
        recipe: { inputs: [spec.emitsType], output: 'delta' },
      });
    } else {
      tiles.push({ pos, kind, facing });
    }
  }

  // Paths: 2-cell when an east neighbor is available (non-reserved &
  // in-grid), else 1-cell. With a 2-cell path the agent's MOVE op
  // actually moves, exercising movement under conservation.
  const paths: Record<AgentId, readonly Pos[]> = {};
  const programs: Record<AgentId, readonly Op[]> = {};
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i]!;
    const east: Pos = [agent.startPos[0] + 1, agent.startPos[1]];
    const eastValid =
      east[0] < spec.w &&
      east[1] >= 0 &&
      east[1] < spec.h &&
      !inputCells.some((p) => posKey(p) === posKey(east)) &&
      !outputCells.some((p) => posKey(p) === posKey(east));
    paths[agent.id] = eastValid ? [agent.startPos, east] : [agent.startPos];
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
    optionalChallenges: [],
  };

  return { puzzle, solution: { tiles, paths, programs } };
}
