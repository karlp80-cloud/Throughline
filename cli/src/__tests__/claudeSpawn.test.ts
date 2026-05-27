/**
 * claudeSpawn tests per architect doc §3 / §10.2.
 *
 * Security-critical: every test here is load-bearing. Mocks
 * `node:child_process.spawn` to intercept the call and verify:
 *   - argv shape: ['claude', '--print', '--append-system-prompt', sysPrompt]
 *   - options: { shell: false, stdio: ['pipe','pipe','pipe'], windowsHide: true }
 *   - the user prompt is written to stdin, then stdin.end() is called
 *   - non-zero exit → ClaudeSpawnError(reason: 'non-zero-exit')
 *   - timeout → ClaudeSpawnError(reason: 'timeout'), child killed
 *   - spawn fail → ClaudeSpawnError(reason: 'spawn-failed')
 *   - stderr is captured and truncated at 4 KB
 *   - abort signal propagates
 */

import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Note: vi.mock must be hoisted; we import after mocking below.

interface FakeChild extends EventEmitter {
  stdin: Writable & { writes: string[]; endedFlag: boolean };
  stdout: Readable;
  stderr: Readable;
  kill: (signal?: NodeJS.Signals) => boolean;
  killed: boolean;
  killSignals: NodeJS.Signals[];
}

function makeFakeChild(): FakeChild {
  const ee = new EventEmitter() as FakeChild;
  // Writable stdin that records writes.
  const writes: string[] = [];
  const stdin = new Writable({
    write(chunk, _enc, cb) {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      cb();
    },
  }) as Writable & { writes: string[]; endedFlag: boolean };
  stdin.writes = writes;
  stdin.endedFlag = false;
  const originalEnd = stdin.end.bind(stdin);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stdin.end = ((...args: any[]) => {
    stdin.endedFlag = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalEnd as any)(...args);
  }) as typeof stdin.end;
  ee.stdin = stdin;
  ee.stdout = new Readable({ read() {} });
  ee.stderr = new Readable({ read() {} });
  ee.killed = false;
  ee.killSignals = [];
  ee.kill = (signal?: NodeJS.Signals) => {
    ee.killed = true;
    if (signal) ee.killSignals.push(signal);
    return true;
  };
  return ee;
}

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

let _run: typeof import('../claudeSpawn').run;
let _ClaudeSpawnError: typeof import('../claudeSpawn').ClaudeSpawnError;

beforeEach(async () => {
  spawnMock.mockReset();
  // Dynamic re-import to pick up fresh module bindings each test.
  const mod = await import('../claudeSpawn');
  _run = mod.run;
  _ClaudeSpawnError = mod.ClaudeSpawnError;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Push data to stdout/stderr and emit close — defer to next tick so the wrapper's listeners are attached first. */
async function feedAndClose(
  child: FakeChild,
  opts: { stdout?: string[]; stderr?: string[]; exitCode?: number | null } = {},
): Promise<void> {
  await new Promise((r) => setImmediate(r));
  for (const chunk of opts.stdout ?? []) child.stdout.emit('data', Buffer.from(chunk, 'utf8'));
  for (const chunk of opts.stderr ?? []) child.stderr.emit('data', Buffer.from(chunk, 'utf8'));
  await new Promise((r) => setImmediate(r));
  child.emit('close', opts.exitCode ?? 0);
}

describe('claudeSpawn.run — call shape', () => {
  test('invokes spawn with exact argv, shell:false, stdio piped, windowsHide:true', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const p = _run({ systemPrompt: 'SYS', userPrompt: 'USR' });
    feedAndClose(child, { stdout: ['{"version":1}'], exitCode: 0 });
    await p;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, argv, opts] = spawnMock.mock.calls[0]!;
    expect(cmd).toBe('claude');
    expect(argv).toEqual(['--print', '--append-system-prompt', 'SYS']);
    expect((opts as { shell?: boolean }).shell).toBe(false);
    expect((opts as { windowsHide?: boolean }).windowsHide).toBe(true);
    expect((opts as { stdio?: unknown }).stdio).toEqual(['pipe', 'pipe', 'pipe']);
  });

  test('writes the userPrompt to child stdin and calls .end()', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const p = _run({ systemPrompt: 'sys', userPrompt: 'USER_PROMPT_BODY' });
    feedAndClose(child, { stdout: ['{}'], exitCode: 0 });
    await p;
    expect(child.stdin.writes.join('')).toBe('USER_PROMPT_BODY');
    expect(child.stdin.endedFlag).toBe(true);
  });

  test('captures full stdout', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const p = _run({ systemPrompt: '', userPrompt: '' });
    feedAndClose(child, { stdout: ['part-one', 'part-two'], exitCode: 0 });
    const r = await p;
    expect(r.stdout).toBe('part-onepart-two');
    expect(r.exitCode).toBe(0);
  });
});

