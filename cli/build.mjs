#!/usr/bin/env node
/**
 * Build script for the Throughline CLI.
 *
 * 1. Type-check the whole CLI tree (tsc --noEmit).
 * 2. Bundle cli/src/index.ts to dist-cli/throughline-gen.mjs.
 * 3. Copy prompts/system.md into dist-cli/prompts/system.md so the
 *    runtime can find it relative to the bundle.
 *
 * Kept as a tiny standalone Node script so package.json's build:cli
 * line stays terse and we can add post-build steps without growing
 * the npm script string.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function run(cmd, args, opts = {}) {
  // npm-installed binaries on Windows ship as .cmd shims. spawnSync
  // with `shell: false` can't execute them directly. We resolve to
  // the package's actual entry point under node_modules/.bin/ via
  // node's own resolver. For tsc and esbuild specifically, we know
  // the JS entry points and invoke them with Node.
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
    cwd: repoRoot,
    ...opts,
  });
  if (r.error) {
    console.error(`[build:cli] spawn failed: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`[build:cli] ${cmd} exited ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

const nodeExe = process.execPath;
const tscJs = join(repoRoot, 'node_modules', 'typescript', 'lib', 'tsc.js');
const esbuildJs = join(repoRoot, 'node_modules', 'esbuild', 'bin', 'esbuild');

// 1. Type-check.
run(nodeExe, [tscJs, '-p', 'cli/tsconfig.json', '--noEmit']);

// 2. Bundle. (esbuild's bin shim is a JS file with a node shebang.)
run(nodeExe, [
  esbuildJs,
  'cli/src/index.ts',
  '--bundle',
  '--platform=node',
  '--target=node20',
  '--format=esm',
  '--outfile=dist-cli/throughline-gen.mjs',
  '--loader:.json=json',
  '--external:node:*',
]);

// 3. Copy prompts/system.md beside the bundle.
const outDir = join(repoRoot, 'dist-cli', 'prompts');
mkdirSync(outDir, { recursive: true });
copyFileSync(join(repoRoot, 'cli', 'src', 'prompts', 'system.md'), join(outDir, 'system.md'));

console.log('build:cli done. dist-cli/throughline-gen.mjs + dist-cli/prompts/system.md');
