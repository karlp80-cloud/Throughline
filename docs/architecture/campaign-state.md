# Campaign State + Library (Phase 7)

> **Moderate cycle.** Architect step matters for state-machine design, persistence format, and migration policy. Reviewer focuses on save/load round-trip across schema versions.
> **Companion:** [throughline-design.md](../../throughline-design.md) §5 (the manifest DSL); [IMPLEMENTATION_PLAN.md § Phase 7](../../IMPLEMENTATION_PLAN.md).

This memo locks the schema, persistence model, state machine, migration policy, and DOM-screen contract for Phase 7. Phase 10 imports the schema unchanged when validating LLM-emitted manifests.

## 1. Zod schema (shared with Phase 10)

`src/schema/campaign.ts` — **the single canonical schema** for `campaign.json`. Phase 7 calls `parseCampaign(json) → Campaign | ParseError` on load; Phase 10's CLI calls the same parser on LLM output. Both reject identical inputs.

Schema fields match design doc §5:

```ts
const ChordProgressionName = z.string().min(1).max(64);

const Palette = z.object({
  bg: z.string().regex(HEX),
  surface: z.string().regex(HEX),
  fg: z.string().regex(HEX),
  muted: z.string().regex(HEX),
  accent: z.string().regex(HEX),
  success: z.string().regex(HEX),
  danger: z.string().regex(HEX),
}).strict();

const Theme = z.object({
  name: z.string().min(1).max(80),
  setting_summary: z.string().max(400),
  palette: Palette,
  glyphs: z.record(z.string().min(1).max(40), z.string().min(1).max(40)),
  vocabulary: z.record(z.string().min(1).max(20), z.string().min(1).max(40)),
  progression_name: ChordProgressionName.optional(),
}).strict();

const Pos = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

const InputSpec = z.object({
  pos: Pos,
  emits: z.array(z.string().min(1).max(40)).min(1).max(8),
  rate: z.number().int().min(1).max(64),
}).strict();

const OutputSpec = z.object({
  pos: Pos,
  required: z.array(z.object({
    type: z.string().min(1).max(40),
    count: z.number().int().min(1).max(1000),
  }).strict()).min(1).max(8),
}).strict();

const AgentSpec = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,16}$/),
  start_pos: Pos,
  max_ops: z.number().int().min(1).max(64),
}).strict();

const OptionalChallenge = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  label: z.string().min(1).max(120),
  rule: z.string().min(1).max(200),   // parsed by src/dsl at load time
}).strict();

const PuzzleSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  title: z.string().min(1).max(80),
  briefing: z.string().max(800),
  grid: z.object({ w: z.number().int().min(1).max(32), h: z.number().int().min(1).max(32) }).strict(),
  inputs: z.array(InputSpec).min(1).max(8),
  outputs: z.array(OutputSpec).min(1).max(8),
  agents: z.array(AgentSpec).min(0).max(8),
  obstacles: z.array(Pos).max(64),
  available_tiles: z.array(z.enum(['conveyor', 'splitter', 'merger', 'filter', 'reactor'])).min(1),
  available_ops: z.array(z.enum(['MOVE', 'GRAB', 'DROP', 'WAIT', 'SENSE'])).min(1),
  constraints: z.object({
    max_tiles: z.number().int().min(0).max(256),
    max_cycles: z.number().int().min(1).max(10000),
  }).strict(),
  optional_challenges: z.array(OptionalChallenge).max(8),
}).strict();

const ActSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  title: z.string().min(1).max(80),
  intro_text: z.string().max(2000),
  outro_text: z.string().max(2000),
  required_completions: z.number().int().min(0).max(16),
  puzzles: z.array(PuzzleSchema).min(1).max(16),
}).strict();

const CampaignSchema = z.object({
  version: z.literal(1),
  seed: z.string().min(1).max(64),
  theme: Theme,
  acts: z.array(ActSchema).min(1).max(8),
  ending: z.object({
    good: z.string().max(2000),
    neutral: z.string().max(2000),
  }).strict(),
}).strict();
```

After validation, each puzzle's `optional_challenges[].rule` is also passed through `parseRule()` from `src/dsl`; any `RuleParseError` rejects the whole manifest. The DSL validation is post-Zod because the rule's grammar isn't expressible cleanly in Zod.