describe('claudeSpawn.run — exit codes', () => {
  test('non-zero exit throws ClaudeSpawnError(reason: non-zero-exit)', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const p = _run({ systemPrompt: '', userPrompt: '' });
    feedAndClose(child, { stdout: ['partial'], stderr: ['auth failed\n'], exitCode: 1 });
    let err: unknown;
    try {
      await p;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(_ClaudeSpawnError);
    expect((err as InstanceType<typeof _ClaudeSpawnError>).reason).toBe('non-zero-exit');
    expect((err as InstanceType<typeof _ClaudeSpawnError>).exitCode).toBe(1);
    expect((err as InstanceType<typeof _ClaudeSpawnError>).stderr).toContain('auth failed');
  });
});

describe('claudeSpawn.run — timeout', () => {
  test('fires SIGTERM after timeoutMs', async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const p = _run({ systemPrompt: '', userPrompt: '', timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(150);
    // After SIGTERM, the test still needs to fire `close` so the promise settles.
    child.emit('close', null);
    let err: unknown;
    try {
      await p;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(_ClaudeSpawnError);
    expect((err as InstanceType<typeof _ClaudeSpawnError>).reason).toBe('timeout');
    expect(child.killSignals).toContain('SIGTERM');
    vi.useRealTimers();
  });

  // Reviewer L3: a regression that removed the SIGKILL escalation would
  // leave the test suite green without this. We advance fake time past
  // the 2s grace and assert SIGKILL was issued in addition to SIGTERM.
  test('escalates to SIGKILL after grace period if child does not exit', async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const p = _run({ systemPrompt: '', userPrompt: '', timeoutMs: 100 });
    // Cross the timeout threshold → SIGTERM fires, grace timer arms.
    await vi.advanceTimersByTimeAsync(150);
    expect(child.killSignals).toEqual(['SIGTERM']);
    // Cross the 2s grace → SIGKILL fires.
    await vi.advanceTimersByTimeAsync(2_100);
    expect(child.killSignals).toContain('SIGKILL');
    // Now let the promise settle.
    child.emit('close', null);
    let err: unknown;
    try {
      await p;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(_ClaudeSpawnError);
    expect((err as InstanceType<typeof _ClaudeSpawnError>).reason).toBe('timeout');
    vi.useRealTimers();
  });
});

describe('claudeSpawn.run — spawn failure', () => {
  test('spawn-fail throws ClaudeSpawnError(reason: spawn-failed)', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const p = _run({ systemPrompt: '', userPrompt: '' });
    const fakeErr = Object.assign(new Error('spawn ENOENT'), {
      code: 'ENOENT',
      syscall: 'spawn claude',
    });
    child.emit('error', fakeErr);
    let err: unknown;
    try {
      await p;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(_ClaudeSpawnError);
    expect((err as InstanceType<typeof _ClaudeSpawnError>).reason).toBe('spawn-failed');
  });
});

describe('claudeSpawn.run — stderr truncation', () => {
  test('caps captured stderr at 4 KB and notes truncation', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const p = _run({ systemPrompt: '', userPrompt: '' });
    const big = 'x'.repeat(10_000);
    feedAndClose(child, { stdout: ['{}'], stderr: [big], exitCode: 0 });
    const r = await p;
    expect(r.stderr.length).toBeLessThanOrEqual(4096 + 64);
    // Should mention truncation marker.
    expect(r.stderr).toMatch(/truncated/i);
  });
});

describe('claudeSpawn.run — abort signal', () => {
  test('AbortSignal.abort() kills the child', async () => {
    const ac = new AbortController();
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const p = _run({ systemPrompt: '', userPrompt: '', signal: ac.signal });
    await new Promise((r) => setImmediate(r));
    ac.abort();
    await new Promise((r) => setImmediate(r));
    child.emit('close', null);
    let err: unknown;
    try {
      await p;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(_ClaudeSpawnError);
    expect((err as InstanceType<typeof _ClaudeSpawnError>).reason).toBe('aborted');
    expect(child.killed).toBe(true);
  });
});

describe('claudeSpawn.run — defensive: shell is never true', () => {
  test('options object literally has shell:false', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const p = _run({ systemPrompt: '', userPrompt: '' });
    feedAndClose(child, { stdout: ['{}'], exitCode: 0 });
    await p;
    const opts = spawnMock.mock.calls[0]![2] as Record<string, unknown>;
    expect(opts.shell).toBe(false);
    // Not just falsy — STRICTLY false (no undefined slipping by).
    expect(opts.shell === false).toBe(true);
  });
});
