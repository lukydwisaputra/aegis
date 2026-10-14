import type { ReportRules } from "../config.js";
import type { ResolvedRuleLike } from "./text.js";

export type ResolvedRule = ResolvedRuleLike;

const QA_PROCESS = "this describes how the QA work was run, not the application: say what was tested, on which build, in which test window";

/** The rules every project starts with, each from a real gate rejection (spec, "Item 1"). Patterns look at the words around the word. */
function defaultRules(manualBudgetPercent: number | null): ResolvedRule[] {
  const rule = (id: string, pattern: string, message: string): ResolvedRule => ({ id, re: new RegExp(pattern, "i"), message, severity: "error" });
  const rules: ResolvedRule[] = [
    rule("qa-cycle", String.raw`\b(?:this|the|that|current|previous|last|next|whole|full|entire|same)\s+(?:(?:test|qa|testing)\s+)?cycle\b|\bcycle\s+(?:took|ran|used|date)\b|^\s*[-*]?\s*\**cycle\**\s*:`, `"cycle" for the QA run: ${QA_PROCESS} (use "test window" or "run")`),
    rule("qa-round", String.raw`\b(?:this|that|previous|last|next)\s+round\b|\bround\s+\d+\b`, `"round" for a QA pass: ${QA_PROCESS}`),
    rule("re-verified", String.raw`\bre-?verified\b`, `write "re-tested": "re-verified" is not the customer-facing word`),
    rule("report-history", String.raw`\b(?:prior|previous|earlier|first|last)\s+(?:draft|version|figure|count)s?\b|\bsince\s+the\s+previous\s+version\b|\b(?:corrected|changed|updated)\s+from\s+\d`, "a customer report states the final facts only: leave out what an earlier draft or version said"),
    rule("internal-task-id", String.raw`\bT-(?:\d+|[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z][A-Za-z0-9]*)*-\d+|GATE-G\d+)\b`, "an internal task id: name the test case or the defect instead"),
  ];
  // Only a run the owner scoped to automated testing: the mention is a finding, a run with a manual budget may describe it.
  if (manualBudgetPercent === 0) {
    rules.push(rule("manual-testing", String.raw`\bmanual(?:ly)?[\s-]+(?:test(?:s|ing|ed)?|budget|categor(?:y|ies)|execution|required\s+test\s+cases?)\b`, "this run is automated-only: leave out every mention of manual testing"));
  }
  return rules;
}

/** The default rules, minus `disable`, plus the project's `extend`. */
export function resolveRules(rules: ReportRules, manualBudgetPercent: number | null): ResolvedRule[] {
  const off = new Set(rules.disable);
  const base = defaultRules(manualBudgetPercent).filter((r) => !off.has(r.id));
  const extra = rules.extend.map((e): ResolvedRule => ({ id: e.id, re: new RegExp(e.pattern, e.flags ?? "i"), message: e.message, severity: e.severity ?? "error" }));
  return [...base, ...extra];
}
