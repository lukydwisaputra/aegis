import { lstatSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { COMPLIANCE_REGULATIONS, complianceAgent } from "@qa/contracts";
import { matchGlob, roleOf } from "@qa/path-guard";
import { runDir } from "../paths.js";
import { executiveFindings } from "./executive.js";
import { EXECUTIVE_INPUTS, lintFileFindings, runFiles } from "./run-lint.js";
import type { Finding } from "./text.js";

/** The report writers whose submit is linted: the files they produce are customer-facing. */
export const SUBMIT_LINTED_AGENTS: ReadonlySet<string> = new Set([
  "qa-closure-reporter", "qa-executive-reporter", "qa-defect-manager", ...COMPLIANCE_REGULATIONS.map(complianceAgent),
]);

const EXECUTIVE_REPORTER = "qa-executive-reporter";
const TEXT_FILE = /\.(?:md|json)$/;
/** At most this many findings of each severity are listed in the submit result; the rest is counted. */
const LISTED = 20;
/** At most this many error ids are stamped into the stored work report. */
const STAMPED = 50;
const MESSAGE_MAX = 240;

/** One finding as the submit result shows it: the rule id, where, and the short message (personal data already masked by the scan). */
export interface SubmitLintNote {
  rule: string;
  file: string;
  line: number;
  message: string;
}

/** The lint of a report writer's files at submit: shown in the submit result, never a refusal. */
export interface SubmitLint {
  errors: SubmitLintNote[];
  warnings: SubmitLintNote[];
  /** Findings beyond the listed ones, per severity. */
  omitted?: { errors: number; warnings: number };
  filesScanned: number;
  /** Set when the lint could not run (an unreadable config, for example); the submission is recorded all the same. */
  unavailable?: string;
}

/**
 * The run files a work report's artifactsProduced names, run-relative, Markdown and JSON only. An entry may be run-relative (reports/x) or
 * carry the run prefix (runs/<runId>/x, also inside a longer path); `{run}/x` is read like the role table. A directory names the files under
 * it and a glob (* and **) the files it matches, as the lint walks the run. An entry outside this run (another run, `..`, an absolute path
 * elsewhere) or naming no file is ignored. With no file named, the role table's run globs of the agent stand in.
 */
export function submitLintFiles(root: string, runId: string, agent: string, artifactsProduced: readonly string[]): string[] {
  const dir = runDir(root, runId);
  let all: string[] | null = null;
  const files = (): string[] => (all ??= runFiles(dir).files);
  const out = new Set<string>();
  const marker = `runs/${runId}/`;
  for (const entry of artifactsProduced) {
    let p = entry.trim().replace(/\\/g, "/");
    const at = p.indexOf(marker);
    if (at >= 0) p = p.slice(at + marker.length);
    else if (p.startsWith("{run}/")) p = p.slice("{run}/".length);
    else if (isAbsolute(p) || p.startsWith("runs/")) continue;
    p = p.replace(/^(?:\.\/)+/, "").replace(/\/+$/, "");
    if (p === "" || p.split("/").includes("..")) continue;
    if (p.includes("*")) {
      for (const f of files()) if (matchGlob(p, f)) out.add(f);
      continue;
    }
    let st;
    try {
      st = lstatSync(join(dir, p));
    } catch {
      continue; // names no file of the run
    }
    if (st.isDirectory()) for (const f of files()) { if (f.startsWith(`${p}/`)) out.add(f); }
    else out.add(p); // a file, or a link the lint lists as skipped
  }
  const named = [...out].filter((f) => TEXT_FILE.test(f));
  if (named.length > 0) return named.sort();
  const globs = (roleOf(agent)?.writes ?? []).filter((g) => g.startsWith("{run}/")).map((g) => g.slice("{run}/".length));
  return files().filter((f) => TEXT_FILE.test(f) && globs.some((g) => matchGlob(g, f))).sort();
}

const note = (f: Finding): SubmitLintNote => ({
  rule: f.rule, file: f.file, line: f.line, message: f.message.length > MESSAGE_MAX ? `${f.message.slice(0, MESSAGE_MAX - 3)}...` : f.message,
});

/**
 * The findings of a report writer's files at submit: the run-level classification over exactly those files (lintFileFindings); for the
 * executive reporter the executive stage replaces the wording, tier and brand findings of its two inputs (the stage reads them as errors and
 * also checks the residual-risk ids, one sentence per risk and the deliverable events), and keeps their personal-data findings. Reads only.
 */
export function submitLintFindings(root: string, runId: string, agent: string, artifactsProduced: readonly string[]): { filesScanned: number; findings: Finding[] } {
  const scan = lintFileFindings(root, runId, submitLintFiles(root, runId, agent, artifactsProduced));
  if (agent !== EXECUTIVE_REPORTER) return scan;
  const kept = scan.findings.filter((f) => !EXECUTIVE_INPUTS.has(f.file) || f.rule.startsWith("pii-"));
  return { filesScanned: scan.filesScanned, findings: [...kept, ...executiveFindings(root, runId)] };
}

/**
 * The lint of a submission by a report writer (SUBMIT_LINTED_AGENTS), or null for any other agent: the result to show and the error ids to
 * stamp into the stored work report (`<rule> <file>:<line>`, de-duplicated). Never throws: a lint that cannot run is reported as unavailable.
 */
export function submitLint(root: string, runId: string, agent: string, artifactsProduced: readonly string[]): { lint: SubmitLint; lintErrors: string[] } | null {
  if (!SUBMIT_LINTED_AGENTS.has(agent)) return null;
  let scan: { filesScanned: number; findings: Finding[] };
  try {
    scan = submitLintFindings(root, runId, agent, artifactsProduced);
  } catch (e) {
    return { lint: { errors: [], warnings: [], filesScanned: 0, unavailable: e instanceof Error ? e.message.slice(0, MESSAGE_MAX) : "the lint could not run" }, lintErrors: [] };
  }
  const errors = scan.findings.filter((f) => f.severity === "error");
  const warnings = scan.findings.filter((f) => f.severity !== "error");
  const omitted = { errors: Math.max(0, errors.length - LISTED), warnings: Math.max(0, warnings.length - LISTED) };
  return {
    lint: {
      errors: errors.slice(0, LISTED).map(note),
      warnings: warnings.slice(0, LISTED).map(note),
      ...(omitted.errors + omitted.warnings > 0 ? { omitted } : {}),
      filesScanned: scan.filesScanned,
    },
    lintErrors: [...new Set(errors.map((f) => `${f.rule} ${f.file}:${f.line}`))].slice(0, STAMPED),
  };
}
