import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readLines } from "@qa/event-bus";
import { toolingStringsIn } from "@qa/contracts";
import { readRunConfig } from "../config.js";
import { busPath, runDir } from "../paths.js";
import { MAX_TEXT_BYTES, maskPath } from "./mask.js";
import { BRAND_NAME, resolveRules, TOOLING_TIER1, TOOLING_TIER2 } from "./rules.js";
import { scanTextsUnblanked, type Finding, type ScanText } from "./text.js";
import { brandTexts, CLOSURE_JSON, jsonLineOf, RESIDUAL_RISKS_JSON, signoffFedFindings, type LintReport } from "./run-lint.js";

/** The stages the lint runs at besides the gates. */
export const LINT_STAGES = ["executive"] as const;
export type LintStage = (typeof LINT_STAGES)[number];

/** The ids in residual-risks.json are not exactly the riskIds of closure.json#residualRiskSummary (missing, extra or repeated). */
export const EXEC_RESIDUAL_RISK_IDS = "exec-residual-risk-ids";
/** An entry of residual-risks.json is not exactly one sentence (the sign-off prints it beside its risk). Never checked on the deck. */
export const EXEC_RISK_ONE_SENTENCE = "exec-risk-one-sentence";
/** A deliverable has no report.produced or report.fallback event after the latest start of the executive phase. */
export const EXEC_REPORT_EVENT_MISSING = "exec-report-event-missing";

const DECK_JSON = "reports/executive/executive-deck.json";
/** The three deliverables, by the `deliverable` of their events, with the file each one renders. */
const DELIVERABLES: ReadonlyArray<{ id: "technical" | "signoff" | "slides"; file: string }> = [
  { id: "technical", file: "reports/executive/technical-report.pdf" },
  { id: "signoff", file: "reports/executive/signoff.pdf" },
  { id: "slides", file: "reports/executive/executive-deck.pdf" },
];

/** A file of the run as text and parsed JSON; null when it is missing, a symbolic link or too large, `invalid` when it is not JSON. */
function readJson(dir: string, rel: string): { raw: string; value: unknown } | { invalid: string } | null {
  const abs = join(dir, rel);
  try {
    if (!existsSync(abs) || lstatSync(abs).isSymbolicLink()) return null;
    if (lstatSync(abs).size > MAX_TEXT_BYTES) return { invalid: "larger than 5 MB" };
    const raw = readFileSync(abs, "utf-8");
    try {
      return { raw, value: JSON.parse(raw) as unknown };
    } catch {
      return { invalid: "not valid JSON" }; // never the parser text: it echoes the input
    }
  } catch {
    return { invalid: "cannot read" };
  }
}

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const nonBlank = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

// A full stop after one of these (or after a single capital, an initial) does not end a sentence: "e.g. The", "No. 4", "J. Tan".
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|approx|incl|nos?|mr|mrs|ms|dr|st|inc|ltd|co|fig|cf|al|[A-Z])\.$/i;

/**
 * The number of sentences in a text: a run of . ! or ? (and any closing quote or bracket) followed by whitespace and a capital letter, a
 * digit or an opening quote starts the next one. Lenient on purpose (an abbreviation or an initial never splits), so a finding is never a
 * miscount: a decimal (4.5), a version or an id is not followed by whitespace.
 */
