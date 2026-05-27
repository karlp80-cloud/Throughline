# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Throughline** — a Zachtronic-style flow-routing puzzle game whose mechanics are fixed but whose themes, narrative, and puzzle layouts are LLM-generated per campaign. Two artifacts: a TypeScript/Canvas game (browser + Tauri desktop) and a Node CLI (`throughline-gen`) that produces `campaign.json` manifests via `claude -p`.

## Required reading, in order

1. [throughline-design.md](throughline-design.md) — vision, architecture, DSL schema, phased build plan. Source of truth for all design decisions.
2. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — the executable plan for delivering the design across phases 0–12.

## Current phase

**Phases 0–8 complete.** Origin: https://github.com/karlp80-cloud/Throughline.

Phase 8 added `src/theme/` (palette injection + WCAG AA contrast floor + glyph variant resolution + `{{token}}` vocab substitution with HTML escape + audio progression routing) and 4 glyph families (default + alchemy + forensics + scifi, 33 variants). Moderate cycle: architect memo at [docs/architecture/theming.md](docs/architecture/theming.md), TDD coder, fresh-context reviewer subagent signed off all seven checklist items (token-leak sweep verified by canary, contrast fallback to `DEFAULT_PALETTE` on AA failure, HTML escape blocks `<script>` injection, no `innerHTML` in theme/glyphs source, glyph path-data is ASCII-only SVG, palette injection uses CSS API not string concat, `families.json` matches `library.ts`). Built-in demo at `campaigns/alchemy-demo.json` exercises the full pipeline.

**Tally:** 368 unit (135 engine + 5 palette + 35 editor + 22 animator + 71 DSL + 9 detector + 10 audio + 46 campaign + 34 theme + 1 smoke) + 14 e2e (smoke + 4 renderer screenshots + 1 editor + 2 playback + 1 completion + 1 campaign + 4 theme). Tsc + lint clean. CI green at each push.

**Next:** Phase 9 — Hardcoded Tutorial Campaign (*The Apprentice's Manual*). **Content-focused cycle** — 6 puzzles, one mechanic per puzzle, generic vocabulary (no themed words) so the tutorial gels with any later procgen theme. Reviewer is 2-3 playtesters, not a code reviewer.

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
