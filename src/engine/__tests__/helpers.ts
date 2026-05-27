/**
 * Test helpers for the engine. Build minimal valid Puzzle, Solution,
 * and WorldState objects with overrides. Used across all engine tests.
 */

import type {
  AgentId,
  AgentState,
  CargoInstance,
  CargoType,
  Direction,
  InputSpec,
  Op,
  OutputSpec,
  PlacedTile,
  Pos,
  PosKey,
  Puzzle,
  PuzzleConstraints,
  ReactorRecipe,
  Solution,
  TileKind,
  TileState,
  WorldState,
} from '../types';
import { posKey } from '../types';

// ─── World ─────────────────────────────────────────────────────────
export function emptyWorld(): WorldState {
  return {
    cycle: 0,
    cargoOnTiles: {},
    agents: {},
    tileState: {},
    deliveredCounts: {},
    cumulativeEmissions: 0,
    cumulativeReactorConsumed: 0,
    cumulativeReactorProduced: 0,
    nextCargoId: 0,
  };
}

export interface WorldOverrides {
  cycle?: number;
  cargo?: Readonly<Record<PosKey, readonly CargoInstance[]>>;
  agents?: Readonly<Record<AgentId, AgentState>>;
  tileState?: Readonly<Record<PosKey, TileState>>;
  delivered?: Readonly<Record<CargoType, number>>;
  emissions?: number;
  reactorConsumed?: number;
  reactorProduced?: number;
  nextCargoId?: number;
}

export function makeWorld(o: WorldOverrides = {}): WorldState {
  const base = emptyWorld();
  return {
    cycle: o.cycle ?? base.cycle,
    cargoOnTiles: o.cargo ?? base.cargoOnTiles,
    agents: o.agents ?? base.agents,
    tileState: o.tileState ?? base.tileState,
    deliveredCounts: o.delivered ?? base.deliveredCounts,
    cumulativeEmissions: o.emissions ?? base.cumulativeEmissions,
    cumulativeReactorConsumed: o.reactorConsumed ?? base.cumulativeReactorConsumed,
    cumulativeReactorProduced: o.reactorProduced ?? base.cumulativeReactorProduced,
    nextCargoId: o.nextCargoId ?? base.nextCargoId,
  };
}

// ─── Cargo ─────────────────────────────────────────────────────────
export function cargo(id: number, type: CargoType): CargoInstance {
  return { id, type };
}

/** Convenience: build a cargoOnTiles map from a pos→cargos object literal. */
export function cargoMap(
  entries: Record<string, readonly CargoInstance[]>,
): Record<PosKey, readonly CargoInstance[]> {
  return entries as Record<PosKey, readonly CargoInstance[]>;
}

// ─── Tiles ─────────────────────────────────────────────────────────
export function conveyor(pos: Pos, facing: Direction): PlacedTile {
  return { pos, kind: 'conveyor', facing };
}
export function splitter(pos: Pos, facing: Direction): PlacedTile {
  return { pos, kind: 'splitter', facing };
}
export function merger(pos: Pos, facing: Direction): PlacedTile {
  return { pos, kind: 'merger', facing };
}
export function filter(pos: Pos, facing: Direction, filterType: CargoType): PlacedTile {
  return { pos, kind: 'filter', facing, filterType };
}
export function reactor(pos: Pos, facing: Direction, recipe: ReactorRecipe): PlacedTile {
  return { pos, kind: 'reactor', facing, recipe };
}

// ─── Agents ────────────────────────────────────────────────────────
export function agentState(pos: Pos, overrides: Partial<AgentState> = {}): AgentState {
  return {
    pos,
    pathIndex: overrides.pathIndex ?? 0,
    programIndex: overrides.programIndex ?? 0,
    carrying: overrides.carrying ?? null,
  };
}

// ─── Puzzle / Solution ─────────────────────────────────────────────
export interface PuzzleOverrides {
  id?: string;
  grid?: { w: number; h: number };
  inputs?: readonly InputSpec[];
  outputs?: readonly OutputSpec[];
  agents?: readonly { id: AgentId; startPos: Pos; maxOps?: number }[];
  obstacles?: readonly Pos[];
  availableTiles?: readonly TileKind[];
  availableOps?: readonly Op['kind'][];
  constraints?: Partial<PuzzleConstraints>;
}

export function makePuzzle(o: PuzzleOverrides = {}): Puzzle {
  return {
    id: o.id ?? 'test',
    grid: o.grid ?? { w: 8, h: 6 },
    inputs: o.inputs ?? [],
    outputs: o.outputs ?? [],
    agents:
      o.agents?.map((a) => ({
        id: a.id,
        startPos: a.startPos,
        maxOps: a.maxOps ?? 16,
      })) ?? [],
    obstacles: o.obstacles ?? [],
    availableTiles: o.availableTiles ?? ['conveyor', 'splitter', 'merger', 'filter', 'reactor'],
    availableOps: o.availableOps ?? ['MOVE', 'GRAB', 'DROP', 'WAIT', 'SENSE'],
    constraints: {
      maxTiles: o.constraints?.maxTiles ?? 40,
      maxCycles: o.constraints?.maxCycles ?? 250,
    },
  };
}

export function makeSolution(
  tiles: readonly PlacedTile[] = [],
  paths: Record<AgentId, readonly Pos[]> = {},
  programs: Record<AgentId, readonly Op[]> = {},
): Solution {
  return { tiles, paths, programs };
}

// ─── Position helpers ──────────────────────────────────────────────
export function pk(x: number, y: number): PosKey {
  return posKey([x, y]);
}
