# Tutorial Curriculum: *The Apprentice's Manual*

> **Phase 9 content design.** No architect step in the code sense — this is curriculum design. The "reviewer" is fresh playtesters, not a code reviewer.
> **Plan ref:** [IMPLEMENTATION_PLAN.md § Phase 9](../../IMPLEMENTATION_PLAN.md).

## Framing

The player is a new apprentice at **The Workshop** — a deliberately theme-flexible institution. The senior mentor's voice is **warm, slightly dry, ~6–8 lines per puzzle**. The mentor uses generic vocabulary (`flow`, `operator`, `lattice`) — never alchemy / forensics / sci-fi words — so the tutorial gels with any future procgen theme.

## Pedagogical principles

1. **One new mechanic per puzzle.** Earlier mechanics may reappear but the new one is the lesson.
2. **`available_tiles` / `available_ops` are constrained per puzzle** so the player can't sidestep the lesson. The graduation puzzle opens everything back up.
3. **Mentor lines live in `briefing`** — that's what the puzzle screen displays. The act `intro_text` / `outro_text` carry the narrative beats around the puzzles.
4. **Optional challenges are gentle teaching opportunities**, not punishing. Most puzzles ship one optional that nudges toward economy.
5. **Solutions exist and are reachable** within the puzzle's `max_tiles` and `max_cycles`. A reference solution per puzzle drives the scripted e2e.

## Curriculum

| # | Title | New mechanic | Mentor focus |
|---|---|---|---|
| 1 | First Flow | `conveyor` + Input + Output | "Watch what moves, and where it goes." |
| 2 | The Branching Path | `splitter` | Decisions under throughput. |
| 3 | Two Hands, One Mind | Agents: `MOVE`, `GRAB`, `DROP` | Manual routing vs. tile routing. |
| 4 | The Sorter's Eye | `filter` | Conditional flow. |
| 5 | Confluence | `merger` | Synchronizing streams. |
| 6 | Graduation: The First Commission | `reactor` + everything above | Combining mechanics into a recipe. |

## Per-puzzle design

### P1 — First Flow

- **Grid:** 5×3, input at (0,1), output at (4,1), 3 alpha required.
- **Tiles:** `conveyor` only. **Ops:** `MOVE`, `WAIT` (agent unused).
- **Reference solution:** four conveyors at (0..3, 1) facing E.
- **Optional:** "Use ≤4 tiles" (`tiles_used <= 4`).
- **Mentor takeaway:** Every flow has an origin and a destination. The conveyor is the simplest operator: it carries what arrives, in the direction it points.

### P2 — The Branching Path

- **Grid:** 5×3, input at (0,1) rate=1, two outputs at (4,0) and (4,2), each requiring 2 alpha.
- **Tiles:** `conveyor` + `splitter`. **Ops:** `MOVE`, `WAIT`.
- **Reference solution:** conveyors at (0,1) E, (1,1) E, splitter at (2,1) E, conveyors at (2,0) E + (3,0) E (one path), (2,2) E + (3,2) E (other path).
- **Optional:** none (the geometry is the lesson).
- **Mentor takeaway:** The splitter alternates: first arrival up, next down, then up again. Two outputs from one input — when you need both, this is how.

### P3 — Two Hands, One Mind

- **Grid:** 5×1, input at (0,0), output at (4,0), 2 alpha required, rate=1.
- **Tiles:** none allowed. **Ops:** `MOVE`, `GRAB`, `DROP`, `WAIT`. **Agent:** `a1` at (0,0), maxOps 8.
- **Reference solution:** agent path = [(0,0), (1,0), (2,0), (3,0), (4,0), (3,0), (2,0), (1,0)] (8 cells, walks there-and-back). Program = `GRAB, MOVE, MOVE, MOVE, MOVE, DROP, MOVE, MOVE` (8 ops). Each loop delivers one alpha. Two loops ⇒ 16 cycles; well under `max_cycles: 30`.
- **Optional:** "Use ≤8 ops" (the reference uses exactly 8 — tight but fair).
- **Mentor takeaway:** When no tile fits the bend, the operator walks. Place them, trace where they walk, write the small program of what they do at each step. The program loops; the walk loops.

### P4 — The Sorter's Eye

