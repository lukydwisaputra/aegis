# Pre-gate Lint (`aegis lint`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before Gate 2 or Gate 3 opens, a deterministic lint reads the customer-facing run files and blocks the gate on the mechanical problems the owner kept finding by rejecting: QA-process wording, internal task ids, a mention of manual testing in an automated-only run, and personal data (NRIC, email, phone, a person's name) that could be real.

**Architecture:** Pure scanners (`scanText`, `scanPii`) in `packages/@qa/run-state/src/lint/`, driven by default rules plus the project's `aegis.config.json#reportRules`. `runLint` collects the customer-facing files of a run, scans their text (Markdown as text, JSON string values only, never keys), writes `reports/lint/gate-{G}.json` and records `lint.completed`. `openGate` runs it and refuses to open the gate on any `error`. The orchestrator runs `aegis lint --gate` first and sends each finding to the agent that wrote the file.

**Tech Stack:** TypeScript, jest (`__internal-tests__`), commander (`apps/cli`).

**Spec:** `docs/superpowers/specs/2026-10-14-lighter-framework-design.md` (section "Item 1", with the owner decisions of 2026-10-14).

## Global Constraints

- Owner decisions: a failed lint **blocks** the gate; the word rules start from the words the owner already rejected, applied **in context** (never a bare word); the PII rules cover NRIC, full name, email and phone, and allow only data that cannot be real.
- A value is allowed as "cannot be real" only when it is guaranteed so: an NRIC whose check letter is wrong (it cannot exist), an email on a domain reserved by RFC 2606 / RFC 6761 (`example.com`, `example.net`, `example.org`, any `.test`, `.example`, `.invalid`, `.localhost`), a masked value. A phone number is allowed only when it matches a pattern the project declares in `reportRules.pii.syntheticPhonePatterns` (no published Singapore range is reserved for tests; see the spec's open item).
- The scan never prints a full real-looking value back: findings show the rule, the file, the line and a context window in which the matched value is masked.
- No LLM in the loop: same input, same findings, same order (files sorted, lines ascending).
- Gate: `pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align` stay green; the align ratchet (207) does not grow.

## Review Focus

- "Cycle" as a domain word (`discharge cycle`, `multi-cycle`, `billing cycle`) must pass; `this cycle`, `the cycle took 36.7 hours`, `**Cycle:** full` must fail.
- A phrase inside an inline code span, a fenced block, a double-quoted requirement, or a JSON key (`cycleDate`) must pass.
- A masked NRIC (`S****567D`) and a partial one (`567D`) must pass; `S1234567D` (valid checksum) must fail; `S1234567A` (wrong check letter) must pass.
- `qa+1@example.com` passes; `tan.ah.kow@gmail.com` and an unreserved company domain fail unless declared.
- A project that sets `testing.manualBudgetPercent` above 0 must not get the manual-testing finding.
- A `reportRules.allow` entry silences exactly the phrase it names and nothing else; a `disable` entry removes a whole rule.
- A file that is not valid JSON or not UTF-8: skipped and listed, the lint still completes.

---

### Task 1: Read `reportRules` from `aegis.config.json`

**Files:**
- Modify: `packages/@qa/run-state/src/config.ts` (`RunConfig`, `readRunConfig`)
- Test: `__internal-tests__/report-rules-config.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export interface ReportRuleSpec { id: string; pattern: string; flags?: string; message: string; severity?: "error" | "warning" }
  export interface ReportRules {
    extend: ReportRuleSpec[];        // rules added to the defaults
    disable: string[];               // default rule ids switched off
    allow: string[];                 // phrases that are never reported (matched case-insensitively against the matched text and its 40-character neighbourhood)
    pii: { syntheticEmailDomains: string[]; syntheticNamePrefixes: string[]; syntheticPhonePatterns: string[] };
  }
  // RunConfig gains: reportRules: ReportRules; manualBudgetPercent: number | null
  ```

- [ ] **Step 1: Write the failing test**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { readRunConfig } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
afterEach(() => t.cleanup());
beforeEach(() => { t = makeAegisRoot(); });
const set = (extra: object) => {
  const f = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), ...extra }));
};

