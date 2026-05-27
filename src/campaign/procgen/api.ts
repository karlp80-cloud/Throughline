/**
 * TypeScript bindings for the three Rust procgen commands.
 *
 * Public surface is intentionally tiny — these are *just* the IPC
 * shim. The orchestration (UI flow, retry on schema fail, library
 * upsert, …) lives in the harness. The Rust side does no parsing or
 * validation; the manifest text it returns is fed verbatim to
 * `JSON.parse` + `parseCampaign` on the TS side.
 *
 * Tauri 2.x convention: command args are wrapped in a single named
 * field matching the Rust handler's argument identifier (so a
 * Rust fn `generate_campaign(opts: GenerateOpts)` is invoked with
 * `invoke('generate_campaign', { opts: { ... } })`).
 *
 * Companion: docs/architecture/procgen-integration.md §3.
 */

import { tauriHandle } from '../../platform';

export interface GenerateOpts {
  readonly jobId: string;
  readonly seed?: string;
  readonly acts?: number;
  readonly puzzlesPerAct?: number;
  readonly gentle?: boolean;
  readonly avoidThemes?: readonly string[];
  readonly llmTimeoutMs?: number;
}

export interface GenerateOk {
  readonly path: string;
  readonly manifestJson: string;
  readonly elapsedMs: number;
  readonly seedUsed: string;
}

export type ProcgenErrorKind =
  | 'binary-not-found'
  | 'spawn-failed'
  | 'timeout'
  | 'cancelled'
  | 'cli-exit'
  | 'stdout-not-json'
  | 'file-read-failed'
  | 'path-rejected'
  | 'internal-error';

export interface ProcgenError {
  readonly kind: ProcgenErrorKind;
  readonly message: string;
  readonly cliExitCode?: number;
  readonly cliStderr?: string;
}

export interface ProgressPayload {
  readonly jobId: string;
  readonly phase: string;
  readonly elapsedMs: number;
}

export async function generateCampaign(opts: GenerateOpts): Promise<GenerateOk> {
  const h = await tauriHandle();
  return h.invoke<GenerateOk>('generate_campaign', { opts });
}

export async function cancelGeneration(jobId: string): Promise<void> {
  const h = await tauriHandle();
  await h.invoke<void>('cancel_generation', { jobId });
}

export async function readCampaignFile(path: string): Promise<string> {
  const h = await tauriHandle();
  return h.invoke<string>('read_campaign_file', { path });
}

/**
 * Subscribe to `procgen:progress` heartbeats emitted by the Rust
 * generator every ~2 seconds while a job runs. The callback receives
 * the payload only — Tauri's `Event<T>` envelope is unwrapped by
 * `tauriHandle().listen`. Resolves to an unlisten function.
 */
export async function onProgress(cb: (payload: ProgressPayload) => void): Promise<() => void> {
  const h = await tauriHandle();
  return h.listen<ProgressPayload>('procgen:progress', cb);
}
