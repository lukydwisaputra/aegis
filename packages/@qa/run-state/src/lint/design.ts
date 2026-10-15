import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runDir } from "../paths.js";
import { finding, isPlain, snippet } from "./data-util.js";
import { MAX_TEXT_BYTES } from "./mask.js";
import { plainRunFile } from "./plain-path.js";
import type { Finding } from "./text.js";

/**
 * The design checks of the Design barrier, from the case JSON, the story JSON and dev-test-review.json (reads only):
 * - design-manual-reason-missing (error): a manual case (requiresManual true or automationStatus Manual) states why in manualReason (or
 *   manualJustification) and what it tried in automationBlocker;
 * - design-covered-by-weak (error): a coveredBy that names a developer test the review rates weak, wrong or unmapped records no real coverage;
 * - design-covered-by-unknown (warning): a coveredBy in no file the review lists;
 * - design-dev-test-unused (warning, one finding): criteria an adequate developer test covers that no case records in coveredBy.
 * A coveredBy ref resolves exactly, else through its file: the review lists a file's tests under the names the reviewer gave (a describe
 * block, S05), while a case may name one test inside it.
 */

const CASE_FILE = /^TC-[A-Z]{2,8}-\d{3,}\.json$/;

const MANUAL_REASON =
  "a manual case states why no automation is possible: manualReason (or manualJustification) and automationBlocker, which cites the criterion or the alternatives tried (mock, simulation, visual regression); a case that can run unattended is Automated";
const COVERED_WEAK =
  "a developer test the review rates weak, wrong or unmapped is not coverage: drop coveredBy and design the case as Automated (its script is written in Execution), or name an adequate developer test";
const COVERED_UNKNOWN = "coveredBy names a developer test no file of dev-test-review.json lists: check the path and the test name";
const UNUSED = "a criterion an adequate developer test covers has one case with automationStatus Automated and coveredBy naming that test";

type Verdict = "adequate" | "weak" | "wrong" | "unmapped";
const VERDICTS: readonly string[] = ["adequate", "weak", "wrong", "unmapped"];

interface Review {
  exact: Map<string, Verdict>;
  byFile: Map<string, Verdict[]>;
}

const fileOf = (ref: string): string => ref.split("#")[0]!.trim();

