/**
 * Built-in campaigns shipped with the game. Phase 9 adds the
 * tutorial; Phase 12 adds 3-5 demo campaigns. For Phase 7 we ship
 * one two-act demo so the harness has something to drive.
 *
 * Imports the JSON statically (Vite resolves these at build time).
 * Each entry is the raw JSON; `parseCampaign` validates on use.
 */

import alchemyJson from '../../campaigns/alchemy-demo.json';
import twoActJson from '../../campaigns/two-act.json';

export interface BuiltInCampaign {
  readonly id: string;
  readonly displayName: string;
  readonly manifest: unknown;
}

export const BUILT_IN_CAMPAIGNS: readonly BuiltInCampaign[] = [
  {
    id: 'demo-two-act',
    displayName: 'The Workshop (demo, 2 acts)',
    manifest: twoActJson,
  },
  {
    id: 'demo-alchemy',
    displayName: 'The Aetherium Distillery (themed, 1 act)',
    manifest: alchemyJson,
  },
];
