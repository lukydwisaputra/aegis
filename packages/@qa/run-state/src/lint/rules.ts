import type { ReportRules } from "../config.js";
import type { ResolvedRuleLike } from "./text.js";

export type ResolvedRule = ResolvedRuleLike;

const QA_PROCESS = "this describes how the QA work was run, not the application: say what was tested, on which build, in which test window";

/** The rules every project starts with, each from a real gate rejection (spec, "Item 1"). Patterns look at the words around the word. */
function defaultRules(manualBudgetPercent: number | null): ResolvedRule[] {
  const rule = (id: string, pattern: string, message: string): ResolvedRule => ({ id, re: new RegExp(pattern, "i"), message, severity: "error" });
  const rules: ResolvedRule[] = [
    rule(
      "qa-cycle",
      [
        String.raw`\b(?:this|that)\s+(?:(?:test|qa|testing)\s+)?cycle\b`,
        String.raw`\b(?:test|qa|testing)\s+cycle\b`,
        String.raw`\bcycle\s+(?:took|ran|used|date)\b`,
        String.raw`\bthe\s+cycle\s+(?:took|ran|used|lasted)\b`,
        // The label forms: a bold label anywhere, a line-start label (optional list or quote marker), a table-cell label.
        String.raw`\*\*cycle:?\*\*`,
        String.raw`^\s*(?:(?:[-*+>]|\d+[.)])\s*)*cycle\s*:`,
        String.raw`\|\s*(?:\*\*)?cycle:?(?:\*\*)?\s*\|`,
      ].join("|"),
      `"cycle" for the QA run: ${QA_PROCESS} (use "test window" or "run")`,
    ),
    rule("qa-round", String.raw`\b(?:this|that)\s+round\b(?![\s-]trip)(?!-\w)|\bround\s+\d+\b(?![.,]\d)(?!-\w)`, `"round" for a QA pass: ${QA_PROCESS}`),
    rule("re-verified", String.raw`\bre-?verified\b`, `write "re-tested": "re-verified" is not the customer-facing word`),
    rule("report-history", String.raw`\b(?:prior|previous|earlier|first)\s+drafts?\b|\bsince\s+the\s+previous\s+version\b|\b(?:previous|earlier|prior)\s+(?:version|figure|count)s?\s+of\s+(?:this|the)\s+report\b`, "a customer report states the final facts only: leave out what an earlier draft or version said"),
    rule("internal-task-id", String.raw`(?<![A-Za-z0-9])T-(?:\d{1,6}|[A-Za-z][A-Za-z0-9]{0,29}(?:-[A-Za-z][A-Za-z0-9]{0,29}){0,5}-\d{1,6}|GATE-G\d{1,3})\b`, "an internal task id: name the test case or the defect instead"),
    rule(
      "gate-history",
      [
        String.raw`\b(?:after|per|following|since)\s+(?:the\s+)?(?:owner['’]?s?\s+)?(?:gate\s*[123]|G[123])\s+(?:rejection|decision|reject)\b`,
        String.raw`\bowner\s+G[123]\s+(?:rejection|decision)\b`,
        String.raw`\bthe\s+(?:closure\s+)?draft\s+said\s+(?:\d|that\b)`,
        String.raw`\bthis\s+(?:version|final\s+pass)\s+corrects\s+(?:the\s+)?(?:figures?|counts?|numbers?|totals?|report)\b`,
      ].join("|"),
      "a customer report states the final facts only: leave out the owner's gate decisions and what an earlier draft said",
    ),
  ];
  // Only a run the owner scoped to automated testing: the mention is a finding, a run with a manual budget may describe it.
  if (manualBudgetPercent === 0) {
    rules.push(rule("manual-testing", [
      String.raw`\bmanual(?:ly)?[\s-]+(?:test(?:s|ing|ed)?|budget|categor(?:y|ies)|execution|required\s+test\s+cases?)\b`,
      String.raw`\bexecuted\s+manually\b`,
      String.raw`\bmanual\s+verification\b`,
      String.raw`\bmanually\s+(?:executed|verified|tested)\b`,
    ].join("|"), "this run is automated-only: leave out every mention of manual testing"));
  }
  return rules;
}

/** The brand rule over the customer-facing files (BRAND_CLEAN_RUN_GLOBS): "Aegis", an internal agent name, a framework identifier. */
export const BRAND_NAME = "brand-name";
/** Tier 1: tooling words, run-file paths and names, local servers (TOOLING_WORD_RULES), over the tooling-clean files and the executive inputs. */
export const TOOLING_TIER1 = "tooling-tier1";
/** Tier 2: plain business language (PLAIN_LANGUAGE_RULES), only over what the sign-off and the deck print. */
export const TOOLING_TIER2 = "tooling-tier2";

/**
 * Every built-in text rule id the lint reports, which reportRules.disable switches off and reportRules.allow narrows: the default wording
 * rules (manual-testing only in an automated-only run), the brand rule and the two tooling tiers. The data rules (lint/data.ts) are apart.
 */
export const TEXT_RULE_IDS: readonly string[] = [...defaultRules(0).map((r) => r.id), BRAND_NAME, TOOLING_TIER1, TOOLING_TIER2];

/** The default rules, minus `disable`, plus the project's `extend`. */
export function resolveRules(rules: Omit<ReportRules, "localPorts">, manualBudgetPercent: number | null): ResolvedRule[] {
  const off = new Set(rules.disable);
  const base = defaultRules(manualBudgetPercent).filter((r) => !off.has(r.id));
  const extra = rules.extend.map((e): ResolvedRule => ({ id: e.id, re: new RegExp(e.pattern, e.flags ?? "i"), message: e.message, severity: e.severity ?? "error" }));
  return [...base, ...extra];
}
