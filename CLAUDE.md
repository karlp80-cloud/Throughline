# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Throughline** — a Zachtronic-style flow-routing puzzle game whose mechanics are fixed but whose themes, narrative, and puzzle layouts are LLM-generated per campaign. Two artifacts: a TypeScript/Canvas game (browser + Tauri desktop) and a Node CLI (`throughline-gen`) that produces `campaign.json` manifests via `claude -p`.

## Required reading, in order

1. [throughline-design.md](throughline-design.md) — vision, architecture, DSL schema, phased build plan. Source of truth for all design decisions.
2. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — the executable plan for delivering the design across phases 0–12.

## Current phase

**Phases 0–9 complete; Phase 9 awaiting human playtester review.** Origin: https://github.com/karlp80-cloud/Throughline.

Phase 9 added `campaigns/tutorial.json` — *The Apprentice's Manual*. Six hand-built puzzles teaching one mechanic each (conveyor → splitter → agent → filter → merger → reactor), with mentor lines in `briefing` using generic vocabulary that gels with any later procgen theme. `campaigns/tutorial.solutions.ts` carries reference solutions; a unit test asserts every reference wins, and `e2e/tutorial.spec.ts` walks the whole 6-puzzle act to the ending in ~9s. Curriculum doc at [docs/curriculum/tutorial.md](docs/curriculum/tutorial.md). Tutorial is the FIRST built-in on the main menu now.

One Phase-9 polish gap: the editor's tile-placement UI doesn't surface a filter-type picker, so P4 ("The Sorter's Eye") currently requires LOAD_SOLUTION or a future UI extension to place a configured filter. The e2e bypasses via LOAD_SOLUTION.

**Tally:** 376 unit (+8 tutorial) + 15 e2e (+1 tutorial). Tsc + lint clean. CI green at each push.

**Pending:** Phase 9 human-playtester review — recruit 2-3 people who haven't seen Throughline, hand them `npm run dev`, file findings in `docs/playtest/tutorial-<initials>.md`. Patterns across testers (not single-tester noise) drive any mentor-copy or constraint iteration.

**Next:** Phase 10 — Companion CLI (`throughline-gen`). **Full cycle**. The last big review-heavy phase. Security-relevant: subprocess to `claude -p`, Zod validation of LLM output, retry loop with bounded backoff, automated solvability check. The plan calls it "the most important review pass in the project."

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
