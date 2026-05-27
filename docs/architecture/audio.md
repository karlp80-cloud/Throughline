# Audio Architecture Notes (Phase 6)

> **Light cycle.** Manual listening is the reviewer.
> **Companion:** [IMPLEMENTATION_PLAN.md § Phase 6](../../IMPLEMENTATION_PLAN.md).

## Split: Tone.js for loops, raw Web Audio for SFX

Tone.js handles the music loops (chord progressions on Pattern + PolySynth). It schedules notes via its own internal lookahead buffer (~100ms), which is fine for music but adds latency that would be noticeable on per-click SFX.

Raw Web Audio (a `BiquadFilterNode → GainNode → AudioContext.destination` chain per SFX) handles all interactive feedback (tile place, agent step, grab/drop, success/failure). Each SFX is a short ADSR-shaped sine/triangle blip; the buffer is built and played in <2ms.

## Browser autoplay policy

`AudioContext` cannot start until a user gesture. `mountAudio` constructs the controller but the underlying context is `suspended` until the first `playSfx` / `playLoop` call, which calls `context.resume()`. Tests inject a mock backend so they don't depend on this.

## Backend abstraction (mock-friendly)

```ts
interface AudioBackend {
  ensureRunning(): Promise<void>;
  playSfx(spec: SfxSpec): void;
  startLoop(name: LoopName, progression: ChordProgression): void;
  stopLoop(name: LoopName): void;
  setMusicGain(gain01: number): void;
  setSfxGain(gain01: number): void;
}
```

`AudioController` holds a single backend instance. Real builds wire a `WebAudioBackend` that uses `AudioContext` + Tone.js; tests inject a `MockBackend` that records calls for assertion.

## Public surface

```ts
class AudioController {
  constructor(backend: AudioBackend);
  playSfx(name: SfxName): void;        // fire-and-forget
  startLoop(name: LoopName): void;      // idempotent: starting an already-playing loop is a no-op
  stopLoop(name: LoopName): void;
  stopAllLoops(): void;
  setMusicVolume(v01: number): void;
  setSfxVolume(v01: number): void;
  getVolumes(): { music: number; sfx: number };
}
```

`SfxName` is a closed union: `'tile_place' | 'tile_rotate' | 'tile_delete' | 'agent_step' | 'cargo_grab' | 'cargo_drop' | 'success' | 'failure'`.

`LoopName` is `'intro' | 'hub' | 'puzzle'`.

## SFX bank (data)

```ts
const SFX: Record<SfxName, SfxSpec> = {
  tile_place:  { freq: 440, wave: 'triangle', durationMs: 80, gain: 0.4 },
  tile_rotate: { freq: 660, wave: 'sine',     durationMs: 60, gain: 0.3 },
  tile_delete: { freq: 220, wave: 'sawtooth', durationMs: 120, gain: 0.35, sweepTo: 110 },
  agent_step:  { freq: 880, wave: 'sine',     durationMs: 40, gain: 0.2 },
  cargo_grab:  { freq: 523, wave: 'triangle', durationMs: 70, gain: 0.35, sweepTo: 698 },
  cargo_drop:  { freq: 523, wave: 'triangle', durationMs: 70, gain: 0.35, sweepTo: 349 },
  success:     { freq: 523, wave: 'sine',     durationMs: 400, gain: 0.4, sweepTo: 1047 },
  failure:     { freq: 220, wave: 'triangle', durationMs: 500, gain: 0.4, sweepTo: 110 },
};
```

Each SFX has a tight ADSR (5ms attack / 20ms decay / hold for most of the duration / 30ms release). A `sweepTo` causes a linear frequency ramp during the note. Frequencies are in Hz.

## Loops (data)

`src/audio/loops.ts` defines three Tone.js Pattern configurations: `intro`, `hub`, `puzzle`. Each pattern walks a 16-step sequence over the active chord progression. The pattern itself is generic; the chord progression supplied by Phase 8 picks the actual notes.

For Phase 6, the only available progression is `DEFAULT_PROGRESSION` (a simple minor-7th cycle in A). Phase 8 swaps in 12 distinct progressions selected by theme.

## Loop mixer

`loopMixer.ts` (per the plan's note in Phase 6 deliverables) implements a slow cross-fade when switching loops. Calling `startLoop('puzzle')` while `'hub'` is playing fades out `hub` (1500ms) while fading in `puzzle`, so transitions aren't jarring.

## Wiring into the rest of the app

| Event | SFX |
|---|---|
| Editor: tile placed | `tile_place` |
| Editor: tile rotated (in placing mode or on selection) | `tile_rotate` |
| Editor: tile deleted | `tile_delete` |
| Playback: each cargo grab event | `cargo_grab` |
| Playback: each cargo drop event | `cargo_drop` |
| Playback: each agent move | `agent_step` |
| Playback: finished with victory | `success` |
| Playback: finished with cycle_limit_exceeded | `failure` |

Loops are managed at the app harness level (`src/main.ts`): `puzzle` plays while the editor or playback view is active. Hub/intro come online in Phase 7.

## Volume mixer DOM

`src/audio/dom/volumeMixer.ts` exports `mountVolumeMixer(container, controller)` returning two sliders (Music / SFX, 0..100). Persists to `localStorage` under `throughline:audio:volumes`. Click anywhere to "wake" the audio context if it's still suspended.

## Test plan

- **`controller.test.ts`** — uses a `MockBackend` to assert:
  - `playSfx(name)` calls `backend.playSfx` with the right `SfxSpec`.
  - `startLoop(name)` calls `backend.startLoop` with the right progression.
  - `startLoop` of an already-playing loop is a no-op.
  - `stopAllLoops` stops every active loop.
  - Volume setters clamp to `[0, 1]`.
- **No browser/Tone real-backend tests** in Phase 6 — those need an `AudioContext`, which tests would have to mock anyway. Manual listening covers the real backend.

## Out of scope (v1)

- Spatial audio / panning
- Per-cargo-type sound variation
- Player-controlled mute hotkey (Phase 9 polish if needed)
- Audio sprites / streamed assets (everything is generated)
