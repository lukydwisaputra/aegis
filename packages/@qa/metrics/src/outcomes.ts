import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BLOCKED_CAUSES, type BlockedCause } from "@qa/contracts";

/** What one check came to: worst first, see WORST_FIRST. */
export type Outcome = "fail" | "blocked" | "partial" | "skipped" | "unknown" | "not-verified" | "deferred" | "out-of-scope" | "pass" | "no-op";

const CASE_FILE = /^(TC-[A-Z]{2,8}-\d{3,})\.json$/;
export const RESULT_FILE = /^(TC-[A-Z]{2,8}-\d{3,})(?:-(desktop|tablet|mobile))?-result\.json$/;
/**
 * A further result file of a case, `TC-X-result-<label>.json` (for example `TC-COMMS-007-result-messaging.json`, the messaging stub's
 * angle next to the API angle's `TC-COMMS-007-result.json`). It never takes part in the worst-first rule: it counts only when it
 * declares itself the case of record (`"caseOfRecord": true`), and is otherwise ignored as it always was.
 */
const EXTRA_RESULT_FILE = /^(TC-[A-Z]{2,8}-\d{3,})(?:-(desktop|tablet|mobile))?-result-([A-Za-z0-9][A-Za-z0-9-]*)\.json$/;
export const VIEWPORTS = ["desktop", "tablet", "mobile"] as const;
export type Viewport = (typeof VIEWPORTS)[number];

/** Worst first: the outcome of a TC with several results is the first of these any of them has. */
const WORST_FIRST: readonly Outcome[] = ["fail", "blocked", "partial", "skipped", "unknown", "not-verified", "deferred", "out-of-scope", "pass", "no-op"];
/** Outcomes of a check that did not run to a verdict. */
export const NOT_EXECUTED: ReadonlySet<Outcome> = new Set<Outcome>(["blocked", "skipped", "unknown", "not-verified", "deferred", "out-of-scope"]);
/** Outcomes that are a recorded ruling on a check (a scope or verification decision), not a test verdict: counted apart, outside the pass rate. */
export const RULED: ReadonlySet<Outcome> = new Set<Outcome>(["not-verified", "deferred", "out-of-scope"]);
const SYNONYMS: Readonly<Record<string, Outcome>> = {
  pass: "pass", passed: "pass", fail: "fail", failed: "fail", blocked: "blocked", partial: "partial",
  skipped: "skipped", skip: "skipped", "no-op": "no-op", noop: "no-op",
  not_verified: "not-verified", "not-verified": "not-verified", deferred: "deferred", out_of_scope: "out-of-scope", "out-of-scope": "out-of-scope",
};

export const outcomeOf = (status: unknown): Outcome => (typeof status === "string" ? (SYNONYMS[status.trim().toLowerCase()] ?? "unknown") : "unknown");

function worst(outcomes: readonly Outcome[]): Outcome {
  if (outcomes.length === 0) return "unknown";
  return outcomes.reduce<Outcome>((w, o) => (WORST_FIRST.indexOf(o) < WORST_FIRST.indexOf(w) ? o : w), "no-op");
}

/** One result file: its status, or the worst status of its results[] array. */
export function resultOutcome(doc: unknown): Outcome {
  if (doc === null || typeof doc !== "object") return "unknown";
  const o = doc as { status?: unknown; results?: unknown };
  if (Array.isArray(o.results) && o.results.length > 0) {
    return worst(o.results.map((r) => outcomeOf((r as { status?: unknown } | null | undefined)?.status)));
  }
  return outcomeOf(o.status);
}

