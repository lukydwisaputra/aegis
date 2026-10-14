import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DefectIdSchema, DefectSchema, defectRetestVerdict, isOpenApplicationDefect } from "@qa/contracts";
import { readLines } from "@qa/event-bus";
import { CaseOfRecordError, computeDefectRecordCounts, latestDefectManagementComplete, scanChecks, type BlockedInfo, type DefectRecordCounts } from "@qa/metrics";
import { busPath, runDir } from "../paths.js";
import { readRun } from "../run.js";
import { maskPath, maskPersonalData } from "./mask.js";
import type { Finding } from "./text.js";

/**
 * The data checks of the lint: what the run's own records say, not how a customer file is worded. They read run files only (result
 * files under cases/, defect records, events.jsonl, rtm.json) and never spawn a process. Stage `execution` (the Execution barrier) runs
 * the Blocked rules only; stage `G2` (the Triage barrier, openGate G2, aegis lint run --gate G2) runs the Blocked and the defect rules.
 * Only a full cycle is checked: a smoke run's G2 is auto-decided.
 */
export type DataStage = "execution" | "G2";

/** The rule groups `reportRules.disable` may name: the owner's recorded project exception for a whole group. */
export const DATA_RULE_GROUPS = ["blocked-qa-side", "defect-origin", "defect-counts", "env-probe"] as const;
export type DataRuleGroup = (typeof DATA_RULE_GROUPS)[number];

/** Every data rule id and its group. */
export const DATA_RULES: Readonly<Record<string, DataRuleGroup>> = {
  "blocked-no-cause": "blocked-qa-side",
  "blocked-no-dependency": "blocked-qa-side",
  "blocked-cause-suspect": "blocked-qa-side",
  "blocked-requirement-gap": "blocked-qa-side",
  "blocked-unreadable": "blocked-qa-side",
  "defect-origin-missing": "defect-origin",
  "defect-origin-not-clean": "defect-origin",
  "defect-unreadable": "defect-origin",
  "defect-counts-mismatch": "defect-counts",
  "defect-severity-mismatch": "defect-counts",
  "defect-rtm-mismatch": "defect-counts",
};

/** The group of a data rule id, or undefined for a wording or personal-data rule. */
export const dataRuleGroup = (rule: string): DataRuleGroup | undefined => DATA_RULES[rule];

/** A piece of record text in a finding: never more than 60 characters, personal data masked. */
const snippet = (s: string): string => maskPersonalData(s.slice(0, 60)).text;

const finding = (rule: string, severity: Finding["severity"], file: string, message: string, context: string): Finding =>
  ({ rule, severity, file: maskPath(file), line: 1, message, context, kind: "data" });

// ─── Blocked ──────────────────────────────────────────────────────────────────

const NO_CAUSE =
  "Blocked needs blockedCause product-dependency or requirement-gap; a QA-side fault (spec error, auth, test data, budget, environment) is fixed, not recorded as Blocked";
const NO_DEPENDENCY = "name the product dependency exactly in blockedDependency (for example Singpass, MyInfo, Stripe, S3)";
const REQUIREMENT_GAP = "record the ambiguity in the requirement ambiguity report";
const SUSPECT = "the note of this product-dependency Blocked result reads like a QA-side fault: check that the dependency is real and exists now";
const UNREADABLE_CASE = "the result files of this case disagree on which is the case of record (two declare caseOfRecord, or one gives no caseOfRecordReason): the Blocked checks cannot read it";

/** Words that name no dependency at all. */
const GENERIC_DEPENDENCY: ReadonlySet<string> = new Set(["api", "service", "server", "data", "env", "tbd", "none", "unknown", "n/a"]);

