# Rule DSL Architecture Memo (Phase 5)

> **Status:** Architect step. Awaiting user review before Coder begins.
> **Cycle:** Full. The DSL parser is the first piece of code that handles untrusted strings (eventually from an LLM). Reviewer runs with fresh context and verifies the explicit "no eval, no Function()" contract.
> **Companion:** [throughline-design.md](../../throughline-design.md) §5 (the `optional_challenges.rule` field); [IMPLEMENTATION_PLAN.md](../../IMPLEMENTATION_PLAN.md) § Phase 5.

This memo locks in the rule DSL's grammar, AST shape, parser/evaluator interfaces, error semantics, fuzz strategy, and stats-panel UI **before** code is written. The Coder step builds against these contracts via strict TDD; the Reviewer step verifies the no-eval invariant with a deliberate violation.

---

## 1. Scope

The DSL evaluates optional-challenge rules from `campaign.json`:

```jsonc
"optional_challenges": [
  { "id": "opt_cycles", "label": "Solve in <40 cycles", "rule": "cycles < 40" },
  { "id": "opt_tiles",  "label": "Use ≤12 tiles",        "rule": "tiles_used <= 12" }
]
```

A rule is a string. It MUST parse to an AST and, when evaluated against per-puzzle stats, MUST return a `boolean`.

**Out of scope:**
- The required win condition (delivery counts). That's the engine's `checkVictory` (Phase 1, already shipped).
- The badge/checkmark UI animations. Phase 6 (audio cues) and beyond can polish.
- LLM-emitted rules at scale. Phase 10 validates each rule at manifest-load time using this DSL.

---

## 2. Threat model (why the no-eval rule matters)

Rules originate in `campaign.json`. Phase 7 validates the manifest's structure with Zod, but the `rule` field is a free-form string. In Phase 10, that string is written by `claude -p` — an LLM. **The rule string must be treated as hostile** for the same reasons narrative text is hostile (memo invariant #6).

Concrete attack avoided by this design:

- An attacker (or a careless LLM) emits a rule like `"window.location='evil';false"`. With `eval` or `new Function`, this would execute arbitrary JS in the player's browser. Our DSL parses the rule into an AST first; the evaluator is a pure function over that AST that knows nothing about the JS runtime.

**Forbidden constructs anywhere under `src/dsl/`:**
- `eval(...)`
- `new Function(...)`, `Function(...)`
- `setTimeout(stringArg, ...)`, `setInterval(stringArg, ...)`
- Any dynamic `import()` of a user-supplied path
- `Reflect.construct` / `Proxy` against runtime-supplied keys

A static-grep test (`src/dsl/__tests__/no-eval.test.ts`, similar to the engine purity test in Phase 1) will be the canary. The reviewer verifies it by adding `eval('1')` in a scratch branch and confirming the test fails.

---

## 3. Grammar (EBNF)

```
expr        = orExpr ;
orExpr      = andExpr  ( "||" andExpr )* ;
andExpr     = cmpExpr  ( "&&" cmpExpr )* ;
cmpExpr     = sumExpr  ( cmpOp sumExpr )? ;
sumExpr     = mulExpr  ( ( "+" | "-" ) mulExpr )* ;
mulExpr     = unary    ( ( "*" | "/" ) unary )* ;
unary       = "!" unary
            | primary ;
primary     = NUMBER
            | IDENT
            | "(" expr ")" ;

cmpOp       = "==" | "!=" | "<" | "<=" | ">" | ">=" ;

IDENT       = "cycles" | "tiles_used" | "agent_count" | "ops_total" ;
NUMBER      = digit+ ;          (* unsigned decimal integers only *)
digit       = "0" ... "9" ;
WHITESPACE  = ( " " | "\t" )+ ;  (* lexer skips between tokens *)
```

### Notes