/** A result file declares itself the case of record with `"caseOfRecord": true` (and a `caseOfRecordReason`). */
function declaresCaseOfRecord(doc: unknown): boolean {
  return doc !== null && typeof doc === "object" && (doc as { caseOfRecord?: unknown }).caseOfRecord === true;
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

/** One Blocked entry of a result file that counts (see scanChecks): its structured cause, the dependency it names and its free text. */
export interface BlockedInfo {
  caseId: string;
  /** The result file name in cases/. */
  file: string;
  /** `blockedCause` as recorded: one of BLOCKED_CAUSES, `invalid` (a value outside them) or `missing` (absent or empty). */
  cause: BlockedCause | "invalid" | "missing";
  /** The trimmed `blockedDependency`; empty when absent. */
  dependency: string;
  /** The entry's free text (notes, note, blocker, blockedReason, reason, blockedBy, environmentNote), for hints only. */
  text: string;
}

const BLOCKED_TEXT_KEYS = [...TEXT_KEYS, "blockedBy", "environmentNote"] as const;

/** A field value that counts as absent: undefined, null or a blank string. */
const absent = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

function field(o: unknown, key: string): unknown {
  return o !== null && typeof o === "object" ? (o as Record<string, unknown>)[key] : undefined;
}

function texts(o: unknown): string[] {
  if (o === null || typeof o !== "object") return [];
  return BLOCKED_TEXT_KEYS.flatMap((k) => {
    const v = (o as Record<string, unknown>)[k];
    return typeof v === "string" && v.trim() !== "" ? [v.trim()] : [];
  });
}

/**
 * The structured cause of one Blocked entry. `blockedCause` is read case-insensitively with `_` accepted for `-`; a present value
 * outside BLOCKED_CAUSES is `invalid`, an absent one `missing`. A results[] entry that lacks `blockedCause` or `blockedDependency`
 * takes the field from `inherited` (the file object); its text is its own followed by the file's.
 */
export function blockedInfoOf(entry: unknown, inherited?: unknown): Omit<BlockedInfo, "caseId" | "file"> {
  const own = (key: string): unknown => (absent(field(entry, key)) ? field(inherited, key) : field(entry, key));
  const rawCause = own("blockedCause");
  let cause: BlockedInfo["cause"];
  if (absent(rawCause)) cause = "missing";
  else {
    const norm = typeof rawCause === "string" ? rawCause.trim().toLowerCase().replace(/_/g, "-") : "";
    cause = (BLOCKED_CAUSES as readonly string[]).includes(norm) ? (norm as BlockedCause) : "invalid";
  }
  const rawDependency = own("blockedDependency");
  const dependency = typeof rawDependency === "string" ? rawDependency.trim() : "";
  const text = [...new Set([...texts(entry), ...(inherited === undefined ? [] : texts(inherited))])].join(" ");
  return { cause, dependency, text };
}

/**
 * The Blocked entries of one result file that counts: each blocked results[] entry when results[] is a non-empty array (as
 * resultOutcome reads it), else the file itself when it is blocked.
 */
function blockedEntries(caseId: string, file: string, doc: unknown): BlockedInfo[] {
  if (doc === null || typeof doc !== "object") return [];
  const list = (doc as { results?: unknown }).results;
  if (Array.isArray(list) && list.length > 0) {
    return list.filter((r) => outcomeOf(field(r, "status")) === "blocked").map((r) => ({ caseId, file, ...blockedInfoOf(r, doc) }));
  }
  return outcomeOf(field(doc, "status")) === "blocked" ? [{ caseId, file, ...blockedInfoOf(doc) }] : [];
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

/**
 * The cases the owner recorded as out of scope (run.json#descoped, written by aegis run descope): case id -> the recorded
 * reason. Read raw, so @qa/metrics stays file-based; an absent or unreadable run.json means none.
 */
export function descopedCases(runDir: string): Map<string, string> {
  const doc = readJson(join(runDir, "run.json"));
  const list = doc !== null && typeof doc === "object" ? (doc as { descoped?: unknown }).descoped : undefined;
  const out = new Map<string, string>();
  if (!Array.isArray(list)) return out;
  for (const e of list) {
    if (e === null || typeof e !== "object") continue;
    const { caseId, reason } = e as { caseId?: unknown; reason?: unknown };
    if (typeof caseId === "string" && caseId !== "" && typeof reason === "string" && !out.has(caseId)) out.set(caseId, reason);
  }
  return out;
}

/** A refusal of a case-of-record declaration: two files declare it for one case, or a declaring file gives no reason. */
export class CaseOfRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseOfRecordError";
  }
}

/** A result file of a case whose case of record is another file: listed in coverage.json, never counted. */
export interface ObservedResult {
  /** The result file name in cases/. */
  file: string;
  /** What the file says (its worst entry for a results[] file). */
  status: Outcome;
  /** The case-of-record file that stands for the case. */
  supersededBy: string;
  /** The file's own `observationOf`, when it names one. */
  observationOf?: string;
}

/** The result file the owner's gate decision made the case of record, with the reason it declared (caseOfRecordReason). */
export interface CaseOfRecord {
  file: string;
  reason: string;
  /** The result files it says it supersedes (`supersedes`), when it names any. */
  supersedes?: string[];
}

/** One designed check: its outcome (undefined when it has no result file) and the free text of its no-verdict result files. */
export interface CheckState {
  /** Worst outcome across result files and unreported scoped viewports; undefined = no result file. */
  outcome?: Outcome;
  /** Text (notes, note, blocker, blockedReason, reason) of the result files that gave no verdict; never of a passing entry. */
  texts: string[];
  /** A scoped viewport has no result file (the check is then at best undeterminable). */
  missingViewport: boolean;
  /** Set when a result file declared itself the case of record: the outcome above is that file's alone. */
  caseOfRecord?: CaseOfRecord;
  /** With a case of record: every other result file of the case and its status, uncounted. */
  observations?: ObservedResult[];
  /**
   * The Blocked entries of the result files that count for the case (the case of record alone; else the viewport files when any
   * exist, else the plain file), one per blocked entry, in file-name order. Absent when there is none. Never serialized.
   */
  blocked?: BlockedInfo[];
}

/**
 * Pure: the designed checks of the run's cases directory (cases/{TC-ID}.json) with what their result files say. A descoped case is not a check.
 * `descoped` is the caller's snapshot of descopedCases(runDir); a caller that already read it passes it so one compute sees one snapshot.
 */
