/**
 * Real-browser AudioBackend.
 *
 * SFX: a fresh oscillator + gain per shot, with ADSR shaped via
 *      AudioParam ramps. Cheap to spin up; no buffer pre-allocation.
 * Loops: Tone.js Pattern + PolySynth. Each LoopName has at most one
 *        active Tone Pattern.
 *
 * `ensureRunning` resumes the AudioContext (browsers require a user
 * gesture before the context can play). Tests don't go through this
 * backend — they inject the mock from controller.test.ts.
 */

import * as Tone from 'tone';
import type { AudioBackend, ChordProgression, LoopName, SfxSpec } from './types';

interface ActiveLoop {
  pattern: Tone.Pattern<string[]>;
  synth: Tone.PolySynth;
  volume: Tone.Volume;
}

export class WebAudioBackend implements AudioBackend {
  private context: AudioContext | null = null;
  private sfxGainNode: GainNode | null = null;
  private musicGainDb = 0; // converted from linear in setMusicGain
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
    const volume = new Tone.Volume(this.musicGainDb).toDestination();
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.2, decay: 0.3, sustain: 0.5, release: 0.8 },
    }).connect(volume);
    // Flatten the progression into a sequence of chord events.
    // Each chord is held for its durationBeats.
    const events: string[][] = progression.map((c) => c.notes.slice());
    const pattern = new Tone.Pattern<string[]>(
      (time, chord) => {
        if (!chord) return;
        synth.triggerAttackRelease(chord, '2n', time, 0.4);
      },
      events,
      'up',
    );
    pattern.interval = '2n';
    pattern.start(0);
    this.active.set(name, { pattern, synth, volume });
  }

  stopLoop(name: LoopName): void {
    const a = this.active.get(name);
    if (!a) return;
    a.pattern.stop();
    a.pattern.dispose();
    a.synth.releaseAll();
    a.synth.dispose();
    a.volume.dispose();
    this.active.delete(name);
  }

  setMusicGain(gain01: number): void {
    // -60 dB at gain=0, 0 dB at gain=1, linear in between (perceptual-ish).
    this.musicGainDb = gain01 <= 0.001 ? -60 : 20 * Math.log10(gain01);
    for (const a of this.active.values()) {
      a.volume.volume.rampTo(this.musicGainDb, 0.05);
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
}
