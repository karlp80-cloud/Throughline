/**
 * Campaign state machine. Pure reducer over (state, action, campaign).
 *
 * Save mutation is NOT in the reducer — the harness mutates the save
 * on completion events and calls `writeSave` separately. This keeps
 * the reducer's purity easy to test.
 */

import type { RawCampaign } from '../schema/campaign';
import type { CampaignSave } from './saves';

export type CampaignState =
  | { readonly kind: 'main_menu' }
  | { readonly kind: 'act_intro'; readonly actIndex: number }
  | { readonly kind: 'hub'; readonly actIndex: number }
  | { readonly kind: 'puzzle'; readonly actIndex: number; readonly puzzleIndex: number }
  | { readonly kind: 'act_outro'; readonly actIndex: number }
  | { readonly kind: 'ending' };

export type CampaignAction =
  | { readonly type: 'SELECT_CAMPAIGN' }
  | { readonly type: 'BEGIN_ACT' }
  | { readonly type: 'OPEN_PUZZLE'; readonly puzzleIndex: number }
  | { readonly type: 'LEAVE_PUZZLE' }
  | { readonly type: 'FINISH_ACT' }
  | { readonly type: 'ACT_OUTRO_NEXT' }
  | { readonly type: 'RETURN_TO_MENU' };

export function initialState(): CampaignState {
  return { kind: 'main_menu' };
}

export function reduce(
  state: CampaignState,
  action: CampaignAction,
  campaign: RawCampaign,
): CampaignState {
  switch (action.type) {
    case 'SELECT_CAMPAIGN':
      if (state.kind !== 'main_menu') return state;
      return { kind: 'act_intro', actIndex: 0 };

    case 'BEGIN_ACT':
      if (state.kind !== 'act_intro') return state;
      return { kind: 'hub', actIndex: state.actIndex };

    case 'OPEN_PUZZLE': {
      if (state.kind !== 'hub') return state;
      const act = campaign.acts[state.actIndex];
      if (!act || action.puzzleIndex < 0 || action.puzzleIndex >= act.puzzles.length) return state;
      return { kind: 'puzzle', actIndex: state.actIndex, puzzleIndex: action.puzzleIndex };
    }

    case 'LEAVE_PUZZLE':
      if (state.kind !== 'puzzle') return state;
      return { kind: 'hub', actIndex: state.actIndex };

    case 'FINISH_ACT':
      if (state.kind !== 'hub') return state;
      return { kind: 'act_outro', actIndex: state.actIndex };

    case 'ACT_OUTRO_NEXT': {
      if (state.kind !== 'act_outro') return state;
      const next = state.actIndex + 1;
      if (next >= campaign.acts.length) return { kind: 'ending' };
      return { kind: 'act_intro', actIndex: next };
    }

    case 'RETURN_TO_MENU':
      return { kind: 'main_menu' };
  }
}

/**
 * Whether the player has completed enough puzzles in the current
 * hub's act to "Finish act". The hub UI gates the button on this.
 */
export function canFinishAct(
  state: CampaignState,
  campaign: RawCampaign,
  save: CampaignSave,
): boolean {
  if (state.kind !== 'hub') return false;
  const act = campaign.acts[state.actIndex];
  if (!act) return false;
  const completed = save.progress[act.id]?.completedPuzzleIds.length ?? 0;
  return completed >= act.required_completions;
}

/** Is a given puzzle in the current act marked complete in the save? */
export function isPuzzleComplete(
  campaign: RawCampaign,
  save: CampaignSave,
  actIndex: number,
  puzzleIndex: number,
): boolean {
  const act = campaign.acts[actIndex];
  if (!act) return false;
  const puzzle = act.puzzles[puzzleIndex];
  if (!puzzle) return false;
  return save.progress[act.id]?.completedPuzzleIds.includes(puzzle.id) ?? false;
}

/** Count of optionals earned for a given puzzle (UI badge display). */
export function optionalsEarnedCount(
  campaign: RawCampaign,
  save: CampaignSave,
  actIndex: number,
  puzzleIndex: number,
): number {
  const act = campaign.acts[actIndex];
  if (!act) return 0;
  const puzzle = act.puzzles[puzzleIndex];
  if (!puzzle) return 0;
  return save.progress[act.id]?.optionalsEarned[puzzle.id]?.length ?? 0;
}
