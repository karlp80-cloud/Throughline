# Throughline — Design Document

---

## 1. Vision

A Zachtronic-style flow-routing puzzle game where the **mechanics stay constant** but the **theme, narrative, and puzzle layouts are regenerated every playthrough** by an LLM. One campaign you're an alchemist routing essences through runic lattices; the next you're a forensic analyst tracing evidence between suspects; the next you're a starship engineer balancing reactor flows. Same skeleton, different costume — but the costume runs deep enough that puzzle layouts, goals, and narrative beats are all shaped by the chosen theme.

Built and tested entirely by Claude Code, including GUI, audio, content, and the LLM-prompting subsystem.

---

## 2. Core Loop

1. **Open campaign** (or press *New Campaign* → companion CLI generates a fresh manifest).
2. **Act intro screen**: narrative beat, theme established visually and aurally.
3. **Hub view**: 3–5 puzzles available within the act, pick any.
4. **Puzzle view**:
   - Read the goal (input → output, with constraints).
   - Place tiles on the grid (conveyors, splitters, mergers, filters, reactors).
   - Draw agent paths and write tiny per-cycle instruction lists (MOVE / GRAB / DROP / SENSE / etc.).
   - Hit **Run**. Watch the simulation: play / pause / step / fast-forward / reset.
   - On success: badge appears, optional challenges evaluated, narrative beat plays.