- **No strings** — there is no string literal in the grammar. The closed identifier set is the only way to reference a value.
- **No function calls** — `primary` admits no `IDENT "(" args ")"` form.
- **No member access** — no `.` operator.
- **No assignment** — no `=` as a producer; only `==` as a comparator.
- **`!=` is `!` followed by `=` in the lexer** — handled by single-token output.
- **Operator precedence** is encoded by the grammar's left-recursive descent (low precedence at the outer rule):
  `||` < `&&` < (`==` `!=` `<` `<=` `>` `>=`) < (`+` `-`) < (`*` `/`) < `!` < primary.
- **`cmpExpr` is non-associative** — `a < b < c` is a parse error (only zero or one cmpOp per cmpExpr). The other binary operators are left-associative.
- **Identifiers are closed** — only the four names listed are valid; any other identifier is a **parse-time** error, not an eval-time error. This is the load-time gate that makes invalid rules fail at puzzle-load, not at the player's first attempt.

### Why integers only?

Phase 5 evaluates rules against `cycles`, `tiles_used`, `agent_count`, `ops_total` — all non-negative integers. Allowing floats opens NaN/Infinity edge cases for negligible gain. If a future rule needs ratios (e.g. `tiles_used / agent_count < 5`), we permit `/` as **integer division** in this grammar: `7 / 2 → 3`. Division by zero is a runtime error handled per §6.

---

## 4. AST

```ts
// src/dsl/ast.ts

export type VarName = 'cycles' | 'tiles_used' | 'agent_count' | 'ops_total';

export type BinOp =
  | '||'
  | '&&'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '+'
  | '-'
  | '*'
  | '/';

export type AST =
  | { readonly kind: 'num'; readonly value: number }
  | { readonly kind: 'var'; readonly name: VarName }
  | {
      readonly kind: 'bin';
      readonly op: BinOp;
      readonly lhs: AST;
      readonly rhs: AST;
    }
  | { readonly kind: 'unary'; readonly op: '!'; readonly arg: AST };
```

Every variant carries `readonly` and the discriminating `kind` field. The AST is immutable.

`VarName` is a string-literal union — TS narrowing at parse time guarantees the evaluator never sees an unknown identifier.

---

## 5. Module layout

```
src/dsl/
├── lexer.ts          # string → Token[]
├── parser.ts         # Token[] → AST
├── ast.ts            # AST type + BinOp + VarName
├── evaluator.ts      # AST + Context → boolean | number | EvalError
├── errors.ts         # RuleParseError, RuleEvalError classes
├── index.ts          # public barrel: parseRule, evaluateRule, types
└── __tests__/
    ├── lexer.test.ts
    ├── parser.test.ts
    ├── evaluator.test.ts
    ├── fuzz.test.ts        # fast-check: 10 000 random strings → never throws unexpectedly
    └── no-eval.test.ts     # static-grep canary
```

Phase 7's manifest loader imports `parseRule` to validate every `optional_challenges[].rule` string at load time. Phase 5's completion detector calls `evaluateRule` per challenge after a successful run.

---

## 6. Lexer

```ts
// src/dsl/lexer.ts

export type Token =
  | { kind: 'NUMBER'; value: number; offset: number }
  | { kind: 'IDENT'; name: string; offset: number }    // unvalidated name
  | { kind: 'OP'; op: string; offset: number }         // raw operator string
  | { kind: 'LPAREN'; offset: number }
  | { kind: 'RPAREN'; offset: number }
  | { kind: 'EOF'; offset: number };

export function tokenize(input: string): Token[];      // throws RuleParseError
```

### Lexing rules

