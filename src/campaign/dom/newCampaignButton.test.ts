// @vitest-environment jsdom
/**
 * Tests for `mountNewCampaignButton`. The button is what `renderMain
 * Menu` puts above the built-in campaign list; its click handler
 * branches on `isTauri()` to either the Tauri pre-gen flow or the
 * browser file-picker flow.
 *
 * Both flows are exercised via mock deps. The button itself is what
 * we're asserting on here — flow contracts are pinned in
 * newCampaignModal.test.ts (Tauri side) and browserFallback.test.ts
 * (browser side).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mountNewCampaignButton, type NewCampaignButtonDeps } from './newCampaignButton';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

function depsWith(over: Partial<NewCampaignButtonDeps>): NewCampaignButtonDeps {
  return {
    isTauri: () => true,
    openTauriFlow: vi.fn().mockResolvedValue(undefined),
    openBrowserFlow: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('mountNewCampaignButton', () => {
  test('renders a button with data-role="new-campaign"', () => {
    mountNewCampaignButton(host, depsWith({}));
    const btn = host.querySelector('button[data-role="new-campaign"]');
    expect(btn).not.toBeNull();
    expect(btn!.textContent ?? '').toMatch(/New Campaign/i);
  });

  test('Tauri branch: click calls openTauriFlow exactly once', () => {
    const openTauriFlow = vi.fn().mockResolvedValue(undefined);
    const openBrowserFlow = vi.fn().mockResolvedValue(undefined);
    mountNewCampaignButton(host, depsWith({ isTauri: () => true, openTauriFlow, openBrowserFlow }));
    (host.querySelector('button[data-role="new-campaign"]') as HTMLButtonElement).click();
    expect(openTauriFlow).toHaveBeenCalledTimes(1);
    expect(openBrowserFlow).not.toHaveBeenCalled();
  });

  test('Browser branch: click calls openBrowserFlow exactly once', () => {
    const openTauriFlow = vi.fn().mockResolvedValue(undefined);
    const openBrowserFlow = vi.fn().mockResolvedValue(undefined);
    mountNewCampaignButton(
      host,
      depsWith({ isTauri: () => false, openTauriFlow, openBrowserFlow }),
    );
    (host.querySelector('button[data-role="new-campaign"]') as HTMLButtonElement).click();
    expect(openBrowserFlow).toHaveBeenCalledTimes(1);
    expect(openTauriFlow).not.toHaveBeenCalled();
  });

  test('Concurrent clicks do not spawn duplicate flows', async () => {
    let resolveGate: (() => void) | undefined;
    const openTauriFlow = vi.fn().mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveGate = res;
        }),
    );
    mountNewCampaignButton(host, depsWith({ openTauriFlow }));
    const btn = host.querySelector('button[data-role="new-campaign"]') as HTMLButtonElement;
    btn.click();
    btn.click();
    btn.click();
    expect(openTauriFlow).toHaveBeenCalledTimes(1);
    // Once it finishes, a fresh click works again.
    resolveGate?.();
    await Promise.resolve();
    await Promise.resolve();
    btn.click();
    expect(openTauriFlow).toHaveBeenCalledTimes(2);
  });
});
