# Engine Architecture Memo (Phase 1)

> **Status:** Architect step. Awaiting user review before Coder begins.
> **Scope:** Headless simulation only. No DOM, no Canvas, no Tone, no Tauri, no LLM.
> **Companion:** [throughline-design.md](../../throughline-design.md) §5 (DSL), §6 (Mechanics); [IMPLEMENTATION_PLAN.md](../../IMPLEMENTATION_PLAN.md) § Phase 1.

This memo locks in the engine's type contracts, cycle resolution algorithm, conservation invariant, halt conditions, and determinism rules **before** code is written. Once the user approves, the Coder step builds against these contracts via TDD.

Open decisions where the design doc is silent are flagged in §11; please review and respond there before Coder begins.

---

## 1. Module layout

```
src/engine/
├── types.ts              # all type definitions; no logic
├── tiles/
│   ├── conveyor.ts
│   ├── splitter.ts
│   ├── merger.ts
│   ├── filter.ts
│   └── reactor.ts
├── agents/
│   └── ops.ts            # MOVE, GRAB, DROP, SENSE, WAIT
├── step.ts               # one cycle: emit → declare → resolve → bookkeep
├── run.ts                # runUntilHalt
├── debug/
│   └── dumpTrace.ts      # writes failing-test traces to test-results/engine/
├── index.ts              # public barrel: runUntilHalt, stepOnce, types
└── __tests__/            # per-tile, per-op, snapshot, property tests
```

**Public surface (`src/engine/index.ts`):**

```ts
export { runUntilHalt, stepOnce } from './run';
export type {
  Puzzle, Solution, WorldState, CycleTrace, RunResult,
  EngineStatus, Op, PlacedTile, Pos, Direction, CargoType,
  AgentId, AgentState, InputSpec, OutputSpec,
} from './types';
```

No other modules under `src/engine/` are exported. Phase 7's loader will import these types when wiring the Zod schema; Phase 10's CLI will import `runUntilHalt` for the solvability check.

**Forbidden in `src/engine/`** (lint-enforced in a later phase; verified by reviewer this phase):

- `Math.random`, `Date.now`, `performance.now`
- `crypto.randomUUID`, `crypto.getRandomValues`
- Iteration over `Map`/`Set` insertion order (use sorted arrays)
- Any DOM, `window`, `document`, `globalThis` references
- Any `import` from packages outside the standard library

---

## 2. Type contracts (`types.ts`)

