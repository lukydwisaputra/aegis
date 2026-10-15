import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { loadGuardContext } from "@qa/path-guard";
import { readRunConfig } from "../config.js";
import { runDir } from "../paths.js";
import { atomicWrite } from "../util.js";
import { reissueCaseScope } from "../reissue-scope.js";
import { readRun } from "../run.js";
import { finding, isPlain, snippet } from "./data-util.js";
import { MAX_TEXT_BYTES } from "./mask.js";
import { plainRunFile } from "./plain-path.js";
import type { Finding } from "./text.js";

/**
 * The spec lint: the rules of the specialists' spec files that a reviewer rejected for in three real runs and a parser can decide. The spec
 * files are the ones the run's result files name (`specRef`, `specFile` as a string or a list, and the `automatedTestRef` of a case), found
 * by their `.spec.ts` / `.test.ts` / `.e2e.ts` paths in whatever shape the entry has (a plain path, `path#test name`, prose with two paths
 * and notes in parentheses, an object, a list). A path resolves against the target project root and is read only when it is a regular file
 * inside the tests directory reached through no symbolic link and no `..`; a developer test outside it, a missing file, a link and a secrets
 * file are counted as skipped and never read. The files are parsed with the TypeScript compiler API (a syntax tree, so a rule never fires
 * on a comment or a string), which is imported only here and only when there is a spec to read: every hook loads this package.
 *
 * Findings are data findings: the spec's path from the target root, the line, the rule id and a masked snippet of at most 60 characters of the
 * source; they are written only to reports/lint/ and the CLI results, never to a customer-facing file.
 */

/** The group `reportRules.disable` may name for every rule below. */
export const SPEC_RULE_GROUP = "spec-checks";

type Severity = Finding["severity"];

/**
 * The rule ids and their severity. A rule is an error only when its replay over the specs the three real runs passed (the task report)
 * showed no hit that is not a true fault; the rest are warnings.
 */
export const SPEC_RULES: Readonly<Record<string, Severity>> = {
  "spec-wait-for-timeout": "warning",
  "spec-fixture-import": "error",
  "spec-trivial-assertion": "error",
  "spec-swallowed-cleanup": "warning",
  "spec-afterEach-screenshot": "warning",
  "spec-raw-page": "warning",
  "spec-e2e-suffix": "warning",
  // A file the lint could not check (a parse failure, a depth or size bound), and files left out by the bounds: said, never silent.
  "spec-unparsed": "warning",
  "spec-not-scanned": "warning",
};

const MESSAGES: Readonly<Record<string, string>> = {
  "spec-wait-for-timeout": "a fixed sleep (waitForTimeout) makes the test timing-dependent: wait for the observable outcome with a web-first assertion or expect.poll",
  "spec-fixture-import": "a UI spec imports test from the QA auth fixture (the fixtures folder of the tests directory), not from @playwright/test",
  "spec-trivial-assertion": "an assertion on a literal that cannot fail asserts nothing: assert the behaviour under test",
  "spec-swallowed-cleanup": "a cleanup that swallows its error hides a leak of test data: let it fail, or record the failure",
  "spec-afterEach-screenshot": "a UI spec captures a screenshot in an afterEach hook for every test, pass and fail (evidence for each case)",
  "spec-raw-page": "a UI spec drives the page through a Page Object, not with direct page calls",
  "spec-unparsed": "this spec could not be checked (it failed to parse or exceeded a bound of the lint): the other spec files were checked",
  "spec-not-scanned": "spec files were left out of the lint (a size, count or time bound): they are checked at the Execution barrier or in a later run",
  "spec-e2e-suffix": "an end-to-end journey case is written in a spec named for the journey (a file name carrying .e2e before the extension), and the Playwright test match must discover it",
};

