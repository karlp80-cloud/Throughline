/**
 * Writer tests. Atomic-write + path-safety per architect doc §8.
 *
 * Security-critical: every malicious-path fixture in §10.6 has a
 * test below that asserts the writer rejects it (or accepts the
 * benign case).
 */

import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { writeManifest, WriterPathError } from '../writer';
import { parseCampaign } from '../../../src/schema/campaign';

const isWindows = process.platform === 'win32';

let tempRoot: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tempRoot = await mkdtemp(join(tmpdir(), 'throughline-writer-'));
  process.chdir(tempRoot);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tempRoot, { recursive: true, force: true });
});

/** Minimal valid campaign for round-trip tests. */
function fixtureManifest() {
  return parseCampaign({
    version: 1,
    seed: 'test',
    theme: {
      name: 'T',
      setting_summary: '',
      palette: {
        bg: '#000000',
        surface: '#111111',
        fg: '#ffffff',
        muted: '#888888',
        accent: '#ff00ff',
        success: '#00ff00',
        danger: '#ff0000',
      },
      glyphs: {},
      vocabulary: {},
    },
    acts: [
      {
        id: 'a1',
        title: 'Act',
        intro_text: '',
        outro_text: '',
        required_completions: 0,
        puzzles: [
          {
            id: 'p1',
            title: 'P',
            briefing: '',
            grid: { w: 3, h: 1 },
            inputs: [{ pos: [0, 0], emits: ['alpha'], rate: 1 }],
            outputs: [{ pos: [2, 0], required: [{ type: 'alpha', count: 1 }] }],
            agents: [],
            obstacles: [],
            available_tiles: ['conveyor'],
            available_ops: ['MOVE'],
            constraints: { max_tiles: 3, max_cycles: 10 },
            optional_challenges: [],
          },
        ],
      },
    ],
    ending: { good: '', neutral: '' },
  });
}

describe('writeManifest — round trip', () => {
  test('writes a valid manifest that round-trips through parseCampaign', async () => {
    const manifest = fixtureManifest();
    const out = join(tempRoot, 'campaign.json');
    await writeManifest(out, manifest);
    const text = await readFile(out, 'utf8');
    const reparsed = parseCampaign(JSON.parse(text));
    expect(reparsed).toEqual(manifest);
  });

  test('written file is pretty-printed JSON (2-space indent)', async () => {
    const manifest = fixtureManifest();
    const out = join(tempRoot, 'pretty.json');
    await writeManifest(out, manifest);
    const text = await readFile(out, 'utf8');
    // Pretty-printed means at least one newline + indentation.
    expect(text).toContain('\n  ');
  });
});

describe('writeManifest — path safety', () => {
  test('rejects parent-directory traversal (../)', async () => {
    const manifest = fixtureManifest();
    await expect(writeManifest('../escape.json', manifest)).rejects.toBeInstanceOf(WriterPathError);
    await expect(writeManifest('../escape.json', manifest)).rejects.toMatchObject({
      kind: 'absolute-outside-cwd',
    });
  });

  test('rejects absolute path outside CWD', async () => {
    const manifest = fixtureManifest();
    const outsidePath = isWindows ? 'C:\\Windows\\System32\\evil.json' : '/etc/evil.json';
    await expect(writeManifest(outsidePath, manifest)).rejects.toMatchObject({
      kind: 'absolute-outside-cwd',
    });
  });

  test('rejects when parent directory does not exist', async () => {
    const manifest = fixtureManifest();
    const out = join(tempRoot, 'no-such-dir', 'campaign.json');
    await expect(writeManifest(out, manifest)).rejects.toMatchObject({
      kind: 'parent-missing',
    });
  });

  test.skipIf(isWindows)('rejects symlink whose target escapes CWD', async () => {
    // Create a symlink inside CWD pointing OUT of CWD.
    const escapeTarget = await mkdtemp(join(tmpdir(), 'throughline-escape-'));
    const linkPath = join(tempRoot, 'escape-link');
    try {
      await symlink(escapeTarget, linkPath, 'dir');
      const out = join(linkPath, 'evil.json');
      await expect(writeManifest(out, fixtureManifest())).rejects.toMatchObject({
        kind: 'symlink',
      });
    } finally {
      await rm(escapeTarget, { recursive: true, force: true });
    }
  });

  test('accepts a path inside CWD', async () => {
    const manifest = fixtureManifest();
    await mkdir(join(tempRoot, 'sub'), { recursive: true });
    const out = join(tempRoot, 'sub', 'campaign.json');
    await writeManifest(out, manifest);
    const text = await readFile(out, 'utf8');
    expect(JSON.parse(text)).toEqual(manifest);
  });
});

describe('writeManifest — atomic write rollback', () => {
  test('temp file is cleaned up on rename failure', async () => {
    // Force rename to fail by creating a destination that's a directory.
    const manifest = fixtureManifest();
    const dst = join(tempRoot, 'collide');
    await mkdir(dst); // exists as a directory — rename(file → dir) fails

    // Capture pre-state of the directory listing.
    const preEntries = await (await import('node:fs/promises')).readdir(tempRoot);

    await expect(writeManifest(dst, manifest)).rejects.toBeTruthy();

    // No tmp file should remain after the failed rename.
    const postEntries = await (await import('node:fs/promises')).readdir(tempRoot);
    const tmpLeftovers = postEntries.filter((n) => !preEntries.includes(n) && n.includes('.tmp-'));
    expect(tmpLeftovers).toEqual([]);
  });

  test('overwrites an existing file atomically', async () => {
    const out = join(tempRoot, 'overwrite.json');
    await writeFile(out, 'OLD CONTENT');
    await writeManifest(out, fixtureManifest());
    const text = await readFile(out, 'utf8');
    expect(text).not.toBe('OLD CONTENT');
    expect(JSON.parse(text)).toBeTruthy();
  });
});

describe('safeResolve outside of writeManifest', () => {
  test('the parent must exist; cwd itself is fine', async () => {
    // Sanity: a file directly inside cwd works.
    await writeManifest('direct.json', fixtureManifest());
    const text = await readFile(resolve(tempRoot, 'direct.json'), 'utf8');
    expect(JSON.parse(text)).toBeTruthy();
  });

  test('rejects bare-cwd-relative path that traverses upward', async () => {
    // `..${sep}escape.json` is the path; resolves outside cwd.
    await expect(writeManifest(`..${sep}escape.json`, fixtureManifest())).rejects.toBeInstanceOf(
      WriterPathError,
    );
  });

  test('produces a stat-able file on success', async () => {
    const out = join(tempRoot, 'statme.json');
    await writeManifest(out, fixtureManifest());
    const s = await stat(out);
    expect(s.isFile()).toBe(true);
    expect(s.size).toBeGreaterThan(0);
  });
});