```ts
// ─── Coordinates ────────────────────────────────────────────────────
export type Pos = readonly [x: number, y: number];
export type Direction = 'N' | 'E' | 'S' | 'W';

// ─── Cargo ──────────────────────────────────────────────────────────
/** Opaque cargo-type name from the puzzle DSL (e.g. 'alpha', 'plasma'). */
export type CargoType = string;

/**
 * A single cargo unit. The `id` is a monotonic counter assigned at
 * emission time; it gives every unit identity so the conservation
 * invariant can be checked by id-set equality, not just count.
 */
export interface CargoInstance {
  readonly id: number;
  readonly type: CargoType;
}

// ─── Tiles (placed by player) ───────────────────────────────────────
export type TileKind = 'conveyor' | 'splitter' | 'merger' | 'filter' | 'reactor';

export interface PlacedTile {
  readonly pos: Pos;
  readonly kind: TileKind;
  /** Primary facing direction. Per-kind interpretation in §4. */
  readonly facing: Direction;
  /** Required when kind === 'filter'. */
  readonly filterType?: CargoType;
  /** Required when kind === 'reactor'. */
  readonly recipe?: ReactorRecipe;
}

export interface ReactorRecipe {
  /** Sorted lexicographically for deterministic matching. */
  readonly inputs: readonly CargoType[];
  readonly output: CargoType;
}

// ─── Agents & Ops ───────────────────────────────────────────────────
export type AgentId = string;

export type Op =
  | { readonly kind: 'MOVE' }
  | { readonly kind: 'GRAB' }
  | { readonly kind: 'DROP' }
  | { readonly kind: 'WAIT' }
  | {
      readonly kind: 'SENSE';
      readonly expects: CargoType;
      readonly then: ThenOp;
      readonly otherwise: ThenOp;
    };

/** SENSE branches contain a leaf op only — no nested SENSE in v1. */
export type ThenOp = Extract<Op, { kind: 'MOVE' | 'GRAB' | 'DROP' | 'WAIT' }>;

export interface AgentSpec {
  readonly id: AgentId;
  readonly startPos: Pos;
  /** Hard cap on `programs[id].length`. Enforced at solution validation. */
  readonly maxOps: number;
}

// ─── Puzzle definition (from campaign.json) ────────────────────────
export interface InputSpec {
  readonly pos: Pos;
  /** Emission rotates through this array; see §8. */
  readonly emits: readonly CargoType[];
  /** Emits when `cycle % rate === 0`. Must be >= 1. */
  readonly rate: number;
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
}

// ─── Player solution ────────────────────────────────────────────────
export interface Solution {
  readonly tiles: readonly PlacedTile[];
  /** Polyline path per agent; agent walks this on MOVE. */
  readonly paths: Readonly<Record<AgentId, readonly Pos[]>>;
  /** Op list per agent; loops indefinitely. */
  readonly programs: Readonly<Record<AgentId, readonly Op[]>>;
}

// ─── Runtime state ──────────────────────────────────────────────────
export interface AgentState {
  readonly pos: Pos;
  readonly pathIndex: number;     // wraps mod path.length
  readonly programIndex: number;  // wraps mod program.length
  readonly carrying: CargoInstance | null;
}

/**
 * Position-keyed cargo map. Keys are `${x},${y}` so the map is JSON-
 * serializable for snapshot tests and avoids Map-iteration determinism
 * concerns. The engine never iterates this map for behavior — only
 * for snapshot serialization, where keys are sorted lexicographically.
 */
export type PosKey = `${number},${number}`;

export interface WorldState {
  readonly cycle: number;
  readonly cargoOnTiles: Readonly<Record<PosKey, readonly CargoInstance[]>>;
  readonly agents: Readonly<Record<AgentId, AgentState>>;
  readonly deliveredCounts: Readonly<Record<CargoType, number>>;
  /** Monotonic count of all cargo emitted from inputs since cycle 0. */
  readonly cumulativeEmissions: number;
  /** Next id to assign to a newly emitted cargo. */
  readonly nextCargoId: number;
}

// ─── Trace ──────────────────────────────────────────────────────────
export interface EmissionEvent {
  readonly inputPos: Pos;
  readonly cargo: CargoInstance;
}
export interface AgentEvent {
  readonly agent: AgentId;
  readonly from: Pos;
  readonly to: Pos;
  readonly opExecuted: Op | ThenOp;
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
```

All types are `readonly`. The engine constructs new `WorldState` snapshots each cycle; nothing mutates in place. This buys us free undo, free history, and trivial structural equality for tests.

---

## 3. Solution shape

Already pinned in §2 (`Solution`). Three notes:

1. **`paths[id]` is the agent's walked route as a polyline of grid cells.** On `MOVE`, the agent advances by 1 along the path; `pathIndex` wraps modulo `path.length`. Path of length 1 = the agent is stationary (MOVE is a no-op).
2. **`programs[id]` is the agent's instruction loop**; `programIndex` wraps modulo `program.length`. Empty program is a validation error (caught by Phase 7 Zod schema; the engine assumes valid input but still treats empty programs as `agent_deadlock` candidates).
3. **No explicit "edits per cycle" budget.** The number of ops per cycle is exactly 1 — one op per agent per cycle. The `maxOps` field constrains program *length*, not throughput.

---

## 4. Tile model

### 4.1 Facing semantics per kind

| Kind | Facing means |
|---|---|
| `conveyor` | Direction cargo moves from this cell each cycle. |
| `splitter` | "Cargo arrives FROM the OPPOSITE of facing; departs ALTERNATELY along the two perpendiculars to facing." Example: facing `E` ⇒ cargo arrives from `W`, departs `N` and `S` alternately, starting `N` on first arrival. |
| `merger` | "Cargo arrives FROM the two perpendiculars to facing; departs in the facing direction." Example: facing `E` ⇒ arrivals from `N` and `S` combine into a stream going `E`. |
| `filter` | Cargo of `filterType` passes in the facing direction; others stay on the cell (blocked). |
| `reactor` | Combines cargo of the recipe's `inputs` types currently on the cell into one cargo of the recipe's `output` type, leaving on the facing direction. |

**Splitter alternation state** lives in the tile, not the world. Since we're keeping `PlacedTile` immutable per §2, the alternation toggle state is held in `WorldState` under a separate `tileState` map (added below; not in original §2 sketch — flag in §11):

```ts
export interface TileState {
  readonly splitterNextOut?: Direction;  // for splitter
}
// add to WorldState:
//   readonly tileState: Readonly<Record<PosKey, TileState>>;
```

