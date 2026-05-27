/**
 * One cycle of the puzzle engine.
 *
 * Per engine memo §5, a cycle is four phases in order:
 *   Phase 0 EMIT       — inputs produce cargo
 *   Phase A DECLARE    — agents and tiles compute intents from snapshot
 *   Phase B RESOLVE    — intents applied to draft world
 *   Phase C DELIVER    — cargo on output cells consumed against requirements
 *
 * Phase A reads from a frozen snapshot that already includes Phase 0
 * emissions (memo Q1 = yes). Phase B applies intents to a mutable
 * draft; nothing the player sees is mutated in place.
 *
 * Move resolution honors:
 *   - Swap pairs: both stay (memo Q6 = a)
 *   - Same-target collision: lex-earliest agent id wins (Q7 = a)
 *   - Stationary occupant: blocks would-be enterer
 *   - Chain following: agent A may move into B's start IFF B is also
 *     moving and B's move succeeds (fixpoint iteration)
 *
 * GRAB picks the lowest-id cargo on the agent's cell, for determinism.
 * Cargo of non-matching type at an output cell stays put (Q2 = a).
 * Reactor consumes one set per cycle even with extras present (Q8 = a).
 */

import { computeAgentIntent } from './agents/ops';
import { conveyorIntents } from './tiles/conveyor';
import { filterIntents } from './tiles/filter';
import { mergerIntents } from './tiles/merger';
import { reactorIntents } from './tiles/reactor';
import { splitterIntents } from './tiles/splitter';
import type {
  AgentEvent,
  AgentId,
  AgentIntent,
  AgentState,
  CargoInstance,
  CargoType,
  CollisionEvent,
  CycleTrace,
  DeliveryEvent,
  EmissionEvent,
  PlacedTile,
  Pos,
  PosKey,
  Puzzle,
  Solution,
  TileIntent,
  TileState,
  WorldState,
} from './types';
import { fromPosKey, posKey } from './types';

// ─── Mutable draft (internal only) ─────────────────────────────────
interface DraftWorld {
  cycle: number;
  cargoOnTiles: Record<PosKey, CargoInstance[]>;
  agents: Record<AgentId, AgentState>;
  tileState: Record<PosKey, TileState>;
  deliveredCounts: Record<CargoType, number>;
  cumulativeEmissions: number;
  cumulativeReactorConsumed: number;
  cumulativeReactorProduced: number;
  nextCargoId: number;
}

function cloneToDraft(w: WorldState): DraftWorld {
  const cargoOnTiles: Record<PosKey, CargoInstance[]> = {};
  for (const [k, v] of Object.entries(w.cargoOnTiles)) {
    cargoOnTiles[k as PosKey] = v.slice();
  }
  const tileState: Record<PosKey, TileState> = {};
  for (const [k, v] of Object.entries(w.tileState)) {
    tileState[k as PosKey] = { ...v };
  }
  return {
    cycle: w.cycle,
    cargoOnTiles,
    agents: { ...w.agents },
    tileState,
    deliveredCounts: { ...w.deliveredCounts },
    cumulativeEmissions: w.cumulativeEmissions,
    cumulativeReactorConsumed: w.cumulativeReactorConsumed,
    cumulativeReactorProduced: w.cumulativeReactorProduced,
    nextCargoId: w.nextCargoId,
  };
}

// ─── Geometry helpers ──────────────────────────────────────────────
function inBounds(p: Pos, grid: { w: number; h: number }): boolean {
  return p[0] >= 0 && p[0] < grid.w && p[1] >= 0 && p[1] < grid.h;
}
function isObstacle(p: Pos, obstacles: readonly Pos[]): boolean {
  return obstacles.some((o) => o[0] === p[0] && o[1] === p[1]);
}
function samePos(a: Pos, b: Pos): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

// ─── Tile dispatch ────────────────────────────────────────────────
function tileIntents(tile: PlacedTile, snapshot: WorldState): readonly TileIntent[] {
  switch (tile.kind) {
    case 'conveyor':
      return conveyorIntents(tile, snapshot);
    case 'splitter':
      return splitterIntents(tile, snapshot);
    case 'merger':
      return mergerIntents(tile, snapshot);
    case 'filter':
      return filterIntents(tile, snapshot);
    case 'reactor':
      return reactorIntents(tile, snapshot);
  }
}

