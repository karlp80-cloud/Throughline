/**
 * Per-class procgen error modal.
 *
 * One `<dialog>` element with title + body + (optionally) a
 * sanitized stderr `<pre>` + a category-specific button set. All
 * text rendered via `textContent` — never `innerHTML`. The stderr
 * shown here has already been sanitized Rust-side (architect §6);
 * `textContent` is the defense-in-depth at the render layer.
 *
 * Returns a Promise that resolves to the user's choice:
 *   - 'retry'         → re-run with the same args
 *   - 'reroll-retry'  → re-open pre-gen modal with a fresh seed
 *   - 'close'         → back to main menu
 *
 * Companion: docs/architecture/procgen-integration.md §5.
 */

import type { ProcgenErrorKind } from '../procgen/api';

export type ErrorClass =
  | ProcgenErrorKind
  // TS-side categories that don't originate from Rust:
  | 'stdout-not-json'
  | 'schema-fail';

export type ErrorAction = 'retry' | 'reroll-retry' | 'close';

export interface ErrorModalOpts {
  readonly errorClass: ErrorClass;
  /** CLI exit code; only relevant for `errorClass === 'cli-exit'`. */
  readonly cliExitCode?: number;
  /** Already-sanitized stderr from the Rust side; rendered via textContent. */
  readonly stderr?: string;
  /** Optional override message (e.g. for `spawn-failed`'s errno). */
  readonly message?: string;
  /** Element to mount the dialog under; defaults to `document.body`. */
  readonly host?: HTMLElement;
}

interface Spec {
  title: string;
  body: string;
  /** Actions in render order. `close` is always last. */
  actions: ErrorAction[];
  /** Friendlier label override per action; falls back to a default. */
  labelOverrides?: Partial<Record<ErrorAction, string>>;
}

function specFor(opts: ErrorModalOpts): Spec {
  const { errorClass, cliExitCode } = opts;
  switch (errorClass) {
    case 'binary-not-found':
      return {
        title: "Couldn't find the campaign generator",
        body: "Couldn't find the campaign generator on your system. Make sure Node.js 20+ is installed and available on your PATH, then try again.",
        actions: ['close'],
      };
    case 'spawn-failed':
      return {
        title: 'Failed to launch the generator',
        body:
          'Failed to launch the campaign generator' + (opts.message ? ': ' + opts.message : '.'),
        actions: ['retry', 'close'],
      };
    case 'timeout':
      return {
        title: 'Generation timed out',
        body: 'Generation took longer than 5 minutes and was cancelled. Try a smaller seed, fewer acts, or fewer puzzles per act.',
        actions: ['retry', 'close'],
      };
    case 'cancelled':
      return {
        title: 'Cancelled',
        body: 'Generation was cancelled.',
        actions: ['close'],
      };
    case 'cli-exit':
      switch (cliExitCode) {
        case 2:
          return {
            title: "Couldn't get a valid campaign",
            body: "Couldn't get a valid campaign from the LLM after a few retries. Try a fresh seed.",
            actions: ['reroll-retry', 'close'],
            labelOverrides: { 'reroll-retry': 'Try a fresh seed' },
          };
        case 3:
          return {
            title: "Couldn't solve every puzzle",
            body: "One or more puzzles couldn't be solved within the time budget. Try a fresh seed, or enable Gentle mode for an easier batch.",
            actions: ['reroll-retry', 'close'],
            labelOverrides: { 'reroll-retry': 'Try a fresh seed' },
          };
        case 4:
          return {
            title: 'Path safety violation',
            body: 'The generator refused to write to the requested path. This is an app bug; please file an issue.',
            actions: ['close'],
          };
        case 5:
          return {
            title: "Couldn't reach claude",
            body: "Couldn't reach Claude. Is the `claude` CLI installed and signed in? See the install docs.",
            actions: ['close'],
          };
        default:
          return {
            title: 'Generator failed',
            body: 'The generator hit an internal error.',
            actions: ['retry', 'close'],
          };
      }
    case 'stdout-not-json':
      return {
        title: 'Malformed output',
        body: 'The generator returned malformed data. Try a fresh seed.',
        actions: ['reroll-retry', 'close'],
        labelOverrides: { 'reroll-retry': 'Try a fresh seed' },
      };
    case 'schema-fail':
      return {
        title: 'Campaign failed validation',
        body: 'The generated campaign failed validation. Try a fresh seed.',
        actions: ['reroll-retry', 'close'],
        labelOverrides: { 'reroll-retry': 'Try a fresh seed' },
      };
    case 'file-read-failed':
      return {
        title: "Couldn't read campaign file",
        body: "Couldn't read the campaign file" + (opts.message ? ': ' + opts.message : '.'),
        actions: ['close'],
      };
    case 'path-rejected':
      return {
        title: 'Refused to read that path',
        body: 'Refused to read from that location. This is an app bug; please file an issue.',
        actions: ['close'],
      };
    case 'internal-error':
    default:
      return {
        title: 'Unexpected error',
        body: 'An unexpected error occurred' + (opts.message ? ': ' + opts.message : '.'),
        actions: ['retry', 'close'],
      };
  }
}

