import { isAbsolute, join } from "node:path";
import { COMPLIANCE_REGULATIONS, complianceAgent } from "@qa/contracts";
import { loadGuardContext, matchGlob, roleOf, roleWritable, ROLES, type RolePaths } from "@qa/path-guard";
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
/** At most this many error findings are stamped into the stored work report with their message and masked line. */
const STAMPED_FINDINGS = 20;
const CONTEXT_MAX = 160;

/** One finding as the submit result shows it: the rule id, where, and the short message (personal data already masked by the scan). */
export interface SubmitLintNote {
  rule: string;
  file: string;
  line: number;
  message: string;
}

/** One error finding as the CLI stamps it into the stored work report (`lintFindings`): what the CLI needs to return the report with a review it builds itself. */
export interface StampedFinding {
  rule: string;
  file: string;
  line: number;
  message: string;
  context: string;
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
  const named = namedRunFiles(root, runId, artifactsProduced).filter((f) => TEXT_FILE.test(f));
  if (named.length > 0) return named;
  const globs = (roleOf(agent)?.writes ?? []).filter((g) => g.startsWith("{run}/")).map((g) => g.slice("{run}/".length));
  return runFiles(runDir(root, runId)).files.filter((f) => TEXT_FILE.test(f) && globs.some((g) => matchGlob(g, f))).sort();
}

/**
 * Every run file (any type) a work report's artifactsProduced names, run-relative and sorted, resolved as submitLintFiles describes (an entry
 * may be run-relative, carry the run prefix or `{run}/`, name a directory or a glob; anything outside the run or naming no file is ignored).
 * No role-table fallback: an entry that names nothing names nothing.
 */
function namedRunFiles(root: string, runId: string, artifactsProduced: readonly string[]): string[] {
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
  return [...out].sort();
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

/** The lint of one submission: the result to show, the error ids to stamp and the first error findings with their text, to stamp beside them. */
export interface SubmitLintResult {
  lint: SubmitLint;
  lintErrors: string[];
  findings: StampedFinding[];
}

/**
 * The lint of a submission by a report writer (SUBMIT_LINTED_AGENTS) in a full run, or null for any other agent and in a smoke run: the result to show and the error ids to
 * stamp into the stored work report (`<rule> <file>:<line>`, de-duplicated). Never throws: a lint that cannot run is reported as unavailable.
 */
export function submitLint(root: string, runId: string, agent: string, artifactsProduced: readonly string[]): SubmitLintResult | null {
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
    return { lint: { errors: [], warnings: [], filesScanned: 0, unavailable: e instanceof Error ? e.message.slice(0, MESSAGE_MAX) : "the lint could not run" }, lintErrors: [], findings: [] };
  }
  return packageLint(scan.findings, scan.filesScanned);
}

/** The result a submit shows and the error ids it stamps, from a list of findings. */
function packageLint(findings: readonly Finding[], filesScanned: number): SubmitLintResult {
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
    findings: errors.slice(0, STAMPED_FINDINGS).map((f) => ({
      rule: f.rule, file: f.file, line: f.line,
      message: f.message.length > MESSAGE_MAX ? `${f.message.slice(0, MESSAGE_MAX - 3)}...` : f.message,
      context: f.context.length > CONTEXT_MAX ? `${f.context.slice(0, CONTEXT_MAX - 3)}...` : f.context,
    })),
  };
}

/** The specialists whose spec files are linted at submit: every one that writes Playwright or test specs (the spec lint, lint/specs.ts). */
export const SPEC_LINTED_AGENTS: ReadonlySet<string> = new Set([
  "qa-ui-specialist", "qa-responsive-specialist", "qa-accessibility-specialist", "qa-api-specialist", "qa-database-specialist", "qa-messaging-specialist",
  "qa-realtime-specialist", "qa-feature-flag-specialist", "qa-unit-specialist", "qa-security-specialist",
]);

/**
 * The lint of the spec files a specialist's work report lists in artifactsProduced (an entry is a path from the target root and may carry a
 * note in parentheses): the spec rules over the files that resolve inside the tests directory. Null for any other agent, in a smoke run and
 * when the entries name no spec file. Stamped like the report writers' lint (the error ids), never a refusal; never throws.
 */
export async function specSubmitLint(root: string, runId: string, agent: string, artifactsProduced: readonly string[]): Promise<SubmitLintResult | null> {
  if (!SPEC_LINTED_AGENTS.has(agent)) return null;
  try {
    if (readRun(root, runId).cycleType === "smoke") return null;
  } catch {
    // an unreadable run.json: the lint below reports what it can
  }
  const files = specEntryFiles(root, artifactsProduced);
  if (files.length === 0) return null;
  const found = await specFindingsForEntries(root, runId, artifactsProduced);
  // Only a spec this agent may edit is stamped against its report: a spec it merely ran (a viewport re-run of a UI spec) is shown as a warning
  // that names its owner, and stays an error at the Execution barrier, where its own specialist fixes it.
  let paths: RolePaths | null = null;
  try {
    const ctx = loadGuardContext(root);
    paths = { aegisRoot: ctx.aegisRoot, targetRoot: ctx.targetRoot, testsDir: ctx.testsDir, runDir: runDir(root, runId) };
  } catch {
    // no paths: nothing can be shown as the agent's own, so nothing is stamped
  }
  const own = (f: Finding): boolean => paths !== null && roleWritable(agent, join(paths.targetRoot, f.file), paths);
  const owner = (f: Finding): string => ROLES.find((r) => r.kind === "specialist" && r.agent !== agent && paths !== null && roleWritable(r.agent, join(paths.targetRoot, f.file), paths))?.agent ?? "its specialist";
  const shaped = found.map((f): Finding => (f.severity === "error" && !own(f) ? { ...f, severity: "warning", context: `${f.context} (an error, but the spec belongs to ${owner(f)})` } : f));
  return packageLint(shaped, files.length);
}

/** The two lints of one submission folded into one result: the errors and warnings of both, the error ids of both. */
export function mergeSubmitLints(a: SubmitLintResult | null, b: SubmitLintResult | null): SubmitLintResult | null {
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
    findings: [...a.findings, ...b.findings].slice(0, STAMPED_FINDINGS),
  };
}