The validated `Campaign` is then mapped onto the engine's `Puzzle[]` (camelCase, narrower types). DOM screens render the camelCase form; Zod is the boundary.

## 2. Save format

```ts
interface CampaignSave {
  readonly version: 1;
  readonly campaignId: string;
  readonly manifestHash: string;           // sha-1 of canonical-stringified manifest
  readonly progress: Record<ActId, ActProgress>;
  readonly lastPlayed: number;             // unix ms
}

interface ActProgress {
  readonly completedPuzzleIds: readonly PuzzleId[];
  readonly optionalsEarned: Record<PuzzleId, readonly ChallengeId[]>;
}
```

Stored under `throughline:campaign:<campaignId>` (localStorage).

```ts
interface LibraryIndex {
  readonly version: 1;
  readonly entries: readonly LibraryEntry[];
}
interface LibraryEntry {
  readonly campaignId: string;
  readonly themeName: string;
  readonly lastPlayed: number;
  readonly completed: boolean;
}
```

Stored under `throughline:library`.

`manifestHash` is computed via a small canonical-stringify pass (sorted keys) + a tiny non-crypto hash (FNV-1a is sufficient — we're detecting accidental drift, not adversarial tampering). The same hash function lives in `src/campaign/hash.ts`.

## 3. State machine

```
main_menu  ── select campaign ──▶  act_intro
                                      │
                       (continue)     ▼
                   ┌──────────────  hub
                   ▼                  │
                puzzle  ── victory ──▶ hub (mark complete)
                   │                  │
                   └── back ──────────┘
                                      │
              (act complete:          ▼
               completed ≥ required)
                                  act_outro
                                      │
                                      ▼
                  (more acts)  ──▶ act_intro (next)
                                      │
                                      ▼
                                  ending  ──▶ main_menu
```

State shape:

```ts
type CampaignState =
  | { kind: 'main_menu' }
  | { kind: 'act_intro'; actIndex: number }
  | { kind: 'hub'; actIndex: number }
  | { kind: 'puzzle'; actIndex: number; puzzleIndex: number }
  | { kind: 'act_outro'; actIndex: number }
  | { kind: 'ending' };
```

Actions: `SELECT_CAMPAIGN`, `BEGIN_ACT`, `OPEN_PUZZLE`, `BACK_TO_HUB`, `COMPLETE_PUZZLE` (carries the earned optionals), `ACT_OUTRO_NEXT`, `RETURN_TO_MENU`.

Reducer is pure: `(state, action, save, campaign) → { state, save? }`. The save mutates only on `COMPLETE_PUZZLE` and on each state transition (we autosave the new state's `lastPlayed`).

## 4. Migration policy

Each save carries `version: number`. On load:

- `save.version === currentVersion` → use as-is.
- `save.version < currentVersion` → run `migrate(save, from → from+1)` for each step. Each migrator is a pure function `Save_vN → Save_vN+1`.
- `save.version > currentVersion` → **refuse to load** with a friendly error ("save was created by a newer version of the game; please update"). Never crash.
- Manifest hash mismatch (saved progress doesn't match the loaded manifest) → **warn**; offer "reset progress" via a one-click button. Never silently apply stale progress to a different manifest.

Phase 7 has no migrations yet (v1 is current). The infrastructure exists so the **migration test** is meaningful:

```ts
// In migrations.test.ts:
registerMigration(0, 1, (oldSave) => ({ ...oldSave, version: 1, lastPlayed: 0 }));
const ancient: SaveV0 = ...;
expect(migrate(ancient).version).toBe(1);
```

If Phase 8 / 9 add fields, they register a `0 → 1` (or `1 → 2`) migrator. The test for that case lives next to the registration.

## 5. Persistence adapter

```ts
interface StorageBackend {
  read(key: string): string | null;
  write(key: string, value: string): void;
  delete(key: string): void;
  keys(prefix: string): string[];
}
```

Phase 7 ships `LocalStorageBackend`. Tauri's filesystem-backed variant lands in Phase 12 (or earlier if the player needs to import / export saves before then). All persistence code goes through this interface; nothing reads `localStorage` directly outside the backend.

In-memory `MemoryStorageBackend` for tests.

## 6. Built-in campaigns

`campaigns/` holds JSON manifests checked into the repo (Phase 9 adds the tutorial; Phase 12 adds 3–5 demo campaigns). `src/campaign/builtins.ts` imports them statically so they're always available without a file picker. Phase 11 adds the runtime "New Campaign" CLI-invoked path; Phase 7 is content with built-ins only.

## 7. DOM screens

Hand-written DOM (consistent with editor / playback). One module per screen:

| Screen | File | Notable content |
|---|---|---|
| Main menu | `dom/mainMenu.ts` | "New campaign" CTA, library list |
| Act intro | `dom/actIntro.ts` | act title, intro_text (textContent), "Begin →" button |
| Hub | `dom/hub.ts` | per-puzzle tile with completion mark and earned-optional count |
| Puzzle | (mounts editor + playback) | wraps Phase 3+4+5 modules |
| Act outro | `dom/actOutro.ts` | outro_text + "Continue →" |
| Ending | `dom/ending.ts` | ending.good text + "Return to menu" |
| Library | `dom/libraryView.ts` | embedded in mainMenu when entries exist |

All LLM-supplied strings (`intro_text`, `outro_text`, `ending.good`, `theme.name`, every puzzle field) go through `textContent` — **never** `innerHTML`. The reviewer verifies this by injecting `<script>` into a manifest fixture and asserting it doesn't execute.

## 8. Editor/playback integration

The current `main.ts` hardcodes one puzzle (`editorDefault`). Phase 7 refactors:

- Extract `mountPuzzleSession(container, puzzle, callbacks, audio?) → PuzzleSessionHandle` in `src/app/puzzleSession.ts`. Owns the editor↔playback toggle currently in `main.ts` plus an `onVictory(stats: CompletionStats, optionalsEarned: ChallengeId[]) → void` callback.
- The campaign harness mounts a puzzle session when state is `{ kind: 'puzzle' }`; the session's `onVictory` dispatches `COMPLETE_PUZZLE`.

`main.ts` becomes a top-level shell: parse URL, mount `CampaignHarness` (default route) or `mountCanvasFromQueryString` (fixture route).

## 9. Test plan

| File | What it covers |
|---|---|
| `src/schema/__tests__/campaign.test.ts` | Zod schema: every required field's missing/invalid case; rule-DSL validation hook; theme palette regex |
| `src/campaign/__tests__/state.test.ts` | Every action's effect on every state; victory transitions; act gating |
| `src/campaign/__tests__/persistence.test.ts` | Save round-trip; corrupted JSON gracefully ignored; manifest-hash mismatch warns; future-version save refused |
| `src/campaign/__tests__/migrations.test.ts` | Register synthetic v0 → v1; assert chain runs to current |
| `src/campaign/__tests__/library.test.ts` | Add, list-in-order (most-recent first), delete, dedup |
| `src/campaign/__tests__/hash.test.ts` | Same manifest → same hash; tiny edit → different hash; sorted-keys canonical form |
| `e2e/campaign.spec.ts` | Load synthetic 2-act manifest; complete required puzzles in act 1 programmatically; assert act 2 unlocks; reload page; assert resume to act 2 |

`fixtures/two-act.json` is the synthetic manifest used by the e2e + several unit tests.

## 10. Reviewer focus (from plan)

> Reviewer focuses on save/load round-trip across schema versions and migration safety — saves from older builds shouldn't crash newer builds.

Operationalized:

- Migration harness exercised by at least one synthetic v0 → v1 migration in CI.
- Future-version save refused with a clear error, not a crash.
- Manifest-hash mismatch produces the documented "warn + reset" flow, not silent data loss.
- Corrupted localStorage JSON does NOT brick the main menu — the app still loads to a usable state.
- All narrative text from `campaign.json` reaches the DOM via `textContent` (verified by `<script>` injection test).

## 11. What this phase does NOT do

- Tauri filesystem persistence (Phase 11/12)
- "New Campaign" CLI invocation (Phase 11)
- Theme application from `campaign.theme` (Phase 8 — Phase 7 just stores it)
- Multi-player / cloud sync (not in v1 design)
- Save import/export (not in v1 design)
