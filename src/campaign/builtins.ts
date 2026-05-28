/**
 * Built-in campaigns shipped with the game. Phase 9 added the
 * tutorial; Phase 12 adds three sample campaigns (Lighthouse Keepers,
 * Switchyard, Atrium Garden) so the game is playable without
 * `claude` installed.
 *
 * Imports the JSON statically (Vite resolves these at build time).
 * Each entry is the raw JSON; `parseCampaign` validates on use.
 */

import alchemyJson from '../../campaigns/alchemy-demo.json';
import tutorialJson from '../../campaigns/tutorial.json';
import twoActJson from '../../campaigns/two-act.json';
import lighthouseJson from '../../campaigns/samples/lighthouse-keepers.json';
import switchyardJson from '../../campaigns/samples/switchyard.json';
import atriumJson from '../../campaigns/samples/atrium-garden.json';

export interface BuiltInCampaign {
  readonly id: string;
  readonly displayName: string;
  readonly manifest: unknown;
}

export const BUILT_IN_CAMPAIGNS: readonly BuiltInCampaign[] = [
  {
    id: 'tutorial',
    displayName: "The Apprentice's Manual (tutorial)",
    manifest: tutorialJson,
  },
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
  {
    id: 'sample-lighthouse-keepers',
    displayName: 'Lighthouse Keepers (sample, 1 act)',
    manifest: lighthouseJson,
  },
  {
    id: 'sample-switchyard',
    displayName: 'Switchyard (sample, 1 act)',
    manifest: switchyardJson,
  },
  {
    id: 'sample-atrium-garden',
    displayName: 'Atrium Garden (sample, 1 act)',
    manifest: atriumJson,
  },
];