/** The testing-side wording of the old keyword table (uncovered.ts CAUSE_RULES) plus the QA-side words of the G2 rejections. */
const SUSPECT_WORDS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "seed data", re: /seed data/i },
  { label: "service-role", re: /service[ -]role/i },
  { label: "time budget", re: /time budget/i },
  { label: "harness", re: /harness/i },
  { label: "session budget", re: /session budget|live-session|session-ttl/i },
  { label: "dev-covered", re: /dev-covered/i },
  { label: "no QA script", re: /no qa script/i },
  { label: "sandbox-only", re: /sandbox-only/i },
  { label: "live session", re: /live-logged-in|leader session|sustained live|live sessions?\b/i },
  { label: "out of reach", re: /out of (?:\S+ ){0,3}reach/i },
  { label: "live DB inspection", re: /live db inspection/i },
  { label: "mutation score", re: /mutation score/i },
  { label: "testability flag", re: /testability flag/i },
];

function blockedFindings(dir: string): Finding[] {
  let checks: ReturnType<typeof scanChecks>;
  try {
    checks = scanChecks(dir);
  } catch (e) {
    if (!(e instanceof CaseOfRecordError)) throw e;
    const caseId = /^(TC-[A-Z]{2,8}-\d{3,})/.exec(e.message)?.[1] ?? "unknown case";
    const file = /\b(TC-[A-Z]{2,8}-\d{3,}[A-Za-z0-9-]*\.json)\b/.exec(e.message)?.[1];
    return [finding("blocked-unreadable", "error", file === undefined ? "cases" : `cases/${file}`, UNREADABLE_CASE, caseId)];
  }
  const out: Finding[] = [];
  const seen = new Set<string>();
  const add = (b: BlockedInfo, rule: string, severity: Finding["severity"], message: string, context: string): void => {
    // Once per case per file per rule, however many entries of that file are blocked.
    const key = `${rule}\0${b.caseId}\0${b.file}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(finding(rule, severity, `cases/${b.file}`, message, context));
  };
  for (const id of [...checks.keys()].sort()) {
    for (const b of checks.get(id)!.blocked ?? []) {
      if (b.cause === "missing" || b.cause === "invalid") {
        add(b, "blocked-no-cause", "error", NO_CAUSE, `${b.caseId}: blockedCause ${b.cause}`);
      } else if (b.cause === "requirement-gap") {
        add(b, "blocked-requirement-gap", "warning", REQUIREMENT_GAP, b.caseId);
      } else {
        if (b.dependency.length < 2 || GENERIC_DEPENDENCY.has(b.dependency.toLowerCase())) {
          add(b, "blocked-no-dependency", "error", NO_DEPENDENCY, b.dependency === "" ? `${b.caseId}: blockedDependency missing` : `${b.caseId}: blockedDependency "${snippet(b.dependency)}"`);
        }
        const hit = SUSPECT_WORDS.find((w) => w.re.test(b.text));
        if (hit !== undefined) add(b, "blocked-cause-suspect", "warning", SUSPECT, `${b.caseId}: note names ${hit.label}`);
      }
    }
  }
  return out;
}

// ─── Defects ──────────────────────────────────────────────────────────────────

const ORIGIN_MISSING = "an open defect records its origin confirmation: originConfirmation.ruledOut (what was ruled out) and originConfirmation.evidenceRef";
const ORIGIN_NOT_CLEAN = "an open defect is reproduced on a clean environment (originConfirmation.reproducedOnClean true) before it is reported as an application defect";
const DEFECT_UNREADABLE = "this defect record does not follow the defect record schema; it is still counted where its fields can be read";
const DEFECT_NOT_JSON = "this defect record is not a JSON object; it is left out of every count and of the RTM defect map check";
const COUNTS_MISMATCH = "the defect management summary does not match the defect records: re-record it with the figures of aegis metrics defects";
const NO_SUMMARY = "no defect management summary was recorded: record it with the figures of aegis metrics defects";
const SEVERITY_MISMATCH = "the summary's severityBreakdown does not match the open defect records by severity (unclassified for a record with no severity)";
const RTM_MISMATCH = "rtm.json#defectMap does not hold exactly the defect record ids: run aegis rtm sync-defects";

const COUNT_FIELDS = ["openApplicationDefects", "fixed", "partiallyFixed", "reframed", "reportWithdrawn", "cannotVerify", "notFixed"] as const;

const isPlain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

interface DefectFiles {
  /** Readable records (a JSON object), by file name. */
  records: Array<{ name: string; id: string; record: Record<string, unknown> }>;
  /** Ids (file basenames and record ids) whose record cannot be used for the RTM defect map, as sync-defects reads them. */
  unusable: Set<string>;
  findings: Finding[];
}

function readDefects(dir: string): DefectFiles {
  const defectsDir = join(dir, "defects");
  const out: DefectFiles = { records: [], unusable: new Set(), findings: [] };
  if (!existsSync(defectsDir)) return out;
  for (const name of readdirSync(defectsDir).filter((n) => /^DEF-.*\.json$/.test(n)).sort()) {
    const fileId = name.replace(/\.json$/, "");
    const rel = `defects/${name}`;
    let record: unknown;
    try {
      record = JSON.parse(readFileSync(join(defectsDir, name), "utf-8"));
    } catch {
      record = undefined; // never the parser text: it echoes the input
    }
    if (!isPlain(record)) {
      out.unusable.add(fileId);
      out.findings.push(finding("defect-unreadable", "warning", rel, DEFECT_NOT_JSON, fileId));
      continue;
    }
    const id = typeof record["id"] === "string" ? record["id"] : fileId;
    if (!DefectIdSchema.safeParse(id).success) { out.unusable.add(fileId); out.unusable.add(id); }
    out.records.push({ name, id, record });
    const parsed = DefectSchema.safeParse(record);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.filter((p) => typeof p === "string").join(".") || "(record)"))];
      out.findings.push(finding("defect-unreadable", "warning", rel, DEFECT_UNREADABLE, `${snippet(id)}: ${fields.slice(0, 3).join(", ")}${fields.length > 3 ? ", ..." : ""}`));
    }
  }
  return out;
}

function originFindings(files: DefectFiles): Finding[] {
  const out: Finding[] = [];
  for (const { name, id, record } of files.records) {
    if (!isOpenApplicationDefect(record)) continue;
    const rel = `defects/${name}`;
    const oc = isPlain(record["originConfirmation"]) ? record["originConfirmation"] : undefined;
    const missing: string[] = [];
    if (!Array.isArray(oc?.["ruledOut"]) || (oc["ruledOut"] as unknown[]).length === 0) missing.push("ruledOut");
    if (typeof oc?.["evidenceRef"] !== "string" || (oc["evidenceRef"] as string).trim() === "") missing.push("evidenceRef");
    if (missing.length > 0) out.push(finding("defect-origin-missing", "error", rel, ORIGIN_MISSING, `${snippet(id)}: originConfirmation ${missing.join(", ")} missing`));
    // An exploratory candidate (-EXP) and a carried defect with a retest verdict have no clean reproduction of their own to record.
    if (!/-EXP$/i.test(id) && defectRetestVerdict(record) === null && oc?.["reproducedOnClean"] !== true) {
      out.push(finding("defect-origin-not-clean", "error", rel, ORIGIN_NOT_CLEAN, `${snippet(id)}: reproducedOnClean ${oc === undefined ? "missing" : JSON.stringify(oc["reproducedOnClean"] ?? null)}`));
    }
  }
  return out;
}

/** The last defect.management-complete event, read leniently (an event of an older schema still counts). */
function lastSummary(root: string, runId: string): Record<string, unknown> | undefined {
  const events: Array<Record<string, unknown>> = [];
  for (const line of readLines(busPath(root, runId))) {
    if (!line.includes("defect.management-complete")) continue;
    try {
      const e: unknown = JSON.parse(line);
      if (isPlain(e)) events.push(e);
    } catch {
      // a torn line is the integrity check's business
    }
  }
  return latestDefectManagementComplete(events);
}

/** A { code: count } map with the zero counts dropped, as sorted `code:n` pairs; null when it is not such a map. */
function nonZero(v: unknown): string[] | null {
  if (!isPlain(v)) return null;
  const pairs: string[] = [];
  for (const [k, n] of Object.entries(v)) {
    if (typeof n !== "number") return null;
    if (n !== 0) pairs.push(`${k}:${n}`);
  }
  return pairs.sort();
}

function countFindings(root: string, runId: string, dir: string, counts: DefectRecordCounts | null, files: DefectFiles): Finding[] {
  const out: Finding[] = [];
  const event = lastSummary(root, runId);
  if (event === undefined) {
    if (files.records.length > 0) out.push(finding("defect-counts-mismatch", "error", "events.jsonl", NO_SUMMARY, `${files.records.length} defect record(s), no summary`));
  } else {
    for (const field of COUNT_FIELDS) {
      const stated = event[field];
      if (typeof stated !== "number") continue;
      const actual = counts?.[field] ?? 0;
      if (stated !== actual) out.push(finding("defect-counts-mismatch", "error", "events.jsonl", COUNTS_MISMATCH, `${field} ${stated} vs ${actual}`));
    }
    // An event written before openApplicationDefects existed counted the opened defects in severityBreakdown: not comparable.
    if (typeof event["openApplicationDefects"] === "number") {
      const stated = nonZero(event["severityBreakdown"]);
      const bySeverity: Record<string, number> = {};
      for (const items of Object.values(counts?.openItems ?? {})) for (const i of items) bySeverity[i.severity ?? "unclassified"] = (bySeverity[i.severity ?? "unclassified"] ?? 0) + 1;
      const actual = nonZero(bySeverity)!;
      if (stated === null || stated.join(",") !== actual.join(",")) {
        out.push(finding("defect-severity-mismatch", "error", "events.jsonl", SEVERITY_MISMATCH, `severityBreakdown ${snippet(stated === null ? "unreadable" : `{${stated.join(", ")}}`)} vs {${actual.join(", ")}}`));
      }
    }
  }
  // The RTM defect map: exactly the usable record ids (as aegis rtm sync-defects reads them).
  const ids = new Set(files.records.map((r) => r.id).filter((id) => !files.unusable.has(id)));
  const rtm = (() => {
    try {
      return JSON.parse(readFileSync(join(dir, "rtm.json"), "utf-8")) as unknown;
    } catch {
      return undefined;
    }
  })();
  const map = isPlain(rtm) && Array.isArray(rtm["defectMap"]) ? (rtm["defectMap"] as unknown[]) : null;
  if (map === null) {
    if (files.records.length > 0) out.push(finding("defect-rtm-mismatch", "error", "rtm.json", RTM_MISMATCH, `no defectMap; ${files.records.length} defect record(s)`));
    return out;
  }
  const mapped = new Set(map.flatMap((e) => (isPlain(e) && typeof e["defectId"] === "string" && !files.unusable.has(e["defectId"]) ? [e["defectId"]] : [])));
  const missing = [...ids].filter((id) => !mapped.has(id)).sort();
  const extra = [...mapped].filter((id) => !ids.has(id)).sort();
  if (missing.length > 0 || extra.length > 0) {
    const listed = [...missing.map((id) => `missing ${id}`), ...extra.map((id) => `extra ${snippet(id)}`)];
    out.push(finding("defect-rtm-mismatch", "error", "rtm.json", RTM_MISMATCH, `${listed.slice(0, 5).join(", ")}${listed.length > 5 ? `, ... (${listed.length})` : ""}`));
  }
  return out;
}

/**
 * The data findings of the run at `stage`, every one with kind "data", file run-relative, line 1 and ids (never record text beyond a masked
 * 60-character cut) as context. A rule whose group or id is in `disabled` (reportRules.disable) is left out. Reads only; [] for a smoke run.
 */
export function dataFindings(root: string, runId: string, stage: DataStage, disabled: ReadonlySet<string>): Finding[] {
  if (readRun(root, runId).cycleType !== "full") return [];
  const dir = runDir(root, runId);
  const on = (group: DataRuleGroup): boolean => !disabled.has(group);
  const out: Finding[] = [];
  if (on("blocked-qa-side")) out.push(...blockedFindings(dir));
  if (stage === "G2" && (on("defect-origin") || on("defect-counts"))) {
    const files = readDefects(dir);
    if (on("defect-origin")) out.push(...files.findings, ...originFindings(files));
    if (on("defect-counts")) out.push(...countFindings(root, runId, dir, computeDefectRecordCounts(dir), files));
  }
  return out.filter((f) => !disabled.has(f.rule));
}
