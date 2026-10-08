import { join } from "node:path";
import { type UncoveredCause } from "@qa/contracts";
import { NOT_EXECUTED, readJson, scanChecks, type CheckState } from "./outcomes.js";

/** A cause a keyword rule can assign. not-attempted is never keyword-assigned: it follows from a check having no result file. */
export type KeywordCause = Exclude<UncoveredCause, "not-attempted">;
export type RowCause = UncoveredCause | "other";

export interface CauseRule {
  cause: KeywordCause;
  /** Tested against the result file's note or blocker first, else the origin text of the closure's uncovered row, case-insensitive. */
  pattern: RegExp;
  /** Shown in the row's via, so a reviewer sees which rule fired. */
  label: string;
}

/**
 * Every keyword rule, in one place. The first rule that matches decides, so the order is the priority: an outside constraint
 * (environment) outranks an unclear requirement, which outranks the testing team's own limits. Extend this table, never the code
 * below, when a real row falls through to "other".
 */
export const CAUSE_RULES: readonly CauseRule[] = [
  // Environment: the system under test or its surroundings were not available.
  { cause: "environment", pattern: /schedule[ -]app/i, label: "Schedule App" },
  { cause: "environment", pattern: /(?<![\w./-])503(?![\w/-])/, label: "503" },
  { cause: "environment", pattern: /\b(?:app|service|integration|feed|api|server|provider|webhook|gateway)\b[^.;]{0,30}\bdisconnected|\bdisconnected\b[^.;]{0,20}\b(?:app|service|integration|feed|api|server|provider|webhook|gateway)\b/i, label: "service disconnected" },
  { cause: "environment", pattern: /seed data/i, label: "seed data" },
  { cause: "environment", pattern: /not seeded|organisations? seeded|seeded (?:this |in this )?environment/i, label: "organisation not seeded" },
  { cause: "environment", pattern: /singpass|myinfo/i, label: "Singpass or MyInfo dependency" },
  { cause: "environment", pattern: /commshub.{0,60}deliver|deliver.{0,60}commshub/i, label: "CommsHub delivery dependency" },
  // Requirement gap: the requirement does not say what to assert.
  { cause: "requirement-gap", pattern: /\bnot identified\b/i, label: "requirement not identified" },
  { cause: "requirement-gap", pattern: /\b(?:requirements?|spec(?:ification)?|acceptance criteri(?:on|a))\b[^.;]{0,60}\b(?:unclear|not defined)\b|\b(?:unclear|not defined)\b[^.;]{0,40}\b(?:requirements?|spec(?:ification)?|acceptance criteri(?:on|a))\b/i, label: "requirement unclear or not defined" },
  // Testing side: the testing team's own scope, tooling or time stopped the check.
  { cause: "testing-side", pattern: /dev-covered/i, label: "dev-covered" },
  { cause: "testing-side", pattern: /no qa script/i, label: "no QA script" },
  { cause: "testing-side", pattern: /sandbox-only/i, label: "sandbox-only Playwright policy" },
  { cause: "testing-side", pattern: /harness/i, label: "harness" },
  { cause: "testing-side", pattern: /live-logged-in|leader session|sustained live|live sessions?\b/i, label: "session" },
  { cause: "testing-side", pattern: /live-session|session budget|session-ttl/i, label: "live-session budget" },
  { cause: "testing-side", pattern: /time budget/i, label: "time budget" },
  { cause: "testing-side", pattern: /out of (?:\S+ ){0,3}reach/i, label: "out of reach" },
  { cause: "testing-side", pattern: /live db inspection/i, label: "live DB inspection" },
  { cause: "testing-side", pattern: /mutation score/i, label: "mutation score" },
  { cause: "testing-side", pattern: /testability flag/i, label: "testability flag" },
];

export interface UncoveredRow {
  id: string;
  cause: RowCause;
  /** How the cause was decided: "no result file", "keyword: <label>" (with " (closure origin)" when the text came from the closure's row), "viewport result missing", "no rule matched". */
  via: string;
}

export interface UncoveredByCause {
  environment: number;
  testingSide: number;
  requirementGap: number;
  notAttempted: number;
  other: number;
}

export interface UncoveredRollup {
  /** Sums to blocked + skipped + unknown + notAttempted of the counts of the same coverage.json. */
  byCause: UncoveredByCause;
  /** One row per uncovered check, sorted by id. */
  rows: UncoveredRow[];
}

export const emptyUncovered = (): UncoveredRollup => ({ rows: [], byCause: { environment: 0, testingSide: 0, requirementGap: 0, notAttempted: 0, other: 0 } });

const COUNT_KEY: Readonly<Record<RowCause, keyof UncoveredByCause>> = {
  environment: "environment", "testing-side": "testingSide", "requirement-gap": "requirementGap", "not-attempted": "notAttempted", other: "other",
};

function keywordRule(text: string): CauseRule | undefined {
  return CAUSE_RULES.find((r) => r.pattern.test(text));
}

/** The closure's origin text per uncovered id: a paraphrase of the result files, used only when their own text matches no rule. */
function closureOrigins(runDir: string): Map<string, string> {
  const doc = readJson(join(runDir, "reports", "closure", "closure.json"));
  const list = doc !== null && typeof doc === "object" ? (doc as { uncoveredTestCases?: unknown }).uncoveredTestCases : undefined;
  const out = new Map<string, string>();
  if (!Array.isArray(list)) return out;
  for (const r of list) {
    if (r === null || typeof r !== "object") continue;
    const { id, origin } = r as { id?: unknown; origin?: unknown };
    if (typeof id === "string" && typeof origin === "string" && !out.has(id)) out.set(id, origin);
  }
  return out;
}

/**
 * Pure: the checks that gave no verdict (worst outcome blocked, skipped or undeterminable, or designed with no result file), each
 * with one cause. A check with no result file is not-attempted, and only that is. Any other row takes the first CAUSE_RULES match
 * on the text of its result files (the specialists' own words), else on the closure row's origin text, else testing-side when a
 * scoped viewport has no result, else "other". `checks` may be passed when the caller has already scanned the run. Writes nothing.
 */
export function classifyUncovered(runDir: string, checks: ReadonlyMap<string, CheckState> = scanChecks(runDir)): UncoveredRollup {
  const origins = closureOrigins(runDir);
  const out = emptyUncovered();
  for (const [id, state] of [...checks].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    let row: UncoveredRow;
    if (state.outcome === undefined) {
      row = { id, cause: "not-attempted", via: "no result file" };
    } else if (NOT_EXECUTED.has(state.outcome)) {
      const fromResult = state.texts.length === 0 ? undefined : keywordRule(state.texts.join("\n"));
      const origin = origins.get(id);
      const fromOrigin = fromResult !== undefined || origin === undefined ? undefined : keywordRule(origin);
      if (fromResult !== undefined) row = { id, cause: fromResult.cause, via: `keyword: ${fromResult.label}` };
      else if (fromOrigin !== undefined) row = { id, cause: fromOrigin.cause, via: `keyword: ${fromOrigin.label} (closure origin)` };
      else if (state.missingViewport) row = { id, cause: "testing-side", via: "viewport result missing" };
      else row = { id, cause: "other", via: "no rule matched" };
    } else {
      continue;
    }
    out.rows.push(row);
    out.byCause[COUNT_KEY[row.cause]]++;
  }
  return out;
}
