import { isAbsolute } from "node:path";
import { COMPLIANCE_REGULATIONS, complianceAgent } from "@qa/contracts";
import { matchGlob, roleOf } from "@qa/path-guard";
import { runDir } from "../paths.js";
import { readRun } from "../run.js";
import { executiveFindings } from "./executive.js";
import { CLOSURE_JSON, EXECUTIVE_INPUTS, lintFileFindings, plainRunFile, runFiles, TEXT_FILE } from "./run-lint.js";
import { specEntryFiles, specFindingsForEntries } from "./specs.js";
import type { Finding } from "./text.js";

/** The report writers whose submit is linted: the files they produce are customer-facing. */
export const SUBMIT_LINTED_AGENTS: ReadonlySet<string> = new Set([
  "qa-closure-reporter", "qa-executive-reporter", "qa-defect-manager", ...COMPLIANCE_REGULATIONS.map(complianceAgent),
]);

const EXECUTIVE_REPORTER = "qa-executive-reporter";
const CLOSURE_REPORTER = "qa-closure-reporter";
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
 * elsewhere) or naming no file is ignored, and so is a path through a symbolic link: only the files the run walk lists (it never follows a
 * link) are named. With no file named, the role table's run globs of the agent stand in.
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
    // Only what the run walk lists (it never follows a link): a file it lists, or the files under a directory it walked. A link anywhere in
    // the path, or a path that names no file of the run, names nothing.
    const listed = files();
    if (listed.includes(p)) out.add(p);
    else for (const f of listed) if (f.startsWith(`${p}/`)) out.add(f);
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
 * closure reporter the closure fields the sign-off prints are added as the G3 lint reads them (errors); for the
 * executive reporter the executive stage replaces the wording, tier and brand findings of its two inputs (the stage reads them as errors and
 * also checks the residual-risk ids, one sentence per risk and the deliverable events), and keeps their personal-data findings. Reads only.
 */
export function submitLintFindings(root: string, runId: string, agent: string, artifactsProduced: readonly string[]): { filesScanned: number; findings: Finding[] } {
  // The closure reporter also sees what the Closure-final barrier refuses at G3: the closure fields the sign-off prints (tier 1 and tier 2).
  // closure.json is read whenever it exists, whatever artifactsProduced names: the barrier reads it at G3 either way.
  const files = submitLintFiles(root, runId, agent, artifactsProduced);
  const closure = agent === CLOSURE_REPORTER && !files.includes(CLOSURE_JSON) && plainRunFile(runDir(root, runId), CLOSURE_JSON) ? [CLOSURE_JSON] : [];
  const scan = lintFileFindings(root, runId, [...files, ...closure], { signoffFed: agent === CLOSURE_REPORTER });
  if (agent !== EXECUTIVE_REPORTER) return scan;
  const kept = scan.findings.filter((f) => !EXECUTIVE_INPUTS.has(f.file) || f.rule.startsWith("pii-"));
  return { filesScanned: scan.filesScanned, findings: [...kept, ...executiveFindings(root, runId)] };
}

/**
 * The lint of a submission by a report writer (SUBMIT_LINTED_AGENTS) in a full run, or null for any other agent and in a smoke run: the result to show and the error ids to
 * stamp into the stored work report (`<rule> <file>:<line>`, de-duplicated). Never throws: a lint that cannot run is reported as unavailable.
 */
export function submitLint(root: string, runId: string, agent: string, artifactsProduced: readonly string[]): { lint: SubmitLint; lintErrors: string[] } | null {
  if (!SUBMIT_LINTED_AGENTS.has(agent)) return null;
  // A smoke run has no gate the lint prepares for (no G3, no executive phase): nothing is linted or stamped.
  try {
    if (readRun(root, runId).cycleType === "smoke") return null;
  } catch {
    // an unreadable run.json: the lint below reports what it can
  }
  let scan: { filesScanned: number; findings: Finding[] };
  try {
    scan = submitLintFindings(root, runId, agent, artifactsProduced);
  } catch (e) {
    return { lint: { errors: [], warnings: [], filesScanned: 0, unavailable: e instanceof Error ? e.message.slice(0, MESSAGE_MAX) : "the lint could not run" }, lintErrors: [] };
  }
  return packageLint(scan.findings, scan.filesScanned);
}

/** The result a submit shows and the error ids it stamps, from a list of findings. */
function packageLint(findings: readonly Finding[], filesScanned: number): { lint: SubmitLint; lintErrors: string[] } {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity !== "error");
  const omitted = { errors: Math.max(0, errors.length - LISTED), warnings: Math.max(0, warnings.length - LISTED) };
  return {
    lint: {
      errors: errors.slice(0, LISTED).map(note),
      warnings: warnings.slice(0, LISTED).map(note),
      ...(omitted.errors + omitted.warnings > 0 ? { omitted } : {}),
      filesScanned,
    },
    lintErrors: [...new Set(errors.map((f) => `${f.rule} ${f.file}:${f.line}`))].slice(0, STAMPED),
  };
}

/** The specialists whose spec files are linted at submit: every one that writes Playwright or test specs (the spec lint, lint/specs.ts). */
export const SPEC_LINTED_AGENTS: ReadonlySet<string> = new Set([
  "qa-ui-specialist", "qa-responsive-specialist", "qa-accessibility-specialist", "qa-api-specialist", "qa-database-specialist", "qa-messaging-specialist",
  "qa-realtime-specialist", "qa-feature-flag-specialist", "qa-unit-specialist",
]);

/**
 * The lint of the spec files a specialist's work report lists in artifactsProduced (an entry is a path from the target root and may carry a
 * note in parentheses): the spec rules over the files that resolve inside the tests directory. Null for any other agent, in a smoke run and
 * when the entries name no spec file. Stamped like the report writers' lint (the error ids), never a refusal; never throws.
 */
export async function specSubmitLint(root: string, runId: string, agent: string, artifactsProduced: readonly string[]): Promise<{ lint: SubmitLint; lintErrors: string[] } | null> {
  if (!SPEC_LINTED_AGENTS.has(agent)) return null;
  try {
    if (readRun(root, runId).cycleType === "smoke") return null;
  } catch {
    // an unreadable run.json: the lint below reports what it can
  }
  const files = specEntryFiles(root, artifactsProduced);
  if (files.length === 0) return null;
  return packageLint(await specFindingsForEntries(root, runId, artifactsProduced), files.length);
}

/** The two lints of one submission folded into one result: the errors and warnings of both, the error ids of both. */
export function mergeSubmitLints(a: { lint: SubmitLint; lintErrors: string[] } | null, b: { lint: SubmitLint; lintErrors: string[] } | null): { lint: SubmitLint; lintErrors: string[] } | null {
  if (a === null) return b;
  if (b === null) return a;
  const omitted = { errors: (a.lint.omitted?.errors ?? 0) + (b.lint.omitted?.errors ?? 0), warnings: (a.lint.omitted?.warnings ?? 0) + (b.lint.omitted?.warnings ?? 0) };
  return {
    lint: {
      errors: [...a.lint.errors, ...b.lint.errors].slice(0, LISTED),
      warnings: [...a.lint.warnings, ...b.lint.warnings].slice(0, LISTED),
      ...(omitted.errors + omitted.warnings > 0 ? { omitted } : {}),
      filesScanned: a.lint.filesScanned + b.lint.filesScanned,
    },
    lintErrors: [...new Set([...a.lintErrors, ...b.lintErrors])].slice(0, STAMPED),
  };
}