// ─── Public entrypoint ────────────────────────────────────────────
export function stepOnce(
  puzzle: Puzzle,
  solution: Solution,
  world: WorldState,
): { world: WorldState; trace: CycleTrace } {
  const draft = cloneToDraft(world);
  const cycleAtStart = draft.cycle;

  // ─── Phase 0: EMIT ───────────────────────────────────────────────
  const emissions: EmissionEvent[] = [];
  for (const input of puzzle.inputs) {
    if (input.rate < 1) continue; // defensive; schema validates >= 1
    if (cycleAtStart % input.rate !== 0) continue;
    const k = Math.floor(cycleAtStart / input.rate);
    const type = input.emits[k % input.emits.length];
    if (type === undefined) continue;
    const c: CargoInstance = { id: draft.nextCargoId, type };
    draft.nextCargoId += 1;
    const key = posKey(input.pos);
    const existing = draft.cargoOnTiles[key] ?? [];
    draft.cargoOnTiles[key] = existing.concat(c);
    draft.cumulativeEmissions += 1;
    emissions.push({ inputPos: input.pos, cargo: c });
  }

  // ─── Phase A snapshot ───────────────────────────────────────────
  const snapshot: WorldState = cloneToDraft(draft) as unknown as WorldState;

  // ─── Phase A: tile intents (sorted by posKey for determinism) ───
  const sortedTiles = solution.tiles
    .slice()
    .sort((a, b) => posKey(a.pos).localeCompare(posKey(b.pos)));
  const allTileIntents: TileIntent[] = [];
  for (const tile of sortedTiles) {
    allTileIntents.push(...tileIntents(tile, snapshot));
  }

  // ─── Phase A: agent intents (sorted by AgentId for determinism) ─
  const sortedAgentIds = puzzle.agents
    .map((a) => a.id)
    .slice()
    .sort();
  const agentIntents: AgentIntent[] = [];
  for (const aid of sortedAgentIds) {
    const state = snapshot.agents[aid];
    if (!state) continue;
    const cellCargo = snapshot.cargoOnTiles[posKey(state.pos)] ?? [];
    const path = solution.paths[aid] ?? [];
    const program = solution.programs[aid] ?? [];
    agentIntents.push(computeAgentIntent(aid, state, path, program, cellCargo));
  }

  // ─── Phase B: apply tile intents ────────────────────────────────
  applyTileIntents(draft, allTileIntents, puzzle);

  // ─── Phase B: resolve agent moves ───────────────────────────────
  const moveResults = resolveAgentMoves(agentIntents, snapshot, puzzle);

  // ─── Phase B: apply agent state updates + log events ────────────
  const agentEvents: AgentEvent[] = [];
  for (const intent of agentIntents) {
    const startState = snapshot.agents[intent.agent];
    if (!startState) continue;
    const program = solution.programs[intent.agent] ?? [];
    const path = solution.paths[intent.agent] ?? [];

    let newPos: Pos = startState.pos;
    let newPathIndex = startState.pathIndex;
    let newCarrying = startState.carrying;
    const logFrom: Pos = startState.pos;
    let logTo: Pos = startState.pos;

    if (intent.kind === 'move') {
      const result = moveResults.results.get(intent.agent);
      if (result?.succeeded) {
        newPos = result.newPos;
        if (path.length > 0) {
          newPathIndex = (startState.pathIndex + 1) % path.length;
        }
      }
      logTo = newPos;
    } else if (intent.kind === 'grab') {
      const here = draft.cargoOnTiles[posKey(startState.pos)] ?? [];
      if (startState.carrying === null && here.length > 0) {
        const sorted = here.slice().sort((a, b) => a.id - b.id);
        const picked = sorted[0];
        if (picked) {
          newCarrying = picked;
          draft.cargoOnTiles[posKey(startState.pos)] = here.filter((c) => c.id !== picked.id);
        }
      }
    } else if (intent.kind === 'drop') {
      if (startState.carrying !== null) {
        const k = posKey(startState.pos);
        const existing = draft.cargoOnTiles[k] ?? [];
        draft.cargoOnTiles[k] = existing.concat(startState.carrying);
        newCarrying = null;
      }
    }
    // wait: positions/carrying unchanged

    const newProgramIndex = program.length > 0 ? (startState.programIndex + 1) % program.length : 0;

    draft.agents[intent.agent] = {
      pos: newPos,
      pathIndex: newPathIndex,
      programIndex: newProgramIndex,
      carrying: newCarrying,
    };

    agentEvents.push({
      agent: intent.agent,
      from: logFrom,
      to: logTo,
      opExecuted: intent.opExecuted,
    });
  }

  const collisions: CollisionEvent[] = [];
  for (const [key, info] of moveResults.collisionsByTarget) {
    collisions.push({
      pos: fromPosKey(key),
      winner: info.winner,
      blocked: info.blocked,
    });
  }

  // ─── Phase C: DELIVER ───────────────────────────────────────────
  const deliveries: DeliveryEvent[] = [];
  for (const output of puzzle.outputs) {
    const key = posKey(output.pos);
    const here = draft.cargoOnTiles[key] ?? [];
    if (here.length === 0) continue;
    const sortedHere = here.slice().sort((a, b) => a.id - b.id);
    const remaining: CargoInstance[] = [];
    for (const c of sortedHere) {
      const req = output.required.find(
        (r) => r.type === c.type && (draft.deliveredCounts[r.type] ?? 0) < r.count,
      );
      if (req) {
        draft.deliveredCounts[req.type] = (draft.deliveredCounts[req.type] ?? 0) + 1;
        deliveries.push({ outputPos: output.pos, cargo: c });
      } else {
        remaining.push(c);
      }
    }
    draft.cargoOnTiles[key] = remaining;
  }

  // ─── Advance + clean ───────────────────────────────────────────
  draft.cycle = cycleAtStart + 1;
  for (const k of Object.keys(draft.cargoOnTiles)) {
    if ((draft.cargoOnTiles[k as PosKey] ?? []).length === 0) {
      delete draft.cargoOnTiles[k as PosKey];
    }
  }

  const worldAfter = draft as unknown as WorldState;
  return {
    world: worldAfter,
    trace: {
      cycle: cycleAtStart,
      emissions,
      agentEvents,
      collisions,
      deliveries,
      worldAfter,
    },
  };
}