### 4.2 Rotation

Player rotates tiles in the editor via the `R` key. Rotation produces a new `PlacedTile` with `facing` cycled `N → E → S → W → N`. Engine sees only the final `facing`.

### 4.3 Obstacles

`puzzle.obstacles` are impassable cells. Agents cannot enter, cargo cannot occupy. Tile placement on an obstacle is rejected at solution validation (caught by Phase 3 editor; engine still defensively skips obstacle cells if encountered).

### 4.4 Input / output cells

Inputs and outputs sit on grid cells like tiles. Agents can stand on them. Player-placed tiles cannot be placed on input or output cells (Phase 3 editor enforces; engine ignores attempts).

---

## 5. Cycle resolution algorithm

A cycle = 4 phases, executed in order. Each phase reads the world snapshot at the **start of the cycle**; mutations accumulate in a draft and commit only at end-of-cycle.

```
cycle N:
  Phase 0  EMIT       — inputs produce cargo
  Phase A  DECLARE    — agents and tiles compute their intents from snapshot
  Phase B  RESOLVE    — conflicts resolved, intents applied to draft
  Phase C  DELIVER    — cargo on output cells consumed against requirements
  → world snapshot at end of cycle becomes "start" for cycle N+1
```

### Phase 0 — EMIT

For each input `i` (iterated in puzzle.inputs order, which is fixed):

1. If `cycle % i.rate !== 0`, skip.
2. Compute the emission type: `i.emits[(cycle / i.rate) % i.emits.length]`. Integer division.
3. Create `CargoInstance { id: world.nextCargoId++, type }`.
4. Append to `draft.cargoOnTiles[posKey(i.pos)]`.
5. Increment `draft.cumulativeEmissions`.
6. Record an `EmissionEvent`.

### Phase A — DECLARE

Both agents and tiles compute intents against the **start-of-cycle snapshot**, not the post-Phase-0 draft. This means cargo emitted this cycle is visible to agents/tiles for action this cycle. (Open Q in §11.)

**Agent intent computation:**

For each agent `a` (iterated in lexicographic order of `AgentId`):

1. Look up `op = program[programIndex % program.length]`.
2. If `op.kind === 'SENSE'`:
   - Check the current cell's cargo (from start-of-cycle snapshot).
   - If any cargo of type `op.expects` is present, the active sub-op is `op.then`; otherwise `op.otherwise`.
   - The agent declares an intent based on the sub-op (one of MOVE/GRAB/DROP/WAIT) and advances `programIndex` by 1.
   - Record `AgentEvent.opExecuted` as the resolved `ThenOp`, not the SENSE wrapper.
3. Else handle directly:
   - `MOVE`: declare intent to be at `paths[id][(pathIndex + 1) % path.length]` and advance pathIndex by 1.
   - `GRAB`: declare intent to remove one cargo from current cell and place it in `carrying` (only if `carrying === null` AND some cargo is present; else no-op).
   - `DROP`: declare intent to append `carrying` to current cell's cargo and set `carrying = null` (only if `carrying !== null`; else no-op).
   - `WAIT`: declare no movement; advance programIndex.
4. Always advance `programIndex` by 1 (loops via mod).

**Tile intent computation:**

For each tile `t` (iterated in sorted order of `posKey`):