export function sentenceCount(text: string): number {
  const t = text.trim();
  if (t === "") return 0;
  let n = 1;
  for (const m of t.matchAll(/[.!?]+["'’”)\]]*\s+(?=["'“‘(\[]?[A-Z0-9])/g)) {
    if (m[0][0] === "." && ABBREVIATION.test(t.slice(0, (m.index ?? 0) + 1))) continue;
    n++;
  }
  return n;
}

/** The line of the n-th (0-based) occurrence of a quoted value (a risk id) in the raw file, else 1. */
const lineOfValue = (raw: string, value: string, nth = 0): number => {
  const quoted = JSON.stringify(value);
  let i = raw.indexOf(quoted);
  for (let k = 0; k < nth && i >= 0; k++) i = raw.indexOf(quoted, i + 1);
  return i < 0 ? 1 : raw.slice(0, i).split("\n").length;
};

/** (b) and (c): the ids of residual-risks.json against the closure's residualRiskSummary, and one sentence per entry. */
function residualRiskFindings(risks: { raw: string; value: unknown } | null, closure: { raw: string; value: unknown } | null, disabled: ReadonlySet<string>): Finding[] {
  const out: Finding[] = [];
  const closureIds = closure === null ? null : (Array.isArray(rec(closure.value)["residualRiskSummary"]) ? (rec(closure.value)["residualRiskSummary"] as unknown[]) : [])
    .map((r) => rec(r)["riskId"]).filter(nonBlank).map((id) => id.trim());
  const idFinding = (line: number, id: string, message: string): Finding => ({ rule: EXEC_RESIDUAL_RISK_IDS, severity: "error", file: RESIDUAL_RISKS_JSON, line, message, context: id });
  if (risks === null) {
    if (!disabled.has(EXEC_RESIDUAL_RISK_IDS) && closureIds !== null && closureIds.length > 0) {
      for (const id of [...new Set(closureIds)]) out.push(idFinding(1, id, `${id} of the closure's residual risks has no plain sentence: write residual-risks.json with one entry {riskId, plain} for every residual risk of the closure, in its order`));
    }
    return out;
  }
  if (!Array.isArray(risks.value)) {
    if (!disabled.has(EXEC_RESIDUAL_RISK_IDS)) out.push(idFinding(1, "", "residual-risks.json is not a list: write a JSON array of {riskId, plain}, one entry per residual risk of the closure"));
    return out;
  }
  const seen = new Set<string>();
  const occurrences = new Map<string, number>();
  risks.value.forEach((e, i) => {
    const r = rec(e);
    const id = nonBlank(r["riskId"]) ? r["riskId"].trim() : null;
    const written = r["riskId"] as string;
    const nth = id === null ? 0 : (occurrences.get(written) ?? 0);
    if (id !== null) occurrences.set(written, nth + 1);
    const line = id === null ? 1 : lineOfValue(risks.raw, written, nth);
    if (!disabled.has(EXEC_RESIDUAL_RISK_IDS)) {
      if (id === null) out.push(idFinding(line, "", `entry [${i}] has no riskId: every entry names the closure risk it describes`));
      else if (seen.has(id)) out.push(idFinding(line, id, `${id} is listed more than once: the sign-off prints the first entry and ignores the rest; keep one sentence per risk`));
      else if (closureIds !== null && !closureIds.includes(id)) out.push(idFinding(line, id, `${id} is not a residual risk of the closure (residualRiskSummary): remove the entry or correct its riskId`));
    }
    if (id !== null) seen.add(id);
    if (!disabled.has(EXEC_RISK_ONE_SENTENCE)) {
      const plain = r["plain"];
      const n = typeof plain === "string" ? sentenceCount(plain) : 0;
      if (n !== 1) {
        out.push({
          rule: EXEC_RISK_ONE_SENTENCE, severity: "error", file: RESIDUAL_RISKS_JSON, line, context: id ?? "",
          message: n === 0
            ? `entry [${i}]${id === null ? "" : ` (${id})`} has no plain sentence: write one customer-readable sentence`
            : `entry [${i}]${id === null ? "" : ` (${id})`} has ${n} sentences: the sign-off prints one sentence beside each risk; join or shorten them to one`,
        });
      }
    }
  });
  if (!disabled.has(EXEC_RESIDUAL_RISK_IDS) && closureIds !== null) {
    for (const id of [...new Set(closureIds)].filter((x) => !seen.has(x))) {
      out.push(idFinding(1, id, `${id} of the closure's residual risks has no entry: the sign-off would print the closure's technical title; add {riskId, plain} for it`));
    }
  }
  return out;
}

/** The deliverable an event names: its `deliverable`, else the file name of its `path` (`runs/RUN-…/reports/executive/x.pdf` or `reports/executive/x.pdf`). */
function deliverableOf(e: Record<string, unknown>): string | null {
  if (DELIVERABLES.some((d) => d.id === e["deliverable"])) return e["deliverable"] as string;
  const base = typeof e["path"] === "string" ? (e["path"].split(/[\\/]/).pop() ?? "") : "";
  return DELIVERABLES.find((d) => d.file.endsWith(`/${base}`))?.id ?? null;
}

/**
 * (d): per deliverable, a report.produced or report.fallback event after the latest start of the executive phase. Events pile up across
 * attempts and reissues; one attempt may re-render only one deliverable, which is fine while each of the three has an event in this phase.
 */
function reportEventFindings(root: string, runId: string): Finding[] {
  const events: Array<Record<string, unknown>> = [];
  for (const l of readLines(busPath(root, runId))) {
    if (!l.includes("report.") && !l.includes("run.phase.started")) continue;
    try {
      events.push(rec(JSON.parse(l)));
    } catch {
      // an unreadable line is the integrity check's business, not the lint's
    }
  }
  let start = -1;
  events.forEach((e, i) => { if (e["type"] === "run.phase.started" && e["phase"] === "executive") start = i; });
  const done = new Set<string>();
  for (const e of events.slice(start + 1)) {
    if (e["type"] !== "report.produced" && e["type"] !== "report.fallback") continue;
    const d = deliverableOf(e);
    if (d !== null) done.add(d);
  }
  const since = start < 0 ? "in the run (the executive phase has not started)" : "since the executive phase last started";
  return DELIVERABLES.filter((d) => !done.has(d.id)).map((d) => ({
    rule: EXEC_REPORT_EVENT_MISSING, severity: "error" as const, file: d.file, line: 1, context: d.id,
    message: `no report.produced or report.fallback event for the ${d.id} deliverable ${since}: render it with its skill and append report.produced, or append report.fallback with the reason it could not be rendered`,
  }));
}

/**
 * The executive stage: the inputs of the three deliverables, after G3. Reads run files only.
 *  (a) executive-deck.json and residual-risks.json, read as written (nothing blanked: the deck and the sign-off print quoted text like any
 *      other), with tier 1 and tier 2, the wording rules and the brand rule, as ERRORS; the closure fields the sign-off prints (and the
 *      open-defect lines it takes from the defect log) as WARNINGS: only an owner reissue can change the closure after G3.
 *  (b) the ids of residual-risks.json equal the riskIds of closure.json#residualRiskSummary.
 *  (c) one sentence per entry of residual-risks.json (never the deck: its residual risks carry no ids and may be longer).
 *  (d) a report.produced or report.fallback event per deliverable after the latest executive phase start.
 * No PDF is read: the rendered documents are checked by the conditions checker the reporter and its reviewer run.
 */
export function executiveScan(root: string, runId: string): { filesScanned: number; skipped: LintReport["skipped"]; findings: Finding[] } {
  const dir = runDir(root, runId);
  const config = readRunConfig(root);
  const disabled = new Set(config.reportRules.disable);
  const rules = resolveRules(config.reportRules, config.manualBudgetPercent);
  const { allow, localPorts } = config.reportRules;
  const skipped: LintReport["skipped"] = [];
  const findings: Finding[] = [];
  let filesScanned = 0;
  const read = (rel: string): { raw: string; value: unknown } | null => {
    const r = readJson(dir, rel);
    if (r === null) return null;
    if ("invalid" in r) { skipped.push({ file: rel, reason: r.invalid }); return null; }
    return r;
  };
  const closure = read(CLOSURE_JSON);
  let risks: { raw: string; value: unknown } | null = null;
  for (const rel of [DECK_JSON, RESIDUAL_RISKS_JSON]) {
    const f = read(rel);
    if (rel === RESIDUAL_RISKS_JSON) risks = f;
    if (f === null) continue;
    filesScanned++;
    const lineOf = jsonLineOf(f.raw);
    const texts: ScanText[] = toolingStringsIn(f.value, "").map((s) => ({ location: s.location, text: s.text, dataKey: s.dataKey }));
    findings.push(...scanTextsUnblanked(rel, texts, {
      ...(disabled.has(TOOLING_TIER1) ? {} : { tier1: { localPorts, severity: () => "error" as const } }),
      ...(disabled.has(TOOLING_TIER2) ? {} : { tier2: { severity: "error" as const } }),
      rules, allow, lineOf,
    }));
    if (!disabled.has(BRAND_NAME)) findings.push(...scanTextsUnblanked(rel, brandTexts(f.value), { brand: { severity: "error" }, allow, lineOf }));
  }
  if (existsSync(dir)) findings.push(...signoffFedFindings(dir, localPorts, allow, disabled, { closure: "warning", risks: null }));
  findings.push(...residualRiskFindings(risks, closure, disabled));
  if (!disabled.has(EXEC_REPORT_EVENT_MISSING)) findings.push(...reportEventFindings(root, runId));
  const shown = findings.map((f) => ({ ...f, file: maskPath(f.file) }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return { filesScanned, skipped: skipped.map((s) => ({ ...s, file: maskPath(s.file) })), findings: shown };
}

/** The findings of the executive stage (executiveScan): errors on the executive inputs and the deliverable events, warnings on the closure fields. */
export function executiveFindings(root: string, runId: string): Finding[] {
  return executiveScan(root, runId).findings;
}

/**
 * Why the executive phase cannot complete: the executive stage errors (never its warnings), by file:line rule, with the fix while the phase
 * is still active. The executive barrier's safety net; the reporter already sees the same findings in its submit result.
 */
export function executiveBlockMessage(errors: readonly Pick<Finding, "file" | "line" | "rule">[]): string {
  const listed = `${errors.slice(0, 10).map((f) => `${f.file}:${f.line} ${f.rule}`).join("; ")}${errors.length > 10 ? "; ..." : ""}`;
  const ids = [...new Set(errors.map((f) => f.rule))].sort().join(", ");
  return `${errors.length} executive stage lint error(s) (${listed}). The executive phase cannot complete with them: add a correction task for the executive reporter to this phase; it fixes its source files (executive-deck.json, residual-risks.json) and renders again, and for a missing deliverable event it renders that deliverable and appends report.produced, or report.fallback with the reason. Run aegis lint run --stage executive for the detail; the owner's recorded exception is reportRules.disable with the rule id (${ids})`;
}
