// @vitest-environment jsdom
/**
 * Integration tests for the procgen path through the harness.
 *
 * Phase 11 adds `loadGeneratedManifest` to the harness handle. This
 * test asserts:
 *   1. A valid manifest is JSON-parsed, schema-validated, synthesized
 *      into a campaign-id + save + library entry, and transitions to
 *      act_intro.
 *   2. The library entry carries the on-disk `sourcePath`.
 *   3. Malformed JSON throws `CampaignParseError`-shaped to the
 *      caller (so the New Campaign flow can show the right modal).
 *   4. Schema failures throw `CampaignParseError`.
 *
 * The harness is mounted with a `MemoryStorageBackend` so we can
 * inspect the library/save state directly.
 *
 * The hints + Tauri flow are pinned in their own tests; this file is
 * the harness-level integration.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mountCampaignHarness, type CampaignHarnessHandle } from '../dom/harness';
import { MemoryStorageBackend } from '../storage';
import { readLibrary } from '../saves';
import { CampaignParseError } from '../../schema/campaign';

function makeManifestJson(seed = 'gen-1'): string {
  return JSON.stringify({
    version: 1,
    seed,
    theme: {
      name: 'Generated Theme',
      setting_summary: '',
      palette: {
        bg: '#000000',
        surface: '#111111',
        fg: '#ffffff',
        muted: '#888888',
        accent: '#ff8800',
        success: '#00cc00',
        danger: '#cc0000',
      },
      glyphs: { input: 'alembic' },
      vocabulary: { cargo: 'alpha' },
    },
    acts: [
      {
        id: 'a1',
        title: 'A1',
        intro_text: 'i1',
        outro_text: 'o1',
        required_completions: 1,
        puzzles: [
          {
            id: 'p1',
            title: 'P1',
            briefing: 'b',
            grid: { w: 5, h: 3 },
            inputs: [{ pos: [0, 1], emits: ['alpha'], rate: 1 }],
            outputs: [{ pos: [4, 1], required: [{ type: 'alpha', count: 3 }] }],
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

let container: HTMLElement;
let storage: MemoryStorageBackend;
let harness: CampaignHarnessHandle;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  storage = new MemoryStorageBackend();
  harness = mountCampaignHarness(container, { storage, now: () => 12345 });
});

afterEach(() => {
  harness.destroy();
  container.remove();
});

describe('harness.loadGeneratedManifest', () => {
  test('happy path: validates, transitions to act_intro 0', () => {
    harness.loadGeneratedManifest(makeManifestJson('s1'), '/path/to/s1.json', 's1');
    expect(harness.state()).toEqual({ kind: 'act_intro', actIndex: 0 });
    expect(harness.campaign()?.seed).toBe('s1');
    expect(harness.campaign()?.theme.name).toBe('Generated Theme');
  });

  test('upserts a library entry with the seed + theme + sourcePath', () => {
    harness.loadGeneratedManifest(makeManifestJson('s2'), '/x/s2.json', 's2');
    const lib = readLibrary(storage);
    expect(lib.entries).toHaveLength(1);
    expect(lib.entries[0]).toMatchObject({
      themeName: 'Generated Theme',
      completed: false,
      sourcePath: '/x/s2.json',
    });
    expect(lib.entries[0]?.campaignId.startsWith('procgen-s2-')).toBe(true);
  });

  test('synthesized campaign id is unique per call (collision-resistant)', () => {
    let n = 0;
    const harnessB = mountCampaignHarness(document.createElement('div'), {
      storage,
      now: () => ++n,
    });
    try {
      harnessB.loadGeneratedManifest(makeManifestJson('s3'), '/x/a.json', 's3');
      const idA = harnessB.save()?.campaignId;
      harnessB.loadGeneratedManifest(makeManifestJson('s3'), '/x/b.json', 's3');
      const idB = harnessB.save()?.campaignId;
      expect(idA).not.toBe(idB);
    } finally {
      harnessB.destroy();
    }
  });

  test('JSON syntax error throws so caller can surface the right modal', () => {
    expect(() => harness.loadGeneratedManifest('{not valid json', '/x.json', 's4')).toThrow();
  });

  test('schema fail throws CampaignParseError so caller can branch', () => {
    expect(() =>
      harness.loadGeneratedManifest(JSON.stringify({ hello: 'world' }), '/x.json', 's5'),
    ).toThrow(CampaignParseError);
  });

  test('written save round-trips through the storage backend', () => {
    harness.loadGeneratedManifest(makeManifestJson('s6'), '/x/s6.json', 's6');
    const saveId = harness.save()?.campaignId;
    expect(saveId).toBeDefined();
    expect(storage.read(`throughline:campaign:${saveId!}`)).not.toBeNull();
  });
});

describe('harness.loadCampaignFromSourcePath (resume on launch)', () => {
  test('reads JSON via injected reader and loads', async () => {
    let calls = 0;
    const fakeRead = async (path: string): Promise<string> => {
      calls++;
      expect(path).toBe('/disk/foo.json');
      return makeManifestJson('resumed');
    };
    await harness.loadCampaignFromSourcePath('/disk/foo.json', 'resumed', fakeRead);
    expect(calls).toBe(1);
    expect(harness.campaign()?.seed).toBe('resumed');
    expect(harness.state()).toEqual({ kind: 'act_intro', actIndex: 0 });
  });

  test('reader rejection bubbles up to the caller', async () => {
    const fakeRead = (): Promise<string> => Promise.reject(new Error('missing'));
    await expect(harness.loadCampaignFromSourcePath('/nope.json', 'x', fakeRead)).rejects.toThrow(
      'missing',
    );
  });
});
