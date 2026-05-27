/**
 * The New Campaign entry button rendered on the main menu.
 *
 * Click handler branches on `isTauri()`:
 *   - Tauri: open the procgen pre-gen modal → wait for result →
 *     load via `harness.loadGeneratedManifest` or surface error.
 *   - Browser: open the file-picker fallback → load locally or
 *     surface error.
 *
 * Both branches are injected as opaque `Promise<void>` thunks so the
 * orchestration is testable without dragging the harness or Tauri
 * runtime into this module. Production wiring happens in the harness
 * (module 11).
 *
 * The button itself is reentrancy-guarded: while a flow is open, the
 * button is disabled and rapid double-clicks are dropped.
 *
 * Companion: docs/architecture/procgen-integration.md §7.1.
 */

export interface NewCampaignButtonDeps {
  isTauri(): boolean;
  openTauriFlow(): Promise<void>;
  openBrowserFlow(): Promise<void>;
}

export interface NewCampaignButtonHandle {
  /** Remove the button from the DOM. */
  destroy(): void;
}

export function mountNewCampaignButton(
  host: HTMLElement,
  deps: NewCampaignButtonDeps,
): NewCampaignButtonHandle {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset['role'] = 'new-campaign';
  btn.textContent = '+ New Campaign';
  btn.style.cssText = `
    text-align: left; padding: 8px 12px;
    background: var(--accent); color: var(--bg);
    border: 1px solid var(--accent); border-radius: 4px;
    cursor: pointer; font: inherit; font-weight: 600;
  `;

  let running = false;
  btn.addEventListener('click', () => {
    if (running) return;
    running = true;
    btn.disabled = true;
    const flow = deps.isTauri() ? deps.openTauriFlow() : deps.openBrowserFlow();
    void flow.finally(() => {
      running = false;
      btn.disabled = false;
    });
  });

  host.appendChild(btn);

  return {
    destroy(): void {
      btn.remove();
    },
  };
}
