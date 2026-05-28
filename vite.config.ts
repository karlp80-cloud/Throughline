import { defineConfig } from 'vite';

/**
 * Throughline Vite config.
 *
 * `base: './'` produces a build whose asset URLs are all relative to
 * the index.html — required for the Tauri webview, which loads the
 * bundle from a `tauri://` (or `https://tauri.localhost/`) origin
 * where absolute `/assets/...` paths would fail.
 *
 * `target: 'esnext'` matches what the Tauri webview (recent WebView2
 * on Windows, WKWebView on macOS, WebKitGTK on Linux) supports, and
 * matches modern browsers. The TypeScript compiler still type-checks
 * against the root tsconfig which sets `target: ES2022`.
 *
 * `sourcemap: false` keeps the production bundle small. Use the dev
 * server (`npm run dev`) for source-mapped debugging.
 */
export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    target: 'esnext',
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