// ─── Tile intent application ───────────────────────────────────────
function applyTileIntents(draft: DraftWorld, intents: readonly TileIntent[], puzzle: Puzzle): void {
  // Order: consumeCargo → produceCargo → moveCargo → flipSplitter.
  // Each cell has at most one tile (Phase 3 editor enforces) so intents
  // from different tiles don't conflict on the same cargo.
  for (const intent of intents) {
    if (intent.kind === 'consumeCargo') {
      const k = posKey(intent.at);
      const here = draft.cargoOnTiles[k] ?? [];
      draft.cargoOnTiles[k] = here.filter((c) => c.id !== intent.cargo.id);
      draft.cumulativeReactorConsumed += 1;
    }
  }
  for (const intent of intents) {
    if (intent.kind === 'produceCargo') {
      const k = posKey(intent.at);
      const newCargo: CargoInstance = { id: draft.nextCargoId, type: intent.cargoType };
      draft.nextCargoId += 1;
      draft.cargoOnTiles[k] = (draft.cargoOnTiles[k] ?? []).concat(newCargo);
      draft.cumulativeReactorProduced += 1;
    }
  }
  for (const intent of intents) {
    if (intent.kind === 'moveCargo') {
      if (!inBounds(intent.to, puzzle.grid)) continue;
      if (isObstacle(intent.to, puzzle.obstacles)) continue;
      const fromKey = posKey(intent.from);
      const here = draft.cargoOnTiles[fromKey] ?? [];
      const idx = here.findIndex((c) => c.id === intent.cargo.id);
      if (idx === -1) continue;
      const moved = here[idx];
      if (!moved) continue;
      draft.cargoOnTiles[fromKey] = here.slice(0, idx).concat(here.slice(idx + 1));
      const toKey = posKey(intent.to);
      draft.cargoOnTiles[toKey] = (draft.cargoOnTiles[toKey] ?? []).concat(moved);
    }
  }
  for (const intent of intents) {
    if (intent.kind === 'flipSplitter') {
      const k = posKey(intent.at);
      draft.tileState[k] = { ...(draft.tileState[k] ?? {}), splitterNextOut: intent.nextOut };
    }
  }
}

// ─── Agent move resolution ─────────────────────────────────────────
interface MoveResolution {
  readonly succeeded: boolean;
  readonly newPos: Pos;
}
interface MoveResults {
  readonly results: Map<AgentId, MoveResolution>;
  readonly collisionsByTarget: Map<PosKey, { winner: AgentId; blocked: AgentId[] }>;
}

