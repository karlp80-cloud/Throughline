/**
 * Type contracts for the headless puzzle engine.
 *
 * See docs/architecture/engine.md for the design memo this module
 * implements. No behavior here — only shapes.
 *
 * All types are `readonly`. The engine builds new WorldState snapshots
 * per cycle; nothing mutates in place.
 */

// ─── Coordinates ───────────────────────────────────────────────────
export type Pos = readonly [x: number, y: number];
export type Direction = 'N' | 'E' | 'S' | 'W';

/**
 * Position-keyed string for use as Record keys. `${x},${y}`.
 * Sortable for deterministic iteration.
 */
export type PosKey = `${number},${number}`;

// ─── Cargo ─────────────────────────────────────────────────────────
/** Opaque cargo-type name from the puzzle DSL (e.g. 'alpha'). */
export type CargoType = string;

/**
 * One cargo unit. The `id` is a monotonic counter assigned at
 * emission (or reactor production); it gives every unit identity
 * for the conservation invariant check.
 */
export interface CargoInstance {
  readonly id: number;
  readonly type: CargoType;
}

// ─── Tiles (placed by player) ──────────────────────────────────────
export type TileKind = 'conveyor' | 'splitter' | 'merger' | 'filter' | 'reactor';

export interface ReactorRecipe {
  /** Inputs sorted lexicographically for deterministic matching. */
  readonly inputs: readonly CargoType[];
  readonly output: CargoType;
}

export interface PlacedTile {
  readonly pos: Pos;
  readonly kind: TileKind;
  /** Primary facing; see engine.md §4 for per-kind interpretation. */
  readonly facing: Direction;
  /** Required when kind === 'filter'. */
  readonly filterType?: CargoType;
  /** Required when kind === 'reactor'. */
  readonly recipe?: ReactorRecipe;
}

// ─── Agents & Ops ──────────────────────────────────────────────────
export type AgentId = string;

/** Leaf op = anything but SENSE. Used as a SENSE branch (no nesting). */
export type ThenOp =
  | { readonly kind: 'MOVE' }
  | { readonly kind: 'GRAB' }
  | { readonly kind: 'DROP' }
  | { readonly kind: 'WAIT' };

export type Op =
  | ThenOp
  | {
      readonly kind: 'SENSE';
      readonly expects: CargoType;
      readonly then: ThenOp;
      readonly otherwise: ThenOp;
    };

export interface AgentSpec {
  readonly id: AgentId;
  readonly startPos: Pos;
  /** Hard cap on `programs[id].length`. */
  readonly maxOps: number;
}

// ─── Puzzle definition ─────────────────────────────────────────────
export interface InputSpec {
  readonly pos: Pos;
  /** Emission rotates through this array. */
  readonly emits: readonly CargoType[];
  /** Emits when `cycle % rate === 0`. Must be >= 1. */
  readonly rate: number;
  /**
   * Direction the input auto-ejects emitted cargo. The input cell
   * acts as an implicit conveyor in this direction: cargo emitted
   * at the input cell moves one step in `facing` on the same cycle,
   * so players don't need to place a tile at the input cell to
   * "free" the cargo. Defaults to 'E'.
   */
  readonly facing?: Direction;
}

export interface OutputRequirement {
  readonly type: CargoType;
  readonly count: number;
}

export interface OutputSpec {
  readonly pos: Pos;
  readonly required: readonly OutputRequirement[];
}

export interface PuzzleConstraints {
  readonly maxTiles: number;
  readonly maxCycles: number;
}

export interface OptionalChallenge {
  readonly id: string;
  readonly label: string;
  /** Rule DSL expression (see docs/architecture/rule-dsl.md). */
  readonly rule: string;
}

export interface Puzzle {
  readonly id: string;
  readonly grid: { readonly w: number; readonly h: number };
  readonly inputs: readonly InputSpec[];
  readonly outputs: readonly OutputSpec[];
  readonly agents: readonly AgentSpec[];
  readonly obstacles: readonly Pos[];
  readonly availableTiles: readonly TileKind[];
  readonly availableOps: readonly Op['kind'][];
  readonly constraints: PuzzleConstraints;
  /** Optional challenges; each has a rule DSL string evaluated post-victory. */
  readonly optionalChallenges: readonly OptionalChallenge[];
  /**
   * Reactor recipes the puzzle author has pre-declared. The editor uses
   * these to populate the `recipe` field on placed reactor tiles — if a
   * puzzle exposes exactly one recipe, placing a reactor uses it
   * automatically; multiple recipes drive a picker UI. Required for any
   * puzzle that lists 'reactor' in `availableTiles`; an empty list is
   * a configuration error.
   */
  readonly reactorRecipes?: readonly ReactorRecipe[];
  /**
   * Filter types the puzzle author has pre-declared. Same role as
   * `reactorRecipes` but for filter tiles.
   */
  readonly filterTypes?: readonly CargoType[];
}

// ─── Player solution ───────────────────────────────────────────────
export interface Solution {
  readonly tiles: readonly PlacedTile[];
  /** Polyline path per agent; agent advances along it on MOVE. */
  readonly paths: Readonly<Record<AgentId, readonly Pos[]>>;
  /** Op list per agent; loops indefinitely. */
  readonly programs: Readonly<Record<AgentId, readonly Op[]>>;
}

