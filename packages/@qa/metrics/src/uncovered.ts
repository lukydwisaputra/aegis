import { join } from "node:path";
import { UNCOVERED_CAUSES, type UncoveredCause } from "@qa/contracts";
import { readJson, scanChecks } from "./outcomes.js";

/** A cause a keyword rule can assign. not-attempted is never keyword-assigned: it follows from a check having no result file. */
export type KeywordCause = Exclude<UncoveredCause, "not-attempted">;
export type RowCause = UncoveredCause | "other";

export interface CauseRule {
  cause: KeywordCause;
  /** Tested against the origin text of the closure's uncovered row (else the result file's note or blocker), case-insensitive. */
  pattern: RegExp;
  /** Shown in the row's via, so a reviewer sees which rule fired. */
  label: string;
}

/**
 * Every keyword rule, in one place. The first rule that matches decides, so the order is the priority: an outside constraint
 * (environment) outranks an unclear requirement, which outranks the QA team's own limits. Extend this table, never the code
 * below, when a real row falls through to "other".
 */
export const CAUSE_RULES: readonly CauseRule[] = [
  // Environment: the system under test or its surroundings were not available.
  { cause: "environment", pattern: /schedule[ -]app/i, label: "Schedule App" },
  { cause: "environment", pattern: /\b503\b/, label: "503" },
  { cause: "environment", pattern: /disconnected/i, label: "disconnected" },
  { cause: "environment", pattern: /seed data/i, label: "seed data" },
  { cause: "environment", pattern: /not seeded|organisations? seeded|seeded (?:this |in this )?environment/i, label: "organisation not seeded" },
  { cause: "environment", pattern: /singpass|myinfo/i, label: "Singpass or MyInfo dependency" },
  { cause: "environment", pattern: /commshub.{0,60}deliver|deliver.{0,60}commshub/i, label: "CommsHub delivery dependency" },
  // Requirement gap: the requirement does not say what to assert.
  { cause: "requirement-gap", pattern: /\bnot identified\b/i, label: "requirement not identified" },
  { cause: "requirement-gap", pattern: /\bunclear\b/i, label: "requirement unclear" },
  { cause: "requirement-gap", pattern: /\bnot defined\b/i, label: "requirement not defined" },
  // QA side: the QA team's own scope, tooling or time stopped the check.
  { cause: "qa-side", pattern: /dev-covered/i, label: "dev-covered" },
  { cause: "qa-side", pattern: /no qa script/i, label: "no QA script" },
  { cause: "qa-side", pattern: /sandbox-only/i, label: "sandbox-only Playwright policy" },
  { cause: "qa-side", pattern: /harness/i, label: "harness" },
  { cause: "qa-side", pattern: /live-logged-in|leader session|sustained live|live sessions?/i, label: "session" },
  { cause: "qa-side", pattern: /time budget/i, label: "time budget" },
  { cause: "qa-side", pattern: /out of (?:\S+ ){0,3}reach/i, label: "out of reach" },
  { cause: "qa-side", pattern: /live db inspection/i, label: "live DB inspection" },
  { cause: "qa-side", pattern: /mutation score/i, label: "mutation score" },
  { cause: "qa-side", pattern: /testability flag/i, label: "testability flag" },
];

export interface UncoveredRow {
  id: string;
  cause: RowCause;
  /** How the cause was decided: "closure cause", "no result file", "keyword: <label>" (with " (result note)" when the text came from the result file), "no rule matched". */
  via: string;
}

export interface UncoveredByCause {
  environment: number;
  qaSide: number;
  requirementGap: number;
  notAttempted: number;
  other: number;
}

export interface UncoveredRollup {
  /** Sums to counts.blocked + counts.notAttempted of the same coverage.json. */
  byCause: UncoveredByCause;
  /** One row per uncovered check, sorted by id. */
  rows: UncoveredRow[];
}

export const emptyUncovered = (): UncoveredRollup => ({ rows: [], byCause: { environment: 0, qaSide: 0, requirementGap: 0, notAttempted: 0, other: 0 } });

const COUNT_KEY: Readonly<Record<RowCause, keyof UncoveredByCause>> = {
  environment: "environment", "qa-side": "qaSide", "requirement-gap": "requirementGap", "not-attempted": "notAttempted", other: "other",
};

function keywordRule(text: string): CauseRule | undefined {
  return CAUSE_RULES.find((r) => r.pattern.test(text));
}

interface ClosureRow { origin?: string; cause?: UncoveredCause }

function closureRows(runDir: string): Map<string, ClosureRow> {
  const doc = readJson(join(runDir, "reports", "closure", "closure.json"));
  const list = doc !== null && typeof doc === "object" ? (doc as { uncoveredTestCases?: unknown }).uncoveredTestCases : undefined;
  const out = new Map<string, ClosureRow>();
  if (!Array.isArray(list)) return out;
  for (const r of list) {
    if (r === null || typeof r !== "object") continue;
    const { id, origin, cause } = r as { id?: unknown; origin?: unknown; cause?: unknown };
    if (typeof id !== "string" || out.has(id)) continue;
    out.set(id, {
      ...(typeof origin === "string" ? { origin } : {}),
      ...(typeof cause === "string" && (UNCOVERED_CAUSES as readonly string[]).includes(cause) ? { cause: cause as UncoveredCause } : {}),
    });
  }
  return out;
}

/**
 * Pure: the checks that gave no verdict (worst outcome blocked, or designed with no result file), each with one cause. Order of
 * sources per row: a check with no result file is not-attempted; else an explicit `cause` on the closure's row; else the first
 * CAUSE_RULES match on the closure row's origin text, then on the result file's note or blocker; else "other". Writes nothing.
 */
export function classifyUncovered(runDir: string): UncoveredRollup {
  const checks = scanChecks(runDir);
  const closure = closureRows(runDir);
  const out = emptyUncovered();
  for (const [id, state] of [...checks].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    let row: UncoveredRow | undefined;
    if (state.outcome === undefined) {
      row = { id, cause: "not-attempted", via: "no result file" };
    } else if (state.outcome === "blocked") {
      const c = closure.get(id);
      if (c?.cause !== undefined) {
        row = { id, cause: c.cause, via: "closure cause" };
      } else {
        const fromOrigin = c?.origin === undefined ? undefined : keywordRule(c.origin);
        const fromNote = fromOrigin === undefined ? keywordRule(state.texts.join("\n")) : undefined;
        if (fromOrigin !== undefined) row = { id, cause: fromOrigin.cause, via: `keyword: ${fromOrigin.label}` };
        else if (fromNote !== undefined) row = { id, cause: fromNote.cause, via: `keyword: ${fromNote.label} (result note)` };
        else row = { id, cause: "other", via: "no rule matched" };
      }
    }
    if (row === undefined) continue;
    out.rows.push(row);
    out.byCause[COUNT_KEY[row.cause]]++;
  }
  return out;
}
