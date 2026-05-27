import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Per-file overrides use `// @vitest-environment jsdom` directives.
    // The engine (Phase 1) stays on `node`; editor/render (Phase 2+) opt into jsdom per file.
  },
});