5. **Finish all required puzzles in an act** → story gate opens → next act.
6. **Finish final act** → ending sequence (LLM-written, theme-consistent).

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Companion CLI  ──►  campaign.json  ──►  Game (TypeScript)      │
│  throughline-gen     (the manifest)      ┌──────────────────┐   │
│  (Node + `claude`)                       │ Campaign State   │   │
│                                          │ Puzzle Engine    │   │
│                                          │ Editor           │   │
│                                          │ Renderer (Canvas)│   │
│                                          │ Audio (WebAudio) │   │
│                                          │ Theme Applicator │   │
│                                          └──────────────────┘   │
│                                                  │              │
│                              ┌───────────────────┴───────────┐  │
│                              ▼                               ▼  │
│                       Browser (Vite)                  Desktop   │
│                                                       (Tauri)   │
└─────────────────────────────────────────────────────────────────┘
```

**Key separation:** the game is a pure function of `campaign.json`. The CLI is the only component that talks to Claude. This means:
- The game runs in browser and desktop identically.
- We can ship hand-crafted sample campaigns for users without `claude` installed.
- The engine is testable end-to-end with synthetic manifests.

---

## 4. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict mode) | Static types matter when the LLM emits structured data we have to validate |
| Build | **Vite** | Fast, simple, great DX |
| Rendering | **HTML5 Canvas 2D** | Vector/geometric aesthetic doesn't need WebGL; Canvas is plenty |
| Audio | **Web Audio API + Tone.js** | Tone.js gives us lo-fi loops + synth SFX cleanly |
| Desktop wrapper | **Tauri** | Tiny binary, Rust-backed, much lighter than Electron |
| Unit tests | **Vitest** | Fits Vite, fast |
| E2E / UI tests | **Playwright** | Headless browser testing, screenshots for visual regression |
| Companion CLI | **Node + Zod** | Zod validates LLM output against schema before saving |
| LLM access | **`claude -p`** spawned as subprocess | Uses user's existing Claude Code auth |

---

## 5. Puzzle DSL

The LLM emits a `campaign.json` matching this schema. Validated by Zod on load.

```jsonc
{
  "version": "1.0",
  "seed": "f3a9b...",                 // for reproducibility
  "theme": {
    "name": "The Aetherium Heist",
    "setting_summary": "Renaissance alchemy meets heist caper",
    "palette": {
      "bg":       "#1a1820",
      "surface":  "#241f29",
      "fg":       "#e8d8b0",
      "muted":    "#7a6a55",
      "accent":   "#c87650",
      "success":  "#82c08a",
      "danger":   "#d06060"
    },
    "glyphs": {                       // names from a fixed library
      "input":   "alembic",
      "output":  "phial",
      "agent":   "homunculus",
      "tile_conveyor": "leyline"
    },
    "vocabulary": {                   // re-skins UI text
      "cargo":  "essence",
      "agent":  "homunculus",
      "tile":   "rune",
      "cycle":  "tick"
    }
  },
  "acts": [
    {
      "id": "act1",
      "title": "The Unsealed Vault",
      "intro_text": "…",
      "outro_text": "…",
      "required_completions": 3,      // of N puzzles, advance threshold
      "puzzles": [
        {
          "id": "act1_p1",
          "title": "First Distillation",
          "briefing": "…",
          "grid": { "w": 10, "h": 8 },
          "inputs": [
            { "pos": [0, 3], "emits": ["alpha"], "rate": 1 }
          ],
          "outputs": [
            {
              "pos": [9, 4],
              "required": [{ "type": "alpha", "count": 4 }]
            }
          ],
          "agents": [
            { "id": "a1", "start_pos": [2, 3], "max_ops": 8 }
          ],
          "obstacles":         [[5, 2], [5, 3]],
          "available_tiles":   ["conveyor", "splitter", "merger"],
          "available_ops":     ["MOVE", "GRAB", "DROP"],
          "constraints": {
            "max_tiles":  40,
            "max_cycles": 250
          },
          "optional_challenges": [
            { "id": "opt_cycles", "label": "Solve in <40 cycles",
              "rule": "cycles < 40" },
            { "id": "opt_tiles",  "label": "Use ≤12 tiles",
              "rule": "tiles_used <= 12" }
          ]
        }
      ]
    }
  ],
  "ending": {
    "good":    "…",
    "neutral": "…"
  }
}
```

The **rule DSL** for optional challenges is a tiny safe expression language (no `eval`, just a parsed AST over a fixed set of variables: `cycles`, `tiles_used`, `agent_count`, `ops_total`).

---

## 6. Mechanics Specifics

### Simulation model
- **Cycle-based**, discrete time. One cycle = one move per agent.
- All agents move **simultaneously** (Phase A: declare moves, Phase B: resolve collisions).
- Inputs emit on cycles divisible by their `rate`. Outputs accept any matching cargo.

### Tile types (v1)
| Tile | Behavior |
|---|---|
| **Conveyor** | Carries cargo one step per cycle in its facing direction |
| **Splitter** | Sends alternating cargo down two outputs |
| **Merger** | Combines two streams into one |
| **Filter** | Lets cargo of type X pass, blocks others |
| **Reactor** | Combines adjacent cargo per a recipe (theme-skinned: "transmutation circle" / "fusion chamber" / "deduction node") |

### Agent ops (v1)
| Op | Effect |
|---|---|
| `MOVE` | Advance one step along path |
| `GRAB` | Pick up cargo at current tile (if hands free) |
| `DROP` | Place cargo at current tile |
| `SENSE` | Branch next-op based on what's underneath (e.g. `SENSE alpha → DROP, else MOVE`) |
| `WAIT` | Skip cycle |

Each agent has a **path** (drawn by the player as a polyline on the grid) and an **instruction list** of up to `max_ops` ops that loops. The agent walks the path; at each step it executes the next instruction.

This is the **hybrid model**: visual paths + tiny program, easier to reason about than pure Exapunks code but more expressive than pure SpaceChem waldos.

---

## 7. Theming System

The LLM emits a `theme` block per campaign. The Theme Applicator:
1. **Palette**: writes CSS custom properties (`--bg`, `--fg`, `--accent`, etc.) on the root element. All Canvas drawing reads from these via a `Palette` singleton.
2. **Glyphs**: each game element has a `glyph_key` (e.g. `input`, `agent`, `tile_conveyor`). The LLM picks a name from a fixed library of SVG glyphs we ship (~50 glyphs across themes). The renderer resolves `glyph_key` → SVG path.
3. **Vocabulary**: UI strings template-substitute (`{{cargo}}`, `{{agent}}`) so "cargo delivered" becomes "essence transmuted" / "evidence linked" / "plasma routed".

**Guard rail**: the LLM is constrained to pick glyphs from a list we provide. It can't invent new glyphs, only remix existing ones. Same for the rule DSL.

---

## 8. Audio System

- **Music**: 3 lo-fi loops per act (intro / hub / puzzle), composed in Tone.js. Tone provides instrumentation; the *chord progression seed* is theme-derived (e.g. minor-7ths for moody themes, major-9ths for hopeful ones). We hand-craft ~12 base progressions and the theme picks one.
- **SFX**: pure Web Audio synth — short ADSR-shaped tones for tile place, agent step, cargo grab/drop, success, failure. Frequencies and waveforms shift slightly per theme.
- **Audio is independent of LLM** — we don't ask the LLM for audio data, only for a theme name that maps to existing assets.

---

## 9. Companion CLI: `throughline-gen`

Standalone Node tool, shipped with the game.

```bash
throughline-gen --out ./campaigns/my-run.json
throughline-gen --seed abc123 --acts 4 --out …
```

Pipeline:
1. Build the **system prompt** (long, includes the full schema, mechanics rules, theme glyph library, rule-DSL grammar).
2. Build the **user prompt** with optional knobs (seed, act count).
3. Spawn `claude -p "<prompt>"`, collect output.
4. **Validate** against Zod schema. On failure, retry up to 2× with the error message appended ("your last attempt was invalid because…").
5. **Solvability check**: for each puzzle, run an automated solver that tries a brute-force routing plan within time budget. If unsolvable, regenerate just that puzzle.
6. Write the manifest.

Solvability check is the most important safety net — it catches the LLM's most likely failure mode (over-constrained puzzles).

---

## 10. Phased Build Plan

Each phase has an explicit **Definition of Done** and a **test strategy**. Phases involving user-visible interaction also list manual test checkpoints.

### Process cycle per phase

Each phase below specifies a **Cycle** — whether to use a full architect → coder → reviewer pass, a lighter variant, or coder-only:

- **Full cycle** for phases with subtle invariants, security surface, or untrusted-input handling (engine simulator, rule DSL, CLI + LLM integration).
- **Moderate cycle** for phases with non-trivial design decisions but no security or invariant load (state machines, theme system, integration).
- **Light cycle** for UI/audio phases where manual playtesting already functions as the reviewer; an architect mini-pass is still useful to nail interfaces, but a separate code reviewer is often redundant.
- **Coder only** for mechanical phases (skeleton, packaging) where tests and manual launch are the review.

Two rules that hold for every cycle:
1. **Reviewers run with fresh context** when possible — a reviewer that watched the code get written has anchoring bias.
2. **Reviewers get phase-specific failure-mode prompts**, not generic "review this code" framing. Each phase below lists what its reviewer should specifically look for.

### Phase 0 — Skeleton
- **Build**: repo, TypeScript config, Vite, Vitest, Playwright, ESLint, Prettier, GitHub-style CI script (`npm test`).
- **DoD**: `npm test` runs and passes one trivial test in both Vitest and Playwright.
- **Tests**: smoke test only.
- **Cycle**: **Coder only.** Too little surface area for separate roles; tests are the review.

### Phase 1 — Puzzle Engine (headless)
- **Build**: pure functions for grid simulation. Types for all DSL entities. A `step()` function that advances one cycle. A `runUntilHalt()` for victory detection.
- **DoD**: can load a synthetic puzzle and simulate it cycle-by-cycle without any UI.
- **Tests** (automated, heavy):
  - Unit tests per tile type (conveyor moves cargo, filter blocks wrong types, etc.).
  - Unit tests per agent op.
  - Snapshot tests: given puzzle X + solution Y, the simulation produces deterministic state trace Z.
  - Property test: collisions never lose cargo (conservation invariant).
  - Property test: solver completes a corpus of 50 hand-built test puzzles.
- **Risk**: cycle/collision resolution edge cases. Mitigation: write the simulation log to disk on test failures for inspection.
- **Cycle**: **Full.** This is the most invariant-heavy phase in the project. Reviewer (fresh context) should check: cargo conservation is *tested*, not just asserted in prose; simultaneous-move resolution is tested under collision; property-test coverage spans edge cases (empty grids, agents starting on inputs/outputs, agents with empty op lists); the simulation is deterministic given identical inputs.

### Phase 2 — Renderer
- **Build**: Canvas renderer that takes engine state and draws grid + tiles + agents + cargo. Palette-aware (reads from CSS variables).
- **DoD**: rendering a hand-built puzzle state matches a reference screenshot within tolerance.
- **Tests**:
  - Automated: Playwright screenshot diff against checked-in reference images (one per tile type, palette, agent state).
  - Manual: visual review — does it look like the Opus Magnum reference we want?
- **Cycle**: **Light.** Architect proposes module layout briefly (drawing pipeline, palette indirection); coder builds; manual visual review substitutes for a code reviewer pass. Add a reviewer pass only if Playwright screenshot diffs prove flaky.

### Phase 3 — Editor
- **Build**: tile palette, drag-place, path-drawing (polyline), op-list editor per agent. Validates against `available_tiles` / `available_ops`.
- **DoD**: can construct a complete solution to a hand-built puzzle in-browser.
- **Tests**:
  - Automated: Playwright drives drag-place, asserts editor state matches expected solution JSON.
  - Manual: 30-min playtest. Is placing tiles satisfying? Path drawing intuitive?
- **Cycle**: **Light.** Manual playtest is the reviewer. Architect pass useful for input-handling design (drag-place vs click-to-place, path-drawing semantics) — get this contract right before coding.

### Phase 4 — Playback Controls
- **Build**: play / pause / step / fast-forward / reset UI. Animates engine state at 4 speeds.
- **DoD**: can hit Run, watch a solution execute, pause it, step through it, reset to edit state.
- **Tests**:
  - Automated: Playwright clicks Run, asserts agents have moved after N animation frames.
  - Manual: does the animation feel right? Is fast-forward fast enough but still readable?
- **Cycle**: **Light.** Manual testing of animation feel is the reviewer. Architect pass should specify the animation interpolation strategy (per-cycle keyframes vs continuous) before coding — getting this wrong is expensive to undo.

### Phase 5 — Win/Loss + Optional Challenges
- **Build**: rule DSL parser/evaluator. Completion detection. Badge UI. Per-puzzle stats panel.
- **DoD**: solving a puzzle shows checkmarks for which optional challenges you met.
- **Tests**:
  - Automated: rule DSL parser unit tests (heavy — fuzzing against malformed rules).
  - Automated: end-to-end "solve puzzle X with solution Y, assert optional opt_cycles is met".
  - Manual: emotional beat — does completion feel satisfying?
- **Cycle**: **Full.** The rule DSL parser is the security-relevant piece. Reviewer (fresh context) should check: parser rejects every malformed input class (fuzz coverage); evaluator handles all valid AST shapes; **no `eval` or `Function()` constructor anywhere** — the DSL must be a safe interpreted AST.

### Phase 6 — Audio
- **Build**: Tone.js loop player + Web Audio SFX bank. Volume mixer.
- **DoD**: each puzzle plays the right loop, each interaction has a sound.
- **Tests**:
  - Automated: assert correct loop is playing for current screen (mock the AudioContext, check `.start()` calls).
  - Manual: listen. Does it loop seamlessly? Are SFX too loud / too dry?
- **Cycle**: **Light.** Manual listening is the reviewer. No architect pass needed beyond confirming the Tone.js / Web Audio split.

### Phase 7 — Campaign State + Library
- **Build**: load `campaign.json`, navigate acts/hubs, auto-save to `localStorage` (browser) or filesystem (Tauri). Story gate logic. **Library view** in main menu: lists past campaigns (active + completed) with theme name, progress, last-played date; selecting one resumes or replays it.
- **DoD**: can complete an act, see it advance the gate, close & re-open and resume; library shows all past campaigns and lets you switch between them.
- **Tests**:
  - Automated: load synthetic 2-act manifest, complete required puzzles in act 1 programmatically, assert act 2 unlocks.
  - Automated: save/load round-trip across multiple concurrent campaigns.
  - Automated: library lists campaigns in expected order; deletion works.
  - Manual: does the act transition feel like a beat or a chore? Is switching between campaigns smooth?
- **Cycle**: **Moderate.** Architect step matters here (state machine for act/puzzle progression, persistence format, library indexing). Reviewer focuses on save/load round-trip across schema versions and migration safety — saves from older builds shouldn't crash newer builds.

### Phase 8 — Theme Applicator
- **Build**: palette injector, glyph library, vocabulary template substitution.
- **DoD**: same puzzle renders three different ways given three theme blocks.
- **Tests**:
  - Automated: Playwright screenshot diffs across themes for the same puzzle.
  - Automated: vocabulary substitution never leaves un-replaced `{{tokens}}` in any UI.
  - Manual: do the themes feel distinct without breaking readability?
- **Cycle**: **Moderate.** Architect designs the glyph library contract and vocabulary substitution rules. Reviewer checks: no un-substituted `{{tokens}}` can leak into UI; palette validation maintains a readability floor (cheap AA-contrast insurance even though A11y is deferred); narrative text is HTML-escaped before rendering.

### Phase 9 — Hardcoded Tutorial Campaign: *The Apprentice's Manual*
- **Framing**: The player is a new apprentice at **The Workshop** — a deliberately theme-flexible institution that trains practitioners of "throughlining" (the universal craft underlying all later procgen themes). A senior mentor character (single voice, ~6–8 lines per puzzle) walks the player through one mechanic per puzzle. Tone is warm, slightly dry. The mentor's vocabulary stays generic ("flow", "operator", "lattice") so it gels with any future procgen vocabulary.
- **Build**: hand-authored tutorial `campaign.json`. Single act, ~6 puzzles. Final puzzle is a graduation where you compose everything you've learned. Outro: "You are sent into the field" → unlocks *New Campaign* button.
- **DoD**: a fresh player who's never seen the game can complete it without reading external docs.
- **Tests**:
  - Automated: full tutorial playthrough using scripted solutions; assert ends in completion state and unlocks procgen.
  - Manual: **user testing with 2–3 people who haven't seen the game.** Do they get unstuck without help?
- **Cycle**: **Content-focused.** The "architect" step here is **curriculum design**: which mechanic does each puzzle introduce, in what order, and what's the graduation puzzle that integrates them? The reviewer is a **fresh playtester** (human if possible), not a code reviewer — code in this phase is mostly content.

### Phase 10 — Companion CLI (`throughline-gen`)
- **Build**: prompt builder, `claude -p` subprocess wrapper, Zod schema validator, retry-on-failure loop, automated solvability check.
- **DoD**: running the CLI produces a valid `campaign.json` that the game can load and play through.
- **Tests**:
  - Automated: feed synthetic LLM outputs (good + malformed + over-constrained) into the validator, assert correct behavior.
  - Automated: integration test that *actually calls* `claude -p` once in CI (gated behind a flag, runs nightly), generates a campaign, runs solvability check on it.
  - Manual: generate 5 campaigns. Are they coherent? Are themes distinct? Are puzzles solvable & fun?
- **Cycle**: **Full — and the most important review pass in the project.** Reviewer (fresh context) should check: subprocess handling has no shell-injection surface (prompt content must never reach a shell unquoted); Zod schemas reject every malformed example, not just accept valid ones; retry loop has bounded backoff and a hard attempt cap; solvability check has a hard time budget per puzzle; **generated narrative text is treated as untrusted** — HTML-escaped before rendering, never inserted as innerHTML; the manifest file's path is validated (no traversal).

### Phase 11 — End-to-End Procgen
- **Build**: "New Campaign" button in-game that invokes the CLI (Tauri only) or prompts the user to drop a generated JSON file (browser).
- **DoD**: from a fresh install, user hits one button, gets a unique 3–6 hour campaign.
- **Tests**:
  - Manual: full playthrough of one generated campaign end-to-end. Track time, fun moments, dud puzzles.
- **Cycle**: **Moderate.** Architect step is mostly the integration test plan; reviewer focuses on the seams (CLI → JSON → game) and on graceful degradation when each link fails — what does the user see if the CLI errors, returns garbage, or hangs?

### Phase 12 — Packaging
- **Build**: Tauri config for desktop builds (Mac/Win/Linux). Vite build for browser. README + bundled sample campaigns.
- **DoD**: someone can download the desktop app or visit the web URL and play.
- **Tests**:
  - Automated: built artifacts launch and reach main menu in CI.
  - Manual: install on a clean machine, play for 10 minutes.
- **Cycle**: **Coder only.** Build config is mostly mechanical; tests and the manual clean-machine install are the review.

---

## 11. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| LLM emits unsolvable puzzles | High | Automated solvability check; regenerate per-puzzle on failure |
| LLM theme collapse (everything ends up sci-fi) | Medium | Diversity instructions + seed; track theme history client-side |
| LLM-generated narrative feels generic | Medium | Few-shot prompting with strong examples; constrain genre via seed-derived hints |
| Audio loops feel repetitive over 3-6 hours | Medium | Multiple loops per act + slow fade-mix between variants |
| Tutorial → procgen difficulty cliff | Medium | First procgen campaign gets a "gentle" flag in the prompt |
| Tauri/browser feature divergence | Low | Keep all game logic platform-agnostic; only file IO differs |
| `claude -p` not installed | Certain for some users | Ship 3–5 sample campaigns; CLI is optional |

---

## 12. Resolved Decisions

| Question | Decision |
|---|---|
| Working title | **Throughline** |
| Phase order | Approved as listed |
| Tech stack | Approved (TS + Canvas + Tone.js + Tauri + Vitest + Playwright) |
| Visual references | No hard constraints |
| Tutorial framing | Player is a trainee learning the craft (see Phase 9: *The Apprentice's Manual*) |
| Campaign library | **In scope** for v1 (folded into Phase 7) |
| Localization | English-only for v1 |
| Accessibility | Deferred (note: keep Theme Applicator pluggable so a high-contrast override can be added later without rework) |
| Community share | Out of scope for v1; format already supports export |