- Conveyor: declare "move ALL cargo at t.pos to neighbor in t.facing".
- Splitter: declare "move ALL cargo at t.pos to neighbor in `splitterNextOut`"; the next-out toggle flips for next cycle.
- Merger: passive — cargo just arrives via neighbors' conveyor declarations. Merger declares "all cargo here moves to neighbor in t.facing" (so it acts like a one-way conveyor with permissive inputs).
- Filter: declare "move cargo of type t.filterType to neighbor in t.facing; leave others in place".
- Reactor: if the multiset of cargo on the cell ⊇ recipe.inputs, declare "consume those inputs, produce one cargo of recipe.output (with fresh id) at this cell" (the new cargo will move out next cycle via the reactor's own conveyor declaration — keep recipe & transport orthogonal).

### Phase B — RESOLVE

Apply intents in this order; mutate the draft started in Phase 0:

1. **Tile transports first.** Compute, for every cargo on the board, its target cell after tile declarations. If a cargo would leave the grid or enter an obstacle, it stays.
2. **Agent moves second.** For each agent (lexicographic by AgentId, deterministic), check if the target cell is:
   - An obstacle → agent stays; record blocked.
   - Outside grid → agent stays; record blocked.
   - Occupied by an agent that successfully moved earlier this resolution AND is still there → agent stays; record CollisionEvent.
   - Otherwise → agent moves there.

   **Swap collisions:** two agents trying to swap cells. After lexicographic ordering, agent A moves first into B's cell; then agent B's target (A's former cell, now empty) is free, so B moves. **This is permitted** because the two-phase split makes positions read from the snapshot, not the in-progress draft — both agents found their target empty in the snapshot, so both can succeed. To prevent this, we add a "no-swap" check: if agent X's target was occupied by agent Y at start-of-cycle AND Y's target was X's start cell, then BOTH stay. This matches player intuition that simultaneous swap collides.
3. **Agent GRAB / DROP** (after move resolution; uses post-move agent positions):
   - GRAB: pick up one cargo (the lowest-id cargo on the cell, for determinism). Cargo is removed from `cargoOnTiles[posKey]` and assigned to `agent.carrying`.
   - DROP: append `carrying` to `cargoOnTiles[posKey]`; set `carrying = null`.
4. **Reactor consumption** (after agents): if a reactor's cell still contains the recipe's input multiset, consume and produce as declared.

### Phase C — DELIVER

For each output cell `o`, in puzzle.outputs order:

1. For each cargo currently on `o.pos`, check each unfulfilled requirement in `o.required` order:
   - If `cargo.type === requirement.type` AND `delivered[type] < requirement.count`, consume the cargo: remove from cell, increment `deliveredCounts[type]`, record `DeliveryEvent`.
2. Cargo whose type matches no requirement (or whose requirement is already met) stays on the output cell.

### End-of-cycle

- Commit draft as new `WorldState` with `cycle = cycle + 1`.
- Build `CycleTrace` from accumulated events.
- Check halt conditions (§7).

---

## 6. Cargo conservation contract

**Invariant (asserted at end of every cycle in debug builds and in every property-test run):**

```
sum(|cargoOnTiles[k]| for k) + sum(1 if a.carrying else 0 for a) + sum(deliveredCounts.values())
  ==
cumulativeEmissions
```

Plus an id-set invariant:

```
{cargo.id for all cargo in cargoOnTiles, agents.carrying} ∪ {ids of delivered cargo}
  has no duplicates
  AND
  equals {0, 1, ..., nextCargoId - 1} minus ids consumed by reactors
```

**Reactor caveat:** a reactor consumes N input cargo (with N ids) and emits 1 cargo with a fresh id. So total cargo count can shrink. We track `cumulativeReactorConsumptions` separately so the count invariant becomes:

```
total_present + delivered + reactor_consumed - reactor_produced == cumulative_emissions
```

…or equivalently `total_present + delivered == cumulative_emissions - reactor_net_loss`.

**Implementation:** wrap the cycle commit in a `debugAssertConservation(world, trace)` function, on by default in tests. Production builds can no-op the assert.

---

## 7. Halt conditions

Checked at the end of each cycle in this order:

1. **`victory`** — every `OutputRequirement` in every `OutputSpec` is satisfied: `deliveredCounts[req.type] >= req.count` for all. Engine returns immediately.
2. **`cycle_limit_exceeded`** — `cycle >= puzzle.constraints.maxCycles`. Engine returns.
3. **`agent_deadlock`** — deferred to v2 per §11 Q3. v1 only reports `victory` or `cycle_limit_exceeded`.

(Deadlock detection requires either a heuristic — "no delivery in N cycles AND world-state hash repeats" — or symbolic analysis. Both add complexity. For v1, an unsolvable puzzle reports `cycle_limit_exceeded`, which is sufficient for the solvability check in Phase 10.)

---

## 8. Rate semantics

- `rate >= 1` is a load-time validation invariant. `rate === 0` is a Zod schema error (Phase 7).
- Emission happens at the start of a cycle, before agent declarations.
- An input with `rate === 1` emits every cycle starting from cycle 0 (cycle 0 is divisible by 1).
- An input with `rate === N` emits at cycles 0, N, 2N, 3N, …
- The emitted type for the K-th emission of input `i` is `i.emits[K mod i.emits.length]`, where `K = cycle / rate` (integer division). At cycle 0 the first element is emitted.

---

## 9. SENSE semantics

Per §5 Phase A: SENSE is a **single program slot** that internally branches between two leaf ops (`then` / `otherwise`). The agent reads the current cell from the start-of-cycle snapshot; whichever branch fires runs in the same cycle. `programIndex` advances by 1 (treating SENSE as one slot).

Rationale for picking this over alternatives:

- **Picked: "SENSE with embedded then/otherwise, single slot."** Simple state machine: no separate sense flag stored across cycles, no JMP register. Counts as 1 program slot which is the player's mental model of "one decision".
- **Rejected: "SENSE sets a flag; next op is conditional."** Requires the agent to carry a 1-bit register across cycles, and the player has to mentally track which of the next two ops corresponds to which flag value. Confusing in the editor.
- **Rejected: "SENSE has no embedded ops; the program contains a jump op."** Player-hostile; SpaceChem-style at a stage where we want Opus-Magnum-style readability.

**`max_ops` accounting:** a SENSE counts as **1** toward the limit (not 3), because the player typed one branching node in the editor. The branches are children, not siblings. The Phase 3 editor design needs to reflect this.

**Restriction:** `SENSE.then` and `SENSE.otherwise` are constrained to `ThenOp` (the 4 leaf ops). No nested SENSE in v1 — keeps the type recursive only one level and matches the player's "one decision" model.

---

## 10. Determinism contract

**Sources of nondeterminism to forbid:**

- `Math.random`, `Date.now`, `performance.now`, `crypto.randomUUID`, `crypto.getRandomValues`
- Iteration over `Map` / `Set` insertion order anywhere it affects engine output
- `Object.keys(obj)` over an unsorted record where the iteration order matters
- Any non-Node host API (window, document, etc.)

**Deterministic conventions:**

- Agent iteration: lexicographic by `AgentId` (string comparison).
- Tile iteration: lexicographic by `posKey` (i.e. `(x,y)` row-major within each row).
- Cargo iteration on a single cell: ascending by `CargoInstance.id`.
- Input iteration: order they appear in `puzzle.inputs`.
- Output iteration: order they appear in `puzzle.outputs`, with requirements iterated in their array order.
- `cargoOnTiles` keyed by `${x},${y}` strings; serialization to JSON sorts keys lexicographically.

**Test obligation:** the determinism property test (§ test plan) runs each generated `(puzzle, solution)` pair twice and asserts `JSON.stringify(trace1) === JSON.stringify(trace2)`. The JSON serializer used must produce sorted keys; we'll add a small `canonicalStringify` helper for this.

**Reviewer check:** grep `src/engine/` for the forbidden APIs listed above. Expected count: 0.

---

## 11. Open questions for user review

These are the calls where the design doc is silent or open to interpretation. **Please respond to each before the Coder step begins.** Recommended answers in **bold**.

**Q1. Emission visibility in Phase A.**
When agents/tiles compute intents in Phase A, do they see cargo that was just emitted in Phase 0 of the *same* cycle?
- **(a) Yes — Phase A reads (snapshot ∪ Phase 0 emissions).** Recommended. Lets a single-cycle "emit and act" puzzle work without an extra cycle of latency. Player intuition: "the alembic dripped, the homunculus grabs it now."
- (b) No — Phase A reads only the snapshot. Emissions become visible at cycle N+1. More "lossy" feel; would frustrate solvers.

**Q2. Cargo non-matching at output cells.**
When cargo arrives at an output cell but doesn't match any unfulfilled requirement, what happens?
- **(a) It stays on the cell, blocking nothing.** Recommended. Player can route it away later if they want. Cell can hold multiple cargo.
- (b) It despawns (is removed from world, not counted toward delivery). Breaks conservation; needs a `lostCount` channel.
- (c) It blocks the output, refusing further arrivals until cleared. Adds back-pressure mechanics not in the design doc.

**Q3. Deadlock detection in v1.**
Should the engine attempt to detect agent_deadlock, or rely on `cycle_limit_exceeded` for all non-victory cases?
- **(a) Rely on `cycle_limit_exceeded` only.** Recommended for v1; simpler. Phase 10 solvability check budgets time anyway. We can add deadlock as v2 enhancement.
- (b) Implement state-hash-repeat detection. More precise but adds engine complexity.

**Q4. Splitter alternation state.**
Splitters need to remember which output to use next. I propose adding a `tileState: Record<PosKey, TileState>` field to `WorldState` for this. Is there a simpler approach you'd prefer?
- **(a) Add `tileState` to `WorldState` as proposed.** Recommended.
- (b) Use cycle-count parity: `splitterNextOut = (cycle % 2 === 0) ? 'N' : 'S'`. Simpler but couples all splitters' alternation to the global cycle clock — odd-cycle puzzles would behave weirdly.

**Q5. Multi-cargo cells.**
Can multiple cargo units occupy the same cell at once?
- **(a) Yes, unbounded.** Recommended for v1. Keeps math simple; reactor recipes assume multi-cargo by design.
- (b) Cap at N (e.g. 4). Adds an overflow rule we'd have to design.

**Q6. Swap collision.**
Two agents simultaneously try to swap cells. My §5 proposal: both stay (detected by "Y was at X's target at start-of-cycle AND Y's target is X's start"). Confirm?
- **(a) Both stay (swap is blocked).** Recommended; matches player intuition.
- (b) Lexicographic winner: A moves first, B then finds A's old cell empty, B moves. Allows ghosting through.

**Q7. Agent on agent (non-swap).**
Two agents trying to move to the same cell (not swapping). Lexicographic winner moves; others blocked. Confirm.
- **(a) Lexicographic by AgentId.** Recommended.
- (b) Order-of-declaration tiebreak (would need to define what that order is anyway — same outcome).

**Q8. Reactor recipe matching.**
A reactor cell contains cargo `[alpha, alpha, beta]`. Recipe is `[alpha, beta] → gamma`. Does the reactor:
- **(a) Consume one alpha + one beta, produce gamma; one alpha remains on cell.** Recommended.
- (b) Refuse to react if extra cargo is present.
- (c) Consume all matching multisets in one cycle (would react `[alpha, beta]` and leave nothing, missing the chance to react another `[alpha, beta]`).

---

## 12. Test plan (for §1 Phase 1's TDD task list)

This re-states the IMPLEMENTATION_PLAN's test contract more concretely so the Coder step has nowhere to invent:

| Test file | Coverage |
|---|---|
| `__tests__/tiles.test.ts` | Per-kind unit tests: conveyor moves cargo facing-ward; splitter alternates outputs; merger collects; filter blocks wrong type; reactor consumes-produces. |
| `__tests__/ops.test.ts` | Per-op unit tests: MOVE advances, GRAB picks up only if free, DROP only if carrying, WAIT no-op, SENSE branches correctly. |
| `__tests__/step.test.ts` | Cycle pipeline: emission timing at rate 1/2/3; agents observe Phase-0-emissions (per Q1); swap collision blocks both; lexicographic non-swap collision; reactor consumption after agents. |
| `__tests__/snapshot.test.ts` | Iterates `__tests__/snapshots/` JSON files. Each pair (puzzle + solution) has a saved expected `CycleTrace[]`. Deep-equal. |
| `__tests__/conservation.property.test.ts` | `fast-check` generator: arbitrary 4–8 grids, 1–3 agents, 1–2 inputs, 1–2 outputs, with-reactor and without-reactor branches. 1000 runs. Asserts the conservation formula in §6 every cycle. |
| `__tests__/determinism.property.test.ts` | 500 generated runs. Each run executed twice. `canonicalStringify(trace1) === canonicalStringify(trace2)`. |
| `__tests__/corpus.test.ts` | 50 hand-built puzzles in `__tests__/fixtures/`. Each asserts the known solution reports `victory` within `maxCycles`. |

**Property-test edge-case requirements** (reviewer will verify):

- `agents.length === 0`
- programs of length 0 (loaded via direct construction, bypassing schema)
- agent `startPos` ∈ input or output cells
- grid 1×1 with no obstacles
- inputs and outputs sharing a row
- all-WAIT programs (engine reports `cycle_limit_exceeded` cleanly)

---

## 13. What this memo does NOT cover

Out of scope for Phase 1 (each goes to its named phase):

- Validation of `Puzzle` from untrusted JSON (Phase 7 Zod schema + Phase 10 CLI strict mode)
- Solution validation against `available_tiles` / `available_ops` / `max_ops` (Phase 3 editor reducer)
- Rendering (Phase 2)
- Animation interpolation between trace frames (Phase 4)
- Rule DSL evaluation for optional challenges (Phase 5)

---

## 14. Definition of done for Phase 1

Coder advances only when:

1. All tests in §12 pass.
2. Reviewer's checklist (verbatim in IMPLEMENTATION_PLAN.md § Phase 1 Reviewer) is signed off.
3. `src/engine/` has zero references to the forbidden APIs in §10.
4. The `runUntilHalt` function works against the 50-puzzle corpus.

---

**Awaiting user review of §11 open questions before starting the Coder step.**
