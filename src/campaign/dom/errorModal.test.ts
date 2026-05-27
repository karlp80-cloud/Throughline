// @vitest-environment jsdom
/**
 * Tests for the per-error-class modal.
 *
 * Strategy: render the modal into a detached container, inspect its
 * DOM, click the buttons, assert the returned `ErrorAction`. Native
 * `<dialog>` doesn't actually open in jsdom (no native pointer
 * dispatch), so `showErrorModal` exposes the same DOM whether or not
 * the dialog is "open" — tests query the rendered children rather
 * than checking `dialog.open`.
 *
 * Coverage maps to architect §5.1.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { showErrorModal, type ErrorClass } from './errorModal';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

interface RenderedCase {
  promise: Promise<unknown>;
  dialog: HTMLDialogElement;
  buttons: HTMLButtonElement[];
}

function render(opts: {
  errorClass: ErrorClass;
  stderr?: string;
  cliExitCode?: number;
}): RenderedCase {
  const promise = showErrorModal({ ...opts, host });
  const dialog = host.querySelector('dialog') as HTMLDialogElement;
  expect(dialog).not.toBeNull();
  const buttons = Array.from(dialog.querySelectorAll('button')) as HTMLButtonElement[];
  return { promise, dialog, buttons };
}

describe('showErrorModal — per-class copy + button set', () => {
  test('binary-not-found: copy mentions Node.js; only Close button', async () => {
    const { dialog, buttons, promise } = render({ errorClass: 'binary-not-found' });
    expect(dialog.textContent ?? '').toMatch(/Node\.js/);
    // Only Close — no Retry, no Reroll.
    expect(buttons.map((b) => b.dataset['action'])).toEqual(['close']);
    buttons[0]!.click();
    await expect(promise).resolves.toBe('close');
  });

  test('timeout: Retry button present', async () => {
    const { buttons, promise } = render({ errorClass: 'timeout' });
    const actions = buttons.map((b) => b.dataset['action']);
    expect(actions).toContain('retry');
    expect(actions).toContain('close');
    // Click Retry.
    buttons.find((b) => b.dataset['action'] === 'retry')!.click();
    await expect(promise).resolves.toBe('retry');
  });

  test('cli-exit-2: shows the "fresh seed" reroll button', async () => {
    const { dialog, buttons, promise } = render({ errorClass: 'cli-exit', cliExitCode: 2 });
    expect(dialog.textContent ?? '').toMatch(/fresh seed/i);
    const actions = buttons.map((b) => b.dataset['action']);
    expect(actions).toContain('reroll-retry');
    buttons.find((b) => b.dataset['action'] === 'reroll-retry')!.click();
    await expect(promise).resolves.toBe('reroll-retry');
  });

  test('cli-exit-5 (claude not found): no automatic retry — close only', async () => {
    const { dialog, buttons, promise } = render({ errorClass: 'cli-exit', cliExitCode: 5 });
    expect(dialog.textContent ?? '').toMatch(/claude/i);
    expect(buttons.map((b) => b.dataset['action'])).toEqual(['close']);
    buttons[0]!.click();
    await expect(promise).resolves.toBe('close');
  });

  test('schema-fail: title mentions validation, Retry-with-fresh-seed visible', async () => {
    const { dialog, buttons, promise } = render({ errorClass: 'schema-fail' });
    expect(dialog.textContent ?? '').toMatch(/validat/i);
    const actions = buttons.map((b) => b.dataset['action']);
    expect(actions).toContain('reroll-retry');
    buttons.find((b) => b.dataset['action'] === 'close')!.click();
    await expect(promise).resolves.toBe('close');
  });

  test('cancelled: no buttons except close; resolves "close"', async () => {
    const { buttons, promise } = render({ errorClass: 'cancelled' });
    expect(buttons.map((b) => b.dataset['action'])).toEqual(['close']);
    buttons[0]!.click();
    await expect(promise).resolves.toBe('close');
  });

  test('stderr renders via textContent in a <pre>, never innerHTML', async () => {
    const malicious = '<img src=x onerror=alert(1)>';
    const { dialog, buttons, promise } = render({
      errorClass: 'cli-exit',
      cliExitCode: 1,
      stderr: malicious,
    });
    const pre = dialog.querySelector('pre');
    expect(pre).not.toBeNull();
    // textContent gets the raw string. innerHTML must NOT contain a
    // live <img> tag — assert by checking there are zero <img>
    // descendants and the raw text survives intact.
    expect(pre!.querySelectorAll('img').length).toBe(0);
    expect(pre!.textContent).toBe(malicious);
    buttons.find((b) => b.dataset['action'] === 'close')!.click();
    await promise;
  });

  test('omits stderr block when no stderr supplied', () => {
    const { dialog } = render({ errorClass: 'cli-exit', cliExitCode: 1 });
    expect(dialog.querySelector('pre')).toBeNull();
  });
});