function readJson(dir: string, rel: string): unknown {
  if (!plainRunFile(dir, rel)) return undefined;
  try {
    const raw = readFileSync(join(dir, rel), "utf-8");
    return raw.length > MAX_TEXT_BYTES ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** The developer-test review as far as this check needs it (ref and verdict); null when the file is absent or not a review. */
function readReview(dir: string): Review | null {
  const doc = readJson(dir, "dev-test-review.json");
  if (!isPlain(doc) || !Array.isArray(doc["tests"])) return null;
  const review: Review = { exact: new Map(), byFile: new Map() };
  for (const t of doc["tests"] as unknown[]) {
    if (!isPlain(t) || typeof t["ref"] !== "string" || typeof t["verdict"] !== "string" || !VERDICTS.includes(t["verdict"])) continue;
    const verdict = t["verdict"] as Verdict;
    if (review.exact.get(t["ref"]) !== "adequate") review.exact.set(t["ref"], verdict);
    const file = fileOf(t["ref"]);
    review.byFile.set(file, [...(review.byFile.get(file) ?? []), verdict]);
  }
  return review;
}

/** The verdict of a ref: the test itself, else its file (adequate when any test of the file is; otherwise the first other verdict), else unknown. */
function resolve(review: Review, ref: string): Verdict | "unknown" {
  const exact = review.exact.get(ref);
  if (exact !== undefined) return exact;
  const file = review.byFile.get(fileOf(ref));
  if (file === undefined || file.length === 0) return "unknown";
  return file.includes("adequate") ? "adequate" : file[0]!;
}

const blank = (v: unknown): boolean => typeof v !== "string" || v.trim() === "";

/** A scoped reissue designs only its listed cases: a case outside the list keeps the design of an earlier round, so its error is shown as a warning (as the Blocked checks do). */
const CARRIED = " (carried case, outside the reissued cases)";

export function designFindings(root: string, runId: string, scope: ReadonlySet<string> | null = null): Finding[] {
  const dir = runDir(root, runId);
  const review = readReview(dir);
  const out: Finding[] = [];
  const coveredAcs = new Set<string>();
  let names: string[] = [];
  try {
    names = readdirSync(join(dir, "cases")).filter((n) => CASE_FILE.test(n)).sort();
  } catch {
    // no cases directory: nothing to check
  }
  for (const name of names) {
    const rel = `cases/${name}`;
    const doc = readJson(dir, rel);
    if (!isPlain(doc)) continue; // an unreadable or invalid case is the rendering barrier's business
    const id = typeof doc["id"] === "string" ? doc["id"] : name.replace(/\.json$/, "");
    const carried = scope !== null && !scope.has(id) && !scope.has(name.replace(/\.json$/, ""));
    const error = (rule: string, message: string, context: string): Finding => finding(rule, carried ? "warning" : "error", rel, message, carried ? context + CARRIED : context);
    if (doc["requiresManual"] === true || doc["automationStatus"] === "Manual") {
      const missing = [...(blank(doc["manualReason"]) && blank(doc["manualJustification"]) ? ["manualReason"] : []), ...(blank(doc["automationBlocker"]) ? ["automationBlocker"] : [])];
      if (missing.length > 0) out.push(error("design-manual-reason-missing", MANUAL_REASON, `${snippet(id)}: ${missing.join(", ")} missing`));
    }
    const trace = isPlain(doc["traceability"]) ? doc["traceability"] : {};
    const covered = isPlain(trace["coveredBy"]) ? trace["coveredBy"] : undefined;
    if (covered !== undefined && typeof covered["ref"] === "string") {
      for (const ac of Array.isArray(trace["acIds"]) ? (trace["acIds"] as unknown[]) : []) if (typeof ac === "string") coveredAcs.add(ac);
      if (review !== null) {
        const verdict = resolve(review, covered["ref"]);
        if (verdict === "unknown") out.push(finding("design-covered-by-unknown", "warning", rel, COVERED_UNKNOWN, `${snippet(id)}: ${snippet(fileOf(covered["ref"]))}`));
        else if (verdict !== "adequate") out.push(error("design-covered-by-weak", COVERED_WEAK, `${snippet(id)}: coveredBy names a ${verdict} developer test`));
      }
    }
  }
  if (review !== null) {
    const unused: string[] = [];
    let stories: string[] = [];
    try {
      stories = readdirSync(join(dir, "stories")).filter((n) => n.endsWith(".json")).sort();
    } catch {
      // no stories directory
    }
    for (const name of stories) {
      const doc = readJson(dir, `stories/${name}`);
      const criteria = isPlain(doc) && Array.isArray(doc["acceptanceCriteria"]) ? (doc["acceptanceCriteria"] as unknown[]) : [];
      for (const ac of criteria) {
        if (!isPlain(ac) || typeof ac["id"] !== "string" || !Array.isArray(ac["devTestRefs"])) continue;
        const adequate = (ac["devTestRefs"] as unknown[]).some((r) => typeof r === "string" && resolve(review, r) === "adequate");
        if (adequate && !coveredAcs.has(ac["id"])) unused.push(ac["id"]);
      }
    }
    if (unused.length > 0) {
      out.push(finding("design-dev-test-unused", "warning", "stories", UNUSED, `${unused.length} ${unused.length === 1 ? "criterion" : "criteria"} with an adequate developer test and no case recording it, first ${snippet(unused[0]!)}`));
    }
  }
  return out;
}

/**
 * The refusal of the Design barrier for design errors: the first findings as file rule, and what fixes them. The test designer's own task
 * is already done and reviewed, so the fix is a correction task for it. In an automated-only scope (testing.manualBudgetPercent 0) the
 * designer never writes a manualReason (qa-test-designer.md): the case is re-designed as Automated.
 */
export function designBlockMessage(errors: readonly Pick<Finding, "file" | "rule" | "context">[], automatedOnly = false): string {
  const listed = errors.slice(0, 10).map((f) => `${f.file} ${f.rule} (${f.context})`).join("; ");
  const manual = errors.some((f) => f.rule === "design-manual-reason-missing");
  const weak = errors.some((f) => f.rule === "design-covered-by-weak");
  const fixes: string[] = [];
  if (manual) {
    fixes.push(
      automatedOnly
        ? "the scope is automated testing only (testing.manualBudgetPercent 0), so no manual case is written and no manualReason: the designer re-designs the case as Automated with a script, or records the criterion in the RTM as Not verified or Out of scope"
        : "a manual case states manualReason and automationBlocker (the criterion or the alternatives tried: mock, simulation, visual regression), or is re-designed as Automated",
    );
  }
  if (weak) fixes.push("a coveredBy names an adequate developer test of dev-test-review.json, or is dropped and the case is designed as Automated (its script is written in Execution)");
  return `${errors.length} design check error(s): ${listed}${errors.length > 10 ? "; ..." : ""}. Add a correction task for qa-test-designer to the active Design phase (its earlier task is already done): it corrects each case JSON (${fixes.join("; ")}) and runs aegis cases render, then complete the phase again; reportRules.disable with the group design-checks is the owner's recorded exception`;
}
