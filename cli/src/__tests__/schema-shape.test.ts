// @vitest-environment node
/**
 * Schema shape introspection (architect doc §12).
 *
 * Mechanically asserts that every `ZodObject` in the campaign schema
 * tree has `unknownKeys === 'strict'`, and every `ZodString` has a
 * `.max(...)` check. Approximates "no open object, no unbounded
 * string"; reviewer-falsifiable by adding `z.object({ x: z.string() })`
 * (no .max) to the schema and confirming this test fails.
 */

import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { CampaignSchema } from '../../../src/schema/campaign';

interface Offender {
  path: string;
  reason: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inspect(schema: any, path: string, offenders: Offender[]): void {
  if (!schema || typeof schema !== 'object') return;
  // Unwrap ZodOptional / ZodNullable / ZodDefault / ZodBranded etc.
  const def = schema._def;
  if (!def) return;
  const tn: string = def.typeName ?? '';

  if (tn === 'ZodObject') {
    const unknownKeys = def.unknownKeys ?? 'strip';
    if (unknownKeys !== 'strict') {
      offenders.push({ path, reason: `ZodObject not strict (unknownKeys=${unknownKeys})` });
    }
    const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
    for (const [k, v] of Object.entries(shape ?? {})) {
      inspect(v, `${path}.${k}`, offenders);
    }
    return;
  }
  if (tn === 'ZodString') {
    const checks: { kind?: string }[] = def.checks ?? [];
    const hasMax = checks.some((c) => c.kind === 'max');
    const hasRegex = checks.some((c) => c.kind === 'regex');
    // A regex check is acceptable in place of a max (it bounds the
    // shape structurally), but we still prefer an explicit max.
    if (!hasMax && !hasRegex) {
      offenders.push({ path, reason: 'ZodString has neither .max() nor .regex()' });
    }
    return;
  }
  if (tn === 'ZodArray') {
    inspect(def.type, `${path}[]`, offenders);
    return;
  }
  if (tn === 'ZodOptional' || tn === 'ZodNullable' || tn === 'ZodReadonly') {
    inspect(def.innerType, path, offenders);
    return;
  }
  if (tn === 'ZodEffects' || tn === 'ZodBranded') {
    inspect(def.schema ?? def.type, path, offenders);
    return;
  }
  if (tn === 'ZodRecord') {
    inspect(def.keyType, `${path}{key}`, offenders);
    inspect(def.valueType, `${path}{value}`, offenders);
    return;
  }
  if (tn === 'ZodTuple') {
    for (let i = 0; i < (def.items?.length ?? 0); i++) {
      inspect(def.items[i], `${path}[${i}]`, offenders);
    }
    return;
  }
  if (tn === 'ZodUnion' || tn === 'ZodDiscriminatedUnion') {
    const opts = def.options ?? [];
    for (let i = 0; i < opts.length; i++) inspect(opts[i], `${path}|${i}`, offenders);
    return;
  }
  // Numbers, booleans, literals, enums, void/null/never — fine.
}

describe('schema shape introspection', () => {
  test('every ZodObject in CampaignSchema is strict', () => {
    const offenders: Offender[] = [];
    inspect(CampaignSchema as unknown as z.ZodTypeAny, '<root>', offenders);
    const nonStrict = offenders.filter((o) => o.reason.startsWith('ZodObject'));
    if (nonStrict.length > 0) {
      throw new Error(
        `Open ZodObjects in campaign schema:\n` +
          nonStrict.map((o) => `  ${o.path}: ${o.reason}`).join('\n'),
      );
    }
    expect(nonStrict).toEqual([]);
  });

  test('every ZodString in CampaignSchema has a .max() or .regex() check', () => {
    const offenders: Offender[] = [];
    inspect(CampaignSchema as unknown as z.ZodTypeAny, '<root>', offenders);
    const unbounded = offenders.filter((o) => o.reason.startsWith('ZodString'));
    if (unbounded.length > 0) {
      throw new Error(
        `Unbounded strings in campaign schema:\n` +
          unbounded.map((o) => `  ${o.path}: ${o.reason}`).join('\n'),
      );
    }
    expect(unbounded).toEqual([]);
  });
});
