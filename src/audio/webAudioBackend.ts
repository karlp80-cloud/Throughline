/**
 * Real-browser AudioBackend.
 *
 * SFX:    a fresh oscillator + gain per shot, with ADSR shaped via
 *         AudioParam ramps. Cheap to spin up; no buffer pre-allocation.
 * Music:  two parallel layers per active loop:
 *   - Pad   (PolySynth, triangle, long envelope) plays the full chord
 *           on the half-note pulse. Quiet and harmonic-rich.
 *   - Pluck (MonoSynth, sine, short envelope) walks the chord tones at
 *           the eighth-note pulse, in an `upDown` pattern. Carries the
 *           ear-catching motion that makes the loop less repetitive.
 *
 * Music has a baseline -6 dB attenuation relative to SFX so a sustained
 * polyphonic chord doesn't drown out the much shorter SFX blips. Slider
 * 1.0 on Music maps to ~-6 dB; slider 1.0 on SFX maps to 0 dB.
 *
 * `ensureRunning` resumes the AudioContext (browsers require a user
 * gesture before the context can play). Tests don't go through this
 * backend — they inject the mock from controller.test.ts.
 */

import * as Tone from 'tone';
import type { AudioBackend, ChordProgression, LoopName, SfxSpec } from './types';

/** Baseline music attenuation in dB. -6 dB ≈ 0.5 linear. */
const MUSIC_BASE_ATTENUATION_DB = -6;

interface ActiveLoop {
  padPattern: Tone.Pattern<string[]>;
  pluckPattern: Tone.Pattern<string>;
  pad: Tone.PolySynth;
  pluck: Tone.Synth;
  volume: Tone.Volume;
}

export class WebAudioBackend implements AudioBackend {
  private context: AudioContext | null = null;
  private sfxGainNode: GainNode | null = null;
  /** User-facing music gain in dB (BEFORE the baseline attenuation). */
  private musicUserDb = 0;
  private sfxGain01 = 0.7;
  private active = new Map<LoopName, ActiveLoop>();
  private started = false;

  async ensureRunning(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.sfxGainNode = this.context.createGain();
      this.sfxGainNode.gain.value = this.sfxGain01;
      this.sfxGainNode.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    if (!this.started) {
      await Tone.start();
      this.started = true;
      Tone.getTransport().start();
    }
  }

  playSfx(spec: SfxSpec): void {
    if (!this.context || !this.sfxGainNode) return; // wait for ensureRunning
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    osc.type = spec.wave;
    osc.frequency.setValueAtTime(spec.freq, now);
    if (spec.sweepTo !== undefined) {
      osc.frequency.linearRampToValueAtTime(spec.sweepTo, now + spec.durationMs / 1000);
    }
    const env = this.context.createGain();
    const peak = spec.gain;
    const attack = 0.005;
    const decay = 0.02;
    const release = 0.03;
    const dur = spec.durationMs / 1000;
    const sustainStart = now + attack + decay;
    const releaseStart = now + Math.max(dur - release, attack + decay);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + attack);
    env.gain.linearRampToValueAtTime(peak * 0.7, now + attack + decay);
    env.gain.setValueAtTime(peak * 0.7, sustainStart);
    env.gain.linearRampToValueAtTime(0, releaseStart + release);
    osc.connect(env).connect(this.sfxGainNode);
    osc.start(now);
    osc.stop(now + dur + release);
  }

  startLoop(name: LoopName, progression: ChordProgression): void {
    // Stop any existing instance of this loop first.
    this.stopLoop(name);

    const volume = new Tone.Volume(this.effectiveMusicDb()).toDestination();

    // Pad layer: harmonic chord pad. Quieter, slower attack.
    const pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.5, decay: 0.5, sustain: 0.55, release: 1.5 },
    }).connect(volume);

    // Pluck layer: melodic line over the chord tones.
    const pluck = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.005, decay: 0.18, sustain: 0.05, release: 0.3 },
    }).connect(volume);

    // Pad walks the chords at 2n (half note).
    const padEvents: string[][] = progression.map((c) => c.notes.slice());
    const padPattern = new Tone.Pattern<string[]>(
      (time, chord) => {
        if (!chord) return;
        pad.triggerAttackRelease(chord, '2n', time, 0.25);
      },
      padEvents,
      'up',
    );
    padPattern.interval = '2n';
    padPattern.start(0);

    // Pluck walks every chord tone (flattened across the whole
    // progression) at 8n (eighth note), in an upDown pattern so the
    // melody curves back on itself rather than just running up.
    const pluckEvents: string[] = [];
    for (const chord of progression) {
      // Use the top three voices of each chord for a brighter line.
      for (const note of chord.notes.slice(1)) pluckEvents.push(note);
    }
    const pluckPattern = new Tone.Pattern<string>(
      (time, note) => {
        if (!note) return;
        pluck.triggerAttackRelease(note, '8n', time, 0.35);
      },
      pluckEvents,
      'upDown',
    );
    pluckPattern.interval = '8n';
    pluckPattern.start(0);

    this.active.set(name, { padPattern, pluckPattern, pad, pluck, volume });
  }

  stopLoop(name: LoopName): void {
    const a = this.active.get(name);
    if (!a) return;
    a.padPattern.stop();
    a.padPattern.dispose();
    a.pluckPattern.stop();
    a.pluckPattern.dispose();
    a.pad.releaseAll();
    a.pad.dispose();
    a.pluck.dispose();
    a.volume.dispose();
    this.active.delete(name);
  }

  setMusicGain(gain01: number): void {
    // -60 dB at gain=0; 0 dB at gain=1; logarithmic ramp in between.
    this.musicUserDb = gain01 <= 0.001 ? -60 : 20 * Math.log10(gain01);
    const target = this.effectiveMusicDb();
    for (const a of this.active.values()) {
      a.volume.volume.rampTo(target, 0.05);
    }
  }

  setSfxGain(gain01: number): void {
    this.sfxGain01 = gain01;
    if (this.sfxGainNode) {
      this.sfxGainNode.gain.linearRampToValueAtTime(
        gain01,
        (this.context?.currentTime ?? 0) + 0.05,
      );
    }
  }

  private effectiveMusicDb(): number {
    // Pin to -Infinity-ish when fully muted so we don't accidentally
    // bleed at -66 dB when the user set the slider to 0.
    if (this.musicUserDb <= -55) return -60;
    return this.musicUserDb + MUSIC_BASE_ATTENUATION_DB;
  }
}
