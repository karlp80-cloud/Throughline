/**
 * Atomic, path-safe manifest writer.
 *
 * Path safety contract (§8.2):
 *   1. The resolved path must live inside CWD.
 *   2. The parent directory must already exist (we never auto-mkdir).
 *   3. The parent directory's realpath must also live inside CWD
 *      (catches symlink jumping out of the sandbox).
 *
 * Atomic-write contract (§8.3):
 *   - Write to `${target}.tmp-${pid}-${counter}` in the same directory.
 *   - fsync the temp file.
 *   - rename(tmp, target) — atomic on POSIX; atomic on Windows when
 *     source and dest live on the same volume (which our tmp suffix
 *     guarantees).
 *   - On any failure after the tmp file exists, unlink it. The target
 *     is untouched.
 */

import { open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import type { RawCampaign } from '../../src/schema/campaign';

export type WriterPathErrorKind =
  | 'absolute-outside-cwd' // resolved path falls outside CWD (covers both `..` and absolute escapes)
  | 'symlink' // parent's realpath resolves outside CWD
  | 'parent-missing'; // parent directory doesn't exist

export class WriterPathError extends Error {
  readonly kind: WriterPathErrorKind;
  readonly path: string;
  constructor(kind: WriterPathErrorKind, path: string) {
    super(`WriterPathError(${kind}): ${path}`);
    this.name = 'WriterPathError';
    this.kind = kind;
    this.path = path;
  }
}

let tmpCounter = 0;

/**
 * Resolve a user-supplied path and prove it's safe to write to.
 * Returns the absolute path; throws WriterPathError on any policy
 * violation.
 */
export async function safeResolve(userPath: string): Promise<string> {
  const cwd = process.cwd();
  // `resolve` handles both relative and absolute inputs.
  const resolved = isAbsolute(userPath) ? resolve(userPath) : resolve(cwd, userPath);

  // Policy 1: resolved must be inside CWD (or equal to CWD).
  // The `+ sep` prefix check prevents 'C:\foobarbaz' from matching 'C:\foo'.
  const cwdWithSep = cwd.endsWith(sep) ? cwd : cwd + sep;
  if (!resolved.startsWith(cwdWithSep) && resolved !== cwd) {
    throw new WriterPathError('absolute-outside-cwd', resolved);
  }

  // Policy 2: parent directory must exist.
  const parent = dirname(resolved);
  let realParent: string;
  try {
    realParent = await realpath(parent);
  } catch {
    throw new WriterPathError('parent-missing', parent);
  }

  // Policy 3: parent's realpath must also be inside CWD's realpath.
  // This catches "symlink under CWD pointing out of CWD" attacks.
  const realCwd = await realpath(cwd);
  const realCwdWithSep = realCwd.endsWith(sep) ? realCwd : realCwd + sep;
  if (!realParent.startsWith(realCwdWithSep) && realParent !== realCwd) {
    throw new WriterPathError('symlink', realParent);
  }

  return resolved;
}

/** Atomic write of the serialized JSON manifest. */
async function atomicWrite(target: string, body: string): Promise<void> {
  const tmp = `${target}.tmp-${process.pid}-${++tmpCounter}`;
  let wroteTmp = false;
  try {
    const fh = await open(tmp, 'w', 0o644);
    try {
      await fh.writeFile(body, { encoding: 'utf8' });
      await fh.sync();
    } finally {
      await fh.close();
    }
    wroteTmp = true;
    await rename(tmp, target);
  } catch (e) {
    if (wroteTmp) {
      // Best-effort cleanup. If unlink fails the tmp file is the only
      // damage and the target remains untouched.
      await unlink(tmp).catch(() => {});
    }
    throw e;
  }
}

/**
 * Public surface: validate the path, then atomically write the
 * pretty-printed manifest to it.
 */
export async function writeManifest(userPath: string, manifest: RawCampaign): Promise<void> {
  const absolute = await safeResolve(userPath);
  const body = JSON.stringify(manifest, null, 2) + '\n';
  await atomicWrite(absolute, body);
}