function actionLabel(
  action: ErrorAction,
  overrides?: Partial<Record<ErrorAction, string>>,
): string {
  if (overrides?.[action]) return overrides[action]!;
  switch (action) {
    case 'retry':
      return 'Retry';
    case 'reroll-retry':
      return 'Try a fresh seed';
    case 'close':
      return 'Close';
  }
}

export function showErrorModal(opts: ErrorModalOpts): Promise<ErrorAction> {
  const host = opts.host ?? document.body;
  const dialog = document.createElement('dialog');
  dialog.dataset['role'] = 'procgen-error-modal';
  dialog.dataset['errorClass'] = opts.errorClass;
  dialog.style.cssText =
    'min-width: 360px; max-width: 560px; padding: 16px; border: 1px solid var(--muted); ' +
    'border-radius: 6px; background: var(--surface); color: var(--fg);';

  const spec = specFor(opts);

  const h = document.createElement('h2');
  h.textContent = spec.title;
  h.style.cssText = 'margin: 0 0 8px 0; font-size: 16px;';
  dialog.appendChild(h);

  const body = document.createElement('p');
  body.dataset['role'] = 'body';
  body.textContent = spec.body;
  body.style.cssText = 'margin: 0 0 12px 0; white-space: pre-wrap;';
  dialog.appendChild(body);

  if (opts.stderr && opts.stderr.length > 0) {
    const pre = document.createElement('pre');
    pre.dataset['role'] = 'stderr';
    // textContent — never innerHTML. Sanitization already happened
    // Rust-side; this is the second layer.
    pre.textContent = opts.stderr;
    pre.style.cssText =
      'max-height: 180px; overflow: auto; padding: 8px; margin: 0 0 12px 0; ' +
      'background: var(--bg); color: var(--fg); border: 1px solid var(--muted); ' +
      'border-radius: 4px; font-family: monospace; font-size: 12px; white-space: pre-wrap;';
    dialog.appendChild(pre);
  }

  const buttonRow = document.createElement('div');
  buttonRow.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';
  dialog.appendChild(buttonRow);

  host.appendChild(dialog);

  return new Promise<ErrorAction>((resolve) => {
    function done(action: ErrorAction): void {
      try {
        if (dialog.open) dialog.close();
      } catch {
        // jsdom: dialog.close may throw; ignore.
      }
      dialog.remove();
      resolve(action);
    }
    for (const action of spec.actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset['action'] = action;
      btn.textContent = actionLabel(action, spec.labelOverrides);
      const isPrimary = action !== 'close';
      btn.style.cssText = isPrimary
        ? 'padding: 6px 14px; background: var(--accent); color: var(--bg); border: 1px solid var(--accent); border-radius: 4px; cursor: pointer; font: inherit; font-weight: 600;'
        : 'padding: 6px 14px; background: var(--bg); color: var(--fg); border: 1px solid var(--muted); border-radius: 4px; cursor: pointer; font: inherit;';
      btn.addEventListener('click', () => done(action));
      buttonRow.appendChild(btn);
    }

    try {
      dialog.showModal();
    } catch {
      // jsdom: showModal not implemented. The dialog is in the DOM
      // regardless; tests query children directly.
    }
  });
}
