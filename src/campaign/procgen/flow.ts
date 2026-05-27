/**
 * Procgen flow glue.
 *
 * Composes the modal + API + harness pieces into the two
 * `NewCampaignFlowDeps` callbacks the harness expects:
 *   - `openTauriFlow()` — pre-gen modal → generate → load or error
 *   - `openBrowserFlow()` — file-picker → load or error
 *
 * Lives in `procgen/` (not `dom/`) because it's a composition module:
 * unit-tested via injected deps; production-wired in `src/main.ts`.
 *
 * Companion: docs/architecture/procgen-integration.md §7 / §10.
 */

import { showErrorModal, type ErrorClass } from '../dom/errorModal';
import { openNewCampaignModal, type NewCampaignModalDeps } from '../dom/newCampaignModal';
import { openBrowserFallback } from '../dom/browserFallback';
import { computeHintsFromLibrary } from './hints';
import {
  cancelGeneration as defaultCancel,
  generateCampaign as defaultGenerate,
  onProgress as defaultOnProgress,
} from './api';
import type { CampaignHarnessHandle } from '../dom/harness';
import type { StorageBackend } from '../storage';

export interface FlowDeps {
  readonly host: HTMLElement;
  readonly storage: StorageBackend;
  readonly harness: CampaignHarnessHandle;
  /** Allows tests to inject fakes. Defaults to the real Tauri-backed API. */
  readonly generate?: NewCampaignModalDeps['generate'];
  readonly cancel?: NewCampaignModalDeps['cancel'];
  readonly onProgress?: NewCampaignModalDeps['onProgress'];
  /** Allows tests to inject deterministic IDs/seeds. */
  readonly newJobId?: () => string;
  readonly newSeed?: () => string;
  /** UI safety-timer override (default 5:30). */
  readonly safetyTimerMs?: number;
}

function defaultJobId(): string {
  // Browser cryptographic random (Tauri webview has crypto too).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Last-resort fallback for very old environments. Not security
  // sensitive — job ids are scoped to the user's session.
  return `job-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function defaultSeed(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.floor(Math.random() * 1e16).toString(16);
}

export async function openTauriFlow(deps: FlowDeps): Promise<void> {
  const hints = computeHintsFromLibrary(deps.storage);
  const modalDeps: NewCampaignModalDeps = {
    generate: deps.generate ?? defaultGenerate,
    cancel: deps.cancel ?? defaultCancel,
    onProgress: deps.onProgress ?? defaultOnProgress,
    hints,
    newJobId: deps.newJobId ?? defaultJobId,
    newSeed: deps.newSeed ?? defaultSeed,
    ...(deps.safetyTimerMs !== undefined ? { safetyTimerMs: deps.safetyTimerMs } : {}),
  };
  const handle = openNewCampaignModal(deps.host, modalDeps);
  const result = await handle.result;
  if (result.kind === 'closed' || result.kind === 'cancelled') return;
  if (result.kind === 'safety-timeout') {
    await showErrorModal({ errorClass: 'timeout', host: deps.host });
    return;
  }
  if (result.kind === 'error') {
    const errClass: ErrorClass = result.error.kind;
    await showErrorModal({
      errorClass: errClass,
      host: deps.host,
      message: result.error.message,
      ...(result.error.cliExitCode !== undefined ? { cliExitCode: result.error.cliExitCode } : {}),
      ...(result.error.cliStderr !== undefined ? { stderr: result.error.cliStderr } : {}),
    });
    return;
  }
  // result.kind === 'generated' — hand off to the harness. If the
  // manifest fails the in-game schema parse we surface schema-fail
  // here (defense in depth — the CLI's own schema-parse already
  // succeeded but the manifest could be malformed in some edge case).
  try {
    deps.harness.loadGeneratedManifest(result.manifestJson, result.path, result.seedUsed);
  } catch (e) {
    const errClass: ErrorClass = e instanceof SyntaxError ? 'stdout-not-json' : 'schema-fail';
    await showErrorModal({
      errorClass: errClass,
      host: deps.host,
      message: (e as Error).message,
    });
  }
}

export async function openBrowserFlow(deps: FlowDeps): Promise<void> {
  const handle = openBrowserFallback(deps.host);
  const result = await handle.result;
  if (result.kind === 'closed') return;
  if (result.kind === 'error') {
    await showErrorModal({
      errorClass: result.errorClass,
      host: deps.host,
      ...(result.message !== undefined ? { message: result.message } : {}),
    });
    return;
  }
  try {
    deps.harness.loadGeneratedManifest(result.manifestJson, result.path, result.seedUsed);
  } catch (e) {
    const errClass: ErrorClass = e instanceof SyntaxError ? 'stdout-not-json' : 'schema-fail';
    await showErrorModal({
      errorClass: errClass,
      host: deps.host,
      message: (e as Error).message,
    });
  }
}