function resolveAgentMoves(
  intents: readonly AgentIntent[],
  snapshot: WorldState,
  puzzle: Puzzle,
): MoveResults {
  const results = new Map<AgentId, MoveResolution>();
  const moves = new Map<AgentId, Pos>();
  for (const intent of intents) {
    if (intent.kind === 'move') {
      moves.set(intent.agent, intent.to);
    } else {
      const s = snapshot.agents[intent.agent];
      if (s) results.set(intent.agent, { succeeded: false, newPos: s.pos });
    }
  }

  const failed = new Set<AgentId>();
  // Collisions grouped by target cell. For same-target races we record a
  // winner; for swap blocks there's no "winner" so winner is the cell's
  // pre-swap occupant which doesn't move — use the lex-earliest blocked id
  // as a stand-in so the field is always populated.
  const collisionInfo = new Map<PosKey, { blocked: AgentId[]; winner: AgentId | null }>();

  // 1. Invalid targets (off-grid, obstacle)
  for (const [aid, target] of moves) {
    if (!inBounds(target, puzzle.grid) || isObstacle(target, puzzle.obstacles)) {
      failed.add(aid);
    }
  }

  // 2. Swap pairs (both stay)
  const sortedMoveIds = Array.from(moves.keys()).sort();
  for (let i = 0; i < sortedMoveIds.length; i++) {
    for (let j = i + 1; j < sortedMoveIds.length; j++) {
      const a = sortedMoveIds[i]!;
      const b = sortedMoveIds[j]!;
      const aStart = snapshot.agents[a]?.pos;
      const bStart = snapshot.agents[b]?.pos;
      const aTarget = moves.get(a);
      const bTarget = moves.get(b);
      if (!aStart || !bStart || !aTarget || !bTarget) continue;
      if (samePos(aTarget, bStart) && samePos(bTarget, aStart)) {
        failed.add(a);
        failed.add(b);
        const key = posKey(aTarget);
        const existing = collisionInfo.get(key) ?? { blocked: [], winner: null };
        if (!existing.blocked.includes(a)) existing.blocked.push(a);
        if (!existing.blocked.includes(b)) existing.blocked.push(b);
        // No clear winner in a swap — pick lex-earliest as placeholder
        if (!existing.winner) existing.winner = a;
        collisionInfo.set(key, existing);
      }
    }
  }

  // 3. Same-target collisions (lex-earliest wins)
  const byTarget = new Map<PosKey, AgentId[]>();
  for (const aid of sortedMoveIds) {
    if (failed.has(aid)) continue;
    const target = moves.get(aid);
    if (!target) continue;
    const k = posKey(target);
    if (!byTarget.has(k)) byTarget.set(k, []);
    byTarget.get(k)!.push(aid);
  }
  for (const [k, ids] of byTarget) {
    if (ids.length > 1) {
      const sorted = ids.slice().sort();
      const winner = sorted[0]!;
      const blocked = sorted.slice(1);
      for (const b of blocked) failed.add(b);
      const existing = collisionInfo.get(k) ?? { blocked: [], winner: null };
      existing.winner = winner;
      for (const b of blocked) {
        if (!existing.blocked.includes(b)) existing.blocked.push(b);
      }
      collisionInfo.set(k, existing);
    }
  }

  // 4. Fixpoint: target cell occupied by a stayer → block
  let changed = true;
  while (changed) {
    changed = false;
    for (const aid of sortedMoveIds) {
      if (failed.has(aid)) continue;
      const target = moves.get(aid);
      if (!target) continue;
      for (const [bid, bState] of Object.entries(snapshot.agents).sort(([x], [y]) =>
        x.localeCompare(y),
      )) {
        if (bid === aid) continue;
        if (!samePos(bState.pos, target)) continue;
        const bHasMove = moves.has(bid);
        const bIsStayer = !bHasMove || failed.has(bid);
        if (bIsStayer) {
          failed.add(aid);
          const k = posKey(target);
          const existing = collisionInfo.get(k) ?? { blocked: [], winner: null };
          if (!existing.blocked.includes(aid)) existing.blocked.push(aid);
          if (!existing.winner) existing.winner = bid;
          collisionInfo.set(k, existing);
          changed = true;
          break;
        }
      }
    }
  }

  // Build results
  for (const aid of sortedMoveIds) {
    const target = moves.get(aid);
    const state = snapshot.agents[aid];
    if (!state || !target) continue;
    if (failed.has(aid)) {
      results.set(aid, { succeeded: false, newPos: state.pos });
    } else {
      results.set(aid, { succeeded: true, newPos: target });
    }
  }

  const collisionsByTarget = new Map<PosKey, { winner: AgentId; blocked: AgentId[] }>();
  for (const [k, info] of collisionInfo) {
    collisionsByTarget.set(k, {
      winner: info.winner ?? '',
      blocked: info.blocked.slice().sort(),
    });
  }

  return { results, collisionsByTarget };
}