export function scanChecks(runDir: string, descoped: ReadonlyMap<string, string> = descopedCases(runDir)): Map<string, CheckState> {
  const casesDir = join(runDir, "cases");
  const files = existsSync(casesDir) ? readdirSync(casesDir).sort() : [];

  const scopeOf = new Map<string, unknown>();
  for (const f of files) {
    const m = CASE_FILE.exec(f);
    if (m !== null && !descoped.has(m[1]!)) scopeOf.set(m[1]!, (readJson(join(casesDir, f)) as { viewportScope?: unknown } | undefined)?.viewportScope);
  }

  interface Results { plain?: Outcome; byViewport: Map<Viewport, Outcome>; texts: string[]; files: ResultDoc[] }
  interface ResultDoc { file: string; doc: unknown; outcome: Outcome; viewport?: Viewport }
  const results = new Map<string, Results>();
  const extras = new Map<string, ResultDoc[]>();
  for (const f of files) {
    const m = RESULT_FILE.exec(f);
    const extra = m === null ? EXTRA_RESULT_FILE.exec(f) : null;
    if ((m === null && extra === null) || !scopeOf.has((m ?? extra)![1]!)) continue;
    const doc = readJson(join(casesDir, f));
    const outcome = resultOutcome(doc);
    if (m === null) {
      const list = extras.get(extra![1]!) ?? [];
      list.push({ file: f, doc, outcome });
      extras.set(extra![1]!, list);
      continue;
    }
    const entry = results.get(m[1]!) ?? { byViewport: new Map<Viewport, Outcome>(), texts: [], files: [] };
    entry.texts.push(...noVerdictTexts(doc));
    entry.files.push({ file: f, doc, outcome, ...(m[2] === undefined ? {} : { viewport: m[2] as Viewport }) });
    if (m[2] === undefined) entry.plain = outcome;
    else entry.byViewport.set(m[2] as Viewport, outcome);
    results.set(m[1]!, entry);
  }

  const out = new Map<string, CheckState>();
  /** The Blocked entries of the files that count, as an optional field: absent when there is none. */
  const blockedOf = (id: string, counted: readonly ResultDoc[]): { blocked?: BlockedInfo[] } => {
    const list = counted.flatMap((r) => blockedEntries(id, r.file, r.doc));
    return list.length > 0 ? { blocked: list } : {};
  };
  for (const [id, scope] of scopeOf) {
    const entry = results.get(id);
    const all = [...(entry?.files ?? []), ...(extras.get(id) ?? [])];
    const declared = all.filter((r) => declaresCaseOfRecord(r.doc));
    if (declared.length > 1) {
      throw new CaseOfRecordError(`${id}: result files ${declared.map((r) => r.file).sort().join(" and ")} both declare "caseOfRecord": true; only one result file of a case may be its case of record`);
    }
    if (declared.length === 1) {
      const record = declared[0]!;
      const reason = (record.doc as { caseOfRecordReason?: unknown }).caseOfRecordReason;
      if (typeof reason !== "string" || reason.trim() === "") {
        throw new CaseOfRecordError(`${id}: ${record.file} declares "caseOfRecord": true without a "caseOfRecordReason"; the reason (the owner's gate decision) is required`);
      }
      const supersedes = (record.doc as { supersedes?: unknown }).supersedes;
      const names = Array.isArray(supersedes) ? supersedes.filter((n): n is string => typeof n === "string") : [];
      out.set(id, {
        outcome: record.outcome,
        texts: noVerdictTexts(record.doc),
        missingViewport: false,
        caseOfRecord: { file: record.file, reason: reason.trim(), ...(names.length > 0 ? { supersedes: names } : {}) },
        observations: all.filter((r) => r !== record).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)).map((r) => {
          const of = (r.doc as { observationOf?: unknown } | null)?.observationOf;
          return { file: r.file, status: r.outcome, supersededBy: record.file, ...(typeof of === "string" && of !== "" ? { observationOf: of } : {}) };
        }),
        ...blockedOf(id, [record]),
      });
      continue;
    }
    if (entry === undefined) { out.set(id, { texts: [], missingViewport: false }); continue; }
    let outcome: Outcome;
    let missingViewport = false;
    if (entry.byViewport.size > 0) {
      const required: readonly Viewport[] = VIEWPORTS.includes(scope as Viewport) ? [scope as Viewport] : VIEWPORTS;
      const outcomes = [...entry.byViewport.values()];
      for (const v of required) if (!entry.byViewport.has(v)) { outcomes.push("unknown"); missingViewport = true; }
      outcome = worst(outcomes);
    } else {
      outcome = entry.plain ?? "unknown";
    }
    // The files the outcome counts: the viewport files when any exist (the plain file is then ignored), else the plain file.
    const counted = entry.files.filter((r) => (entry.byViewport.size > 0) === (r.viewport !== undefined));
    out.set(id, { outcome, texts: entry.texts, missingViewport, ...blockedOf(id, counted) });
  }
  return out;
}
