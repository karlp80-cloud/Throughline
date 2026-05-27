/**
 * Public engine surface.
 *
 * Phase 7's manifest loader, Phase 4's animator, and Phase 10's CLI
 * solvability check all import from here — never from internal
 * modules under `src/engine/`.
 */

export { runUntilHalt, initialWorld, checkVictory } from './run';
export { stepOnce } from './step';
export type {
  AgentEvent,
  AgentId,
  AgentIntent,
  AgentSpec,
  AgentState,
  CargoInstance,
  CargoType,
  CollisionEvent,
  CycleTrace,
  DeliveryEvent,
  Direction,
  EmissionEvent,
  EngineStatus,
  InputSpec,
  Op,
  OutputRequirement,
  OutputSpec,
  PlacedTile,
  Pos,
  PosKey,
  Puzzle,
  PuzzleConstraints,
  ReactorRecipe,
  RunResult,
  Solution,
  ThenOp,
  TileIntent,
  TileKind,
  TileState,
  WorldState,
} from './types';
export { fromPosKey, neighbor, opposite, perpendiculars, posKey } from './types';
