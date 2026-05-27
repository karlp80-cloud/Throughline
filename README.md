# Throughline

A Zachtronic-style flow-routing puzzle game whose mechanics are fixed but whose themes, narrative, and puzzle layouts are LLM-generated per campaign. Built and tested with Claude Code.

Two artifacts:

- **Game** — TypeScript / HTML5 Canvas, runs in the browser (Vite) and as a desktop app (Tauri 2.x).
- **`throughline-gen`** — Node CLI that spawns `claude -p`, validates the result, runs an automated solvability check, and writes a `campaign.json` manifest the game consumes.

See [throughline-design.md](throughline-design.md) for the design and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the phased build plan.

## Status

**Phase 0 — Skeleton.** The repo runs basic unit and end-to-end smoke tests; no game features yet.

## Development

Requires Node `>=20` and npm.

```
npm install
npx playwright install chromium   # first time only
npm run dev                       # local dev server
npm run lint                      # eslint + prettier check
npm run test:unit                 # vitest
npm run test:e2e                  # playwright
npm test                          # both
npm run build                     # production build
```

## License

[MIT](LICENSE).
