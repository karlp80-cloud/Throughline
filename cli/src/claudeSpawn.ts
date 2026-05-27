/**
 * Subprocess wrapper for `claude -p` (architect doc §3).
 *
 * SECURITY-CRITICAL. Every invariant in this module is load-bearing:
 *   - spawn called with shell:false (no shell interpolation surface).
 *   - argv passed as an array; no string concatenation into a command line.
 *   - systemPrompt goes via --append-system-prompt (argv).
 *   - userPrompt goes via stdin (size-uncapped; argv is bounded).
 *   - stdout captured in Buffer chunks then decoded once at end.
 *   - stderr capped at 4 KB to defend against runaway logging.
 *   - timeout (default 60s) sends SIGTERM, then SIGKILL after 2s grace.
 *   - AbortSignal propagates to the child.
 *   - non-zero exit raises a structured ClaudeSpawnError, never a bare
 *     error.
 *
 * The static-analysis test (`no-shell.test.ts`) asserts no `shell: true`
 * exists anywhere in cli/src/. If you find yourself reaching for one,
 * stop — it's never safe.
 */

import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';

export interface ClaudeSpawnOptions {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  /** Wall-clock budget in ms. Default 60_000. */
  readonly timeoutMs?: number;
  /** Optional AbortSignal — used by Phase 11 to cancel from UI. */
  readonly signal?: AbortSignal;
}

export interface ClaudeSpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly elapsedMs: number;
}

export type ClaudeSpawnErrorReason = 'non-zero-exit' | 'timeout' | 'spawn-failed' | 'aborted';

export class ClaudeSpawnError extends Error {
  readonly reason: ClaudeSpawnErrorReason;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdoutSoFar: string;
  constructor(opts: {
    reason: ClaudeSpawnErrorReason;
    exitCode: number | null;
    stderr: string;
    stdoutSoFar: string;
    message?: string;
  }) {
    super(opts.message ?? `claude-p subprocess failed: ${opts.reason}`);
    this.name = 'ClaudeSpawnError';
    this.reason = opts.reason;
    this.exitCode = opts.exitCode;
    this.stderr = opts.stderr;
    this.stdoutSoFar = opts.stdoutSoFar;
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const STDERR_CAP_BYTES = 4096;
const KILL_GRACE_MS = 2_000;

export async function run(opts: ClaudeSpawnOptions): Promise<ClaudeSpawnResult> {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // shell:false is non-negotiable. The argv is a literal array; no
  // string-concat anywhere along this codepath. The architect doc
  // calls this out as the structural defense against shell injection.
  const child = spawn('claude', ['--print', '--append-system-prompt', opts.systemPrompt], {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  // Write the user prompt to stdin; then close stdin so claude knows
  // the input is complete.
  if (child.stdin) {
    child.stdin.write(opts.userPrompt, 'utf8');
    child.stdin.end();
  }

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stderrBytes = 0;
  let stderrTruncated = false;

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    stdoutChunks.push(buf);
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    if (stderrBytes < STDERR_CAP_BYTES) {
      const remaining = STDERR_CAP_BYTES - stderrBytes;
      if (buf.length <= remaining) {
        stderrChunks.push(buf);
        stderrBytes += buf.length;
      } else {
        stderrChunks.push(buf.subarray(0, remaining));
        stderrBytes += remaining;
        stderrTruncated = true;
      }
    } else {
      stderrTruncated = true;
    }
  });

  return new Promise<ClaudeSpawnResult>((resolve, reject) => {
    let settled = false;
    let timeoutFired = false;
    let aborted = false;

    const settleReject = (err: ClaudeSpawnError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killGraceTimer);
      reject(err);
    };
    const settleResolve = (r: ClaudeSpawnResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killGraceTimer);
      resolve(r);
    };

    // We hoist the timer/killTimer refs so we can clear them in
    // every settle branch.
    let killGraceTimer: ReturnType<typeof setTimeout>;
    const timeoutTimer = setTimeout(() => {
      timeoutFired = true;
      child.kill('SIGTERM');
      killGraceTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, KILL_GRACE_MS);
    }, timeoutMs);
    killGraceTimer = setTimeout(() => {}, 0);
    clearTimeout(killGraceTimer);

    const onAbort = (): void => {
      aborted = true;
      child.kill('SIGTERM');
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
      } else {
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    child.on('error', (err) => {
      const stderr = bufferText(stderrChunks, stderrTruncated);
      const stdoutSoFar = Buffer.concat(stdoutChunks).toString('utf8');
      settleReject(
        new ClaudeSpawnError({
          reason: 'spawn-failed',
          exitCode: null,
          stderr,
          stdoutSoFar,
          message: `failed to spawn 'claude': ${err.message}. Is 'claude' installed and on PATH?`,
        }),
      );
    });

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = bufferText(stderrChunks, stderrTruncated);
      if (aborted) {
        settleReject(
          new ClaudeSpawnError({
            reason: 'aborted',
            exitCode: code,
            stderr,
            stdoutSoFar: stdout,
          }),
        );
        return;
      }
      if (timeoutFired) {
        settleReject(
          new ClaudeSpawnError({
            reason: 'timeout',
            exitCode: code,
            stderr,
            stdoutSoFar: stdout,
            message: `claude -p subprocess timed out after ${timeoutMs}ms`,
          }),
        );
        return;
      }
      if (code === 0) {
        settleResolve({
          stdout,
          stderr,
          exitCode: 0,
          elapsedMs: Date.now() - start,
        });
        return;
      }
      settleReject(
        new ClaudeSpawnError({
          reason: 'non-zero-exit',
          exitCode: code ?? -1,
          stderr,
          stdoutSoFar: stdout,
          message: `claude -p subprocess exited with code ${code}`,
        }),
      );
    });
  });
}

function bufferText(chunks: Buffer[], truncated: boolean): string {
  const text = Buffer.concat(chunks).toString('utf8');
  if (!truncated) return text;
  return text + '\n… (stderr truncated)';
}
