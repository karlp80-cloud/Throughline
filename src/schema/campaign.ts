/**
 * Zod schema for `campaign.json`.
 *
 * Single source of truth: Phase 7's loader calls `parseCampaign()` on
 * each manifest; Phase 10's CLI calls the same parser on LLM output.
 * Field names match design doc §5 (snake_case in JSON, mapped to
 * camelCase engine types post-validation).
 *
 * Every `.strict()` to reject unknown fields. Every string field has
 * a `.max()` length cap — the LLM is untrusted input.
 */

import { z } from 'zod';
import { parseRule, RuleParseError } from '../dsl';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const Hex = z.string().regex(HEX_COLOR, { message: 'must be a #RRGGBB hex color' });

const Palette = z
  .object({
    bg: Hex,
    surface: Hex,
    fg: Hex,
    muted: Hex,
    accent: Hex,
    success: Hex,
    danger: Hex,
  })
  .strict();

const Theme = z
  .object({
    name: z.string().min(1).max(80),
    setting_summary: z.string().max(400),
    palette: Palette,
    glyphs: z.record(z.string().min(1).max(40), z.string().min(1).max(40)),
    vocabulary: z.record(z.string().min(1).max(20), z.string().min(1).max(40)),
    progression_name: z.string().min(1).max(64).optional(),
  })
  .strict();

const Pos = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

const Direction = z.enum(['N', 'E', 'S', 'W']);

const InputSpec = z
  .object({
    pos: Pos,
    emits: z.array(z.string().min(1).max(40)).min(1).max(8),
    rate: z.number().int().min(1).max(64),
    /** Direction the input auto-ejects cargo. Defaults to 'E'. */
    facing: Direction.optional(),
  })
  .strict();

const OutputSpec = z
  .object({
    pos: Pos,
    required: z
      .array(
        z
          .object({
            type: z.string().min(1).max(40),
            count: z.number().int().min(1).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

const AgentSpec = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,16}$/),
    start_pos: Pos,
    max_ops: z.number().int().min(1).max(64),
  })
  .strict();

const OptionalChallenge = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
    label: z.string().min(1).max(120),
    rule: z.string().min(1).max(200),
  })
  .strict();

const TileKindEnum = z.enum(['conveyor', 'splitter', 'merger', 'filter', 'reactor']);
const OpKindEnum = z.enum(['MOVE', 'GRAB', 'DROP', 'WAIT', 'SENSE']);

const PuzzleSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
    title: z.string().min(1).max(80),
    briefing: z.string().max(800),
    grid: z
      .object({
        w: z.number().int().min(1).max(32),
        h: z.number().int().min(1).max(32),
      })
      .strict(),
    inputs: z.array(InputSpec).min(1).max(8),
    outputs: z.array(OutputSpec).min(1).max(8),
    agents: z.array(AgentSpec).max(8),
    obstacles: z.array(Pos).max(64),
    available_tiles: z.array(TileKindEnum).min(1),
    available_ops: z.array(OpKindEnum).min(1),
    constraints: z
      .object({
        max_tiles: z.number().int().min(0).max(256),
        max_cycles: z.number().int().min(1).max(10000),
      })
      .strict(),
    optional_challenges: z.array(OptionalChallenge).max(8),
  })
  .strict();

const ActSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
    title: z.string().min(1).max(80),
    intro_text: z.string().max(2000),
    outro_text: z.string().max(2000),
    required_completions: z.number().int().min(0).max(16),
    puzzles: z.array(PuzzleSchema).min(1).max(16),
  })
  .strict();

export const CampaignSchema = z
  .object({
    version: z.literal(1),
    seed: z.string().min(1).max(64),
    theme: Theme,
    acts: z.array(ActSchema).min(1).max(8),
    ending: z
      .object({
        good: z.string().max(2000),
        neutral: z.string().max(2000),
      })
      .strict(),
  })
  .strict();

/** The validated, snake_case shape that came out of Zod. */
export type RawCampaign = z.infer<typeof CampaignSchema>;
export type RawPuzzle = z.infer<typeof PuzzleSchema>;
export type RawAct = z.infer<typeof ActSchema>;
export type RawTheme = z.infer<typeof Theme>;

export class CampaignParseError extends Error {
  readonly kind = 'campaign-parse' as const;
  readonly issues: readonly string[];
  constructor(message: string, issues: readonly string[]) {
    super(message);
    this.name = 'CampaignParseError';
    this.issues = issues;
  }
}

/**
 * Parse and fully validate a campaign manifest. Throws
 * CampaignParseError on any structural or rule-DSL failure.
 */
export function parseCampaign(input: unknown): RawCampaign {
  const result = CampaignSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`);
    throw new CampaignParseError(
      `campaign manifest failed validation (${issues.length} issue${issues.length === 1 ? '' : 's'})`,
      issues,
    );
  }
  // Post-Zod: every rule string must parse via the DSL parser.
  // RuleParseError translates to a CampaignParseError so the loader
  // surface stays consistent.
  const ruleIssues: string[] = [];
  for (let a = 0; a < result.data.acts.length; a++) {
    const act = result.data.acts[a]!;
    for (let p = 0; p < act.puzzles.length; p++) {
      const puzzle = act.puzzles[p]!;
      for (let c = 0; c < puzzle.optional_challenges.length; c++) {
        const ch = puzzle.optional_challenges[c]!;
        try {
          parseRule(ch.rule);
        } catch (e) {
          const path = `acts[${a}].puzzles[${p}].optional_challenges[${c}].rule`;
          ruleIssues.push(`${path}: ${e instanceof RuleParseError ? e.message : String(e)}`);
        }
      }
    }
  }
  if (ruleIssues.length > 0) {
    throw new CampaignParseError(
      `${ruleIssues.length} optional challenge rule(s) failed DSL parse`,
      ruleIssues,
    );
  }
  return result.data;
}
