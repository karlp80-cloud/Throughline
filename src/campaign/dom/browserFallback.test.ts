// @vitest-environment jsdom
/**
 * Tests for the browser-mode fallback modal (file-picker import).
 *
 * The modal explains the limitation, exposes a file picker, reads
 * the file via FileReader, JSON.parses, runs `parseCampaign`, and
 * resolves with one of:
 *   - { kind: 'imported', manifestJson, ...inferred }
 *   - { kind: 'closed' } (Cancel)
 *   - { kind: 'error', errorClass, message? }
 *
 * Strategy: build a minimal `File` blob in-memory; we don't rely on
 * an actual `<input type="file">` user-gesture — we synthesize a
 * `files` selection and dispatch `change`. The architect note about
 * `setInputFiles` (Playwright) is irrelevant here; that's the e2e.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openBrowserFallback, type BrowserFallbackResult } from './browserFallback';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

function makeMinimalCampaignJson(): string {
  // The smallest manifest that passes parseCampaign — single act, single
  // puzzle, single input/output. The schema validator (Phase 7) is what
  // this exercises; the e2e uses a richer manifest from disk.
  return JSON.stringify({
    version: 1,
    seed: 'browser-test',
    theme: {
      name: 'Test',
      setting_summary: 'unit',
      palette: {
        bg: '#000000',
        surface: '#101010',
        fg: '#ffffff',
        muted: '#808080',
        accent: '#ff0000',
        success: '#00ff00',
        danger: '#ff00ff',
      },
      glyphs: { input: 'alembic', output: 'phial' },
      vocabulary: { cargo: 'alpha' },
    },
    acts: [
      {
        id: 'a1',
        title: 'Act 1',
        intro_text: 'i',
        outro_text: 'o',
        required_completions: 1,
        puzzles: [
          {
            id: 'p1',
            title: 'P1',
            briefing: 'b',
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
    ending: { good: 'g', neutral: 'n' },
  });
}

async function selectFile(input: HTMLInputElement, content: string): Promise<void> {
  const file = new File([content], 'campaign.json', { type: 'application/json' });
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
  // Let FileReader.readAsText resolve.
  await Promise.resolve();
  await new Promise<void>((res) => setTimeout(res, 5));
}

describe('openBrowserFallback', () => {
  test('renders explanatory copy + Cancel + a file picker button', () => {
    openBrowserFallback(host);
    const dialog = host.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent ?? '').toMatch(/desktop app/i);
    expect(host.querySelector('button[data-role="choose-file"]')).not.toBeNull();
    expect(host.querySelector('button[data-role="cancel"]')).not.toBeNull();
    expect(host.querySelector('input[data-role="file-input"]')).not.toBeNull();
  });

  test('Cancel resolves "closed"', async () => {
    const handle = openBrowserFallback(host);
    (host.querySelector('button[data-role="cancel"]') as HTMLButtonElement).click();
    const r = await handle.result;
    expect(r.kind).toBe('closed');
  });

  test('happy path: valid manifest → resolves imported', async () => {
    const handle = openBrowserFallback(host);
    const input = host.querySelector('input[data-role="file-input"]') as HTMLInputElement;
    await selectFile(input, makeMinimalCampaignJson());
    const r: BrowserFallbackResult = await handle.result;
    expect(r.kind).toBe('imported');
    if (r.kind === 'imported') {
      expect(r.seedUsed).toBe('browser-test');
      // path empty since no on-disk location
      expect(r.path).toBe('');
    }
  });

  test('JSON syntax error → resolves error stdout-not-json', async () => {
    const handle = openBrowserFallback(host);
    const input = host.querySelector('input[data-role="file-input"]') as HTMLInputElement;
    await selectFile(input, '{not valid json');
    const r = await handle.result;
    expect(r.kind).toBe('error');
    if (r.kind === 'error') {
      expect(r.errorClass).toBe('stdout-not-json');
    }
  });

  test('schema fail → resolves error schema-fail', async () => {
    const handle = openBrowserFallback(host);
    const input = host.querySelector('input[data-role="file-input"]') as HTMLInputElement;
    // Valid JSON but missing the required `version` field, etc.
    await selectFile(input, JSON.stringify({ hello: 'world' }));
    const r = await handle.result;
    expect(r.kind).toBe('error');
    if (r.kind === 'error') {
      expect(r.errorClass).toBe('schema-fail');
    }
  });
});