// ─── Runtime state ─────────────────────────────────────────────────
export interface AgentState {
  readonly pos: Pos;
  readonly pathIndex: number; // wraps mod path.length
  readonly programIndex: number; // wraps mod program.length
  readonly carrying: CargoInstance | null;
}

/** Per-tile mutable state (splitter alternation toggle, etc.). */
export interface TileState {
  readonly splitterNextOut?: Direction;
}

export interface WorldState {
  readonly cycle: number;
  readonly cargoOnTiles: Readonly<Record<PosKey, readonly CargoInstance[]>>;
  readonly agents: Readonly<Record<AgentId, AgentState>>;
  readonly tileState: Readonly<Record<PosKey, TileState>>;
  readonly deliveredCounts: Readonly<Record<CargoType, number>>;
  /** Monotonic count of all cargo emitted from inputs since cycle 0. */
  readonly cumulativeEmissions: number;
  /** Total cargo consumed by reactors. */
  readonly cumulativeReactorConsumed: number;
  /** Total cargo produced by reactors. */
  readonly cumulativeReactorProduced: number;
  /** Next id to assign to a newly emitted or produced cargo. */
  readonly nextCargoId: number;
}

// ─── Intents (collected in Phase A, applied in Phase B) ────────────
/**
 * A tile's declared effect for a single cycle, computed against the
 * start-of-cycle snapshot (after Phase 0 emissions).
 */
export type TileIntent =
  | {
      readonly kind: 'moveCargo';
      readonly cargo: CargoInstance;
      readonly from: Pos;
      readonly to: Pos;
    }
  | {
      readonly kind: 'consumeCargo';
      readonly cargo: CargoInstance;
      readonly at: Pos;
    }
  | {
      readonly kind: 'produceCargo';
      /** Type to produce; engine assigns id at apply time. */
      readonly cargoType: CargoType;
      readonly at: Pos;
    }
  | {
      readonly kind: 'flipSplitter';
      readonly at: Pos;
      readonly nextOut: Direction;
    };

/**
 * An agent's declared effect for a single cycle. The op-executed
 * field is what actually ran (post-SENSE branching).
 */
export type AgentIntent =
  | {
      readonly kind: 'move';
      readonly agent: AgentId;
      readonly from: Pos;
      readonly to: Pos;
      readonly opExecuted: ThenOp;
    }
  | {
      readonly kind: 'grab';
      readonly agent: AgentId;
      readonly at: Pos;
      readonly opExecuted: ThenOp;
    }
  | {
      readonly kind: 'drop';
      readonly agent: AgentId;
      readonly at: Pos;
      readonly opExecuted: ThenOp;
    }
  | {
      readonly kind: 'wait';
      readonly agent: AgentId;
      readonly at: Pos;
      readonly opExecuted: ThenOp;
    };

// ─── Trace ─────────────────────────────────────────────────────────
export interface EmissionEvent {
  readonly inputPos: Pos;
  readonly cargo: CargoInstance;
}
export interface AgentEvent {
  readonly agent: AgentId;
  readonly from: Pos;
  readonly to: Pos;
  readonly opExecuted: ThenOp;
}
export interface CollisionEvent {
  readonly pos: Pos;
  readonly winner: AgentId;
  readonly blocked: readonly AgentId[];
}
export interface DeliveryEvent {
  readonly outputPos: Pos;
  readonly cargo: CargoInstance;
}

export interface CycleTrace {
  readonly cycle: number;
  readonly emissions: readonly EmissionEvent[];
  readonly agentEvents: readonly AgentEvent[];
  readonly collisions: readonly CollisionEvent[];
  readonly deliveries: readonly DeliveryEvent[];
  readonly worldAfter: WorldState;
}

export type EngineStatus = 'victory' | 'cycle_limit_exceeded' | 'agent_deadlock';

export interface RunResult {
  readonly status: EngineStatus;
  readonly trace: readonly CycleTrace[];
}

// ─── Helpers (pure, no behavior beyond conversion) ─────────────────
/** Build the canonical PosKey for a Pos. */
export function posKey(p: Pos): PosKey {
  return `${p[0]},${p[1]}`;
}

/** Parse a PosKey back to a Pos. */
export function fromPosKey(k: PosKey): Pos {
  const [x, y] = k.split(',') as [string, string];
  return [Number(x), Number(y)];
}

/** Step one cell in a given direction. */
export function neighbor(p: Pos, dir: Direction): Pos {
  const [x, y] = p;
  switch (dir) {
    case 'N':
      return [x, y - 1];
    case 'E':
      return [x + 1, y];
    case 'S':
      return [x, y + 1];
    case 'W':
      return [x - 1, y];
  }
}

/** The two directions perpendicular to a primary direction. */
export function perpendiculars(dir: Direction): readonly [Direction, Direction] {
  switch (dir) {
    case 'N':
    case 'S':
      return ['E', 'W'];
    case 'E':
    case 'W':
      return ['N', 'S'];
  }
}

/** The opposite of a direction. */
export function opposite(dir: Direction): Direction {
  switch (dir) {
    case 'N':
      return 'S';
    case 'S':
      return 'N';
    case 'E':
      return 'W';
    case 'W':
      return 'E';
  }
}
