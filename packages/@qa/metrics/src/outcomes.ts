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

function hasBlockedEntry(doc: unknown): boolean {
  const r = doc !== null && typeof doc === "object" ? (doc as { results?: unknown }).results : undefined;
  return Array.isArray(r) && r.some((e) => outcomeOf((e as { status?: unknown } | null | undefined)?.status) === "blocked");
}

/** The free text a result file gives for why a check did not run: notes, blocker, reason, also on each results[] entry. */
function resultTexts(doc: unknown): string[] {
  if (doc === null || typeof doc !== "object") return [];
  const pick = (o: unknown): string[] =>
    o === null || typeof o !== "object"
      ? []
      : ["notes", "note", "blocker", "reason"].flatMap((k) => {
          const v = (o as Record<string, unknown>)[k];
          return typeof v === "string" && v.trim() !== "" ? [v.trim()] : [];
        });
  const r = (doc as { results?: unknown }).results;
  return [...pick(doc), ...(Array.isArray(r) ? r.flatMap(pick) : [])];
}

export function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return undefined;
  }
}

/** One designed check: its outcome (undefined when it has no result file) and the free text of its blocked result files. */
export interface CheckState {
  /** Worst outcome across result files and unreported scoped viewports; undefined = no result file. */
  outcome?: Outcome;
  /** Notes and blocker text of the result files that were blocked (every result file's text when none was). */
  texts: string[];
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

  interface Results { plain?: Outcome; byViewport: Map<Viewport, Outcome>; blockedTexts: string[]; allTexts: string[] }
  const results = new Map<string, Results>();
  for (const f of files) {
    const m = RESULT_FILE.exec(f);
    if (m === null || !scopeOf.has(m[1]!)) continue;
    const entry = results.get(m[1]!) ?? { byViewport: new Map<Viewport, Outcome>(), blockedTexts: [], allTexts: [] };
    const doc = readJson(join(casesDir, f));
    const outcome = resultOutcome(doc);
    const texts = resultTexts(doc);
    entry.allTexts.push(...texts);
    if (outcome === "blocked" || hasBlockedEntry(doc)) entry.blockedTexts.push(...texts);
    if (m[2] === undefined) entry.plain = outcome;
    else entry.byViewport.set(m[2] as Viewport, outcome);
    results.set(m[1]!, entry);
  }

  const out = new Map<string, CheckState>();
  for (const [id, scope] of scopeOf) {
    const entry = results.get(id);
    if (entry === undefined) { out.set(id, { texts: [] }); continue; }
    let outcome: Outcome;
    if (entry.byViewport.size > 0) {
      const required: readonly Viewport[] = VIEWPORTS.includes(scope as Viewport) ? [scope as Viewport] : VIEWPORTS;
      const all = [...entry.byViewport.values()];
      for (const v of required) if (!entry.byViewport.has(v)) all.push("unknown");
      outcome = worst(all);
    } else {
      outcome = entry.plain ?? "unknown";
    }
    out.set(id, { outcome, texts: entry.blockedTexts.length > 0 ? entry.blockedTexts : entry.allTexts });
  }
  return out;
}