- Skip whitespace (` `, `\t`) between tokens.
- Digits → `NUMBER`. Leading `0` is allowed (`007` is the integer 7); the engine doesn't care about source notation.
- A letter or underscore starts an `IDENT` (`/[a-zA-Z_][a-zA-Z0-9_]*/`). The lexer does **not** validate identifier membership — the parser does.
- Operator characters: `<`, `<=`, `>`, `>=`, `==`, `!=`, `!`, `&&`, `||`, `+`, `-`, `*`, `/`. The lexer must prefer **longest match** — `<=` before `<`, `&&` before `&`. A bare `&` or `|` is a `RuleParseError`.
- Parentheses → `LPAREN` / `RPAREN`.
- End of input → exactly one `EOF` token.
- Any other character → throw `RuleParseError` with an offset pointer.

The lexer is total — it either returns a `Token[]` ending in `EOF` or throws `RuleParseError`. It never returns an empty list.

---

## 7. Parser

```ts
// src/dsl/parser.ts
export function parse(tokens: Token[]): AST;          // throws RuleParseError
```

Recursive-descent matching the grammar in §3. The parser:

- Validates identifier membership against `VarName` at parse time; unknown identifiers throw `RuleParseError`.
- Requires an `EOF` token at the end of `expr`; trailing tokens throw `RuleParseError` ("unexpected token after expression").
- Tracks the token offset in errors so a future editor can underline the offending span.

`parseRule(input: string): AST` in `index.ts` composes lexer + parser.

---

## 8. Evaluator

```ts
// src/dsl/evaluator.ts

export interface RuleContext {
  readonly cycles: number;
  readonly tiles_used: number;
  readonly agent_count: number;
  readonly ops_total: number;
}

/**
 * Evaluates an AST against a context.
 *
 * Returns `boolean` at the root for any rule that PARSES at the
 * boolean level (e.g. `cycles < 40`). Returns `number` for purely
 * arithmetic ASTs (`cycles + 1`). The public `evaluateRule()`
 * wrapper enforces that the root must be boolean — see §10.
 */
export function evaluate(ast: AST, ctx: RuleContext): boolean | number;
```

### Operator semantics

| Op | Operand types | Result | Notes |
|---|---|---|---|
| `\|\|`, `&&` | bool, bool | bool | Short-circuit |
| `==`, `!=` | (num, num) or (bool, bool) | bool | Mixed type → eval error |
| `<`, `<=`, `>`, `>=` | num, num | bool | Mixed type → eval error |
| `+`, `-`, `*` | num, num | num | JS `+` semantics on ints |
| `/` | num, num | num | **Integer** division: `Math.trunc(a / b)`. `b === 0` → eval error |
| `!` | bool | bool | Type mismatch → eval error |

### Type errors

A type mismatch — e.g. `5 + true`, `cycles && 4` — is an **evaluation error**, not a parse error. The grammar doesn't track types; the evaluator does. Type errors translate to "rule fails closed" at the public boundary (§10).

### Determinism

The evaluator is a pure function over `(AST, RuleContext)`. No `Math.random`, no `Date.now`, no IO. Equal inputs produce equal outputs.

---

## 9. Errors

```ts
// src/dsl/errors.ts

export class RuleParseError extends Error {
  readonly kind = 'parse' as const;
  constructor(message: string, readonly offset: number) {
    super(message);
    this.name = 'RuleParseError';
  }
}

export class RuleEvalError extends Error {
  readonly kind = 'eval' as const;
  constructor(message: string) {
    super(message);
    this.name = 'RuleEvalError';
  }
}
```

Errors are **typed** so the completion-detector / UI layer can branch on `err.kind === 'parse'` vs `'eval'` without string-matching.

The lexer and parser throw `RuleParseError`. The evaluator throws `RuleEvalError`. Anything else escaping these modules is a bug and must fail loud.

---

## 10. Public API

