// @vitest-environment jsdom
/**
 * Tests for the TS bindings to the three Rust procgen commands.
 *
 * Strategy: mock `tauriHandle()` (from `src/platform`) to return a
 * canned invoke function. We exercise (a) the happy path — args
 * marshalled correctly, return value passed through verbatim — and
 * (b) the error path — a rejected invoke surfaces as a
 * `ProcgenError`-shaped value (already Tauri-serialized into a JS
 * object) without being wrapped.
 *
 * The production code at `src/campaign/procgen/api.ts` is the thin
 * shim that does the marshalling.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../platform', () => ({
  tauriHandle: vi.fn(),
}));

import { tauriHandle } from '../../platform';
import {
  cancelGeneration,
  generateCampaign,
  readCampaignFile,
  type GenerateOk,
  type ProcgenError,
} from './api';

const CANNED_OK: GenerateOk = {
  path: '/x/foo.json',
  manifestJson: '{}',
  elapsedMs: 1234,
  seedUsed: 'abc',
};

function mockInvoke(impl: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>): void {
  vi.mocked(tauriHandle).mockResolvedValue({
    invoke: vi.fn(impl) as <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
    listen: vi.fn().mockResolvedValue(() => undefined),
  });
}

describe('generateCampaign', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test('marshals all GenerateOpts fields and returns GenerateOk', async () => {
    let seen: { cmd: string; args: Record<string, unknown> | undefined } | null = null;
    mockInvoke(async (cmd, args) => {
      seen = { cmd, args };
      return CANNED_OK;
    });
    const result = await generateCampaign({
      jobId: 'job-1',
      seed: 'abc',
      acts: 3,
      puzzlesPerAct: 4,
      gentle: true,
      avoidThemes: ['x', 'y'],
      llmTimeoutMs: 60_000,
    });
    expect(result).toEqual(CANNED_OK);
    expect(seen).not.toBeNull();
    expect(seen!.cmd).toBe('generate_campaign');
    // Tauri 2.x convention: args wrapped in a single `opts` field
    // (matching the Rust handler's `GenerateOpts` arg name).
    expect(seen!.args).toEqual({
      opts: {
        jobId: 'job-1',
        seed: 'abc',
        acts: 3,
        puzzlesPerAct: 4,
        gentle: true,
        avoidThemes: ['x', 'y'],
        llmTimeoutMs: 60_000,
      },
    });
  });

  test('omits optional fields cleanly when not provided', async () => {
    let seen: Record<string, unknown> | undefined;
    mockInvoke(async (_cmd, args) => {
      seen = args;
      return CANNED_OK;
    });
    await generateCampaign({ jobId: 'job-2' });
    // The handler should pass a defined `opts.jobId` and leave optional
    // fields undefined (Rust's `Option<T>` deserializes from either
    // missing or null). We don't enforce which form is used, only that
    // jobId arrives intact.
    expect(seen).toBeDefined();
    expect((seen!.opts as { jobId: string }).jobId).toBe('job-2');
  });

  test('rejected invoke surfaces ProcgenError shape', async () => {
    const err: ProcgenError = {
      kind: 'cli-exit',
      message: 'oops',
      cliExitCode: 2,
      cliStderr: 'stack trace',
    };
    mockInvoke(async () => {
      throw err;
    });
    await expect(generateCampaign({ jobId: 'j3' })).rejects.toEqual(err);
  });
});

describe('cancelGeneration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test('invokes cancel_generation with the right jobId', async () => {
    let seen: { cmd: string; args: Record<string, unknown> | undefined } | null = null;
    mockInvoke(async (cmd, args) => {
      seen = { cmd, args };
      return undefined;
    });
    await cancelGeneration('job-7');
    expect(seen!.cmd).toBe('cancel_generation');
    expect(seen!.args).toEqual({ jobId: 'job-7' });
  });

  test('rejected invoke propagates', async () => {
    mockInvoke(async () => {
      throw { kind: 'internal-error', message: 'no such job' } satisfies ProcgenError;
    });
    await expect(cancelGeneration('nope')).rejects.toMatchObject({ kind: 'internal-error' });
  });
});

describe('readCampaignFile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test('invokes read_campaign_file and returns the string', async () => {
    let seen: { cmd: string; args: Record<string, unknown> | undefined } | null = null;
    mockInvoke(async (cmd, args) => {
      seen = { cmd, args };
      return '{"version":1}';
    });
    const out = await readCampaignFile('/tmp/foo.json');
    expect(seen!.cmd).toBe('read_campaign_file');
    expect(seen!.args).toEqual({ path: '/tmp/foo.json' });
    expect(out).toBe('{"version":1}');
  });

  test('rejected invoke surfaces ProcgenError', async () => {
    mockInvoke(async () => {
      throw { kind: 'file-read-failed', message: 'ENOENT' } satisfies ProcgenError;
    });
    await expect(readCampaignFile('/bad')).rejects.toMatchObject({ kind: 'file-read-failed' });
  });
});
