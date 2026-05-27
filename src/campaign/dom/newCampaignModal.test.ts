// @vitest-environment jsdom
/**
 * Tests for the New Campaign modal — pre-gen form + generating view.
 *
 * Strategy: the modal accepts injectable dependencies (generate /
 * cancel / onProgress / safety timer ms) so we can drive every
 * scenario from canned promises and a fake clock. The production
 * site (newCampaignButton) wires in real implementations.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  openNewCampaignModal,
  type NewCampaignModalDeps,
  type GeneratedManifestResult,
} from './newCampaignModal';
import type { GenerateOk } from '../procgen/api';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  vi.useRealTimers();
});

afterEach(() => {
  host.remove();
  vi.useRealTimers();
});

function defaultOk(): GenerateOk {
  return {
    path: '/x/generated.json',
    manifestJson: '{"v":1}',
    elapsedMs: 1234,
    seedUsed: 'fakeseed',
  };
}

function depsWith(overrides: Partial<NewCampaignModalDeps>): NewCampaignModalDeps {
  return {
    generate: vi.fn().mockResolvedValue(defaultOk()),
    cancel: vi.fn().mockResolvedValue(undefined),
    onProgress: vi.fn().mockResolvedValue(() => undefined),
    hints: { avoidThemes: [], gentle: true },
    safetyTimerMs: 5000,
    newJobId: () => 'job-fixed',
    newSeed: () => 'rolled-seed',
    ...overrides,
  };
}

describe('openNewCampaignModal — pre-gen form', () => {
  test('renders form fields with sensible defaults', () => {
    openNewCampaignModal(host, depsWith({}));
    const dialog = host.querySelector('dialog')!;
    expect(dialog.querySelector('input[data-role="seed"]')).not.toBeNull();
    expect(dialog.querySelector('input[data-role="acts"]')).not.toBeNull();
    expect(dialog.querySelector('input[data-role="puzzles-per-act"]')).not.toBeNull();
    expect(dialog.querySelector('input[data-role="gentle"]')).not.toBeNull();
    expect(dialog.querySelector('button[data-role="generate"]')).not.toBeNull();
    expect(dialog.querySelector('button[data-role="cancel"]')).not.toBeNull();
  });

  test('shows avoid-themes section only when non-empty', () => {
    const empty = openNewCampaignModal(
      host,
      depsWith({ hints: { avoidThemes: [], gentle: true } }),
    );
    expect(host.querySelector('[data-role="avoid-themes"]')).toBeNull();
    empty.close();

    openNewCampaignModal(host, depsWith({ hints: { avoidThemes: ['Workshop'], gentle: false } }));
    const section = host.querySelector('[data-role="avoid-themes"]');
    expect(section).not.toBeNull();
    expect(section!.textContent ?? '').toMatch(/Workshop/);
  });

  test('gentle checkbox defaults reflect hints', () => {
    const a = openNewCampaignModal(host, depsWith({ hints: { avoidThemes: [], gentle: true } }));
    let cb = host.querySelector('input[data-role="gentle"]') as HTMLInputElement;
    expect(cb.checked).toBe(true);
    a.close();

    openNewCampaignModal(host, depsWith({ hints: { avoidThemes: [], gentle: false } }));
    cb = host.querySelector('input[data-role="gentle"]') as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  test('disables Generate when seed input is empty', () => {
    openNewCampaignModal(host, depsWith({}));
    const seed = host.querySelector('input[data-role="seed"]') as HTMLInputElement;
    const gen = host.querySelector('button[data-role="generate"]') as HTMLButtonElement;
    seed.value = '';
    seed.dispatchEvent(new Event('input'));
    expect(gen.disabled).toBe(true);

    seed.value = 'valid-seed';
    seed.dispatchEvent(new Event('input'));
    expect(gen.disabled).toBe(false);
  });

  test('Cancel on the pre-gen form resolves with kind=closed', async () => {
    const handle = openNewCampaignModal(host, depsWith({}));
    (host.querySelector('button[data-role="cancel"]') as HTMLButtonElement).click();
    const r: GeneratedManifestResult = await handle.result;
    expect(r.kind).toBe('closed');
  });
});

describe('openNewCampaignModal — generating + success', () => {
  test('happy path: Generate click → generating view → resolves with manifest', async () => {
    const generate = vi.fn().mockResolvedValue(defaultOk());
    const handle = openNewCampaignModal(host, depsWith({ generate }));
    // Click Generate.
    (host.querySelector('button[data-role="generate"]') as HTMLButtonElement).click();
    // The generating view should appear; let promise resolve.
    const r = await handle.result;
    expect(r.kind).toBe('generated');
    if (r.kind === 'generated') {
      expect(r.manifestJson).toBe('{"v":1}');
      expect(r.seedUsed).toBe('fakeseed');
      expect(r.path).toBe('/x/generated.json');
    }
    expect(generate).toHaveBeenCalledTimes(1);
    // jobId should be passed.
    const args = generate.mock.calls[0]?.[0] as { jobId: string };
    expect(args.jobId).toBe('job-fixed');
  });

  test('Generate marshals the form values to opts', async () => {
    const generate = vi.fn().mockResolvedValue(defaultOk());
    const handle = openNewCampaignModal(
      host,
      depsWith({ generate, hints: { avoidThemes: ['T'], gentle: false } }),
    );
    const seed = host.querySelector('input[data-role="seed"]') as HTMLInputElement;
    seed.value = 'my-seed';
    seed.dispatchEvent(new Event('input'));
    const acts = host.querySelector('input[data-role="acts"]') as HTMLInputElement;
    acts.value = '5';
    acts.dispatchEvent(new Event('input'));
    const ppa = host.querySelector('input[data-role="puzzles-per-act"]') as HTMLInputElement;
    ppa.value = '6';
    ppa.dispatchEvent(new Event('input'));
    (host.querySelector('button[data-role="generate"]') as HTMLButtonElement).click();
    await handle.result;
    const args = generate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.seed).toBe('my-seed');
    expect(args.acts).toBe(5);
    expect(args.puzzlesPerAct).toBe(6);
    expect(args.gentle).toBe(false);
    expect(args.avoidThemes).toEqual(['T']);
  });
});

describe('openNewCampaignModal — cancel + safety timer', () => {
  test('Cancel during generating kills the job and resolves cancelled', async () => {
    // generate that never resolves; the Cancel click path is what
    // resolves the modal (the modal closes optimistically rather than
    // waiting for the Rust child to actually exit — Q11 in the
    // architect doc).
    const generate = vi.fn().mockImplementation(
      () =>
        new Promise(() => {
          // never resolves
        }),
    );
    const cancel = vi.fn().mockResolvedValue(undefined);
    const handle = openNewCampaignModal(host, depsWith({ generate, cancel }));
    (host.querySelector('button[data-role="generate"]') as HTMLButtonElement).click();
    // Wait a tick for the generating view to render.
    await Promise.resolve();
    expect(host.querySelector('[data-role="generating"]')).not.toBeNull();
    // Click Cancel.
    (host.querySelector('button[data-role="cancel-generation"]') as HTMLButtonElement).click();
    const r = await handle.result;
    expect(r.kind).toBe('cancelled');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('job-fixed');
  });

  test('safety timer fires when invoke never resolves and cancel is ignored', async () => {
    vi.useFakeTimers();
    const generate = vi.fn().mockImplementation(
      () =>
        new Promise(() => {
          // never resolves
        }),
    );
    const cancel = vi.fn().mockResolvedValue(undefined);
    const handle = openNewCampaignModal(host, depsWith({ generate, cancel, safetyTimerMs: 5000 }));
    (host.querySelector('button[data-role="generate"]') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);
    // Fast-forward past the safety timer.
    await vi.advanceTimersByTimeAsync(5000);
    const r = await handle.result;
    expect(r.kind).toBe('safety-timeout');
    expect(cancel).toHaveBeenCalled();
  });

  test('Generate failure surfaces error result without auto-closing the host', async () => {
    const generate = vi
      .fn()
      .mockRejectedValue({ kind: 'cli-exit', message: 'oops', cliExitCode: 1 });
    const handle = openNewCampaignModal(host, depsWith({ generate }));
    (host.querySelector('button[data-role="generate"]') as HTMLButtonElement).click();
    const r = await handle.result;
    expect(r.kind).toBe('error');
    if (r.kind === 'error') {
      expect(r.error.kind).toBe('cli-exit');
      expect(r.error.cliExitCode).toBe(1);
    }
  });
});

describe('openNewCampaignModal — progress events', () => {
  test('subscribes to onProgress and updates elapsed counter', async () => {
    let progressCb: ((p: { jobId: string; phase: string; elapsedMs: number }) => void) | null =
      null;
    const onProgress = vi.fn().mockImplementation(async (cb: typeof progressCb) => {
      progressCb = cb;
      return () => undefined;
    });
    // Hold the generate promise open so the generating view is still
    // present when we observe the elapsed-counter update.
    let resolveGen: (v: GenerateOk) => void = () => undefined;
    const generate = vi.fn().mockImplementation(
      () =>
        new Promise<GenerateOk>((res) => {
          resolveGen = res;
        }),
    );
    const handle = openNewCampaignModal(host, depsWith({ generate, onProgress }));
    (host.querySelector('button[data-role="generate"]') as HTMLButtonElement).click();
    // Let the generating view render + onProgress.then settle (two
    // microtask ticks: one for onProgress kickoff, one for the .then).
    await Promise.resolve();
    await Promise.resolve();
    expect(onProgress).toHaveBeenCalled();
    expect(progressCb).not.toBeNull();
    progressCb!({ jobId: 'job-fixed', phase: 'running', elapsedMs: 7500 });
    const elapsed = host.querySelector('[data-role="elapsed"]');
    expect(elapsed?.textContent ?? '').toMatch(/^7s/); // 7.5s floored → 7s
    resolveGen(defaultOk());
    await handle.result;
  });
});