```ts
// src/dsl/index.ts

export { type AST, type VarName, type BinOp } from './ast';
export { type RuleContext } from './evaluator';
export { RuleParseError, RuleEvalError } from './errors';

/** Parse + validate a rule string. Throws RuleParseError on invalid input. */
export function parseRule(input: string): AST;

/**
 * Parse + evaluate. Returns true / false for the optional challenge.
 *
 * "Fails closed" policy:
 *   - Parse error  → throws RuleParseError (caller decides; Phase 7
 *                    loader rejects the manifest)
 *   - Eval error   → returns `false` (challenge not earned). Players
 *                    never see a runtime "rule evaluation failed"
 *                    surface; the challenge just doesn't unlock.
 *   - Non-boolean root → throws RuleParseError at parse time? No —
 *                    detected at evaluate time and returns false.
 *                    Reasoning: declaring "root must be boolean" at
 *                    parse time would require a static type analysis
 *                    of arithmetic operators across the AST; for the
 *                    small set of allowed ops, dynamic detection at
 *                    the root is simpler and equally safe.
 */
export function evaluateRule(input: string, ctx: RuleContext): boolean;
```

Phase 7 calls `parseRule(rule)` per `optional_challenges` entry and rejects the manifest if any throws. Phase 5's completion detector calls `evaluateRule` post-victory.

---

## 11. Failure mode coverage (parser)

The reviewer's "rejects every malformed input class" check translates to these explicit test classes (each gets a unit + targeted fuzz coverage):

1. **Lexer-rejected**: unknown characters (`@`, `#`, `;`, emoji), bare `&` or `|`, unterminated literals.
2. **Empty input** — `""` and `"   "` → parse error.
3. **Unbalanced parens** — `"(1"`, `"1)"`, `"((1)"`.
4. **Missing operand** — `"1 +"`, `"+ 1"`, `"1 < "`.
5. **Trailing tokens** — `"1 + 2 3"`, `"1 + 2 garbage"`.
6. **Unknown identifier** — `"x < 5"`, `"foo == 0"`, `"Cycles < 5"` (case-sensitive).
7. **Non-associative comparator chains** — `"1 < 2 < 3"` is a parse error.
8. **Operator typos** — `"1 = 2"` (single `=`), `"1 << 2"` (no such op), `"1 *= 2"`.

The fuzz test generates 10 000 random strings of length 0–40 over an alphabet that mixes valid and invalid characters; assertion: for every input, `parseRule` either returns an `AST` or throws a `RuleParseError`. It never throws a different error class, never returns undefined, never hangs (test harness wraps each call in a 100ms timeout).

---

## 12. Per-puzzle stats panel

`src/completion/dom/resultsPanel.ts` renders on the `finished` event from Phase 4's animator. Shape:

```
┌─ Results ──────────────────────────────┐
│ ✅ Victory                              │
│                                         │
│ cycles:        12                       │
│ tiles_used:    7                        │
│ agent_count:   1                        │
│ ops_total:     8                        │
│                                         │
│ Optional challenges:                    │
│  ☑ Solve in <40 cycles                  │
│  ☐ Use ≤12 tiles                        │
└─────────────────────────────────────────┘
```

### Construction

- All text goes via `textContent` — never `innerHTML`. The challenge labels come from `campaign.json` and are LLM-controlled.
- The checkbox icon is drawn from a fixed glyph set; no user-controlled glyph.
- Each row's check state comes from `evaluateRule(challenge.rule, ctx)`. Rules that throw `RuleParseError` should never reach this stage (Phase 7 rejected the manifest); we still defensively render an X with no special UI.

### Trigger

Phase 5 wires:

```ts
animator.onUpdate(() => {
  if (animator.status() === 'finished' && animator.haltStatus() === 'victory') {
    mountResultsPanel(panelEl, puzzle, computeStats(puzzle, solution, trace));
  }
});
```

The detector computes `RuleContext` once per finished run; the panel calls `evaluateRule` per challenge.

---

## 13. Test plan (matches plan's Phase 5 Coder list)

Concrete test files / coverage:

