# Throughline — Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to work through this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking. Each phase is gated — do not advance past a phase whose Exit Criteria are not met.

**Goal:** Build Throughline — a Zachtronic-style flow-routing puzzle game whose mechanics are fixed but whose themes, narrative, and puzzle layouts are LLM-generated per campaign. Two artifacts: a TypeScript/Canvas game (browser + Tauri desktop) and a Node CLI (`throughline-gen`) that produces `campaign.json` manifests via `claude -p`.

**Architecture:** The game is a pure function of `campaign.json`. The CLI is the only component that talks to an LLM. Everything in the game runs from the validated manifest and is deterministic given identical solution input. See [throughline-design.md](throughline-design.md) §3 for the full diagram.

**Tech Stack:** TypeScript (strict), Vite, HTML5 Canvas 2D, Web Audio + Tone.js, Tauri 2.x, Vitest, Playwright, Node + Zod for the CLI. Package manager: **npm** (matches the design doc's `npm test` reference). ESLint: **flat config** (v9+). Prettier with defaults.

---

## Phase map

| # | Name | Cycle | Risk surface |
|---|---|---|---|
| 0 | Skeleton | Coder only | mechanical |
| 1 | Puzzle Engine (headless) | **Full** | invariants (determinism, conservation) |
| 2 | Renderer | Light | visual fidelity |
| 3 | Editor | Light | input ergonomics |
| 4 | Playback Controls | Light | animation feel |
| 5 | Win/Loss + Rule DSL | **Full** | DSL parser must be eval-free |
| 6 | Audio | Light | aesthetic |
| 7 | Campaign State + Library | Moderate | save/load migration |
| 8 | Theme Applicator | Moderate | un-substituted tokens, contrast |
| 9 | Tutorial Campaign | Content-focused | curriculum coherence |
| 10 | Companion CLI | **Full** | untrusted LLM I/O, shell injection |
| 11 | E2E Procgen | Moderate | seam failures |
| 12 | Packaging | Coder only | mechanical |

**Cross-cutting review rules** (from design doc §10):
- Reviewers must run with **fresh context** when possible.
- Reviewers get **phase-specific failure-mode prompts**, not generic "review this code". The verbatim checklists are embedded in each Reviewer subsection below.

**Cross-cutting invariants** (must remain true after every phase):
- Game code never calls an LLM. The CLI is the only LLM caller.
- Engine simulation is deterministic given identical inputs.
- Cargo is conserved across simultaneous-move resolution.
- The optional-challenge rule DSL has no `eval` / `Function()` / `new Function`.
- All LLM-produced strings are HTML-escaped before rendering. Never `innerHTML`.

---

## Phase 0 — Skeleton

**Cycle:** Coder only.
**Goal:** Repository scaffold that runs one trivial Vitest test and one trivial Playwright test green.
**Maps to DoD:** "`npm test` runs and passes one trivial test in both Vitest and Playwright."

### Deliverables

Create:
- `package.json` (scripts: `dev`, `build`, `preview`, `test`, `test:unit`, `test:e2e`, `lint`, `format`)
- `tsconfig.json` (`"strict": true`, `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`)
- `vite.config.ts`
- `vitest.config.ts` (environment: `jsdom` for the eventual editor tests, `node` for engine tests via test-level overrides; root config uses `node` by default)
- `playwright.config.ts` (single chromium project for now; spawn `vite preview` for the test server)
- `eslint.config.js` (flat config: `@typescript-eslint`, `eslint-config-prettier`)
- `.prettierrc` (defaults; `"singleQuote": true`, `"trailingComma": "all"`)
- `.gitignore` (`node_modules`, `dist`, `playwright-report`, `test-results`, `.vite`)
- `.editorconfig`
- `index.html` (mount point `<div id="app">`)
- `src/main.ts` (renders `"Throughline"` into `#app`)
- `src/__tests__/smoke.test.ts` (asserts `1 + 1 === 2`)
- `e2e/smoke.spec.ts` (loads `/`, expects body to contain `"Throughline"`)
- `.github/workflows/ci.yml` (runs `npm ci && npm run lint && npm test && npm run build`)
- `README.md` (one-line description + dev/test commands)
- `LICENSE` (MIT)

### Tasks

- [ ] Initialize git: `git init && git branch -M main`.
- [ ] `npm init -y`; edit `package.json` to set `"type": "module"`, `"private": true`.
- [ ] Install runtime/build deps: `npm i tone zod`.
- [ ] Install dev deps: `npm i -D typescript vite vitest @vitest/ui jsdom @playwright/test eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-config-prettier prettier`.
- [ ] `npx playwright install --with-deps chromium`.
- [ ] Write each config file listed above.
- [ ] Write `src/main.ts` and `index.html`.
- [ ] Write `src/__tests__/smoke.test.ts` (Vitest).
- [ ] Write `e2e/smoke.spec.ts` (Playwright).
- [ ] Wire `package.json` scripts:
  - `"dev": "vite"`
  - `"build": "tsc -b && vite build"`
  - `"preview": "vite preview --port 4173"`
  - `"test": "npm run test:unit && npm run test:e2e"`
  - `"test:unit": "vitest run"`
  - `"test:e2e": "playwright test"`
  - `"lint": "eslint . && prettier --check ."`
  - `"format": "prettier --write ."`
- [ ] Add `.github/workflows/ci.yml`.
- [ ] First commit: `chore: phase 0 — project skeleton`.

### Test commands

```
npm run lint
npm run test:unit
npm run test:e2e
npm run build
```

### Exit criteria

- All four commands above pass on a clean clone.
- CI workflow runs green on a push to `main`.
- `npm run dev` opens a browser showing the word "Throughline".

---

## Phase 1 — Puzzle Engine (headless)

**Cycle:** Full. This is the most invariant-heavy phase. Reviewer must run with fresh context.
**Goal:** Pure-function simulation of the puzzle DSL. No UI. Loads synthetic manifests, advances one cycle at a time, detects victory.
**Maps to DoD:** "Can load a synthetic puzzle and simulate it cycle-by-cycle without any UI."

### Architect

Architect produces a short design memo (`docs/architecture/engine.md`) **before** any engine code is written. Memo must specify:

1. **Type module layout.**
   - `src/engine/types.ts` — TS types for `Cargo`, `Direction`, `Pos`, `Tile`, `Agent`, `Input`, `Output`, `Puzzle`, `Solution`, `WorldState`, `CycleTrace`. These are *runtime types*; Zod schemas come later (Phase 7 for load, Phase 10 for CLI validation).
2. **Solution shape.** What does a player solution look like in memory? Proposal: `{ tiles: PlacedTile[], paths: Record<AgentId, Pos[]>, programs: Record<AgentId, Op[]> }`. Architect confirms or revises.
3. **Tile facing/rotation model.** How is a conveyor's direction encoded? Proposal: enum `N | E | S | W` per `PlacedTile`. For splitter/merger, define which sides are inputs vs outputs.
4. **Cycle resolution algorithm.** Two-phase exactly per design doc §6:
   - **Phase A (declare):** every agent computes its intended next position and op effect against a *read-only* snapshot of the previous cycle's state.
   - **Phase B (resolve):** apply declared moves; collisions resolved deterministically (proposal: lexicographic by agent id; ties are impossible after that sort). Document the exact rule.
5. **Cargo conservation contract.** State the invariant in code: `sum(cargo in all tiles + cargo carried by agents + cargo delivered to outputs) == cumulative input emissions`. This sum is computed and asserted at the end of every property-test run.
6. **Halt conditions.** `victory` (all outputs satisfied), `cycle_limit_exceeded`, `agent_deadlock` (every agent's program has only `WAIT` or is blocked). Distinguish from "stable but not won" — the engine reports a status enum, the caller decides.
7. **Rate semantics.** "Inputs emit on cycles divisible by `rate`" → `rate >= 1`; `rate=1` emits every cycle including cycle 0; emission happens at the *start* of a cycle, before Phase A. `rate=0` is a schema validation error.
8. **`SENSE` semantics.** Architect specifies the exact grammar of a `SENSE` op. Proposal: `SENSE <cargo_type>` branches the *next* op; the agent has an internal "branch flag" that the next op consumes. Document the state machine.
9. **Determinism contract.** Given identical `(Puzzle, Solution, seed-free)` inputs, two engine runs must produce byte-identical `CycleTrace[]`. No `Math.random`, no `Date.now`, no iteration over `Map`/`Set` (use sorted arrays for any ordered iteration).

Architect memo is reviewed by the user before Coder begins.

### Coder

#### Deliverables

Create:
- `src/engine/types.ts`
- `src/engine/tiles/conveyor.ts`, `splitter.ts`, `merger.ts`, `filter.ts`, `reactor.ts` (one file per tile; each exports `step(tile, world) → tileEffects`)
- `src/engine/agents/ops.ts` (one function per op: `MOVE`, `GRAB`, `DROP`, `SENSE`, `WAIT`)
- `src/engine/step.ts` (orchestrates one cycle: emit → Phase A → Phase B → bookkeeping)
- `src/engine/run.ts` (`runUntilHalt(puzzle, solution, maxCycles) → { status, trace }`)
- `src/engine/index.ts` (public barrel — only `runUntilHalt`, `stepOnce`, types)
- `src/engine/__tests__/tiles.test.ts`
- `src/engine/__tests__/ops.test.ts`
- `src/engine/__tests__/step.test.ts`
- `src/engine/__tests__/snapshots/` (directory of input puzzle + solution + expected trace JSON files)
- `src/engine/__tests__/snapshot.test.ts` (iterates over the snapshots dir)
- `src/engine/__tests__/conservation.property.test.ts`
- `src/engine/__tests__/determinism.property.test.ts`
- `src/engine/__tests__/corpus.test.ts` (the 50-puzzle solver corpus)
- `src/engine/__tests__/fixtures/` (50 hand-built puzzles with known-good solutions)
- `src/engine/debug/dumpTrace.ts` (writes failing-test traces to `test-results/engine/`)

Install: `npm i -D fast-check` (for property tests).

#### Tasks (TDD — test first for every behavior)

- [ ] Define `types.ts` per the architect memo. Commit.
- [ ] For each tile type, in order conveyor → splitter → merger → filter → reactor:
  - [ ] Write the per-tile unit test (e.g. *"a conveyor facing E moves a cargo placed on it east by one tile per cycle"*) and run it; it must fail.
  - [ ] Implement the tile's `step` function until the test passes.
  - [ ] Commit (`feat(engine): conveyor`, etc.).
- [ ] For each agent op (`MOVE`, `GRAB`, `DROP`, `SENSE`, `WAIT`):
  - [ ] Write the unit test; run; fail.
  - [ ] Implement; pass; commit.
- [ ] Build `step.ts` orchestration:
  - [ ] Write a test for input emission timing (rate=1, rate=2, rate=3 at cycles 0..6).
  - [ ] Write a test for Phase A / Phase B split: two agents trying to swap positions must NOT both succeed silently.
  - [ ] Implement the cycle pipeline until both pass.
- [ ] Build `runUntilHalt`:
  - [ ] Test: a trivial solved puzzle reports `victory` at the expected cycle.
  - [ ] Test: an unsolvable puzzle reports `cycle_limit_exceeded` at exactly `maxCycles`.
  - [ ] Test: a puzzle where every agent's program is `WAIT` reports `agent_deadlock`.
- [ ] Snapshot tests:
  - [ ] Hand-build 5 puzzle+solution pairs covering different mechanics. Persist puzzle, solution, and expected trace JSON to `__tests__/snapshots/`.
  - [ ] `snapshot.test.ts` walks the directory and asserts `runUntilHalt(puzzle, solution).trace` deep-equals the expected trace.
- [ ] Conservation property test (fast-check):
  - [ ] Generator produces arbitrary small puzzles (4–8 grid, 1–3 agents, 1–2 inputs, 1–2 outputs).
  - [ ] For 1000 generated runs, assert: at every cycle, `tilesCargoCount + agentsCargoCount + deliveredCount == cumulativeEmissions`.
  - [ ] On failure: write the generated puzzle + trace to `test-results/engine/` via `dumpTrace`.
- [ ] Determinism property test:
  - [ ] Generator produces arbitrary puzzles + solutions.
  - [ ] Run each twice; assert `JSON.stringify(trace1) === JSON.stringify(trace2)`.
- [ ] Solver corpus:
  - [ ] Author 50 puzzles with known-good solutions in `fixtures/`. Span: trivial (single agent + conveyor), filter routing, splitter throughput, merger collision, reactor recipe, multi-agent coordination, near-cycle-cap stress.
  - [ ] `corpus.test.ts` asserts every puzzle's known solution reports `victory` within the puzzle's stated `max_cycles`.
- [ ] Lint, format, run full suite, commit `feat(engine): phase 1 complete`.

#### Test commands

```
npm run test:unit -- src/engine
npm run lint
```

### Reviewer

**Run with fresh context.** Reviewer should not have read the implementation while it was being written. Reviewer must verify each of the following **verbatim** from design doc §10 Phase 1:

> Reviewer (fresh context) should check: cargo conservation is *tested*, not just asserted in prose; simultaneous-move resolution is tested under collision; property-test coverage spans edge cases (empty grids, agents starting on inputs/outputs, agents with empty op lists); the simulation is deterministic given identical inputs.

Concretely, the reviewer's checklist:

- [ ] Cargo conservation is enforced by an actual property test that fails when broken (verify by introducing a deliberate leak in a scratch branch and confirming the test catches it).
- [ ] Simultaneous-move collisions (head-on, swap, three-way race for one cell) have explicit unit tests, and the resolution rule is documented in the engine memo.
- [ ] Property-test generators reach edge cases: `agents.length === 0`, agents with `program.length === 0`, agents whose `start_pos` overlaps an `input` or `output`, grids with zero obstacles, grids of minimum legal dimensions.
- [ ] Determinism test runs each generated case twice and compares full traces — not just final state.
- [ ] No use of `Math.random`, `Date.now`, `crypto.randomUUID`, or any iteration over `Map`/`Set` insertion order anywhere under `src/engine/`.

Reviewer reports findings to the user before Phase 2 begins.

### Exit criteria

- All listed tests pass.
- Reviewer checklist is signed off in writing (PR comment or `docs/reviews/phase-1.md`).
- Engine has no UI, DOM, or `window`/`document` references.

---

## Phase 2 — Renderer

**Cycle:** Light. Architect proposes the drawing pipeline + palette indirection briefly; coder builds; manual visual review is the reviewer. Add a reviewer pass only if Playwright screenshot diffs prove flaky.
**Goal:** Canvas renderer that takes engine state and draws grid, tiles, agents, cargo, palette-aware.
**Maps to DoD:** "Rendering a hand-built puzzle state matches a reference screenshot within tolerance."

### Architect notes

Short notes only (in PR description or `docs/architecture/renderer.md`):

- **Pipeline:** `render(ctx, world, theme) → void`. Stateless; called from a `requestAnimationFrame` loop in the app shell (not the engine).
- **Palette indirection:** A `Palette` singleton reads CSS custom properties (`--bg`, `--fg`, `--accent`, …) from `document.documentElement`. All Canvas fill/stroke calls go through `Palette.get('accent')` etc. Themes never appear hardcoded in renderer code.
- **Glyph resolution:** Glyphs are SVG paths in `src/render/glyphs/` indexed by string key (`input`, `output`, `agent`, `tile_conveyor`, etc.). The renderer holds a `Map<string, Path2D>` precomputed at app startup. Phase 8 wires the theme's `glyphs` block to choose which glyph file per key; for now, a default mapping is fine.
- **Layering:** background → grid lines → obstacles → tiles → cargo → agents → overlay (e.g. selection). Each is a separate pass.
- **No subpixel surprises:** scale to integer grid units; round on draw to avoid half-pixel anti-aliasing artifacts that flake screenshot tests.

### Deliverables

Create:
- `src/render/palette.ts` (singleton reading CSS vars)
- `src/render/glyphs/index.ts` + a starter set of SVG path strings (~12 glyphs to cover Phase 1's tile types and a generic agent)
- `src/render/renderer.ts` (the `render` function)
- `src/render/__tests__/palette.test.ts` (unit: returns the CSS var, falls back to a documented default if unset)
- `e2e/render.spec.ts` (Playwright: renders 4 reference puzzle states; screenshot-diffs against checked-in PNGs)
- `e2e/render-refs/` (committed reference PNGs)
- `src/app/canvasMount.ts` (minimal app harness: a Canvas, a hardcoded puzzle/solution, a render call — used by the Playwright test)
- Update `src/main.ts` to mount the canvas

### Tasks

- [ ] Architect notes written and skimmed by the user (one round of feedback is fine).
- [ ] Implement `Palette` and unit-test it.
- [ ] Implement glyph index (a flat object literal is fine; do not over-engineer).
- [ ] Implement `render` layer by layer; each layer gets a one-line test in a scratch Playwright spec to confirm it draws at all (then collapse into the final reference-image suite).
- [ ] Author the 4 reference fixtures: empty grid, single-tile grid, full puzzle pre-run, full puzzle mid-run.
- [ ] Generate reference PNGs by running the spec once, manually inspecting, and committing the result.
- [ ] Configure Playwright's `toHaveScreenshot` with `{ maxDiffPixelRatio: 0.005 }` (5 ‰ tolerance — tune if flaky).
- [ ] Commit.

### Test commands

```
npm run test:e2e -- e2e/render.spec.ts
npm run test:unit -- src/render
```

### Manual checkpoint

- Render the four fixtures in a browser. Does it visually evoke the Opus Magnum reference aesthetic (vector/geometric, restrained palette)? If not, iterate on glyph paths and stroke widths *before* committing reference PNGs.

### Exit criteria

- Screenshot diff tests pass on Linux + Windows runners (note Playwright's per-OS reference quirk — may need `*-{platform}.png` siblings; document if so).
- Manual visual review approved.

---

## Phase 3 — Editor

**Cycle:** Light. Manual playtest is the reviewer. Architect pass useful for input-handling design.
**Goal:** Player can construct a complete solution to a hand-built puzzle in-browser.
**Maps to DoD:** "Can construct a complete solution to a hand-built puzzle in-browser."

### Architect notes

Short notes in `docs/architecture/editor.md`:

- **Tile placement model:** click-to-place from a palette toolbar. Rotation via `R` key while a tile is selected. Drag-place is a future enhancement, not v1.
- **Path drawing:** click an agent's home cell to enter path mode; subsequent clicks append vertices (polyline); `Esc` exits, `Z` undoes the last vertex. The path is a list of grid cells, not pixels.
- **Op-list editor:** a panel per agent. Up/down arrow to reorder; backspace to delete; a dropdown adds. Validated against `available_ops` and `max_ops` from the puzzle.
- **Selection model:** exactly one "active object" at a time (tile, agent, or none). Keyboard ops act on the active object.
- **State shape:** `EditorState = { puzzle: Puzzle, draft: Solution, mode: 'idle' | 'placing-tile' | 'drawing-path' | 'editing-ops' }`. A reducer applies edit actions. The reducer is pure and unit-tested; React/DOM event handlers dispatch into it.

**UI framework: none.** Editor is hand-written DOM + a reducer, per user decision before Phase 0.

### Deliverables

Create:
- `src/editor/state.ts` (reducer + action types)
- `src/editor/state.test.ts` (unit tests for every action)
- `src/editor/dom/palette.ts` (tile-palette toolbar)
- `src/editor/dom/grid.ts` (click/keyboard handlers on the canvas)
- `src/editor/dom/opList.ts` (per-agent op-list panel)
- `src/editor/index.ts` (mounts editor onto a canvas + DOM container, wires reducer)
- `e2e/editor.spec.ts` (Playwright: drives a full solution construction for a known puzzle, asserts final `EditorState.draft` matches expected JSON via a `__getDraft()` hook exposed only in dev/test builds)

### Tasks

- [ ] Architect notes + framework decision confirmed with user.
- [ ] Reducer + action types; unit tests for every action.
- [ ] DOM event wiring for tile placement; manual smoke.
- [ ] Path drawing; manual smoke.
- [ ] Op-list panel; manual smoke.
- [ ] Validation: actions that would exceed `max_tiles`, exceed `max_ops`, or use a tile/op not in the puzzle's available list are rejected by the reducer (unit tests).
- [ ] Playwright spec drives the construction of a known solution end-to-end.
- [ ] Commit.

### Test commands

```
npm run test:unit -- src/editor
npm run test:e2e -- e2e/editor.spec.ts
```

### Manual checkpoint

- **30-minute playtest by the user.** Is placing tiles satisfying? Path drawing intuitive? Op-list editor not frustrating? Note any friction; address only blockers in this phase.

### Exit criteria

- All listed tests pass.
- User-reported playtest friction is logged in `docs/playtest/phase-3.md`; blockers fixed, polish deferred.

---

## Phase 4 — Playback Controls

**Cycle:** Light. Manual testing of animation feel is the reviewer. Architect pass should specify the animation interpolation strategy.
**Goal:** Player hits Run, watches a solution execute, can pause/step/fast-forward/reset.
**Maps to DoD:** "Can hit Run, watch a solution execute, pause it, step through it, reset to edit state."

### Architect notes

Short notes in `docs/architecture/playback.md`:

- **Strategy:** the engine produces discrete `CycleTrace[]` from `runUntilHalt`. The renderer interpolates *between* consecutive trace frames using time-based easing (linear for cargo movement, ease-in-out for agent steps). The engine itself never sees animation time.
- **Speeds:** ×0.5, ×1, ×2, ×4. ×1 = one cycle per 600ms. Implemented by scaling a single `cyclesPerSecond` parameter.
- **State machine:** `idle | running | paused | finished`. Transitions: `idle--Run-->running`, `running--Pause-->paused`, `running--reaches halt-->finished`, `*--Reset-->idle`. Step works in `idle` and `paused` only.
- **Pre-compute the trace, then animate:** because the engine is deterministic and headless, `runUntilHalt` runs once when the player hits Run; the animator then plays back. This avoids the engine and renderer ever stepping in lockstep at frame rate.

### Deliverables

Create:
- `src/playback/animator.ts` (consumes a `CycleTrace[]`, exposes `play()`, `pause()`, `step()`, `setSpeed()`, `reset()`, emits per-frame `InterpolatedState`)
- `src/playback/animator.test.ts` (unit: fake clock; assert state transitions, frame interpolation math)
- `src/playback/dom/controls.ts` (toolbar buttons + keyboard shortcuts: space=play/pause, period=step, brackets=speed)
- `src/playback/index.ts` (wires animator + controls + renderer + editor state)
- `e2e/playback.spec.ts` (Playwright: load a solved puzzle, click Run, wait N animation frames, assert agents have moved)

### Tasks

- [ ] Architect notes written.
- [ ] Implement animator with a fake-clock unit test for every state transition.
- [ ] Implement interpolation math; unit test it (pure function).
- [ ] DOM controls + keyboard shortcuts.
- [ ] Wire to the editor's "Run" button; on Run, freeze edits.
- [ ] Reset button restores the pre-Run editor state byte-for-byte.
- [ ] Playwright spec end-to-end.
- [ ] Commit.

### Test commands

```
npm run test:unit -- src/playback
npm run test:e2e -- e2e/playback.spec.ts
```

### Manual checkpoint

- Does the animation feel right? Is ×4 readable? Is reset instantaneous and unambiguous?

### Exit criteria

- Tests pass; manual feel check approved.

---

## Phase 5 — Win/Loss + Optional Challenges

**Cycle:** Full. The rule DSL parser is the security-relevant piece. Reviewer must run with fresh context.
**Goal:** Solving a puzzle awards a checkmark; optional challenges (e.g. `cycles < 40`) are evaluated and badged.
**Maps to DoD:** "Solving a puzzle shows checkmarks for which optional challenges you met."

### Architect

Architect produces `docs/architecture/rule-dsl.md` **before** code:

1. **Formal grammar** in EBNF. Suggested grammar:

   ```
   expr      = orExpr ;
   orExpr    = andExpr ( "||" andExpr )* ;
   andExpr   = cmpExpr ( "&&" cmpExpr )* ;
   cmpExpr   = sumExpr ( ("=="|"!="|"<"|"<="|">"|">=") sumExpr )? ;
   sumExpr   = mulExpr ( ("+"|"-") mulExpr )* ;
   mulExpr   = unary ( ("*"|"/") unary )* ;
   unary     = "!" unary | primary ;
   primary   = NUMBER | IDENT | "(" expr ")" ;
   IDENT     = "cycles" | "tiles_used" | "agent_count" | "ops_total" ;
   NUMBER    = digit+ ;
   ```

   No strings, no function calls, no member access, no assignment. Idents are a closed set.

2. **AST shape:** discriminated union, e.g. `{ kind: 'num', value: number } | { kind: 'var', name: VarName } | { kind: 'bin', op: BinOp, lhs: AST, rhs: AST } | { kind: 'unary', op: '!', arg: AST }`.

3. **Evaluator interface:** `evaluate(ast: AST, ctx: { cycles, tiles_used, agent_count, ops_total }) → boolean | number`. Result type at the root must be `boolean` — any non-boolean root is a validation error caught at puzzle-load time, not at evaluation time.

4. **Failure modes documented:** lexer rejects unknown characters; parser rejects unbalanced parens, missing operands, trailing tokens; evaluator divides-by-zero → rule fails closed (challenge not earned); identifiers outside the closed set → parse error.

5. **Per-puzzle stats panel.** Specify the UI: on completion, a results panel shows `cycles`, `tiles_used`, `agent_count`, `ops_total`; each optional challenge gets a row with its label and a checkmark or X.

### Coder

#### Deliverables

Create:
- `src/dsl/lexer.ts`
- `src/dsl/parser.ts`
- `src/dsl/ast.ts`
- `src/dsl/evaluator.ts`
- `src/dsl/index.ts` (`parseRule(string) → AST`, `evaluateRule(AST, Context) → boolean`)
- `src/dsl/__tests__/lexer.test.ts`
- `src/dsl/__tests__/parser.test.ts`
- `src/dsl/__tests__/evaluator.test.ts`
- `src/dsl/__tests__/fuzz.test.ts` (fast-check: feed random strings to `parseRule`; assert it either returns an AST or throws a `RuleParseError` — never throws an unexpected type, never hangs, never returns undefined)
- `src/dsl/__tests__/no-eval.test.ts` (static check: greps the compiled `src/dsl/` for `eval`, `Function(`, `new Function`, `setTimeout(.+string`, etc., and fails if found)
- `src/completion/detector.ts` (`detectCompletion(puzzle, trace) → CompletionResult` with stats + per-challenge results)
- `src/completion/__tests__/detector.test.ts`
- `src/completion/dom/resultsPanel.ts` (renders the badge UI)
- `e2e/completion.spec.ts` (Playwright: solve a puzzle with a known solution, assert exactly the expected checkmarks appear)

#### Tasks (TDD)

- [ ] Lexer: tokenize the example rules from the design doc (`cycles < 40`, `tiles_used <= 12`) plus edge cases (whitespace, unbalanced parens, unknown chars). Tests first.
- [ ] Parser: produces AST for every grammar production. Tests first; one happy + one rejection per rule.
- [ ] Evaluator: covers every AST kind; div-by-zero returns `false`; non-boolean root rejected at evaluation entry.
- [ ] Fuzz test (10 000 generated strings).
- [ ] `no-eval.test.ts` static greps the source dir for `\beval\s*\(`, `\bFunction\s*\(`, `new\s+Function`. Use Node's `fs` to read files; do not rely on bundler internals.
- [ ] Completion detector: pure function over `(puzzle, trace)`; reads `puzzle.optional_challenges`, evaluates each, returns full result.
- [ ] Results panel DOM; uses `textContent` only, never `innerHTML` (assert in a code review pass).
- [ ] Wire panel to playback `finished` event.
- [ ] End-to-end Playwright spec.
- [ ] Commit.

#### Test commands

```
npm run test:unit -- src/dsl src/completion
npm run test:e2e -- e2e/completion.spec.ts
```

### Reviewer

**Run with fresh context.** Verbatim from design doc §10 Phase 5:

> Reviewer (fresh context) should check: parser rejects every malformed input class (fuzz coverage); evaluator handles all valid AST shapes; **no `eval` or `Function()` constructor anywhere** — the DSL must be a safe interpreted AST.

Concretely:

- [ ] Fuzz coverage is real: confirm `fuzz.test.ts` runs at least 10 000 cases per CI run and the generator can produce malformed input (it should produce many parse errors). Verify by counting thrown `RuleParseError`s.
- [ ] Every AST `kind` has at least one direct evaluator test.
- [ ] `no-eval.test.ts` passes AND was verified by deliberately adding `eval('1')` in a scratch branch — confirming the test catches it.
- [ ] No `innerHTML` anywhere under `src/completion/dom/` or `src/dsl/`.
- [ ] The closed identifier set is enforced at parse time, not just at evaluation time.

Reviewer reports findings to user before Phase 6.

### Exit criteria

- All tests pass.
- Reviewer checklist signed off.

---

## Phase 6 — Audio

**Cycle:** Light. Manual listening is the reviewer.
**Goal:** Each puzzle plays the right loop; each interaction has a sound.
**Maps to DoD:** "Each puzzle plays the right loop, each interaction has a sound."

### Architect notes

- Tone.js handles music loops; raw Web Audio handles SFX. Don't blend them; the boundary keeps SFX latency low (Tone.js scheduling adds buffer).
- 12 base chord progressions live in code as data; the theme picks one by name in Phase 8. For Phase 6 use a single default progression.
- A single `AudioController` exposes `playLoop(name)`, `playSfx(name)`, `setMusicVolume`, `setSfxVolume`. Mock-friendly: depends on `AudioContext` and `Tone` only through a thin adapter so unit tests can swap a mock.

### Deliverables

Create:
- `src/audio/controller.ts`
- `src/audio/sfxBank.ts` (synth definitions: tile place, agent step, grab, drop, success, failure)
- `src/audio/loops.ts` (3 lo-fi loops for intro/hub/puzzle — Tone.js Pattern objects)
- `src/audio/loopMixer.ts` (slow cross-fade between loop variants when switching, mitigating "loops feel repetitive over 3-6 hours" per design doc §11)
- `src/audio/progressions.ts` (12 base progressions)
- `src/audio/__tests__/controller.test.ts` (mock AudioContext / Tone; assert that `playLoop('puzzle')` calls `.start()` on the right object)
- `src/audio/dom/volumeMixer.ts`
- Update editor / playback to call `playSfx` at the right moments.

### Tasks

- [ ] Architect note (3-5 lines, in PR description is fine).
- [ ] Build `controller` with mock-injectable audio backend; unit test it.
- [ ] Author SFX (short ADSR-shaped tones).
- [ ] Author 3 loops and 12 progressions (data only; Phase 8 wires the theme picker).
- [ ] Wire SFX into editor + playback events.
- [ ] Volume mixer DOM.
- [ ] Commit.

### Test commands

```
npm run test:unit -- src/audio
```

### Manual checkpoint

- Listen on headphones. Do loops repeat seamlessly? Are SFX too loud / too dry? Adjust ADSR + gain until pleasant.

### Exit criteria

- Tests pass.
- User signs off on manual listen.

---

## Phase 7 — Campaign State + Library

**Cycle:** Moderate. Architect step matters here. Reviewer focuses on save/load round-trip across schema versions.
**Goal:** Load `campaign.json`, navigate acts/hubs, auto-save, story gate logic, library view in main menu.
**Maps to DoD:** "Can complete an act, see it advance the gate, close & re-open and resume; library shows all past campaigns and lets you switch between them."

### Architect

Produce `docs/architecture/campaign-state.md`:

1. **Zod schema** for `campaign.json` matching design doc §5. Schema lives in `src/schema/campaign.ts` and is shared with Phase 10's CLI. **Schema version field is required** and on a mismatch we run migrations, never crash.
2. **State machine** for campaign progression:
   - `loaded → act-intro → hub → puzzle → puzzle-complete → hub (or act-outro if `required_completions` met) → act-intro (next) | ending`.
3. **Persistence format.** Two layers:
   - **CampaignSave** (per campaign): `{ version, campaignId, manifestHash, progress: { actId: { completedPuzzleIds, optionalsEarned } }, lastPlayed }`.
   - **LibraryIndex** (global): `{ version, entries: [{ campaignId, themeName, lastPlayed, completed }] }`.
   - Browser: `localStorage` keys `throughline:campaign:<id>` and `throughline:library`.
   - Tauri: files under app data dir (resolved via Tauri API).
4. **Migration policy.** Saves carry a `version`. On load: if `save.version < current`, run sequential migration functions; if `save.version > current`, refuse to load with a friendly error; if `manifestHash` mismatches the loaded `campaign.json` (manifest was edited under the player), warn and offer "reset progress" — never crash.
5. **Where does the ending text screen live?** Fold into this phase: when the final act completes, render `campaign.ending.good` (escaped) on an outro screen. The `neutral` ending is reserved for future "completed required puzzles but not all optionals" branching; default to `good` in v1.

### Coder

#### Deliverables

Create:
- `src/schema/campaign.ts` (Zod schemas — shared module)
- `src/campaign/load.ts` (loads + validates a manifest from a `File` or path)
- `src/campaign/state.ts` (the state-machine reducer)
- `src/campaign/persistence.ts` (storage adapter: browser/localStorage vs Tauri filesystem; chosen via a small platform-detection module)
- `src/campaign/migrations.ts` (registry of `from→to` save migrators; v1 has none yet but the harness must exist)
- `src/campaign/library.ts` (LibraryIndex CRUD)
- `src/campaign/dom/mainMenu.ts`, `actIntro.ts`, `hub.ts`, `actOutro.ts`, `ending.ts`, `libraryView.ts`
- `src/campaign/__tests__/state.test.ts`
- `src/campaign/__tests__/persistence.test.ts` (round-trip; missing keys; corrupted JSON; old version triggers migration)
- `src/campaign/__tests__/library.test.ts` (add, list-in-order, delete)
- `e2e/campaign.spec.ts` (load synthetic 2-act manifest; complete required puzzles in act 1 programmatically via dev hooks; assert act 2 unlocks; reload page; assert resume to act 2)
- `src/campaign/__tests__/fixtures/two-act.json` (synthetic manifest)

#### Tasks

- [ ] Architect doc written; Zod schemas extracted into the shared module.
- [ ] Implement schema + a `parseCampaign(json) → Campaign | ParseError` wrapper. Tests for every required field's missing/invalid case.
- [ ] Implement reducer + state-machine tests.
- [ ] Implement persistence adapter; tests against an in-memory fake storage.
- [ ] Implement migration harness (a registry + a `migrate(save) → save`); test by registering a fake `v0 → v1` migrator.
- [ ] Implement library CRUD.
- [ ] DOM screens (main menu, intro, hub, outro, ending, library view). Use a small router-like helper or a single `screen` state field.
- [ ] All narrative strings rendered via `textContent`. Never `innerHTML`. (Tested via a Playwright spec that injects a script tag in a manifest field and asserts it does not execute.)
- [ ] Save autosaves on every state transition.
- [ ] End-to-end Playwright spec.
- [ ] Commit.

#### Test commands

```
npm run test:unit -- src/schema src/campaign
npm run test:e2e -- e2e/campaign.spec.ts
```

### Reviewer

Verbatim from design doc §10 Phase 7:

> Reviewer focuses on save/load round-trip across schema versions and migration safety — saves from older builds shouldn't crash newer builds.

Concretely:

- [ ] The migration harness is exercised by tests, not just defined: at least one synthetic `v0 → v1` migration must run in CI.
- [ ] A save with a future `version` is rejected with a clear error, not crashed on.
- [ ] A manifest hash mismatch produces the documented "warn + reset" flow, not silent data loss.
- [ ] Corrupted JSON in storage does not brick the main menu — the app still loads to a usable state.
- [ ] All narrative text from `campaign.json` reaches the DOM via `textContent` (verify via a `<script>`-injection test).

### Manual checkpoint

- Complete a 2-act synthetic campaign by hand. Does the act-intro / hub / act-outro flow feel like a beat or a chore? Is switching campaigns in the library smooth?

### Exit criteria

- All tests pass.
- Reviewer checklist signed off.
- Manual walkthrough approved.

---

## Phase 8 — Theme Applicator

**Cycle:** Moderate. Architect designs the glyph library contract and vocabulary substitution rules.
**Goal:** Same puzzle renders three different ways given three theme blocks.
**Maps to DoD:** "Same puzzle renders three different ways given three theme blocks."

### Architect

Produce `docs/architecture/theming.md`:

1. **Glyph library contract.** `src/render/glyphs/index.ts` exports a `GLYPH_LIBRARY` object keyed by `glyph_key` (e.g. `input`, `output`, `agent`, `tile_conveyor`). Each entry has alternate variants for thematic flavor (e.g. `input.alembic`, `input.evidence_locker`, `input.reactor_inlet`). Theme blocks reference variants by name; unknown variant names fall back to a documented default with a console warning. **Phase 8 ships ~50 glyphs across ~5 thematic families.**
2. **Vocabulary substitution.** Every player-facing UI string is authored as a template (`"{{cargo}} delivered"`). A `substitute(template, vocab) → string` function does string replacement. The replacement function HTML-escapes its inputs as a defense-in-depth measure (the renderer already escapes, but vocab strings come from the LLM and may end up in many places).
3. **Palette validation.** On theme load, compute the WCAG contrast ratio between `bg` and `fg`, and between `surface` and `fg`. If either is below 4.5:1, reject the theme and fall back to a documented default palette with a console warning. This is the "cheap AA-contrast insurance" mentioned in the design doc.
4. **Token leak detection.** A regex `/{{[\w_]+}}/` run against the rendered DOM in a Playwright spec ensures no template tokens leak unsubstituted.
5. **Audio coupling.** The theme block's name maps to one of the 12 chord progressions and to per-theme SFX tweaks (small frequency multipliers in `sfxBank`). Wire this here.

### Coder

#### Deliverables

Create:
- `src/theme/applier.ts` (`applyTheme(theme) → void`: sets CSS vars, registers glyph variants, sets vocab, configures audio)
- `src/theme/vocabulary.ts` (`substitute`)
- `src/theme/contrast.ts` (WCAG contrast calculation; pure function)
- `src/theme/__tests__/applier.test.ts`
- `src/theme/__tests__/vocabulary.test.ts` (substitution; escaping; missing token → leaves the placeholder + console warning)
- `src/theme/__tests__/contrast.test.ts`
- Expand `src/render/glyphs/` to ~50 variants spanning 5 families (alchemy, forensics, sci-fi, mythic, modernist — placeholder names; refine).
- `src/render/glyphs/families.json` (catalog the LLM can be given a curated list from in Phase 10)
- `e2e/theme.spec.ts` (Playwright: render the same puzzle with 3 different theme blocks, screenshot-diff each; also assert no `{{...}}` tokens in any rendered text)

#### Tasks

- [ ] Architect doc written.
- [ ] Implement `applier` + tests.
- [ ] Implement `substitute` with escaping + tests.
- [ ] Implement `contrast` + tests (use the published WCAG luminance formula).
- [ ] Author 50 SVG glyph variants; catalog them in `families.json`.
- [ ] Wire applier into campaign load (Phase 7 integration point).
- [ ] End-to-end Playwright spec with 3 distinct themes.
- [ ] Commit.

#### Test commands

```
npm run test:unit -- src/theme
npm run test:e2e -- e2e/theme.spec.ts
```

### Reviewer

Verbatim from design doc §10 Phase 8:

> Reviewer checks: no un-substituted `{{tokens}}` can leak into UI; palette validation maintains a readability floor (cheap AA-contrast insurance even though A11y is deferred); narrative text is HTML-escaped before rendering.

Concretely:

- [ ] The token-leak regex test runs after a full render of every screen (not just one) — main menu, act intro, hub, puzzle, results, ending.
- [ ] Contrast validation runs on theme load and the rejection path is tested (a known-bad theme is in the test fixtures).
- [ ] Vocab substitution escapes its inputs — verify by passing `"<script>"` as a vocab value and asserting the rendered DOM contains `&lt;script&gt;`.
- [ ] No glyph in the library uses `<foreignObject>`, `<script>`, or external references.

### Manual checkpoint

- Do the three themes feel distinct without breaking readability? Take screenshots; eyeball.

### Exit criteria

- All tests pass.
- Reviewer checklist signed off.

---

## Phase 9 — Hardcoded Tutorial Campaign: *The Apprentice's Manual*

**Cycle:** Content-focused. The "architect" step is curriculum design; the "reviewer" is a fresh playtester.
**Goal:** A hardcoded `campaign.json` that a fresh player can complete without external docs; final puzzle is a graduation that integrates everything.
**Maps to DoD:** "A fresh player who's never seen the game can complete it without reading external docs."

### Curriculum design

Produce `docs/curriculum/tutorial.md`. Specify, for each of ~6 puzzles, exactly one new mechanic introduced and the mentor's lesson around it. Proposed curriculum (revise during this step):

| # | Title | New mechanic | Mentor focus |
|---|---|---|---|
| 1 | First Flow | Conveyor + Input + Output | "Watch what moves, and where it goes." |
| 2 | The Branching Path | Splitter | Decisions under throughput. |
| 3 | Two Hands, One Mind | Agents: `MOVE`, `GRAB`, `DROP` | Manual routing vs. tile routing. |
| 4 | The Sorter's Eye | Filter + `SENSE` | Conditional action. |
| 5 | Reunion | Merger | Synchronizing streams. |
| 6 | Graduation: The First Commission | Reactor + everything above | Integrates all prior mechanics. |

Constraints:
- Mentor uses **generic vocabulary** (`flow`, `operator`, `lattice`) — no themed words. This is so the tutorial gels with any later procgen theme.
- Mentor voice: warm, slightly dry, ~6–8 lines per puzzle.
- Each puzzle's `optional_challenges` should be tight enough to be teaching opportunities, not punishing.

### Authoring

#### Deliverables

Create:
- `campaigns/tutorial.json` (the hardcoded manifest)
- `campaigns/tutorial.solutions.json` (per-puzzle reference solutions, used by the e2e test)
- `src/campaign/builtins.ts` (re-exports the tutorial manifest so the main menu can offer it without a file picker)
- `docs/curriculum/tutorial.md` (the curriculum design doc above)
- `e2e/tutorial.spec.ts` (loads the tutorial, plays each puzzle programmatically via the reference solutions, asserts ends in completion state, asserts `New Campaign` button becomes enabled)

#### Tasks

- [ ] Curriculum doc written and approved by user.
- [ ] Author each puzzle's grid + inputs + outputs + obstacles + constraints in `tutorial.json`.
- [ ] Author each puzzle's mentor lines as `briefing` text.
- [ ] Author the outro that unlocks `New Campaign`.
- [ ] Build each reference solution by hand in the editor; export to `tutorial.solutions.json`.
- [ ] Write the scripted-playthrough Playwright spec.
- [ ] Commit.

### Test commands

```
npm run test:e2e -- e2e/tutorial.spec.ts
```

### Playtest review

**This is the review step for Phase 9. There is no code reviewer.**

- Recruit **2–3 people who haven't seen the game** (in person or remote screen share).
- Hand them the tutorial cold. Do not coach. Take notes on where they hesitate or get stuck.
- For each playtester: did they finish? How long? Where did they get stuck? Did the mentor lines feel helpful or in the way?
- File findings in `docs/playtest/tutorial-<initials>.md`.
- Iterate on mentor copy and puzzle constraints based on patterns across testers — not single-tester noise.
- Sign off only when all three testers can complete the tutorial without intervention.

### Exit criteria

- E2E spec passes.
- 2+ playtesters completed the tutorial unaided; findings documented.
- The `New Campaign` button is gated and lights up only after tutorial completion.

---

## Phase 10 — Companion CLI (`throughline-gen`)

**Cycle:** Full — and the most important review pass in the project.
**Goal:** Running the CLI produces a valid `campaign.json` that the game can load and play through.
**Maps to DoD:** "Running the CLI produces a valid `campaign.json` that the game can load and play through."

### Architect

Produce `docs/architecture/cli.md`:

1. **Top-level pipeline** (matches design doc §9):
   1. Build the system prompt (long; includes schema, mechanics rules, theme glyph library catalog, rule-DSL grammar).
   2. Build the user prompt (seed, acts).
   3. Spawn `claude -p <prompt>` as a **subprocess with argv** (no shell interpolation). Capture stdout.
   4. Validate against Zod schema (the shared `src/schema/campaign.ts`). On failure, retry up to **2 times** with the error message appended.
   5. Solvability check on each puzzle (per below).
   6. If any puzzle is unsolvable, regenerate **just that puzzle** (up to 2 attempts), preserving the rest of the manifest.
   7. Write the manifest atomically (write to temp file, fsync, rename).
2. **Subprocess safety.** Use `child_process.spawn('claude', ['-p', prompt], { shell: false })`. **Never** use `exec` or `spawn` with `shell: true`. Prompt content stays in argv as a single argument.
3. **Retry/backoff.** Hard cap: 3 total LLM calls per generation attempt (1 initial + 2 retries) for the full manifest; 3 total per regenerated puzzle. Exponential backoff with jitter between calls (e.g. 500ms × 2^attempt + 0–250ms). **Bounded.**
4. **Solvability check.**
   - For each puzzle, run a bounded brute-force/heuristic solver — see "Solver" below.
   - Hard time budget per puzzle: **30 seconds** wall-clock (configurable). Beyond budget → puzzle is "unsolvable as designed" → trigger regeneration.
   - The solver shares the Phase 1 engine code (a manifest run with `runUntilHalt` validates a candidate solution).
5. **Solver strategy** (v1):
   - Iterated random restarts: generate small random solutions (tiles + paths + ops) within the puzzle's constraints; run the engine; keep best by "outputs filled" metric.
   - Number of restarts bounded by the time budget.
   - This is intentionally weak — its purpose is to catch the LLM's most likely failure mode (over-constrained puzzles), not to play optimally.
6. **CLI surface.** `throughline-gen --out <path> [--seed <s>] [--acts <n>] [--puzzles-per-act <n>] [--time-budget-per-puzzle <sec>] [--gentle] [--avoid-themes <comma-list>]`. `--help` prints usage. The `--gentle` flag tells the prompt builder to bias toward easier puzzles (mitigates the "tutorial → procgen difficulty cliff" risk in design doc §11). `--avoid-themes` accepts theme names the LLM should not produce, so Phase 11's UI can pass the player's history.
7. **Path safety.** `--out` is resolved with `path.resolve` against CWD; if the resolved path is outside CWD (e.g. `../../../etc/whatever`), refuse with a clear error.
8. **Treat the LLM's output as untrusted.** This is the entry point of the trust boundary. The Zod schema is enforced strictly (no unknown fields, no string fields without max length). Narrative text fields cap at e.g. 2000 chars; titles at 200.
9. **Live LLM integration test.** A single nightly-only CI test (`SKIP_LIVE_LLM=1` in normal CI, runs only when set otherwise) that actually calls `claude -p` and runs the solver on the result.

### Coder

#### Deliverables

Create (under `cli/`, a separate Node package nested in the repo — its own `package.json` or share root's; recommend **share root's** to keep schema imports trivial):
- `cli/src/index.ts` (entry; arg parsing)
- `cli/src/promptBuilder.ts`
- `cli/src/prompts/system.md` (the long system prompt — checked-in markdown the builder loads at runtime)
- `cli/src/claudeSpawn.ts` (subprocess wrapper)
- `cli/src/validator.ts` (uses shared `src/schema/campaign.ts`)
- `cli/src/solver.ts` (uses shared `src/engine/`)
- `cli/src/generator.ts` (the full pipeline)
- `cli/src/writer.ts` (atomic write)
- `cli/src/__tests__/promptBuilder.test.ts`
- `cli/src/__tests__/claudeSpawn.test.ts` (mocks `child_process.spawn`; asserts argv shape, never `shell: true`)
- `cli/src/__tests__/validator.test.ts` (corpus of synthetic LLM outputs: valid, structurally malformed, semantically bad like negative cycles, untrusted-text injection)
- `cli/src/__tests__/solver.test.ts`
- `cli/src/__tests__/generator.test.ts` (mocks `claudeSpawn`; covers happy path, parse-error retry, unsolvable-puzzle regeneration, hit retry cap)
- `cli/src/__tests__/writer.test.ts` (path traversal rejection; atomic-write behavior on simulated mid-write failure)
- `cli/test-fixtures/llm-outputs/` (the corpus: good.json, missing-field.json, extra-field.json, oversize-text.json, unsolvable.json, …)
- `cli/integration/live-claude.test.ts` (gated by `RUN_LIVE_LLM=1`)
- `bin/throughline-gen` (Node shebang wrapper invoking the compiled CLI entry)
- Update root `package.json` to expose the bin.

#### Tasks (TDD)

- [ ] Architect doc written.
- [ ] System prompt drafted. Include: schema reference, mechanics summary, glyph-family catalog (from Phase 8), rule-DSL grammar, examples of good outputs.
- [ ] `promptBuilder` + unit tests.
- [ ] `claudeSpawn` wrapper:
  - [ ] Unit test asserts `child_process.spawn` is called with `(cmd, args, { shell: false })` — `shell: true` must never appear.
  - [ ] Test handles non-zero exit codes, stderr, and a hard wall-clock timeout (e.g. 60s).
- [ ] `validator`:
  - [ ] Zod schema marked `.strict()` everywhere.
  - [ ] String fields have explicit max lengths.
  - [ ] Tests assert every malformed fixture in the corpus is rejected with a descriptive error.
  - [ ] Tests assert valid fixtures parse successfully.
- [ ] `solver`:
  - [ ] Random-restart routine with a strict time budget.
  - [ ] Unit test: given a hand-built solvable puzzle, finds a victory solution within 30s.
  - [ ] Unit test: given a hand-built unsolvable puzzle, returns `unsolvable` after budget.
- [ ] `generator` pipeline:
  - [ ] Mocks `claudeSpawn` to return canned strings.
  - [ ] Tests: happy path, validator failure triggers retry with appended error message, retry cap exits with clear error, unsolvable puzzle is regenerated per-puzzle, regeneration cap exits with clear error.
- [ ] `writer`:
  - [ ] Atomic write (temp + rename).
  - [ ] Path traversal rejection unit test.
- [ ] `cli/src/index.ts` argument parsing + `--help`.
- [ ] Live integration test, gated.
- [ ] Manual: generate 5 campaigns, eyeball coherence + theme diversity.
- [ ] Commit.

#### Test commands

```
npm run test:unit -- cli
RUN_LIVE_LLM=1 npm run test:unit -- cli/integration   # nightly only
```

### Reviewer

**Run with fresh context. This is the most important review in the project.** Verbatim from design doc §10 Phase 10:

> Reviewer (fresh context) should check: subprocess handling has no shell-injection surface (prompt content must never reach a shell unquoted); Zod schemas reject every malformed example, not just accept valid ones; retry loop has bounded backoff and a hard attempt cap; solvability check has a hard time budget per puzzle; **generated narrative text is treated as untrusted** — HTML-escaped before rendering, never inserted as innerHTML; the manifest file's path is validated (no traversal).

Concretely:

- [ ] Grep the CLI source for `shell:\s*true`, `exec(`, `execSync(`. Should find zero hits. Verify by adding one in a scratch branch and confirming a lint rule or test catches it.
- [ ] Every schema in `src/schema/campaign.ts` uses `.strict()` and every string field has a `.max(...)`. Verify by adding `extra: "junk"` to a fixture and confirming rejection.
- [ ] Retry attempts are countable in a test that injects 5 consecutive failures and asserts the generator gives up at the documented cap (no infinite loops).
- [ ] Solver time budget is honored under load — a deliberately pathological puzzle terminates within `budget + 1s`.
- [ ] Game-side rendering of `campaign.json` narrative fields uses `textContent` everywhere (cross-check against Phase 7 + 8 by grepping for `innerHTML` under `src/`).
- [ ] `writer` rejects every traversal case in a parameterized test: `../`, absolute path outside CWD, symlink that resolves outside CWD.
- [ ] System prompt is checked-in source (`cli/src/prompts/system.md`), not concatenated from many small strings — easier to audit.

### Manual checkpoint

- Generate 5 campaigns end-to-end. Are themes distinct? Are puzzles solvable and fun? Note any failure mode patterns for prompt tuning.

### Exit criteria

- All tests pass (including live test in nightly CI).
- Reviewer checklist signed off in a dedicated `docs/reviews/phase-10.md`.

---

## Phase 11 — End-to-End Procgen

**Cycle:** Moderate. Architect step is mostly the integration test plan. Reviewer focuses on seams and graceful degradation.
**Goal:** "New Campaign" button in-game produces a unique 3–6 hour campaign.
**Maps to DoD:** "From a fresh install, user hits one button, gets a unique 3–6 hour campaign."

### Architect

Produce `docs/architecture/procgen-integration.md`:

1. **Integration test plan.** A matrix of scenarios:
   - **Tauri happy path:** click New Campaign, CLI runs in-process via Tauri's command API, manifest loaded, campaign starts.
   - **Tauri CLI errors:** CLI exits non-zero → in-app modal with the CLI's stderr (sanitized).
   - **Tauri CLI hangs:** wall-clock timeout in the UI (e.g. 5min) → cancel + error modal.
   - **Tauri CLI returns garbage:** validator rejects → modal: "the generator produced invalid output; please try again with a different seed".
   - **Browser fallback:** modal explains "New Campaign requires the desktop app or the CLI". Offers a file picker for a manifest the user generates separately.
2. **Platform detection.** A single `platform.ts` that exposes `isTauri()`. All branches gate on this.
3. **Tauri command surface.** Define exactly which Rust commands the frontend invokes. Proposal: `generate_campaign(seed?, acts?) → Result<{ path, manifest }, String>` and `read_campaign_file(path) → Result<string, String>`. Keep the surface tiny.
4. **Error UX.** Every failure mode produces a friendly message + the ability to retry, never a stuck spinner.
5. **Diversity + difficulty hints to the CLI.** The "New Campaign" handler reads the LibraryIndex (Phase 7) for already-played theme names and passes them as `--avoid-themes`. If the LibraryIndex is empty (player has only finished the tutorial), pass `--gentle` for the first generated campaign. Both are mitigations from design doc §11.

### Coder

#### Deliverables

Create:
- `src/platform.ts`
- `src-tauri/` (Tauri scaffold — `tauri init` if not done in Phase 0)
- `src-tauri/src/commands.rs` (the two commands above)
- `src/campaign/dom/newCampaignButton.ts`
- `src/campaign/dom/newCampaignModal.ts`
- `src/campaign/dom/errorModal.ts`
- `src/campaign/__tests__/newCampaign.test.ts` (mock platform.ts; assert each error path lands on the right modal)
- `e2e/procgen.spec.ts` (mocks the Tauri command bridge; drives the full flow)
- Optionally a browser-only file-picker path in `newCampaignModal`.

#### Tasks

- [ ] Architect doc written.
- [ ] Tauri scaffold (if not yet present); configure dev/build.
- [ ] Implement Rust commands (call the existing `bin/throughline-gen` as a subprocess from Rust, with a wall-clock timeout).
- [ ] Implement frontend modals; wire to platform-gated handlers.
- [ ] Unit tests for each error path.
- [ ] Playwright e2e for the desktop flow (with mocks for the Tauri bridge).
- [ ] Manual: full playthrough of one generated campaign end-to-end. Track time, fun moments, dud puzzles. File a note in `docs/playtest/procgen-first-pass.md`.
- [ ] Commit.

#### Test commands

```
npm run test:unit -- src/campaign
npm run test:e2e -- e2e/procgen.spec.ts
```

### Reviewer

Verbatim from design doc §10 Phase 11:

> Architect step is mostly the integration test plan; reviewer focuses on the seams (CLI → JSON → game) and on graceful degradation when each link fails — what does the user see if the CLI errors, returns garbage, or hangs?

Concretely:

- [ ] Each documented failure mode has an automated test that exercises the user-visible path: CLI exit non-zero, CLI hang (mocked), CLI prints garbage, manifest fails Zod validation post-load.
- [ ] Spinners always have a "cancel" affordance; no infinite spinner is possible.
- [ ] Stderr from the CLI is sanitized before being shown (no terminal escapes; length-capped).
- [ ] Browser fallback path actually works — load a CLI-generated manifest via the file picker, play it.
- [ ] No code paths assume Tauri exists at module-load time (no top-level `import` of Tauri-only modules in shared code; gate via dynamic import).

### Manual checkpoint

- Hit New Campaign on a clean profile; play for 30+ minutes. Note any seams that feel rough.

### Exit criteria

- All tests pass.
- Reviewer checklist signed off.
- One generated campaign played to completion at least once, notes filed.

---

## Phase 12 — Packaging

**Cycle:** Coder only. Build config is mechanical.
**Goal:** Someone can download the desktop app or visit the web URL and play.
**Maps to DoD:** "Someone can download the desktop app or visit the web URL and play."

### Deliverables

Create / modify:
- `src-tauri/tauri.conf.json` (icons, identifier, version, build targets)
- Tauri build outputs configured for macOS, Windows, Linux
- `vite.config.ts` build target finalized (browser build)
- `package.json` scripts: `build:web`, `build:desktop:mac`, `build:desktop:win`, `build:desktop:linux`
- `README.md`: install steps, dev steps, where to get bundled sample campaigns, screenshots
- `campaigns/samples/` (3–5 hand-crafted sample campaigns per design doc §11 mitigation row "claude -p not installed")
- `.github/workflows/release.yml` (on tag: build artifacts for all platforms; attach to a GitHub release)
- `.github/workflows/ci.yml` updated to run a built-artifact smoke (Playwright loads the built `dist/` and reaches the main menu)

### Tasks

- [ ] Tauri config: icons, identifier `org.throughline.app`, version `0.1.0`.
- [ ] Author 3–5 sample campaigns (hand-built or generated then frozen).
- [ ] Update README with download links (post-first-release) and how to run from source.
- [ ] Build all three desktop targets locally; smoke-test launch on at least one (probably Windows since the user is on Win11).
- [ ] CI: built-artifact smoke test in Playwright.
- [ ] CI: release workflow on tag push.
- [ ] Manual: install on a clean machine; play for 10 minutes.
- [ ] Tag `v0.1.0`; first release.

### Test commands

```
npm run build
npm run build:desktop:win   # platform-appropriate
npm run test:e2e            # smoke on built artifact
```

### Exit criteria

- Built artifacts launch on a clean machine and reach the main menu.
- Sample campaigns load and play.
- README walks a stranger through download → play.

---

## Resolved pre-Phase-0 decisions

| Question | Decision |
|---|---|
| License | **MIT** |
| Package manager | **npm** |
| UI framework | **None** (hand-written DOM + reducer for editor/UI) |
| Tauri version | **2.x** |
| Repository host | **GitHub** |
| Tauri app identifier | **`org.throughline.app`** |
