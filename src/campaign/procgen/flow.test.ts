// @vitest-environment jsdom
/**
 * Composition tests for the procgen flow glue.
 *
 * Strategy: drive `openTauriFlow` with canned mock deps (generate /
 * cancel / onProgress / safety timer / job-id / seed) and assert
 * (a) the harness sees the right `loadGeneratedManifest` call on
 * success, and (b) the right error modal renders on each failure
 * class.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openBrowserFlow, openTauriFlow, type FlowDeps } from './flow';
import { MemoryStorageBackend } from '../storage';
import type { CampaignHarnessHandle } from '../dom/harness';
import type { GenerateOk } from './api';

function makeManifestJson(seed = 's1'): string {
  return JSON.stringify({
    version: 1,
    seed,
    theme: {
      name: 'X',
      setting_summary: '',
      palette: {
        bg: '#000000',
        surface: '#101010',
        fg: '#ffffff',
        muted: '#808080',
        accent: '#ff0000',
        success: '#00ff00',
        danger: '#ff00ff',
      },
      glyphs: {},
      vocabulary: {},
    },
    acts: [
      {
        id: 'a1',
        title: 'A',
        intro_text: '',
        outro_text: '',
        required_completions: 1,
        puzzles: [
          {
            id: 'p1',
            title: 'P1',
            briefing: '',
            grid: { w: 5, h: 3 },
            inputs: [{ pos: [0, 1], emits: ['alpha'], rate: 1 }],
            outputs: [{ pos: [4, 1], required: [{ type: 'alpha', count: 1 }] }],
            agents: [],
            obstacles: [],
            available_tiles: ['conveyor'],
            available_ops: ['MOVE'],
            constraints: { max_tiles: 8, max_cycles: 30 },
            optional_challenges: [],
          },
        ],
      },
    ],
    ending: { good: '', neutral: '' },
  });
}

let host: HTMLElement;
let fakeHarness: { loadGeneratedManifest: ReturnType<typeof vi.fn> };

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  fakeHarness = { loadGeneratedManifest: vi.fn() };
});

afterEach(() => {
  host.remove();
});

function depsWith(over: Partial<FlowDeps>): FlowDeps {
  return {
    host,
    storage: new MemoryStorageBackend(),
    harness: fakeHarness as unknown as CampaignHarnessHandle,
    safetyTimerMs: 2000,
    newJobId: () => 'job-1',
    newSeed: () => 'seed-1',
    ...over,
  };
}

describe('openTauriFlow', () => {
  test('happy path: hands manifest to harness.loadGeneratedManifest', async () => {
    const ok: GenerateOk = {
      path: '/x/p.json',
      manifestJson: makeManifestJson(),
      elapsedMs: 1,
      seedUsed: 'used',
    };
    const generate = vi.fn().mockResolvedValue(ok);
    // Drive: open the modal, click Generate (the modal renders into
    // host; we click in the same task tick).
    const flowPromise = openTauriFlow(depsWith({ generate }));
    // Click Generate.
    (host.querySelector('button[data-role="generate"]') as HTMLButtonElement).click();
    await flowPromise;
    expect(generate).toHaveBeenCalledTimes(1);
    expect(fakeHarness.loadGeneratedManifest).toHaveBeenCalledTimes(1);
    expect(fakeHarness.loadGeneratedManifest).toHaveBeenCalledWith(
      ok.manifestJson,
      '/x/p.json',
      'used',
    );
  });

  test('error result: renders the error modal (cli-exit 2 → reroll-retry)', async () => {
    const generate = vi
      .fn()
      .mockRejectedValue({ kind: 'cli-exit', message: 'oops', cliExitCode: 2 });
    const flowPromise = openTauriFlow(depsWith({ generate }));
    (host.querySelector('button[data-role="generate"]') as HTMLButtonElement).click();
    // The flow now awaits the error modal. Wait for it to mount.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const modal = host.querySelector('[data-role="procgen-error-modal"]');
    expect(modal).not.toBeNull();
    expect(modal!.getAttribute('data-error-class')).toBe('cli-exit');
    // Dismiss by clicking Close.
    (modal!.querySelector('button[data-action="close"]') as HTMLButtonElement).click();
    await flowPromise;
    expect(fakeHarness.loadGeneratedManifest).not.toHaveBeenCalled();
  });

  test('closed result: no modal, no load', async () => {
    const generate = vi.fn();
    const flowPromise = openTauriFlow(depsWith({ generate }));
    (host.querySelector('button[data-role="cancel"]') as HTMLButtonElement).click();
    await flowPromise;
    expect(generate).not.toHaveBeenCalled();
    expect(fakeHarness.loadGeneratedManifest).not.toHaveBeenCalled();
  });
});

describe('openBrowserFlow', () => {
  test('happy path: imported manifest reaches harness', async () => {
    const flowPromise = openBrowserFlow(depsWith({}));
    const input = host.querySelector('input[data-role="file-input"]') as HTMLInputElement;
    const file = new File([makeManifestJson('browser-seed')], 'c.json', {
      type: 'application/json',
    });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: {
        length: 1,
        0: file,
        item: (i: number) => (i === 0 ? file : null),
        [Symbol.iterator]: function* () {
          yield file;
        },
      } as unknown as FileList,
    });
    input.dispatchEvent(new Event('change'));
    await flowPromise;
    expect(fakeHarness.loadGeneratedManifest).toHaveBeenCalledTimes(1);
    const args = fakeHarness.loadGeneratedManifest.mock.calls[0]!;
    // seedUsed is recovered from the manifest, not the file name.
    expect(args[2]).toBe('browser-seed');
  });
});
