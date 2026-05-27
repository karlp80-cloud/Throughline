# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Throughline** — a Zachtronic-style flow-routing puzzle game whose mechanics are fixed but whose themes, narrative, and puzzle layouts are LLM-generated per campaign. Two artifacts: a TypeScript/Canvas game (browser + Tauri desktop) and a Node CLI (`throughline-gen`) that produces `campaign.json` manifests via `claude -p`.

## Required reading, in order

1. [throughline-design.md](throughline-design.md) — vision, architecture, DSL schema, phased build plan. Source of truth for all design decisions.
2. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — the executable plan for delivering the design across phases 0–12.

## Current phase

**Phases 0–4 complete and playtest-approved.** Origin: https://github.com/karlp80-cloud/Throughline. Default route (`/`) mounts the editor with a small solvable puzzle; the top-level **▶ Run** swaps to playback (canvas + Play/Pause/Step/Reset/speed-selector); Reset returns to the editor with the draft preserved.

Phase 4 details: pure animator state machine consuming the engine's `CycleTrace[]`; speeds ×0.5/×1/×2/×4 with base 600ms/cycle. **Inter-cycle interpolation** (added during playtest): cargo and agents lerp cell-to-cell at ~60Hz; emitted cargo slides from its input cell (using `EmissionEvent.inputPos`); delivered cargo slides into its output cell and fades out there (using `DeliveryEvent.outputPos`). Reactor-consumed/produced cargo fades in place. Memo at [docs/architecture/playback.md](docs/architecture/playback.md).

Two playtest-driven editor fixes after Phase 4: tile placement now allowed on input/output cells (engine supports it; the editor was over-strict), and Reset preserves the editor's draft so the player can `Run → watch → Reset → edit → Run` without losing tiles.

**Tally:** 198 unit tests (135 engine + 5 palette + 35 editor + 22 animator + 1 smoke) + 8 e2e (smoke + 4 renderer screenshots + 1 editor + 2 playback). Tsc + lint clean. CI green at each push.

**Next:** Phase 5 — Win/Loss + Optional Challenges. **Full cycle** (Architect → Coder → Reviewer with the verbatim rule-DSL "no eval, no Function()" checklist).

When a phase completes, update this section to point at the next phase.

## Tech stack

| Layer | Tool |
|---|---|
| Language | TypeScript (strict) |
| Build | Vite |
| Rendering | HTML5 Canvas 2D |
| Audio | Web Audio + Tone.js |
| Desktop | Tauri 2.x |
| Unit tests | Vitest |
| E2E / screenshot diff | Playwright |
| CLI | Node + Zod |
| LLM access (CLI only) | `claude -p` subprocess |
| Package manager | npm |
| UI framework | None (hand-written DOM + reducer) |
| License | MIT |
| Tauri app id | `org.throughline.app` |
| Repository host | GitHub |

## Test commands

```
npm run lint          # eslint + prettier check
npm run test:unit     # vitest run
npm run test:e2e      # playwright test (auto-builds via pretest:e2e hook)
npm test              # unit + e2e
npm run build         # tsc --noEmit + vite build
npm run dev           # local dev server (port 5173)
```

The Playwright web server uses `vite preview` against the built `dist/`, which is why `test:e2e` builds first. CI installs Playwright Chromium with `npx playwright install --with-deps chromium`.

## Load-bearing invariants

Don't violate these without updating [throughline-design.md](throughline-design.md) first.

1. **The game is a pure function of `campaign.json`.** No LLM calls from game code. No platform-specific game logic — only file IO differs between browser and Tauri.
2. **The CLI is the only LLM caller.** If you want to call an LLM from game code, you're doing the wrong thing.
3. **Engine determinism.** Identical `(puzzle, solution)` → identical `CycleTrace`. No `Math.random` / `Date.now` / `Map`-iteration anywhere under `src/engine/`.
4. **Cargo conservation.** Simultaneous-move resolution loses no cargo under any collision pattern. Property-tested, not just prose.
5. **Two-phase cycle resolution.** Phase A declares, Phase B resolves. Don't collapse them.
6. **LLM output is untrusted.** Zod-validated on load; narrative text always rendered via `textContent`, never `innerHTML`; rule DSL is a parsed AST — **no `eval`, no `Function()`, ever**; glyph keys resolve against a fixed library; manifest paths checked for traversal.
7. **Subprocess safety (CLI).** `child_process.spawn(cmd, argv, { shell: false })`. No `exec`, no shell strings.

## Platform notes

- Working directory: `C:\projects\Throughline` on Windows. PowerShell is default; Bash available via the Bash tool.
- Default branch: `main`. CI runs on push to `main` and on all pull requests.
- Node `>=20` (pinned in `package.json#engines`).
