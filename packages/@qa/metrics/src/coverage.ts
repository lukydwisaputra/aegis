import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface CoverageRollup {
  /** Rows of rtm.json with testStatus Covered / all rows, 0 to 100, one decimal. */
  requirementsCoverage: number;
  /**
   * Designed test cases that were executed / designed, 0 to 100, one decimal. A TC's outcome is its worst outcome across its result
   * files, results[] entries and unreported scoped viewports (undeterminable), worst first: fail, blocked, partial, skipped, unknown,
   * pass, no-op. It is executed unless that worst outcome is blocked, skipped or unknown, so fail and partial count as executed.
   */
  testExecutionCoverage: number;
  /** reports/unit-coverage.json lines (else statements), or null. */
  codeCoverage: number | null;
  /** Rows with testStatus Partial: not counted as covered. */
  partialRequirements: number;
  noData?: true;
}

const CASE_FILE = /^(TC-[A-Z]{2,8}-\d{3,})\.json$/;
const RESULT_FILE = /^(TC-[A-Z]{2,8}-\d{3,})(?:-(desktop|tablet|mobile))?-result\.json$/;
const VIEWPORTS = ["desktop", "tablet", "mobile"] as const;
type Viewport = (typeof VIEWPORTS)[number];

type Outcome = "fail" | "blocked" | "partial" | "skipped" | "unknown" | "pass" | "no-op";
/** Worst first: the outcome of a TC with several results is the first of these any of them has. */
const WORST_FIRST: readonly Outcome[] = ["fail", "blocked", "partial", "skipped", "unknown", "pass", "no-op"];
const NOT_EXECUTED: ReadonlySet<Outcome> = new Set<Outcome>(["blocked", "skipped", "unknown"]);
const SYNONYMS: Readonly<Record<string, Outcome>> = {
  pass: "pass", passed: "pass", fail: "fail", failed: "fail", blocked: "blocked", partial: "partial",
  skipped: "skipped", skip: "skipped", "no-op": "no-op", noop: "no-op",
};

const outcomeOf = (status: unknown): Outcome => (typeof status === "string" ? (SYNONYMS[status.trim().toLowerCase()] ?? "unknown") : "unknown");

function worst(outcomes: readonly Outcome[]): Outcome {
  if (outcomes.length === 0) return "unknown";
  return outcomes.reduce<Outcome>((w, o) => (WORST_FIRST.indexOf(o) < WORST_FIRST.indexOf(w) ? o : w), "no-op");
}

/** One result file: its status, or the worst status of its results[] array. */
function resultOutcome(doc: unknown): Outcome {
  if (doc === null || typeof doc !== "object") return "unknown";
  const o = doc as { status?: unknown; results?: unknown };
  if (Array.isArray(o.results) && o.results.length > 0) {
    return worst(o.results.map((r) => outcomeOf((r as { status?: unknown } | null | undefined)?.status)));
  }
  return outcomeOf(o.status);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return undefined;
  }
}

const percent = (n: number, d: number): number => Math.round((1000 * n) / d) / 10;

function rtmRows(doc: unknown): Array<{ testStatus?: unknown } | null> | null {
  const rows = Array.isArray(doc) ? doc : doc !== null && typeof doc === "object" ? (doc as { rows?: unknown }).rows : undefined;
  return Array.isArray(rows) ? (rows as Array<{ testStatus?: unknown } | null>) : null;
}

function codeCoverage(runDir: string): number | null {
  const doc = readJson(join(runDir, "reports", "unit-coverage.json"));
  if (doc === null || typeof doc !== "object") return null;
  for (const key of ["lines", "statements"]) {
    const v = (doc as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100) return Math.round(v * 10) / 10;
  }
  return null;
}

interface Results {
  plain?: Outcome;
  byViewport: Map<Viewport, Outcome>;
}

/** Pure: reads the run's rtm.json, case and result files and unit-coverage.json; writes nothing. */
export function computeCoverage(runDir: string): CoverageRollup {
  const code = codeCoverage(runDir);
  const rows = rtmRows(readJson(join(runDir, "rtm.json")));
  const casesDir = join(runDir, "cases");
  const files = existsSync(casesDir) ? readdirSync(casesDir) : [];

  const scopeOf = new Map<string, unknown>();
  for (const f of files) {
    const m = CASE_FILE.exec(f);
    if (m !== null) scopeOf.set(m[1]!, (readJson(join(casesDir, f)) as { viewportScope?: unknown } | undefined)?.viewportScope);
  }

  if (rows === null || rows.length === 0 || scopeOf.size === 0) {
    return { requirementsCoverage: 0, testExecutionCoverage: 0, codeCoverage: code, partialRequirements: 0, noData: true };
  }

  const results = new Map<string, Results>();
  for (const f of files) {
    const m = RESULT_FILE.exec(f);
    if (m === null || !scopeOf.has(m[1]!)) continue;
    const entry = results.get(m[1]!) ?? { byViewport: new Map<Viewport, Outcome>() };
    const outcome = resultOutcome(readJson(join(casesDir, f)));
    if (m[2] === undefined) entry.plain = outcome;
    else entry.byViewport.set(m[2] as Viewport, outcome);
    results.set(m[1]!, entry);
  }

  let executed = 0;
  for (const [id, scope] of scopeOf) {
    const entry = results.get(id);
    if (entry === undefined) continue;
    let outcome: Outcome;
    if (entry.byViewport.size > 0) {
      const required: readonly Viewport[] = VIEWPORTS.includes(scope as Viewport) ? [scope as Viewport] : VIEWPORTS;
      const all = [...entry.byViewport.values()];
      for (const v of required) if (!entry.byViewport.has(v)) all.push("unknown");
      outcome = worst(all);
    } else {
      outcome = entry.plain ?? "unknown";
    }
    if (!NOT_EXECUTED.has(outcome)) executed++;
  }

  const covered = rows.filter((r) => r?.testStatus === "Covered").length;
  const partial = rows.filter((r) => r?.testStatus === "Partial").length;
  return {
    requirementsCoverage: percent(covered, rows.length),
    testExecutionCoverage: percent(executed, scopeOf.size),
    codeCoverage: code,
    partialRequirements: partial,
  };
}
