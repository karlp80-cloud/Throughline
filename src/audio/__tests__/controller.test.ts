// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { AudioController } from '../controller';
import { DEFAULT_PROGRESSION } from '../progressions';
import { SFX } from '../sfxBank';
import type { AudioBackend, ChordProgression, LoopName, SfxSpec } from '../types';

interface Call {
  fn: string;
  arg?: unknown;
}

function makeMockBackend(): AudioBackend & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async ensureRunning() {
      calls.push({ fn: 'ensureRunning' });
    },
    playSfx(spec: SfxSpec) {
      calls.push({ fn: 'playSfx', arg: spec });
    },
    startLoop(name: LoopName, progression: ChordProgression) {
      calls.push({ fn: 'startLoop', arg: { name, progression } });
    },
    stopLoop(name: LoopName) {
      calls.push({ fn: 'stopLoop', arg: name });
    },
    setMusicGain(g: number) {
      calls.push({ fn: 'setMusicGain', arg: g });
    },
    setSfxGain(g: number) {
      calls.push({ fn: 'setSfxGain', arg: g });
    },
  };
}

describe('AudioController.playSfx', () => {
  test('forwards the right SfxSpec for each SfxName', () => {
    const be = makeMockBackend();
    const c = new AudioController(be);
    c.playSfx('tile_place');
    c.playSfx('success');
    const sfxCalls = be.calls.filter((c) => c.fn === 'playSfx');
    expect(sfxCalls).toEqual([
      { fn: 'playSfx', arg: SFX.tile_place },
      { fn: 'playSfx', arg: SFX.success },
    ]);
  });

  test('does not call playSfx when SFX volume is 0', () => {
    const be = makeMockBackend();
    const c = new AudioController(be);
    c.setSfxVolume(0);
    c.playSfx('agent_step');
    expect(be.calls.filter((c) => c.fn === 'playSfx')).toEqual([]);
  });
});

describe('AudioController.startLoop / stopLoop', () => {
  test('startLoop forwards with the default progression', () => {
    const be = makeMockBackend();
    const c = new AudioController(be);
    c.startLoop('puzzle');
    expect(be.calls.find((c) => c.fn === 'startLoop')?.arg).toEqual({
      name: 'puzzle',
      progression: DEFAULT_PROGRESSION,
    });
  });

  test('startLoop on the same loop twice is a no-op the second time', () => {
    const be = makeMockBackend();
    const c = new AudioController(be);
    c.startLoop('puzzle');
    c.startLoop('puzzle');
    expect(be.calls.filter((c) => c.fn === 'startLoop')).toHaveLength(1);
  });

  test('starting a different loop while one is playing crossfades — both backend calls happen', () => {
    const be = makeMockBackend();
    const c = new AudioController(be);
    c.startLoop('hub');
    c.startLoop('puzzle');
    // We expect startLoop('puzzle') AND stopLoop('hub') because the mixer
    // tells the backend to fade between them.
    expect(
      be.calls.filter((c) => c.fn === 'startLoop').map((c) => (c.arg as { name: LoopName }).name),
    ).toEqual(['hub', 'puzzle']);
    expect(be.calls.filter((c) => c.fn === 'stopLoop')).toEqual([{ fn: 'stopLoop', arg: 'hub' }]);
  });

  test('stopLoop on a non-active loop is a no-op', () => {
    const be = makeMockBackend();
    const c = new AudioController(be);
    c.stopLoop('puzzle');
    expect(be.calls.filter((c) => c.fn === 'stopLoop')).toEqual([]);
  });

  test('stopAllLoops stops every active loop', () => {
    const be = makeMockBackend();
    const c = new AudioController(be);
    c.startLoop('puzzle');
    c.stopAllLoops();
    expect(be.calls.filter((c) => c.fn === 'stopLoop')).toEqual([
      { fn: 'stopLoop', arg: 'puzzle' },
    ]);
  });
});

describe('AudioController volumes', () => {
  test('setMusicVolume clamps to [0,1] and forwards', () => {
    const be = makeMockBackend();
    const c = new AudioController(be);
    // Constructor pushes the initial setMusicGain(1) — skip it.
    const initial = be.calls.filter((c) => c.fn === 'setMusicGain').length;
    c.setMusicVolume(-0.5);
    c.setMusicVolume(2);
    c.setMusicVolume(0.5);
    const gains = be.calls
      .filter((c) => c.fn === 'setMusicGain')
      .slice(initial)
      .map((c) => c.arg as number);
    expect(gains).toEqual([0, 1, 0.5]);
    expect(c.getVolumes().music).toBe(0.5);
  });

  test('setSfxVolume clamps to [0,1] and forwards', () => {
    const be = makeMockBackend();
    const c = new AudioController(be);
    const initial = be.calls.filter((c) => c.fn === 'setSfxGain').length;
    c.setSfxVolume(-1);
    c.setSfxVolume(10);
    c.setSfxVolume(0.3);
    const gains = be.calls
      .filter((c) => c.fn === 'setSfxGain')
      .slice(initial)
      .map((c) => c.arg as number);
    expect(gains).toEqual([0, 1, 0.3]);
    expect(c.getVolumes().sfx).toBe(0.3);
  });
});

describe('AudioController defensive', () => {
  test('initial volumes are 1.0 music, 0.7 sfx (slight default attenuation)', () => {
    const be = makeMockBackend();
    const c = new AudioController(be);
    const v = c.getVolumes();
    expect(v.music).toBe(1);
    expect(v.sfx).toBe(0.7);
  });
});