describe('reportRules', () => {
  it('defaults to empty rules and the default synthetic markers', () => {
    expect(readRunConfig(t.root).reportRules).toEqual({
      extend: [], disable: [], allow: [],
      pii: { syntheticEmailDomains: [], syntheticNamePrefixes: ['QA', 'Test', 'E2E', 'Dummy', 'Sample'], syntheticPhonePatterns: [] },
    });
  });

  it('reads the project rules and the manual budget', () => {
    set({
      reportRules: { extend: [{ id: 'no-sprint', pattern: '\\bsprint \\d+\\b', message: 'name the build, not the sprint' }], disable: ['qa-round'], allow: ['discharge cycle'],
        pii: { syntheticEmailDomains: ['qa.werkdone.example'], syntheticPhonePatterns: ['^\\+65 ?0\\d{7}$'] } },
      testing: { manualBudgetPercent: 0 },
    });
    const c = readRunConfig(t.root);
    expect(c.reportRules.extend[0]).toMatchObject({ id: 'no-sprint', severity: 'error' });
    expect(c.reportRules.disable).toEqual(['qa-round']);
    expect(c.reportRules.pii.syntheticEmailDomains).toEqual(['qa.werkdone.example']);
    expect(c.manualBudgetPercent).toBe(0);
  });

  it('refuses a rule with an invalid pattern, a duplicate id, or a wrong type', () => {
    set({ reportRules: { extend: [{ id: 'bad', pattern: '(', message: 'x' }] } });
    expect(() => readRunConfig(t.root)).toThrow(/reportRules.extend\[0\].pattern is not a valid regular expression/);
    set({ reportRules: { extend: [{ id: 'a', pattern: 'x', message: 'm' }, { id: 'a', pattern: 'y', message: 'm' }] } });
    expect(() => readRunConfig(t.root)).toThrow(/reportRules.extend: id "a" is listed twice/);
    set({ reportRules: { allow: 'discharge cycle' } });
    expect(() => readRunConfig(t.root)).toThrow(/reportRules.allow must be a list of strings/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd __internal-tests__ && npx jest report-rules-config`
Expected: FAIL (`reportRules` is undefined).

- [ ] **Step 3: Implement**

In `config.ts`, add the interfaces above, the default `DEFAULT_SYNTHETIC_NAME_PREFIXES = ["QA", "Test", "E2E", "Dummy", "Sample"]`, and a `reportRules(value: unknown): ReportRules` function modelled on `intakeReferences` in the same file (it already shows the validation style: `RunStateError("invalid-input", "aegis.config.json#reportRules.… ")`). Rules for each part: `extend` is a list of objects with a non-empty string `id`, a `pattern` that `new RegExp(pattern, flags ?? "i")` accepts (else `reportRules.extend[${i}].pattern is not a valid regular expression`), a string `message`, optional `severity` of `error|warning` (default `error`); ids unique (`reportRules.extend: id "${id}" is listed twice`); `disable`, `allow`, `pii.*` are lists of strings (`reportRules.${name} must be a list of strings`); `pii.syntheticNamePrefixes` defaults to the constant when absent; each `syntheticPhonePatterns` entry must compile. Add `reportRules: reportRules(raw["reportRules"])` and `manualBudgetPercent: typeof testing?.manualBudgetPercent === "number" ? testing.manualBudgetPercent : null` (where `testing = raw["testing"]` is an object) to the object `readRunConfig` returns, and the two fields to `RunConfig`.

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm build && cd __internal-tests__ && npx jest report-rules-config`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src/config.ts __internal-tests__/report-rules-config.test.ts
git commit -m "feat(config): reportRules and manualBudgetPercent in the run config"
```

---

### Task 2: The text scanner and the QA-process wording rules

**Files:**
- Create: `packages/@qa/run-state/src/lint/text.ts`, `packages/@qa/run-state/src/lint/rules.ts`
- Test: `__internal-tests__/lint-wording.test.ts` (create)

**Interfaces:**
- Consumes: `ReportRules`, `ReportRuleSpec` (Task 1).
- Produces:
  ```ts
  // text.ts
  export interface Finding { rule: string; severity: "error" | "warning"; file: string; line: number; message: string; context: string }
  export function maskedLines(text: string): Array<{ line: number; text: string }>;   // text with code spans, fenced blocks and double-quoted runs blanked out (same length)
  export function scanWithRules(file: string, text: string, rules: readonly ResolvedRule[], allow: readonly string[]): Finding[];
  // rules.ts
  export interface ResolvedRule { id: string; re: RegExp; message: string; severity: "error" | "warning" }
  export function resolveRules(rules: ReportRules, manualBudgetPercent: number | null): ResolvedRule[];
  ```

The default rule ids and patterns (each from a real rejection, see the spec): `qa-cycle`, `qa-round`, `re-verified`, `report-history`, `internal-task-id`, `manual-testing`.

- [ ] **Step 1: Write the failing test**

```ts
import { maskedLines, resolveRules, scanWithRules } from '@qa/run-state';

const rules = (budget: number | null = 0, extra: Partial<Parameters<typeof resolveRules>[0]> = {}) =>
  resolveRules({ extend: [], disable: [], allow: [], pii: { syntheticEmailDomains: [], syntheticNamePrefixes: [], syntheticPhonePatterns: [] }, ...extra }, budget);
const ids = (text: string, r = rules(), allow: string[] = []) => scanWithRules('closure.md', text, r, allow).map((f) => f.rule);

describe('qa-cycle: the QA process, not the application', () => {
  it.each([
    'The cycle took 36.7 hours of wall clock.',
    'None is recorded as fully mitigated by this cycle.',
    '- **Cycle:** full STLC, environment development',
    'Developer-test review ran for real this cycle.',
    'Cycle date: 2026-10-12',
  ])('flags: %s', (line) => expect(ids(line)).toContain('qa-cycle'));

  it.each([
    'from the earlier discharge cycle.',
    "a discharge/readmit history is a real multi-cycle state",
    'the billing cycle closes on the 25th',
    'The `cycleDate` field is a string.',
    'The requirement says "the cycle restarts at midnight".',
  ])('leaves alone: %s', (line) => expect(ids(line)).not.toContain('qa-cycle'));
});

describe('the other default rules', () => {
  it('flags re-verified, the QA round, report history and an internal task id', () => {
    expect(ids('Re-verified as fixed at both layers')).toContain('re-verified');
    expect(ids('Re-confirmed this round per the owner')).toContain('qa-round');
    expect(ids('In round 2 the checks were run again')).toContain('qa-round');
    expect(ids('What changed since the previous version')).toContain('report-history');
    expect(ids('the earlier draft counted 62')).toContain('report-history');
    expect(ids('Re-confirmed (T-execution-11, round 2)')).toContain('internal-task-id');
  });

  it('leaves the application and ordinary words alone', () => {
    expect(ids('health answered 200 before and after the run')).toEqual([]);
    expect(ids('the first round of approvals in the app')).toEqual([]);
    expect(ids('rounding to two decimals')).toEqual([]);
  });

  it('flags a mention of manual testing only when the run is automated-only', () => {
    expect(ids('Manual testing was out of scope.', rules(0))).toContain('manual-testing');
    expect(ids('manual budget and manual categories', rules(0))).toContain('manual-testing');
    expect(ids('Manual testing was out of scope.', rules(10))).toEqual([]);
    expect(ids('Manual testing was out of scope.', rules(null))).toEqual([]);
    expect(ids('The admin uses manual entry of attendance.', rules(0))).toEqual([]);
  });
});

describe('context and project rules', () => {
  it('blanks code spans, fenced blocks and quoted runs but keeps the line numbers', () => {
    const lines = maskedLines('a `this cycle` b\n```\nthis cycle\n```\n"this cycle" c this cycle');
    expect(lines.map((l) => l.text.includes('this cycle'))).toEqual([false, false, false, false, true]);
    expect(lines).toHaveLength(5);
  });

  it('allow silences the named phrase only; disable removes a rule; extend adds one', () => {
    expect(ids('the discharge cycle runs daily; this cycle ended', rules(), ['this cycle'])).toEqual([]);
    expect(ids('this cycle', rules(0, { disable: ['qa-cycle'] }))).toEqual([]);
    const extra = rules(0, { extend: [{ id: 'no-sprint', pattern: '\\bsprint \\d+\\b', flags: 'i', message: 'name the build', severity: 'error' }] });
    expect(ids('done in sprint 14', extra)).toContain('no-sprint');
  });

  it('reports the line number and a context window, once per match', () => {
    const f = scanWithRules('closure.md', 'ok\nthe run is fine\nThe cycle took long', rules(), []);
    expect(f).toEqual([expect.objectContaining({ rule: 'qa-cycle', file: 'closure.md', line: 3, severity: 'error' })]);
    expect(f[0]!.context).toContain('The cycle took long');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd __internal-tests__ && npx jest lint-wording`
Expected: FAIL (`maskedLines` is not exported).

- [ ] **Step 3: Implement `text.ts`**

```ts
export interface Finding {
  rule: string;
  severity: "error" | "warning";
  file: string;
  line: number;
  message: string;
  context: string;
}

/**
 * The lines of `text` with everything that is not the author's own prose blanked out with spaces (so columns and line numbers stay):
 * fenced code blocks, inline code spans, and double-quoted runs (straight or curly) on one line, which is where a requirement or an
 * error message is quoted verbatim.
 */
export function maskedLines(text: string): Array<{ line: number; text: string }> {
  let fenced = false;
  return text.split("\n").map((raw, i) => {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      return { line: i + 1, text: " ".repeat(raw.length) };
    }
    if (fenced) return { line: i + 1, text: " ".repeat(raw.length) };
    const blank = (m: string): string => " ".repeat(m.length);
    return { line: i + 1, text: raw.replace(/`[^`]*`/g, blank).replace(/"[^"\n]*"/g, blank).replace(/“[^”\n]*”/g, blank) };
  });
}

export interface ResolvedRuleLike {
  id: string;
  re: RegExp;
  message: string;
  severity: "error" | "warning";
}

const WINDOW = 40;

/** Every match of every rule, in file order. A match whose neighbourhood contains an `allow` phrase is dropped. */
export function scanWithRules(file: string, text: string, rules: readonly ResolvedRuleLike[], allow: readonly string[]): Finding[] {
  const originals = text.split("\n");
  const findings: Finding[] = [];
  const allowLower = allow.map((a) => a.toLowerCase());
  for (const { line, text: masked } of maskedLines(text)) {
    for (const rule of rules) {
      const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : `${rule.re.flags}g`);
      for (let m = re.exec(masked); m !== null; m = re.exec(masked)) {
        if (m[0] === "") { re.lastIndex++; continue; }
        const orig = originals[line - 1] ?? "";
        const near = orig.slice(Math.max(0, m.index - WINDOW), m.index + m[0].length + WINDOW).toLowerCase();
        if (allowLower.some((a) => near.includes(a))) continue;
        findings.push({ rule: rule.id, severity: rule.severity, file, line, message: rule.message, context: orig.slice(Math.max(0, m.index - WINDOW), m.index + m[0].length + WINDOW).trim() });
      }
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}
```

- [ ] **Step 4: Implement `rules.ts`**

```ts
import type { ReportRules } from "../config.js";
import type { ResolvedRuleLike } from "./text.js";

export type ResolvedRule = ResolvedRuleLike;

const QA_PROCESS = "this describes how the QA work was run, not the application: say what was tested, on which build, in which test window";

/** The rules every project starts with, each from a real gate rejection (spec, "Item 1"). Patterns look at the words around the word. */
function defaultRules(manualBudgetPercent: number | null): ResolvedRule[] {
  const rule = (id: string, pattern: string, message: string): ResolvedRule => ({ id, re: new RegExp(pattern, "i"), message, severity: "error" });
  const rules: ResolvedRule[] = [
    rule("qa-cycle", String.raw`\b(?:this|the|that|current|previous|last|next|whole|full|entire|same)\s+(?:(?:test|qa|testing)\s+)?cycle\b|\bcycle\s+(?:took|ran|used|date)\b|^\s*[-*]?\s*\**cycle\**\s*:`, `"cycle" for the QA run: ${QA_PROCESS} (use "test window" or "run")`),
    rule("qa-round", String.raw`\b(?:this|that|previous|last|next|first|second|third|final|another)\s+round\b|\bround\s+\d+\b`, `"round" for a QA pass: ${QA_PROCESS}`),
    rule("re-verified", String.raw`\bre-?verified\b`, `write "re-tested": "re-verified" is not the customer-facing word`),
    rule("report-history", String.raw`\b(?:prior|previous|earlier|first|last)\s+(?:draft|version|figure|count)s?\b|\bsince\s+the\s+previous\s+version\b|\b(?:corrected|changed|updated)\s+from\s+\d`, "a customer report states the final facts only: leave out what an earlier draft or version said"),
    rule("internal-task-id", String.raw`\bT-(?:\d+|[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z][A-Za-z0-9]*)*-\d+|GATE-G\d+)\b`, "an internal task id: name the test case or the defect instead"),
  ];
  // Only a run the owner scoped to automated testing: the mention is a finding, a run with a manual budget may describe it.
  if (manualBudgetPercent === 0) {
    rules.push(rule("manual-testing", String.raw`\bmanual(?:ly)?[\s-]+(?:test(?:s|ing|ed)?|budget|categor(?:y|ies)|execution|required\s+test\s+cases?)\b`, "this run is automated-only: leave out every mention of manual testing"));
  }
  return rules;
}

/** The default rules, minus `disable`, plus the project's `extend`. */
export function resolveRules(rules: ReportRules, manualBudgetPercent: number | null): ResolvedRule[] {
  const off = new Set(rules.disable);
  const base = defaultRules(manualBudgetPercent).filter((r) => !off.has(r.id));
  const extra = rules.extend.map((e): ResolvedRule => ({ id: e.id, re: new RegExp(e.pattern, e.flags ?? "i"), message: e.message, severity: e.severity ?? "error" }));
  return [...base, ...extra];
}
```

Export both from `packages/@qa/run-state/src/index.ts`: `export * from "./lint/text.js"; export * from "./lint/rules.js";`.

- [ ] **Step 5: Run it to see it pass**

Run: `pnpm build && cd __internal-tests__ && npx jest lint-wording`
Expected: PASS. A failing "leaves alone" case means a pattern is too wide: narrow the pattern, never add the phrase to a default allow list. The rule ids and messages are the contract the agents see.

- [ ] **Step 6: Commit**

```bash
git add packages/@qa/run-state/src/lint packages/@qa/run-state/src/index.ts __internal-tests__/lint-wording.test.ts
git commit -m "feat(lint): context-aware wording rules from the owner's gate rejections"
```

---

### Task 3: Personal data that could be real

**Files:**
- Create: `packages/@qa/run-state/src/lint/pii.ts`
- Test: `__internal-tests__/lint-pii.test.ts` (create)

**Interfaces:**
- Consumes: `Finding`, `maskedLines` (Task 2); `ReportRules["pii"]` (Task 1).
- Produces:
  ```ts
  export function validNric(nric: string): boolean;            // checksum only
  export function scanPii(file: string, text: string, pii: ReportRules["pii"]): Finding[];   // rules: pii-nric, pii-email, pii-phone, pii-name (all severity error)
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { scanPii, validNric } from '@qa/run-state';

const pii = { syntheticEmailDomains: [], syntheticNamePrefixes: ['QA', 'Test', 'E2E', 'Dummy', 'Sample'], syntheticPhonePatterns: [] };
const rules = (text: string, p = pii) => scanPii('closure.md', text, p).map((f) => f.rule);

describe('validNric (checksum)', () => {
  it.each(['S1234567D', 'T0123456G', 'F1234567N', 'G1234567X', 'M1234567K', 'M1234521J'])('%s is valid', (n) => expect(validNric(n)).toBe(true));
  it.each(['S1234567A', 'T0123456A', 'M1234521M', 'S123456D', 'X1234567D'])('%s is not', (n) => expect(validNric(n)).toBe(false));
});

describe('NRIC', () => {
  it('a valid one is an error, a masked or partial one and a wrong check letter pass', () => {
    expect(rules('Volunteer S1234567D logged in')).toEqual(['pii-nric']);
    expect(rules('Volunteer S****567D logged in')).toEqual([]);
    expect(rules('last digits 567D')).toEqual([]);
    expect(rules('seeded S1234567A (cannot exist)')).toEqual([]);
  });
  it('never prints the value back', () => {
    const [f] = scanPii('closure.md', 'Volunteer S1234567D logged in', pii);
    expect(f!.context).toContain('S****567D');
    expect(f!.context).not.toContain('S1234567D');
  });
});

describe('email', () => {
  it('passes reserved domains and declared ones, fails every other', () => {
    expect(rules('qa+1@example.com and x@mail.example.org and y@host.test and z@a.invalid')).toEqual([]);
    expect(rules('tan.ah.kow@gmail.com')).toEqual(['pii-email']);
    expect(rules('someone@werkdone.com')).toEqual(['pii-email']);
    expect(rules('qa1@qa.werkdone.example', { ...pii, syntheticEmailDomains: ['qa.werkdone.example'] })).toEqual([]);
  });
});

describe('phone', () => {
  it('fails a phone-shaped value unless masked or matching a declared synthetic pattern', () => {
    expect(rules('call +65 9123 4567')).toEqual(['pii-phone']);
    expect(rules('call 91234567')).toEqual(['pii-phone']);
    expect(rules('call 9123****')).toEqual([]);
    expect(rules('call +65 0123 4567', { ...pii, syntheticPhonePatterns: ['^\\+65 ?0\\d{3} ?\\d{4}$'] })).toEqual([]);
  });
  it('does not mistake counts, dates, ids or versions for a phone', () => {
    expect(rules('144 cases, 2026-10-12, TC-ATT-002, build 12345678abc')).toEqual([]);
  });
});

describe('person name', () => {
  it('flags a full name in a name field unless it carries a synthetic marker', () => {
    expect(rules('- **Name:** Tan Ah Kow')).toEqual(['pii-name']);
    expect(rules('Full name: Siti Binte Rahman')).toEqual(['pii-name']);
    expect(rules('- **Name:** QA Test Volunteer 014')).toEqual([]);
    expect(rules('- **Name:** Settings page header')).toEqual([]); // not a person: a label of the application
    expect(rules('Name: ')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd __internal-tests__ && npx jest lint-pii`
Expected: FAIL (`scanPii` is not exported).

- [ ] **Step 3: Implement**

`packages/@qa/run-state/src/lint/pii.ts`:

```ts
import type { ReportRules } from "../config.js";
import { maskedLines, type Finding } from "./text.js";

const WEIGHTS = [2, 7, 6, 5, 4, 3, 2];
const TABLE: Readonly<Record<string, string>> = { S: "JZIHGFEDCBA", T: "JZIHGFEDCBA", F: "XWUTRQPNMLK", G: "XWUTRQPNMLK", M: "XWUTRQPNJLK" };

/** The NRIC/FIN check letter (weights 2765432, offset 4 for T and G, 3 for M). A wrong letter means the number cannot exist. */
export function validNric(nric: string): boolean {
  const m = /^([STFGM])(\d{7})([A-Z])$/.exec(nric.trim().toUpperCase());
  if (m === null) return false;
  const offset = m[1] === "T" || m[1] === "G" ? 4 : m[1] === "M" ? 3 : 0;
  const sum = [...m[2]!].reduce((s, d, i) => s + Number(d) * WEIGHTS[i]!, 0) + offset;
  return TABLE[m[1]!]![sum % 11] === m[3];
}

/** RFC 2606 and RFC 6761: names that are guaranteed never to be registered. */
const RESERVED_DOMAIN = /(?:^|\.)(?:example\.(?:com|net|org)|[^.]+\.(?:test|example|invalid|localhost)|(?:test|example|invalid|localhost))$/i;

const NRIC = /\b[STFGM]\d{7}[A-Z]\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\b/g;
// +65 9123 4567, 6591234567, 91234567, +44 20 7946 0958: a plus-prefixed international number, or 8 digits that start a Singapore number.
const PHONE = /(?<![\w.\-/])(?:\+\d{1,3}[\s-]?\d[\d\s-]{6,12}\d|[3689]\d{3}[\s-]?\d{4}|65[\s-]?[3689]\d{3}[\s-]?\d{4})(?![\w\-/])/g;
const NAME_FIELD = /(?:^|\n)\s*[-*]?\s*\**(?:full\s+)?name\**\s*:\**\s*(.+)$/gim;

const mask = (v: string): string => (v.length <= 4 ? "****" : `${v[0]}${"*".repeat(Math.max(1, v.length - 4))}${v.slice(-3)}`);

/** Personal data that could be real, in a customer-facing file. Allowed: a value that cannot exist, a reserved domain, a declared synthetic form, a masked value. */
export function scanPii(file: string, text: string, pii: ReportRules["pii"]): Finding[] {
  const out: Finding[] = [];
  const phonePatterns = pii.syntheticPhonePatterns.map((p) => new RegExp(p));
  const add = (rule: string, line: number, message: string, context: string): void => void out.push({ rule, severity: "error", file, line, message, context });
  const originals = text.split("\n");
  for (const { line, text: masked } of maskedLines(text)) {
    const orig = originals[line - 1] ?? "";
    const showing = (value: string): string => orig.replace(value, mask(value)).trim().slice(0, 120);
    for (const m of masked.matchAll(NRIC)) if (validNric(m[0])) add("pii-nric", line, "an NRIC or FIN with a valid check letter could be a real person: mask it as S****567D (or 567D)", showing(m[0]));
    for (const m of masked.matchAll(EMAIL)) {
      const domain = m[1]!.toLowerCase();
      if (!RESERVED_DOMAIN.test(domain) && !pii.syntheticEmailDomains.some((d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`))) {
        add("pii-email", line, "an email on a domain that may be real: use a reserved domain (example.com, .test) for test data, or mask it", showing(m[0]));
      }
    }
    for (const m of masked.matchAll(PHONE)) {
      if (!phonePatterns.some((p) => p.test(m[0].trim()))) add("pii-phone", line, "a phone number that may be real: mask it, or declare the project's synthetic pattern in reportRules.pii.syntheticPhonePatterns", showing(m[0]));
    }
  }
  for (const m of text.matchAll(NAME_FIELD)) {
    const value = m[1]!.replace(/\**\s*$/, "").trim();
    const line = text.slice(0, m.index).split("\n").length + (text[m.index!] === "\n" ? 1 : 0);
    const looksLikeAPerson = /^(?:[A-Z][a-z'-]+\s+){1,}[A-Z][a-z'-]+$/.test(value) && !/\b(?:page|login|screen|form|field|button|tab)\b/i.test(value);
    const marked = pii.syntheticNamePrefixes.some((p) => value.toLowerCase().startsWith(p.toLowerCase()));
    if (looksLikeAPerson && !marked) add("pii-name", line, `a full name that could be a real person: use a name that starts with ${pii.syntheticNamePrefixes.slice(0, 3).join(", ")} for test data`, `Name: ${value.split(" ")[0]} ***`);
  }
  return out.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}
```

Export from `index.ts`: `export * from "./lint/pii.js";`.

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm build && cd __internal-tests__ && npx jest lint-pii`
Expected: PASS. If a "does not mistake" case fails, tighten the PHONE pattern; never widen the allow side.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src/lint/pii.ts packages/@qa/run-state/src/index.ts __internal-tests__/lint-pii.test.ts
git commit -m "feat(lint): NRIC, email, phone and name that could be real"
```

---

### Task 4: `runLint`, the `aegis lint` command, the report and the event

**Files:**
- Create: `packages/@qa/run-state/src/lint/run-lint.ts`, `apps/cli/src/commands/lint.ts`
- Modify: `packages/@qa/run-state/src/index.ts`, `packages/@qa/run-state/src/caller.ts` (`CLI_COMMANDS` `"lint.run"`, `OWNER_COMMANDS`, `AGENT_SET_COMMANDS` `["qa-orchestrator"]`, `CLI_RECORDED_TYPES` `"lint.completed"`), `packages/@qa/run-state/src/hook-context.ts` (`CLI_USAGE`), `packages/@qa/contracts/src/events.ts` (schema + union), `packages/@qa/alignment/src/cli-records.ts`, `__internal-tests__/alignment/cli-records.test.ts` (`ENTRY`), `docs/D13-event-bus-spec.md`, `apps/cli/src/program.ts`, `packages/@qa/path-guard/src/guard.ts` (`CLI_ONLY_RUN_GLOBS` + `DYNAMIC_CLI_ONLY`: `reports/lint/`)
- Test: `__internal-tests__/lint-run.test.ts` (create)

**Interfaces:**
- Consumes: `resolveRules`, `scanWithRules` (Task 2), `scanPii` (Task 3), `readRunConfig().reportRules` and `.manualBudgetPercent` (Task 1), `BRAND_CLEAN_RUN_GLOBS`, `TOOLING_CLEAN_RUN_GLOBS`, `matchGlob` (`@qa/path-guard`).
- Produces:
  ```ts
  export interface LintReport { runId: string; gate: "G2" | "G3"; ok: boolean; errors: number; warnings: number; filesScanned: number; skipped: Array<{ file: string; reason: string }>; findings: Finding[] }
  export async function lintRun(root: string, runId: string, gate: string, caller: string, now?: Date): Promise<LintReport>
  export function lintFindings(root: string, runId: string): { filesScanned: number; skipped: LintReport["skipped"]; findings: Finding[] }   // pure read, no write, no event; used by openGate
  ```
- Event: `lint.completed { agent, gate, errors, warnings, report }`, CLI-recorded.

- [ ] **Step 1: Write the failing test**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { busPath, createRun, lintFindings, lintRun, runDir } from '@qa/run-state';
import { readLines } from '@qa/event-bus';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
beforeEach(async () => {
  t = makeAegisRoot();
  const cfg = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), testing: { manualBudgetPercent: 0 } }));
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});
const put = (rel: string, v: string | object) => {
  const f = path.join(runDir(t.root, runId), rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2));
};
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as Record<string, any>);

describe('lintRun', () => {
  it('scans the customer-facing files, ignores the others, and reports the findings in file and line order', async () => {
    put('reports/closure/closure.md', '# Closure\n\nThe cycle took 36 hours.\nVolunteer S1234567D logged in.\n');
    put('defects/DEF-001-AUTH-UI.md', 'Re-verified on the rebuilt environment (T-execution-3).\n');
    put('reports/work/qa-ui-specialist.T-1.1.json', { approach: 'this cycle, T-execution-3' }); // a work report is internal: never scanned
    put('events-notes.md', 'this cycle'); // not under a customer-facing glob
    const r = await lintRun(t.root, runId, 'G3', 'qa-orchestrator');
    expect(r).toMatchObject({ gate: 'G3', ok: false, filesScanned: 2 });
    expect(r.findings.map((f) => `${f.file}:${f.line}:${f.rule}`)).toEqual([
      'defects/DEF-001-AUTH-UI.md:1:internal-task-id',
      'defects/DEF-001-AUTH-UI.md:1:re-verified',
      'reports/closure/closure.md:3:qa-cycle',
      'reports/closure/closure.md:4:pii-nric',
    ]);
    expect(r.errors).toBe(4);
    expect(JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), 'reports/lint/gate-G3.json'), 'utf8')).errors).toBe(4);
    expect(events().find((e) => e.type === 'lint.completed')).toMatchObject({ agent: 'qa-orchestrator', gate: 'G3', errors: 4, warnings: 0 });
  });

  it('scans JSON string values and never a key (cycleDate)', async () => {
    put('reports/closure/closure.json', { cycleDate: '2026-10-12', summary: 'No finding for this cycle', notes: { owner: 'discharge cycle ok' } });
    const r = await lintRun(t.root, runId, 'G3', 'qa-orchestrator');
    expect(r.findings.map((f) => f.rule)).toEqual(['qa-cycle']);
    expect(r.findings[0]!.file).toBe('reports/closure/closure.json');
  });

  it('is ok on a clean run, skips an unreadable JSON and names it', async () => {
    put('reports/closure/closure.md', 'All good. The discharge cycle is covered.\n');
    put('defects/DEF-002-AUTH-UI.json', '{ not json');
    const r = await lintRun(t.root, runId, 'G2', 'qa-orchestrator');
    expect(r).toMatchObject({ ok: true, errors: 0, filesScanned: 1 });
    expect(r.skipped).toEqual([expect.objectContaining({ file: 'defects/DEF-002-AUTH-UI.json' })]);
  });

  it('refuses a gate other than G2 or G3, and any caller but the orchestrator and the owner', async () => {
    await expect(lintRun(t.root, runId, 'G1', 'qa-orchestrator')).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(lintRun(t.root, runId, 'G3', 'qa-ui-specialist')).rejects.toMatchObject({ code: 'caller-forbidden' });
    await expect(lintRun(t.root, runId, 'G3', 'owner')).resolves.toBeDefined();
  });

  it('lintFindings reads only: no report file, no event', () => {
    put('reports/closure/closure.md', 'this cycle');
    expect(lintFindings(t.root, runId).findings).toHaveLength(1);
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'reports/lint'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd __internal-tests__ && npx jest lint-run`
Expected: FAIL (`lintRun` is not exported).

- [ ] **Step 3: Register the event, the command and the caller rows**

Follow the same six touch points as the `env.executed` event (see `packages/@qa/contracts/src/events.ts` `EnvExecutedEventSchema`, `caller.ts` `CLI_RECORDED_TYPES`, `alignment/src/cli-records.ts`, its test `ENTRY`, `docs/D13-event-bus-spec.md`). Schema:

```ts
/** `aegis lint` ran over the customer-facing files before a gate; the report is reports/lint/gate-{G}.json. */
export const LintCompletedEventSchema = EventBase.extend({
  type: z.literal("lint.completed"),
  agent: z.string(),
  gate: z.enum(["G2", "G3"]),
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  report: z.string(),
});
```

`CLI_COMMANDS` += `"lint.run"`; `OWNER_COMMANDS` += `"lint.run"`; `AGENT_SET_COMMANDS["lint.run"] = ["qa-orchestrator"]`; `CLI_USAGE["lint.run"] = "lint --gate G2|G3 [--run <id>]"`; `CLI_RECORDS["lint.run"] = ["lint.completed"]`; test `ENTRY["lint.run"] = "lintRun"`; path-guard: `reports/lint/` is CLI-only.

- [ ] **Step 4: Write `run-lint.ts`**

```ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { BRAND_CLEAN_RUN_GLOBS, TOOLING_CLEAN_RUN_GLOBS, matchGlob } from "@qa/path-guard";
import { appendChained } from "@qa/event-bus";
import { assertCallerAllowed } from "../caller.js";
import { readRunConfig } from "../config.js";
import { RunStateError } from "../errors.js";
import { busPath, runDir } from "../paths.js";
import { readRun } from "../run.js";
import { atomicWrite, iso } from "../util.js";
import { scanPii } from "./pii.js";
import { resolveRules } from "./rules.js";
import { scanWithRules, type Finding } from "./text.js";

export interface LintReport {
  runId: string;
  gate: "G2" | "G3";
  ok: boolean;
  errors: number;
  warnings: number;
  filesScanned: number;
  skipped: Array<{ file: string; reason: string }>;
  findings: Finding[];
}

const CUSTOMER_FACING = [...new Set([...BRAND_CLEAN_RUN_GLOBS, ...TOOLING_CLEAN_RUN_GLOBS, "reports/compliance/**"])];
const TEXT_FILE = /\.(?:md|json)$/;
const MAX_BYTES = 5 * 1024 * 1024;

function walk(dir: string, base: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const rel = relative(base, abs);
    if (rel === "reports/work" || rel === "reports/review" || rel === "reports/lint" || rel === "evidence" || rel === "playwright-output") continue;
    if (statSync(abs).isDirectory()) walk(abs, base, out);
    else out.push(rel);
  }
}

/** A JSON file as text lines: one per string value, keys never included, so a field name such as cycleDate is not prose. */
function jsonStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) jsonStrings(v, out);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) jsonStrings(v, out);
}

/** The findings over the run's customer-facing files; reads only. */
export function lintFindings(root: string, runId: string): { filesScanned: number; skipped: LintReport["skipped"]; findings: Finding[] } {
  const dir = runDir(root, runId);
  const config = readRunConfig(root);
  const rules = resolveRules(config.reportRules, config.manualBudgetPercent);
  const files: string[] = [];
  if (existsSync(dir)) walk(dir, dir, files);
  const findings: Finding[] = [];
  const skipped: LintReport["skipped"] = [];
  let filesScanned = 0;
  for (const rel of files.filter((f) => TEXT_FILE.test(f) && CUSTOMER_FACING.some((g) => matchGlob(g, rel)))) {
    const abs = join(dir, rel);
    if (statSync(abs).size > MAX_BYTES) { skipped.push({ file: rel, reason: "larger than 5 MB" }); continue; }
    let text = readFileSync(abs, "utf-8");
    if (rel.endsWith(".json")) {
      try {
        const strings: string[] = [];
        jsonStrings(JSON.parse(text), strings);
        text = strings.join("\n");
      } catch (e) {
        skipped.push({ file: rel, reason: `not valid JSON: ${(e as Error).message.slice(0, 80)}` });
        continue;
      }
    }
    filesScanned++;
    findings.push(...scanWithRules(rel, text, rules, config.reportRules.allow), ...scanPii(rel, text, config.reportRules.pii));
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return { filesScanned, skipped, findings };
}

export async function lintRun(root: string, runId: string, gate: string, caller: string, now?: Date): Promise<LintReport> {
  assertCallerAllowed(caller, "lint.run");
  if (gate !== "G2" && gate !== "G3") throw new RunStateError("invalid-input", `lint runs before G2 or G3, not ${gate}`);
  readRun(root, runId);
  const { filesScanned, skipped, findings } = lintFindings(root, runId);
  const errors = findings.filter((f) => f.severity === "error").length;
  const report: LintReport = { runId, gate, ok: errors === 0, errors, warnings: findings.length - errors, filesScanned, skipped, findings };
  const rel = `reports/lint/gate-${gate}.json`;
  atomicWrite(join(runDir(root, runId), rel), JSON.stringify(report, null, 2) + "\n");
  await appendChained(
    { type: "lint.completed", ts: iso(now), agent: caller, gate, errors, warnings: report.warnings, report: rel },
    busPath(root, runId),
    { emittedBy: caller, runId }
  );
  return report;
}
```

`apps/cli/src/commands/lint.ts`:

```ts
import { Command, Option } from "commander";
import { lintRun } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function lintCommand(): Command {
  return new Command("lint")
    .description("Check the customer-facing files for QA-process wording and personal data before a gate; a gate does not open while it has errors")
    .addOption(new Option("--gate <g>", "gate").choices(["G2", "G3"]).makeOptionMandatory())
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action(async (o: { gate: string; run?: string }) => {
        const ctx = context();
        const r = await lintRun(ctx.root, runIdFor(ctx, o.run), o.gate, ctx.caller);
        if (!r.ok) process.exitCode = 3;
        return { ...r, findings: r.findings.slice(0, 50), truncated: r.findings.length > 50 };
      })
    );
}
```

Register in `program.ts`; add the `export * from "./lint/run-lint.js";` line to `index.ts`; the `lint` exit code 3 means "lint found errors" (2 stays "refused").

- [ ] **Step 5: Run it to see it pass, then the whole suite**

Run: `pnpm build && cd __internal-tests__ && npx jest lint-run cli-records event-type-drift && cd .. && pnpm test && pnpm typecheck && pnpm aegis align`
Expected: PASS; ratchet unchanged. The agents' prose that mentions `aegis lint` must sit inside a contract `cli:` list or avoid a backticked command (the align checker reads backticked `aegis ...` as a command the file runs).

- [ ] **Step 6: Commit**

```bash
git add packages apps __internal-tests docs
git commit -m "feat(cli): aegis lint over the customer-facing files, with a report and an event"
```

---

### Task 5: The gate does not open while the lint has errors

**Files:**
- Modify: `packages/@qa/run-state/src/gates.ts:47-49` (`openGate`), `.claude/agents/orchestrator/qa-orchestrator.md` (gate steps and Contract `cli:`), `HANDBOOK/04-stlc-walkthrough.md` (one paragraph), `.claude/agents/tier1-phase/qa-closure-reporter.md` and `qa-defect-manager.md` (one sentence: findings are fixed in the source JSON and the file is rewritten, never argued with)
- Test: `__internal-tests__/lint-gate.test.ts` (create)

**Interfaces:**
- Consumes: `lintFindings` (Task 4).
- Produces: `openGate` throws `RunStateError("lint-failed", ...)` for G2 and G3 when `lintFindings` has an `error`; the message lists the first 10 findings as `file:line rule`.

- [ ] **Step 1: Write the failing test**

Use the helpers the existing gate tests use (`__internal-tests__/cli-phase-gate.test.ts` shows how a run is driven to "ready to open G2": copy its setup helper), then:

```ts
it('refuses to open G3 while a customer-facing file has a lint error, and opens it once the file is fixed', async () => {
  await driveToOpenableGate('G3');                                  // the helper copied from cli-phase-gate.test.ts
  put('reports/closure/closure.md', '# Closure\n\nThe cycle took 36 hours.\n');
  await expect(openGate(t.root, runId, 'G3', 'qa-orchestrator')).rejects.toMatchObject({
    code: 'lint-failed',
    message: expect.stringContaining('reports/closure/closure.md:3 qa-cycle'),
  });
  expect(readRun(t.root, runId).gates['G3']).toBeUndefined();
  put('reports/closure/closure.md', '# Closure\n\nThe test window took 36 hours.\n');
  await expect(openGate(t.root, runId, 'G3', 'qa-orchestrator')).resolves.toMatchObject({ status: 'awaiting-gate' });
});

it('warnings do not block', async () => {
  await driveToOpenableGate('G2');
  setConfig({ reportRules: { extend: [{ id: 'soft', pattern: 'maybe', message: 'm', severity: 'warning' }] } });
  put('defects/DEF-001-AUTH-UI.md', 'maybe a defect');
  await expect(openGate(t.root, runId, 'G2', 'qa-orchestrator')).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd __internal-tests__ && npx jest lint-gate`
Expected: FAIL (the gate opens).

- [ ] **Step 3: Block the gate**

In `openGate`, after the `gateTaskPassed` check and before `const ts = iso(now);`:

```ts
    if (gate === "G2" || gate === "G3") {
      const lint = lintFindings(root, runId).findings.filter((f) => f.severity === "error");
      if (lint.length > 0) {
        const shown = lint.slice(0, 10).map((f) => `${f.file}:${f.line} ${f.rule}`).join("; ");
        throw new RunStateError("lint-failed", `gate ${gate} does not open: ${lint.length} lint error(s) in the customer-facing files (${shown}${lint.length > 10 ? "; ..." : ""}). Run aegis lint --gate ${gate} for the detail, fix each in the agent that wrote the file, then open the gate again`);
      }
    }
```

(import `lintFindings` from `./lint/run-lint.js`; add `"lint-failed"` to the error code union in `errors.ts` and to the CLI's code-to-exit-code mapping next to `"barrier"`.)

- [ ] **Step 4: Teach the orchestrator**

In `qa-orchestrator.md`, in the step where it opens G2 and G3: "Before `gate open`, run `AEGIS_AGENT=qa-orchestrator pnpm aegis lint --gate G<N>`. For each finding, reissue the phase of the agent that wrote the file (defects: Triage; closure and compliance: Closure-draft; executive: Executive) with the finding list in the brief; run the lint again; open the gate only when it reports `ok`. A finding is fixed in the source data and the file rewritten; a project exception is not yours to grant (the owner adds it to `reportRules.allow`)." Add `lint.run` to its Contract `cli:` list. In the HANDBOOK walkthrough, one paragraph: what the lint checks and where `reportRules` lives. In the closure reporter and defect manager: one sentence that the lint will refuse the gate on the QA-process words, internal task ids and real-looking personal data, so they never write them.

- [ ] **Step 5: Run the whole gate**

Run: `pnpm build && pnpm test && pnpm typecheck && pnpm test:smoke && pnpm aegis align`
Expected: PASS, ratchet 207. `cli-cycle-e2e.test.ts` drives a whole run: its fixture files must not trip the lint; if one does, fix the fixture text, not the rule.

- [ ] **Step 6: Commit**

```bash
git add packages .claude HANDBOOK __internal-tests
git commit -m "feat(gate): G2 and G3 do not open while the lint has errors"
```

---

## Self-review

- Owner decisions: blocking (Task 5), contextual word rules from the rejected words (Task 2), PII of four kinds with only cannot-be-real data allowed (Task 3), explore reuse is a separate plan (item 4).
- Placeholders: none; every step has code or the exact edit. The `driveToOpenableGate` helper in Task 5 is copied from the named existing test, not invented.
- Types: `Finding`, `ResolvedRule`, `LintReport`, `lintFindings`, `lintRun`, `ReportRules` are used with the same names across tasks.
- Review Focus: cycle in/out of context (Task 2), code span / quote / JSON key (Task 2), masked and wrong-check NRIC (Task 3), reserved vs real email domains (Task 3), manual budget (Task 2), allow/disable (Task 2), unreadable JSON (Task 4).

## What comes after this slice

1. G2 checks that need run data rather than text: no case Blocked for a QA-side cause (`classifyUncovered` already splits it), defect counts agree with the records, an environment re-probe before Execution and before G2, the Scan profile sanity check (`existingTests.count` above zero with an empty `files`).
2. Explore reuse (owner decision 4): `aegis` records the app build identity (target `git` HEAD plus a hash of the uncommitted diff) at run create and at each Explore; a rejection that reopens Requirements or Env-auth keeps Explore completed when the identity is unchanged, unless the owner passes `--reopen-phase explore`.
3. Synthetic data generation rules for the QA factories (so the lint seldom fires): NRIC with a wrong check letter, emails on `example.com` or `.test`, names that start `QA Test`, phones from the project's declared pattern. The environment engineer's contract is the place to state it.