/** At most this many spec files are read by one lint, and at most this many bytes of them in total. */
const MAX_SPEC_FILES = 500;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
/** The wall-clock budget of one lint, checked between files (a file is never interrupted: one is at most MAX_TEXT_BYTES). */
export const BARRIER_BUDGET_MS = 20_000;
export const SUBMIT_BUDGET_MS = 2_000;
const MAX_REF_CHARS = 4000;
const MAX_DEPTH = 8;
const REF_KEYS: ReadonlySet<string> = new Set(["specRef", "specFile", "specFiles", "automatedTestRef"]);
// A path ending in .spec.ts, .test.ts or .e2e.ts: letters, digits, _ @ . - [ ] and / (a route folder may be [id]); the path#name and prose shapes stop at the first other character.
const SPEC_PATH = /[A-Za-z0-9_@.[\]/-]+\.(?:spec|test|e2e)\.ts(?![A-Za-z0-9_])/g;
const CASE_ID = /^(TC-[A-Za-z0-9]+-\d+)/;

export type SkippedReason = "outside" | "missing" | "link" | "secret" | "large";

/** The spec files the result files name, and the references that were left out (with why). `resolved` are paths from the target root. */
export interface SpecRefs {
  resolved: string[];
  skipped: Array<{ ref: string; reason: SkippedReason }>;
  /** The case ids (from the file names of the result files) that name each resolved spec. */
  cases: ReadonlyMap<string, ReadonlySet<string>>;
}

interface Paths {
  targetRoot: string;
  testsDir: string;
}

function readPaths(root: string): Paths | null {
  try {
    const ctx = loadGuardContext(root);
    return { targetRoot: ctx.targetRoot, testsDir: ctx.testsDir };
  } catch {
    return null;
  }
}

/** Every string in a value (a string, a list, an object), bounded in depth and length. */
function strings(v: unknown, out: string[], depth = 0): void {
  if (depth > MAX_DEPTH) return;
  if (typeof v === "string") out.push(v.length > MAX_REF_CHARS ? v.slice(0, MAX_REF_CHARS) : v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out, depth + 1);
  else if (isPlain(v)) for (const x of Object.values(v)) strings(x, out, depth + 1);
}

/** The values under the reference keys, anywhere in the document (a sub-result such as results[0] or subResults.stub names its spec too). */
function refEntries(v: unknown, out: string[], depth = 0): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(v)) {
    for (const x of v) refEntries(x, out, depth + 1);
  } else if (isPlain(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (REF_KEYS.has(k)) strings(x, out);
      else refEntries(x, out, depth + 1);
    }
  }
}

/** The spec paths in one entry, as written (a normal path has no leading ./). */
export function specPathsIn(entry: string): string[] {
  const out: string[] = [];
  for (const m of entry.matchAll(SPEC_PATH)) out.push(m[0].replace(/^(?:\.\/)+/, ""));
  return out;
}

const isSecretPath = (rel: string): boolean => rel.split("/").some((c) => c === "secrets" || c === ".env" || c.startsWith(".env."));

/**
 * One reference resolved: the path from the target root of a spec file under the tests directory, or why not. A file is read only when it is
 * a regular file reached through no symbolic link and no `..` (plainRunFile, the discipline the run files use): a link anywhere in the path,
 * an absolute path, a path leaving the tests directory and a secrets file are never opened.
 */
function resolveRef(paths: Paths, ref: string): { ok: true; rel: string } | { ok: false; reason: SkippedReason } {
  if (isAbsolute(ref) || ref.split("/").includes("..")) return { ok: false, reason: "outside" };
  const abs = join(paths.targetRoot, ref);
  const underTests = relative(paths.testsDir, abs);
  if (underTests === "" || isAbsolute(underTests) || underTests === ".." || underTests.startsWith("../")) return { ok: false, reason: "outside" };
  if (isSecretPath(underTests)) return { ok: false, reason: "secret" };
  try {
    lstatSync(abs);
  } catch {
    return { ok: false, reason: "missing" };
  }
  if (!plainRunFile(paths.testsDir, underTests)) return { ok: false, reason: "link" };
  return { ok: true, rel: relative(paths.targetRoot, abs).replace(/\\/g, "/") };
}

/**
 * The spec files the run's result files (and the case files) name, from `cases/*.json`. Reads run files and stats paths only: no spec is opened.
 * An unreadable configuration (a testsDir outside the target) names nothing.
 */
export function specRefs(root: string, runId: string): SpecRefs {
  let names: string[] = [];
  try {
    names = readdirSync(join(runDir(root, runId), "cases")).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return { resolved: [], skipped: [], cases: new Map() };
  }
  return specRefsOfFiles(root, runId, names.map((n) => `cases/${n}`));
}

