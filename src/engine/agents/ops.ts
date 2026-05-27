/**
 * Agent op execution — pure intent computation.
 *
 * Per engine memo §5 Phase A: each agent reads the start-of-cycle
 * snapshot, computes a single AgentIntent describing what it wants
 * to do this cycle. Index advancement and Phase B resolution are
 * handled by `step.ts`.
 *
 * SENSE (memo §9) is a single program slot that embeds `then` and
 * `otherwise` leaf ops; the agent reads its current cell and picks
 * the matching branch. The resolved leaf is recorded in `opExecuted`
 * so the trace shows what actually ran, not the SENSE wrapper.
 */

import type {
  AgentId,
  AgentIntent,
  AgentState,
  CargoInstance,
  Op,
  Pos,
  ThenOp,
} from '../types';

/**
 * Compute the agent's intent for the current cycle.
 *
 * @param agentId    the agent's id (used to populate intent.agent)
 * @param state      agent's state at start of cycle (programIndex must
 *                   be in [0, program.length))
 * @param path       the agent's path polyline (length 0 is defensive)
 * @param program    the agent's op list (length 0 is defensive)
 * @param cellCargo  cargo at the agent's current cell at start of cycle
 *                   (post Phase 0 emissions — see memo §11 Q1=yes)
 */
export function computeAgentIntent(
  agentId: AgentId,
  state: AgentState,
  path: readonly Pos[],
  program: readonly Op[],
  cellCargo: readonly CargoInstance[],
): AgentIntent {
  if (program.length === 0) return waitIntent(agentId, state.pos, { kind: 'WAIT' });

  const op = program[state.programIndex % program.length];
  if (!op) return waitIntent(agentId, state.pos, { kind: 'WAIT' });

  const resolved: ThenOp = op.kind === 'SENSE' ? resolveSense(op, cellCargo) : op;
  return executeLeaf(agentId, state, path, cellCargo, resolved);
}

function resolveSense(
  op: Extract<Op, { kind: 'SENSE' }>,
  cellCargo: readonly CargoInstance[],
): ThenOp {
  const matched = cellCargo.some((c) => c.type === op.expects);
  return matched ? op.then : op.otherwise;
}

function executeLeaf(
  agentId: AgentId,
  state: AgentState,
  path: readonly Pos[],
  cellCargo: readonly CargoInstance[],
  op: ThenOp,
): AgentIntent {
  switch (op.kind) {
    case 'MOVE':
      return computeMove(agentId, state, path, op);
    case 'GRAB':
      return state.carrying === null && cellCargo.length > 0
        ? { kind: 'grab', agent: agentId, at: state.pos, opExecuted: op }
        : waitIntent(agentId, state.pos, op);
    case 'DROP':
      return state.carrying !== null
        ? { kind: 'drop', agent: agentId, at: state.pos, opExecuted: op }
        : waitIntent(agentId, state.pos, op);
    case 'WAIT':
      return waitIntent(agentId, state.pos, op);
  }
}

function computeMove(
  agentId: AgentId,
  state: AgentState,
  path: readonly Pos[],
  op: ThenOp & { kind: 'MOVE' },
): AgentIntent {
  if (path.length === 0) return waitIntent(agentId, state.pos, { kind: 'WAIT' });
  const next = path[(state.pathIndex + 1) % path.length];
  if (!next) return waitIntent(agentId, state.pos, { kind: 'WAIT' });
  return { kind: 'move', agent: agentId, from: state.pos, to: next, opExecuted: op };
}

function waitIntent(agentId: AgentId, at: Pos, opExecuted: ThenOp): AgentIntent {
  return { kind: 'wait', agent: agentId, at, opExecuted };
}