| File | What it covers |
|---|---|
| `lexer.test.ts` | Each token class; whitespace; longest-match operators; rejection of unknown chars; offset tracking. |
| `parser.test.ts` | One happy + one rejection case per grammar production; precedence (`1 + 2 * 3` → `1 + (2*3)`); associativity; non-associative cmpExpr. |
| `evaluator.test.ts` | Every AST kind; div-by-zero; type-error returns; short-circuit `||`/`&&`; root-must-be-boolean enforced. |
| `fuzz.test.ts` | 10 000 random strings → never throws unexpected error class. |
| `no-eval.test.ts` | `src/dsl/` source contains zero matches for `eval(`, `Function(`, `new Function`. |
| `__tests__/dsl.integration.test.ts` | end-to-end: real rules from the design doc's example campaign evaluate correctly against fixed contexts. |
| `__tests__/completion.test.ts` | Detector wires all pieces; passes the right `RuleContext`; produces the expected checkmark pattern. |

---

## 14. Open questions for user review

These are calls where the design doc + plan are open. Each has a recommended answer **in bold**. Please confirm or override before Coder begins.

**Q1. Allow comparison chaining (`1 < x < 5`)?**
- **(a) NO — non-associative cmpExpr.** Recommended. The user can write `1 < x && x < 5` instead. Avoids the ambiguity of "do we mean `(1 < x) < 5` or chained-Python-style?"
- (b) Yes, with chained semantics like Python.

**Q2. Division: integer truncation or rational?**
- **(a) Integer truncation (`Math.trunc`).** Recommended. The variables are all integers; rule authors don't need fractional results. Eliminates NaN/Infinity edge cases.
- (b) Float division → exposes NaN, Infinity, and float-comparison surprises.

**Q3. Division by zero: eval error (returns false at the boundary) or treat as `false`?**
- **(a) Eval error.** Recommended. Surfaces as a non-earned challenge but never as a UI surprise. Bonus: makes the rule `cycles / 0 < 5` a parse-OK / eval-fail outcome — caught by the eval-error path, never by an exception bubbling to the renderer.
- (b) Define `n / 0 = 0`. Less surprising for the rule author but quietly wrong.

**Q4. Identifier case sensitivity.**
- **(a) Case-sensitive: only the lowercase names listed.** Recommended. Simpler grammar; rule authors copy-paste from the design doc anyway.
- (b) Case-insensitive: `Cycles` is the same as `cycles`. Adds normalization complexity.

**Q5. Numbers: signed?**
- **(a) Lexer produces unsigned numbers; `-x` is the unary not-quite-minus.** Wait — my grammar doesn't have unary minus. Let me revise: **add unary `-` to `unary`** so `-5 < 0` works. Or **(a) just allow `0 - x` instead** and reject `-5` as a parse error. The latter is simpler but slightly hostile to authors.
  - **Recommended: add unary `-` to `unary`** (small grammar tweak: `unary = ("!"|"-") unary | primary`). The reviewer can verify it doesn't open security holes.

**Q6. Should `parseRule` throw on a non-boolean root, or only at `evaluateRule` time?**
- **(a) Throw at evaluate time, return false from `evaluateRule`.** Recommended per §10's "fails closed" policy.
- (b) Reject at parse time. Would need a small type-inference pass on the AST. Cleaner contract; more code.

**Q7. Stats panel placement during playback.**
- **(a) Bottom-stack panel under the canvas, shown only after `finished` + `victory`.** Recommended. Matches the design doc's "On success: badge appears" beat.
- (b) Sidebar permanently visible during playback, updating live (`cycles` ticks up as the animation runs). More information density; more UI complexity.

---

## 15. What this phase does NOT do

- Hot-reload of rules. The manifest is loaded once; rules are parsed once at load time.
- A rule editor in the UI. Rules are produced by Phase 10's CLI; players don't author them.
- Mathematical functions (`min`, `max`, `abs`). Not in the design doc's `optional_challenges` use case.
- Multi-line rules / comments. Single-expression strings only.

---

**Awaiting user review of §14 open questions before starting the Coder step.**