- **Grid:** 6×3, input at (0,1) rate=1 emitting `["alpha", "beta"]`, output at (5,1) requiring 3 alpha.
- **Tiles:** `conveyor` + `filter`. **Ops:** `MOVE`, `WAIT`.
- **Reference solution:** conveyor at (0,1) E, conveyor at (1,1) E, filter at (2,1) E filterType=`alpha`, conveyors at (3,1) E and (4,1) E.
- **Optional:** "Use ≤5 tiles" (`tiles_used <= 5`).
- **Mentor takeaway:** Two kinds of flow arrive. The filter passes one, blocks the rest. Wrong-type flow piles up at the filter cell — that's normal; it just means you've decided not to route it onward.

### P5 — Confluence

- **Grid:** 6×3, two inputs at (0,0) and (0,2), output at (5,1) requiring 4 alpha. Both inputs emit alpha rate=1.
- **Tiles:** `conveyor` + `merger`. **Ops:** `MOVE`, `WAIT`.
- **Reference solution:** conveyors (0,0)E, (1,0)S, (0,2)E, (1,2)N, merger (1,1)E, conveyors (2,1)E (3,1)E (4,1)E.
- **Optional:** none.
- **Mentor takeaway:** Two flows arrive from different directions; the merger gathers them and passes them down its facing line. Order doesn't matter — only that they arrive.

### P6 — Graduation: The First Commission

- **Grid:** 7×4. Two inputs: alpha at (0,1) rate=2, beta at (0,3) rate=2. Output at (6,2) requiring 2 `gamma`.
- **Tiles:** ALL (conveyor, splitter, merger, filter, reactor). **Ops:** ALL (`MOVE`, `GRAB`, `DROP`, `WAIT`, `SENSE`). Agent `a1` available (maxOps 4) — optional to use.
- **Reactor recipe:** `{ inputs: ["alpha", "beta"], output: "gamma" }`.
- **Reference solution:** route both inputs into a reactor at e.g. (3,2), then convey the gamma output to (6,2). One path:
  - (0,1)E, (1,1)E, (2,1)E, (3,1)S → arrives at (3,2)
  - (0,3)E, (1,3)E, (2,3)E, (3,3)N → arrives at (3,2)
  - reactor at (3,2) facing E, with recipe alpha+beta→gamma
  - (4,2)E, (5,2)E → (6,2)
- **Optional:** "Use ≤12 tiles" (the reference uses 11).
- **Mentor takeaway:** This is what the work looks like at scale. Two flows; a reactor that combines them; a path out. Everything you've learned, working together.

## Reference solutions

`campaigns/tutorial.solutions.json` holds per-puzzle reference solutions in engine (camelCase) form — `tiles[]`, `paths`, `programs`. The scripted-playthrough e2e mounts each puzzle, applies the reference solution via the dispatch hook, hits Run, and asserts victory.

## Outro: "You are sent into the field"

Act outro: a short paragraph from the mentor sending the apprentice off. The act's `outro_text` references the work they've done. The campaign's `ending.good` text — shown after the single act completes — mentions that they're cleared for procedurally-generated commissions. The CampaignHarnessHandle's `state` will be `'ending'` at this point; Phase 11's "New Campaign" button (when it lands) will be gated on this completion.

For Phase 9 the gating mechanism is: when the tutorial's `LibraryEntry.completed` is `true`, the player has graduated. Phase 11 reads this to enable the procgen button.

## Playtest review

This is the review step for Phase 9 — **not** a code review.

- Recruit **2–3 people who haven't seen Throughline**. Hand them the running app; do not coach.
- For each playtester, note: did they finish? How long? Where did they get stuck? Did the mentor lines help or hinder?
- File findings in `docs/playtest/tutorial-<initials>.md`.
- Iterate on mentor copy and puzzle constraints based on **patterns across testers** — not single-tester noise.

## Test plan

- `e2e/tutorial.spec.ts` — load the tutorial campaign, walk through each puzzle programmatically (apply reference solution via `window.__editor.dispatch` + Run), confirm each act_outro and the ending render.
- Reference solutions live in `campaigns/tutorial.solutions.json` so the e2e doesn't have to re-derive them.

## What this phase does NOT do

- No engine changes. (If a tutorial design requires an engine change, the curriculum changes instead.)
- No new tile or op types.
- No multi-act tutorial — one act is sufficient for the six-puzzle curriculum.
- No save/import path for custom progress.
