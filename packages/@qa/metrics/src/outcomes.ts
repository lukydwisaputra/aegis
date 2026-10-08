import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** What one check came to: worst first, see WORST_FIRST. */
export type Outcome = "fail" | "blocked" | "partial" | "skipped" | "unknown" | "pass" | "no-op";

const CASE_FILE = /^(TC-[A-Z]{2,8}-\d{3,})\.json$/;
const RESULT_FILE = /^(TC-[A-Z]{2,8}-\d{3,})(?:-(desktop|tablet|mobile))?-result\.json$/;
export const VIEWPORTS = ["desktop", "tablet", "mobile"] as const;
export type Viewport = (typeof VIEWPORTS)[number];

/** Worst first: the outcome of a TC with several results is the first of these any of them has. */
const WORST_FIRST: readonly Outcome[] = ["fail", "blocked", "partial", "skipped", "unknown", "pass", "no-op"];
/** Outcomes of a check that did not run to a verdict. */
export const NOT_EXECUTED: ReadonlySet<Outcome> = new Set<Outcome>(["blocked", "skipped", "unknown"]);
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

const TEXT_KEYS = ["notes", "note", "blocker", "blockedReason", "reason"] as const;

/** The free text one result object gives for why a check did not run. */
function pick(o: unknown): string[] {
  if (o === null || typeof o !== "object") return [];
  return TEXT_KEYS.flatMap((k) => {
    const v = (o as Record<string, unknown>)[k];
    return typeof v === "string" && v.trim() !== "" ? [v.trim()] : [];
  });
}

/**
 * The text of a result file that gave no verdict: its top-level text plus the text of each results[] entry that itself gave
 * none (blocked, skipped or undeterminable), never the text of a passing or failing entry. Empty for a file that gave a verdict.
 */
function noVerdictTexts(doc: unknown): string[] {
  if (doc === null || typeof doc !== "object") return [];
  const entries = Array.isArray((doc as { results?: unknown }).results) ? ((doc as { results: unknown[] }).results) : [];
  const bad = entries.filter((e) => NOT_EXECUTED.has(outcomeOf((e as { status?: unknown } | null | undefined)?.status)));
  if (!NOT_EXECUTED.has(resultOutcome(doc)) && bad.length === 0) return [];
  return [...pick(doc), ...bad.flatMap(pick)];
}

export function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return undefined;
  }
}

/** One designed check: its outcome (undefined when it has no result file) and the free text of its no-verdict result files. */
export interface CheckState {
  /** Worst outcome across result files and unreported scoped viewports; undefined = no result file. */
  outcome?: Outcome;
  /** Text (notes, note, blocker, blockedReason, reason) of the result files that gave no verdict; never of a passing entry. */
  texts: string[];
  /** A scoped viewport has no result file (the check is then at best undeterminable). */
  missingViewport: boolean;
}

/** Pure: the designed checks of the run's cases directory (cases/{TC-ID}.json) with what their result files say. */
export function scanChecks(runDir: string): Map<string, CheckState> {
  const casesDir = join(runDir, "cases");
  const files = existsSync(casesDir) ? readdirSync(casesDir).sort() : [];

  const scopeOf = new Map<string, unknown>();
  for (const f of files) {
    const m = CASE_FILE.exec(f);
    if (m !== null) scopeOf.set(m[1]!, (readJson(join(casesDir, f)) as { viewportScope?: unknown } | undefined)?.viewportScope);
  }

  interface Results { plain?: Outcome; byViewport: Map<Viewport, Outcome>; texts: string[] }
  const results = new Map<string, Results>();
  for (const f of files) {
    const m = RESULT_FILE.exec(f);
    if (m === null || !scopeOf.has(m[1]!)) continue;
    const entry = results.get(m[1]!) ?? { byViewport: new Map<Viewport, Outcome>(), texts: [] };
    const doc = readJson(join(casesDir, f));
    const outcome = resultOutcome(doc);
    entry.texts.push(...noVerdictTexts(doc));
    if (m[2] === undefined) entry.plain = outcome;
    else entry.byViewport.set(m[2] as Viewport, outcome);
    results.set(m[1]!, entry);
  }

  const out = new Map<string, CheckState>();
  for (const [id, scope] of scopeOf) {
    const entry = results.get(id);
    if (entry === undefined) { out.set(id, { texts: [], missingViewport: false }); continue; }
    let outcome: Outcome;
    let missingViewport = false;
    if (entry.byViewport.size > 0) {
      const required: readonly Viewport[] = VIEWPORTS.includes(scope as Viewport) ? [scope as Viewport] : VIEWPORTS;
      const all = [...entry.byViewport.values()];
      for (const v of required) if (!entry.byViewport.has(v)) { all.push("unknown"); missingViewport = true; }
      outcome = worst(all);
    } else {
      outcome = entry.plain ?? "unknown";
    }
    out.set(id, { outcome, texts: entry.texts, missingViewport });
  }
  return out;
}