/**
 * The spec files the given case files of the run (run-relative, `cases/{name}.json`: designs and result files) name, resolved as specRefs does.
 * A file that is not a plain file, is too large or is not JSON names nothing. Reads run files and stats paths only.
 */
export function specRefsOfFiles(root: string, runId: string, rels: readonly string[]): SpecRefs {
  const none: SpecRefs = { resolved: [], skipped: [], cases: new Map() };
  const paths = readPaths(root);
  if (paths === null) return none;
  const dir = runDir(root, runId);
  const resolved = new Set<string>();
  const skipped = new Map<string, SkippedReason>();
  const cases = new Map<string, Set<string>>();
  for (const rel of rels) {
    const name = rel.replace(/^cases\//, "");
    if (!plainRunFile(dir, rel)) continue;
    let doc: unknown;
    try {
      if (lstatSync(join(dir, rel)).size > MAX_TEXT_BYTES) continue;
      doc = JSON.parse(readFileSync(join(dir, rel), "utf-8"));
    } catch {
      continue;
    }
    const entries: string[] = [];
    refEntries(doc, entries);
    const tc = CASE_ID.exec(name)?.[1];
    for (const entry of entries) {
      for (const ref of specPathsIn(entry)) {
        const r = resolveRef(paths, ref);
        if (!r.ok) {
          skipped.set(ref, r.reason);
          continue;
        }
        resolved.add(r.rel);
        if (tc !== undefined) cases.set(r.rel, (cases.get(r.rel) ?? new Set()).add(tc));
      }
    }
  }
  return { resolved: [...resolved].sort(), skipped: [...skipped].map(([ref, reason]) => ({ ref, reason })), cases };
}

// ─── The rules over a syntax tree ─────────────────────────────────────────────

type TS = typeof import("typescript");
type Node = import("typescript").Node;
type SourceFile = import("typescript").SourceFile;

interface Hit {
  rule: string;
  line: number;
  context: string;
}

const CLEANUP_NAME = /clean|tear.?down|purge|dispose|rollback/i;
const EVIDENCE_WORD = /screenshot|shot|evidence|capture|attach/i;
// The Playwright Page API: a call of one of these on a page object (page, adminPage, ...) is a direct page call. A Page Object method (login, findAndDeleteStaffBy) is not.
const PAGE_API: ReadonlySet<string> = new Set([
  "goto", "locator", "getByRole", "getByText", "getByLabel", "getByPlaceholder", "getByTestId", "getByAltText", "getByTitle", "click", "dblclick", "fill", "type", "press", "check",
  "uncheck", "selectOption", "hover", "focus", "waitForSelector", "waitForURL", "waitForLoadState", "waitForResponse", "waitForRequest", "reload", "goBack", "goForward", "evaluate",
  "setInputFiles", "dispatchEvent", "textContent", "innerText", "isVisible",
]);
const PAGE_RECEIVER = /^(?:page|[a-z]\w*Page)$/;
const POM_SOURCE = /(?:^|\/)pages?\/|\.page(?:\.[jt]s)?$/;
const E2E_NAME = /\.e2e\.(?:spec\.)?ts$/;

/**
 * The rules over one parsed spec. `fixture` says whether the tests directory has the auth fixture the import rule points at; `uiFolder` whether the spec
 * lives in the UI specialist's folder (specs/ of the tests directory), where the import, afterEach and Page Object rules apply (its checklist).
 */
function specHits(ts: TS, sf: SourceFile, fixture: boolean, uiFolder: boolean): Hit[] {
  const hits: Hit[] = [];
  const lineOf = (n: Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const text = (n: Node): string => n.getText(sf).replace(/\s+/g, " ");
  const add = (rule: string, n: Node, context: string): void => void hits.push({ rule, line: lineOf(n), context: snippet(context) });

  // The last name of a call's callee: `a.b.c()` is c, `f()` is f.
  const calleeName = (c: import("typescript").CallExpression): string | null =>
    ts.isPropertyAccessExpression(c.expression) ? c.expression.name.text : ts.isIdentifier(c.expression) ? c.expression.text : null;
  const nameOf = (n: Node): string | null => {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name !== undefined) return n.name.getText(sf);
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent !== undefined && ts.isVariableDeclaration(n.parent)) return n.parent.name.getText(sf);
    return null;
  };
  /** Whether the node sits where a cleanup runs: an afterEach or afterAll hook, a finally block, or a function named for cleanup. */
  const inCleanup = (n: Node): boolean => {
    for (let p: Node | undefined = n.parent, child: Node = n; p !== undefined; child = p, p = p.parent) {
      if (ts.isCallExpression(p) && p.arguments.includes(child as never)) {
        const name = calleeName(p);
        if (name === "afterEach" || name === "afterAll") return true;
      }
      if (ts.isTryStatement(p) && p.finallyBlock === child) return true;
      const fn = nameOf(p);
      if (fn !== null && CLEANUP_NAME.test(fn)) return true;
    }
    return false;
  };
  const isLiteral = (n: Node): boolean =>
    ts.isNumericLiteral(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword;
  const literalKey = (n: Node): string => `${n.kind}:${ts.isStringLiteralLike(n) || ts.isNumericLiteral(n) ? n.text : ""}`;
  const truthy = (n: Node): boolean => (n.kind === ts.SyntaxKind.TrueKeyword ? true : ts.isNumericLiteral(n) ? Number(n.text) !== 0 : ts.isStringLiteralLike(n) ? n.text !== "" : false);
  const falsy = (n: Node): boolean => n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword || (ts.isNumericLiteral(n) && Number(n.text) === 0) || (ts.isStringLiteralLike(n) && n.text === "");
  /** An arrow or function whose body does nothing with the error: empty, a bare return, or a value of undefined, null or void 0. */
  const swallows = (fn: Node): boolean => {
    if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return ts.isIdentifier(fn) && /^noop$/i.test(fn.text);
    const body = fn.body;
    const empty = (e: Node): boolean => (ts.isIdentifier(e) && e.text === "undefined") || e.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(e);
    if (!ts.isBlock(body)) return empty(ts.isParenthesizedExpression(body) ? body.expression : body);
    return body.statements.every((s) => ts.isReturnStatement(s) && (s.expression === undefined || empty(s.expression)));
  };

  let usesBrowser = false;
  let afterEachShot = false;
  let afterEachAny = false;
  let pomImported = false;
  const rawPage: Node[] = [];
  const rawTestImports: Node[] = [];
  const namespaces = new Map<string, Node>();
  const namespaceTest = new Set<string>();
  let first: Node | undefined;

  const visit = (n: Node): void => {
    if (first === undefined && ts.isCallExpression(n) && /^(?:test|it)$/.test(calleeName(n) ?? "") ) first = n;
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const source = n.moduleSpecifier.text;
      if (POM_SOURCE.test(source) && n.importClause?.isTypeOnly !== true) pomImported = true;
      const bindings = n.importClause?.namedBindings;
      if (source === "@playwright/test" && n.importClause?.isTypeOnly !== true) {
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          if (bindings.elements.some((e) => !e.isTypeOnly && (e.propertyName ?? e.name).text === "test")) rawTestImports.push(n);
        } else if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
          namespaces.set(bindings.name.text, n); // a namespace import is a raw test import when its test is used (below)
        } else if (n.importClause?.name !== undefined) {
          rawTestImports.push(n); // the default export of @playwright/test is test
        }
      }
    }
    if (ts.isParameter(n) && ts.isObjectBindingPattern(n.name)) {
      if (n.name.elements.some((e) => /^(?:page|\w+Page)$/.test((e.propertyName ?? e.name).getText(sf)))) usesBrowser = true;
    }
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && namespaces.has(n.expression.text) && n.name.text === "test") namespaceTest.add(n.expression.text);
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      if (name === "goto") usesBrowser = true;
      if (name === "waitForTimeout") add("spec-wait-for-timeout", n, text(n));
      if (name === "afterEach") {
        afterEachAny = true;
        const fn = n.arguments[n.arguments.length - 1];
        if (fn !== undefined) {
          const scan = (c: Node): void => {
            if ((ts.isIdentifier(c) || ts.isStringLiteralLike(c)) && EVIDENCE_WORD.test(c.text)) afterEachShot = true;
            ts.forEachChild(c, scan);
          };
          scan(fn);
        }
      }
      if (ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && PAGE_RECEIVER.test(n.expression.expression.text) && PAGE_API.has(n.expression.name.text)) rawPage.push(n);
      // expect(<literal>).<matcher>(...)
      if (ts.isPropertyAccessExpression(n.expression)) {
        const matcher = n.expression.name.text;
        const subject = n.expression.expression;
        const isExpect = ts.isCallExpression(subject) && (
          (ts.isIdentifier(subject.expression) && subject.expression.text === "expect") ||
          (ts.isPropertyAccessExpression(subject.expression) && ts.isIdentifier(subject.expression.expression) && subject.expression.expression.text === "expect" && subject.expression.name.text === "soft"));
        if (ts.isCallExpression(subject) && isExpect && subject.arguments.length >= 1) {
          const actual = subject.arguments[0]!;
          const arg = n.arguments[0];
          const trivial =
            isLiteral(actual) &&
            (((matcher === "toBe" || matcher === "toEqual" || matcher === "toStrictEqual") && arg !== undefined && isLiteral(arg) && literalKey(arg) === literalKey(actual)) ||
              (matcher === "toBeTruthy" && truthy(actual)) ||
              (matcher === "toBeFalsy" && falsy(actual)) ||
              (matcher === "toBeNull" && actual.kind === ts.SyntaxKind.NullKeyword) ||
              (matcher === "toBeDefined" && actual.kind !== ts.SyntaxKind.NullKeyword));
          if (trivial) add("spec-trivial-assertion", n, text(n));
        }
      }
      // <promise>.catch(<swallow>) in a cleanup
      // A best-effort evidence capture (a screenshot) is not a cleanup of test data.
      const caught = ts.isPropertyAccessExpression(n.expression) ? n.expression.expression : undefined;
      const evidence = caught !== undefined && ts.isCallExpression(caught) && EVIDENCE_WORD.test(calleeName(caught) ?? "");
      if (name === "catch" && n.arguments.length >= 1 && swallows(n.arguments[0]!) && !evidence && inCleanup(n)) add("spec-swallowed-cleanup", n, text(n));
    }
    // try { } catch { } in a cleanup
    // An empty catch that says why in a comment is a stated decision (the reviewer judges the reason), not a silent swallow.
    if (ts.isCatchClause(n) && n.block.statements.length === 0 && !/\/[/*]/.test(n.block.getText(sf)) && inCleanup(n)) add("spec-swallowed-cleanup", n, "empty catch block");
    ts.forEachChild(n, visit);
  };
  visit(sf);
  for (const ns of namespaceTest) rawTestImports.push(namespaces.get(ns)!);

  if (usesBrowser && uiFolder) {
    if (fixture) for (const n of rawTestImports) add("spec-fixture-import", n, `import from ${text((n as import("typescript").ImportDeclaration).moduleSpecifier)}`);
    if (!afterEachShot) hits.push({ rule: "spec-afterEach-screenshot", line: first === undefined ? 1 : lineOf(first), context: afterEachAny ? "an afterEach hook with no screenshot" : "no afterEach hook" });
    if (!pomImported && rawPage.length > 0) hits.push({ rule: "spec-raw-page", line: lineOf(rawPage[0]!), context: `${rawPage.length} page call${rawPage.length === 1 ? "" : "s"}, no Page Object imported` });
  }
  return hits.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

/** The testType of a case: from its case file, else its result file. */
function testTypesOf(dir: string, tc: string): string[] {
  for (const rel of [`cases/${tc}.json`, `cases/${tc}-result.json`]) {
    if (!plainRunFile(dir, rel)) continue;
    try {
      const doc = JSON.parse(readFileSync(join(dir, rel), "utf-8")) as unknown;
      const t = isPlain(doc) ? doc["testType"] : undefined;
      if (typeof t === "string") return [t];
      if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
    } catch {
      // an unreadable case: no type
    }
  }
  return [];
}

const hasAuthFixture = (testsDir: string): boolean => {
  try {
    return readdirSync(join(testsDir, "fixtures")).some((n) => /^auth\.fixture\./.test(n));
  } catch {
    return false;
  }
};

/** What one lint did: its findings, and how many files the bounds left out. */
interface LintOptions {
  budgetMs: number;
}

/**
 * Parse and check each spec file (paths from the target root, already resolved). Never throws and one file never stops the others: a file that
 * fails to parse or exceeds a bound gives one spec-unparsed warning, and a file over the size cap is not read (its size is read first). The
 * lint stops at the file count, the total bytes and the wall-clock budget, and says how many files it left out (spec-not-scanned).
 */
async function lintFiles(
  root: string, runId: string, files: readonly string[], cases: ReadonlyMap<string, ReadonlySet<string>>, disabled: ReadonlySet<string>,
  scope: ReadonlySet<string> | null, opts: LintOptions,
): Promise<Finding[]> {
  const paths = readPaths(root);
  if (paths === null || files.length === 0) return [];
  const ts = (await import("typescript")).default;
  const dir = runDir(root, runId);
  const fixture = hasAuthFixture(paths.testsDir);
  const out: Finding[] = [];
  const started = Date.now();
  let bytes = 0;
  let left = 0;
  const say = (rule: string, file: string, context: string): void => {
    if (!disabled.has(rule)) out.push(finding(rule, SPEC_RULES[rule]!, file, MESSAGES[rule]!, context));
  };
  for (const [i, file] of files.entries()) {
    if (i >= MAX_SPEC_FILES || bytes > MAX_TOTAL_BYTES || Date.now() - started > opts.budgetMs) {
      left = files.length - i;
      break;
    }
    const underTests = relative(paths.testsDir, join(paths.targetRoot, file));
    if (!plainRunFile(paths.testsDir, underTests)) continue;
    const abs = join(paths.testsDir, underTests);
    try {
      const size = lstatSync(abs).size;
      if (size > MAX_TEXT_BYTES) {
        say("spec-unparsed", file, "larger than 5 MB: not read");
        continue;
      }
      bytes += size;
      const code = readFileSync(abs, "utf-8");
      const tcs = cases.get(file) ?? new Set<string>();
      // A scoped reissue runs only its listed cases: a spec that only cases outside the list name keeps the state of an earlier round (a warning).
      const carried = scope !== null && tcs.size > 0 && [...tcs].every((tc) => !scope.has(tc));
      const severity = (rule: string): Severity => (carried ? "warning" : SPEC_RULES[rule]!);
      const note = carried ? " (carried case, outside the reissued cases)" : "";
      const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const hits = specHits(ts, sf, fixture, /^specs\//.test(underTests.replace(/\\/g, "/")));
      if (!E2E_NAME.test(basename(file))) {
        const e2e = [...tcs].sort().find((tc) => testTypesOf(dir, tc).some((t) => t.toLowerCase() === "e2e"));
        if (e2e !== undefined) hits.push({ rule: "spec-e2e-suffix", line: 1, context: `${snippet(e2e)} is an E2E case` });
      }
      for (const h of hits) {
        if (disabled.has(h.rule)) continue;
        out.push({ ...finding(h.rule, severity(h.rule), file, MESSAGES[h.rule]!, h.context + note), line: h.line });
      }
    } catch (e) {
      say("spec-unparsed", file, e instanceof RangeError ? "too deeply nested to walk" : "could not be parsed");
    }
  }
  if (left > 0) say("spec-not-scanned", "tests", `${left} of ${files.length} spec file(s) left out by the file, size or time bound`);
  return out;
}

const disabledRules = (root: string): ReadonlySet<string> | null => {
  const disable = readRunConfig(root).reportRules.disable;
  return disable.includes(SPEC_RULE_GROUP) ? null : new Set(disable);
};

/**
 * The spec findings of a full run: every spec file its result files name, checked by the rules above. Reads run files and the spec files only,
 * never spawns a process; async because the compiler is imported on first use. [] for a smoke run, with the group spec-checks disabled, or when
 * nothing could be read; never throws (the barrier that calls it computes it once, outside the run lock).
 */
export async function specFindings(root: string, runId: string): Promise<Finding[]> {
  try {
    const disabled = disabledRules(root);
    if (disabled === null) return [];
    const state = readRun(root, runId);
    if (state.cycleType !== "full") return [];
    const refs = specRefs(root, runId);
    return await lintFiles(root, runId, refs.resolved, refs.cases, disabled, reissueCaseScope(root, runId, state), { budgetMs: BARRIER_BUDGET_MS });
  } catch {
    return [];
  }
}

/**
 * The spec findings of the spec files one work report lists in artifactsProduced (the submit-time lint of the specialists): the same rules,
 * the same resolution (an entry may carry a note in parentheses), no reissue scope. [] when the entries name no spec file.
 */
export async function specFindingsForEntries(root: string, runId: string, entries: readonly string[]): Promise<Finding[]> {
  try {
    const files = specEntryFiles(root, entries);
    if (files.length === 0) return [];
    const disabled = disabledRules(root);
    if (disabled === null) return [];
    const state = readRun(root, runId);
    if (state.cycleType !== "full") return [];
    return await lintFiles(root, runId, files, specRefs(root, runId).cases, disabled, null, { budgetMs: SUBMIT_BUDGET_MS });
  } catch {
    return [];
  }
}

/** The spec files (paths from the target root) that resolve inside the tests directory from the entries of a work report's artifactsProduced. */
export function specEntryFiles(root: string, entries: readonly string[]): string[] {
  const paths = readPaths(root);
  if (paths === null) return [];
  const files = new Set<string>();
  for (const entry of entries) {
    for (const ref of specPathsIn(entry.length > MAX_REF_CHARS ? entry.slice(0, MAX_REF_CHARS) : entry)) {
      const r = resolveRef(paths, ref);
      if (r.ok) files.add(r.rel);
    }
  }
  return [...files].sort();
}

/** The report of the Execution spec lint: every finding of the last attempt, written by the CLI when the barrier computes it. */
export const SPEC_REPORT_REL = "reports/lint/spec-execution.json";

const REMEDIES: Readonly<Record<string, string>> = {
  "spec-trivial-assertion": "assert the behaviour under test instead of a literal against itself",
  "spec-fixture-import": "import test and expect from the QA auth fixture of the tests directory, not from @playwright/test",
};

/**
 * The refusal text of the Execution barrier for spec errors: the count, the first 10 as file:line rule, the path of the full report, and the
 * remedy of each rule that fired. The correction task is one the barrier names (like a Blocked result): the orchestrator adds it for the
 * specialist whose result file names the spec, and the executor's totals are rewritten after a re-run that changes a result.
 */
export function specBlockMessage(errors: readonly Pick<Finding, "file" | "line" | "rule">[]): string {
  const listed = errors.slice(0, 10).map((f) => `${f.file}:${f.line} ${f.rule}`).join("; ");
  const fixes = [...new Set(errors.map((f) => f.rule))].map((r) => `${r}: ${REMEDIES[r] ?? "see the finding"}`).join("; ");
  return `${errors.length} spec check error(s) in the specialists' spec files (${listed}${errors.length > 10 ? "; ..." : ""}; the full list is in ${SPEC_REPORT_REL}). Add a correction task for the specialist whose result file names each spec (its specialist field, or the role that may write the spec path) to the active Execution phase, dispatch it and its SPV, and once the corrections pass their reviews have qa-test-executor rewrite the totals of execution-summary.json when a re-run changed a result, then complete the phase again. Fixes: ${fixes}. reportRules.disable with the group ${SPEC_RULE_GROUP} or one rule id is the owner's recorded exception`;
}

/**
 * Writes SPEC_REPORT_REL (every finding of this attempt) or removes it when there is none; never throws. Called by the CLI outside the run
 * lock, so a refused completion still leaves the full list.
 */
export function recordSpecReport(root: string, runId: string, findings: readonly Finding[]): void {
  const file = join(runDir(root, runId), SPEC_REPORT_REL);
  try {
    if (findings.length === 0) {
      rmSync(file, { force: true });
      return;
    }
    mkdirSync(join(runDir(root, runId), "reports", "lint"), { recursive: true });
    atomicWrite(file, JSON.stringify({ runId, errors: findings.filter((f) => f.severity === "error").length, warnings: findings.filter((f) => f.severity !== "error").length, findings }, null, 2) + "\n");
  } catch {
    // the refusal text still lists the first findings
  }
}
