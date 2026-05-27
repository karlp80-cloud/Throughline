import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'cli/**/*.test.ts'],
    // Per-file overrides use `// @vitest-environment jsdom` directives.
    // The engine (Phase 1) stays on `node`; editor/render (Phase 2+) opt into jsdom per file.
    // Phase 10's CLI tests live under cli/** and stay on node by default.
    // Live-LLM integration tests live under cli/integration and are gated by RUN_LIVE_LLM=1.
    exclude: ['node_modules/**', 'dist/**', 'dist-cli/**', 'cli/integration/**'],
  },
});
