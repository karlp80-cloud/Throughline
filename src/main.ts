/**
 * Throughline — entry point.
 *
 * Phase 0 contract: mount the project name into #app so the smoke e2e
 * spec can assert it. Real screens land in later phases.
 */
const app = document.getElementById('app');
if (app) {
  app.textContent = 'Throughline';
}
