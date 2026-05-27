/**
 * CLI entry tests (architect §9).
 *
 * The `main(argv)` function is exported so we can drive it with a
 * canned argv array. It returns the process exit code as a number.
 * Spawn / fs are unmocked here — these tests cover the argv parser
 * and the help/version paths.
 */

import { describe, expect, test, vi } from 'vitest';
import { main } from '../index';

describe('CLI — help/version', () => {
  test('--help prints usage and exits 0', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await main(['--help']);
    expect(code).toBe(0);
    expect(stdoutSpy).toHaveBeenCalled();
    const printed = (stdoutSpy.mock.calls[0]?.[0] ?? '') as string;
    expect(printed).toMatch(/Usage:/);
    expect(printed).toMatch(/Exit codes:/);
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  test('-h is an alias for --help', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await main(['-h']);
    expect(code).toBe(0);
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  test('--version prints a version string and exits 0', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await main(['--version']);
    expect(code).toBe(0);
    expect(stdoutSpy).toHaveBeenCalled();
    const printed = (stdoutSpy.mock.calls[0]?.[0] ?? '') as string;
    expect(printed).toMatch(/throughline-gen/);
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

describe('CLI — argv parsing', () => {
  test('--out is required', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await main([]);
    expect(code).toBe(1);
    const printed = (stderrSpy.mock.calls.map((c) => c[0]).join('') ?? '') as string;
    expect(printed.toLowerCase()).toContain('out is required');
    stderrSpy.mockRestore();
  });

  test('unknown flag triggers an error', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await main(['--no-such-flag']);
    expect(code).toBe(1);
    stderrSpy.mockRestore();
  });

  test('--acts must be an integer in [1, 8]', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await main(['--out', 'x.json', '--acts', '999']);
    expect(code).toBe(1);
    const printed = (stderrSpy.mock.calls.map((c) => c[0]).join('') ?? '') as string;
    expect(printed).toMatch(/acts/);
    stderrSpy.mockRestore();
  });

  test('--puzzles-per-act must be an integer in [1, 16]', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await main(['--out', 'x.json', '--puzzles-per-act', '999']);
    expect(code).toBe(1);
    stderrSpy.mockRestore();
  });

  test('positional argument rejected by strict parser', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await main(['some-positional', '--out', 'x.json']);
    expect(code).toBe(1);
    stderrSpy.mockRestore();
  });
});
