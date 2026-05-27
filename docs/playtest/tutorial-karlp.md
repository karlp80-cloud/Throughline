# Tutorial playtest — karlp (sole tester)

**Status:** closed, 6/6 fixes landed.
**Dates:** 2026-05-26 / 2026-05-27.
**Build:** Phase 9 ship (`aa4c58b`) → Phase 10 entry (`117940b`).

## How

Tester ran `npm run dev`, played through the full 6-puzzle tutorial act
end-to-end, filing findings as he hit them. No formal think-aloud,
no recruited fresh-eyes humans — single-tester pass.

## Findings (in order observed)

| # | Puzzle | Symptom | Verdict | Resolution |
|---|---|---|---|---|
| 1 | P1 First Flow | "Modify the output tile so it automatically pushes alphas to the space to its right." | Input cell trapped emitted cargo until a player tile picked it up — confusing first-touch UX. | `InputSpec.facing` (default `'E'`); auto-eject runs in Phase B *after* agent GRAB/DROP. Commit `e2183f1`. |
| 2 | post-victory | "Once a level is complete, have a button in the Victory panel that takes the player back to the Hub." | Player was stuck on the results panel with no obvious return path. | `ResultsPanelOptions.onReturnToHub`; threaded from the campaign harness's `LEAVE_PUZZLE` dispatch. Commit `e2183f1`. |
| 3 | all | "Music is a little repetitive. Add more depth to it." | The Phase 6 fix-up made progressions less repetitive but lacked harmonic foundation. | Added a `Tone.MonoSynth` bass voice playing chord roots one octave down at the 2n pulse. Commit `e2183f1`. |
| 4 | P5 Confluence | "When two alphas overlap after a merge, they merge into a single image. It is impossible to tell there is more than one alpha." | Cargo dots stacked on identical pixels at the merger. | Per-id radial offset (4 px ring) around cell center in `paintCargoAtCellFraction`. Commit `e2183f1`. |
| 5 | P6 Graduation | "The Reactor doesn't seem to do anything. The alphas dont change color, and they don't move out of the reactor." (initial reading) | Cargo dots also didn't visually distinguish α / β / γ. | Greek-letter labels (`α / β / γ / δ / ε`) drawn inside each cargo dot. Commit `e2183f1`. |
| 6 | P6 Graduation | "Reactor still does nothing, the alphas and betas just pile up at the reactor tile. Nothing is pushed out." (re-test after fix #5) | **Root cause:** the editor placed reactor tiles with no `recipe` field, so `reactorIntents` returned `[]` and cargo got trapped. Same gap had been flagged for filter on P4. | Puzzle JSON now declares `reactor_recipes` / `filter_types`; editor's `Mode` carries the resolved config and writes it onto the `PlacedTile`; palette shows a "Recipe:" / "Allow:" picker row. Tutorial JSON updated. Commit `ccfb004`. |

## What the loop revealed about the tutorial design

- P6 (graduation) is the only puzzle whose configurability was hidden. The earlier puzzles teach one mechanic at a time and the mechanic is fully expressed by tile placement + facing. Reactor is the first tile whose *behavior* is data-driven, and the editor surface needed catch-up work.
- Three of the six findings (1, 4, 5) are about *visual legibility* of in-engine state at the cell level. Reactor finding #5 turned out to be a special case of the legibility problem — the player couldn't read what the reactor was outputting because cargo all looked the same.
- Music finding #3 stayed within tuning; no engine work.
- No mentor-copy changes were required — the briefings held up under play.

## Limitations of this pass

- **Single tester.** CLAUDE.md's Phase 9 protocol asks for 2–3 fresh-eyes
  testers; that didn't happen. If patterns across multiple testers ever
  do surface, they should drive a second pass (likely after Phase 11
  when the procgen output gets its own tutorial-style smoke).
- **No think-aloud recording.** Findings were filed conversationally;
  no record of *where* the friction was on each puzzle (just *what*
  was wrong).
- **The tester was the same person who built the tutorial.** Familiarity
  bias likely smoothed over things a true fresh-eyes tester would catch.

## Carried forward

None. All findings either landed as code or were judged out of scope
(no out-of-scope items recorded).
