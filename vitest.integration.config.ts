import { defineConfig } from 'vitest/config';

/**
 * Integration test config. ONLY for the gated live-LLM run; the default
 * config (vitest.config.ts) excludes `cli/integration/**` so it never
 * fires in normal CI / `npm test`.
 *
 * Usage:
 *   RUN_LIVE_LLM=1 npx vitest run --config vitest.integration.config.ts
 *
 * Costs real LLM tokens. Skip the test body itself unless
 * RUN_LIVE_LLM=1 — see `cli/integration/live-claude.test.ts`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['cli/integration/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'dist-cli/**'],
    // The single test inside has a 180s wall-clock budget; lift the
    // suite default to match so vitest doesn't trip on slow LLM
    // responses.
    testTimeout: 240_000,
  },
});
