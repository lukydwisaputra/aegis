/**
 * STAKEHOLDER_FORBIDDEN_PATTERNS — Class B artefact brand-exposure check.
 * Any human-consumed report, defect, test case, RTM, closure, PR body, or
 * dashboard page must match zero of these patterns.
 *
 * Class A (internal) files are exempt: HANDBOOK.md, docs/, agent definitions,
 * events.jsonl, work reports, SPV reviews, agent-memory.
 */
export const STAKEHOLDER_FORBIDDEN_PATTERNS: RegExp[] = [
  /\baegis\b/i,
  /qa-orchestrator/,
  /qa-test-planner/,
  /qa-test-designer/,
  /qa-requirements-analyst/,
  /qa-environment-engineer/,
  /qa-test-executor/,
  /qa-defect-manager/,
  /qa-closure-reporter/,
  /qa-executive-reporter/,
  /qa-ui-specialist/,
  /qa-api-specialist/,
  /qa-unit-specialist/,
  /qa-performance-specialist/,
  /qa-security-specialist/,
  /qa-accessibility-specialist/,
  /qa-exploratory-specialist/,
  /qa-messaging-specialist/,
  /qa-web-explorer/,
  /qa-ui-designer/,
  /qa-database-specialist/,
  /qa-realtime-specialist/,
  /qa-feature-flag-specialist/,
  /qa-responsive-specialist/,
  /qa-github-(planner|implementer|spv)/,
  /qa-cicd-(planner|implementer|spv|evaluator)/,
  /qa-dev-test-reviewer/,
  /qa-compliance-(iso25010|iso5055|istqb|cmmi|gdpr|pdpa|spv)/,
  /qa-(curator|context-scanner|knowledge-librarian|metrics-collector|event-bus)/,
  /modelTier:/,
  /\.claude\/agents\//,
  /agent-memory\//,
  /events\.jsonl/,
  /Co-Authored-By:.*Aegis/i,
];

/**
 * Returns the first matching pattern if any forbidden string is found.
 * Returns null if clean.
 */
export function checkBrandExposure(text: string): RegExp | null {
  for (const pattern of STAKEHOLDER_FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) return pattern;
  }
  return null;
}

/**
 * TOOLING_WORD_PATTERNS: wording about how the QA work was done, not about the application, kept out of the customer-facing defects,
 * closure and compliance reports (`runs/*\/defects/**`, `reports/closure/**`, `reports/compliance/**`; H1 checks writes to them).
 * Tooling facts belong in events and work reports. The list is small on purpose and keeps to forms that mean tooling:
 * the CLI, the RTM defect map, event sequence numbers, a "framework defect", refusal, review and attempt counts, the SPV, "requested
 * changes", work reports and the "record owner". False positives it risks: a target that has its own command-line tool ("CLI"), a
 * defect about a "work report" feature or a "defect map" screen of the application, or a database column named seq. The H1 refusal
 * names the pattern, and the author rewords or, for a real application term, writes it differently ("command-line tool").
 */
export const TOOLING_WORD_PATTERNS: RegExp[] = [
  /\bCLI\b/,
  /\bdefectMap\b|\bdefect[- ]map\b/i,
  /\bseq\s*(?:no\.?|number|#)?\s*\d+/i,
  /\bevent\s+sequence\b/i,
  /\bframework[- ]defect\b|\bframework\.defect/i,
  /\bcli\.refused\b|\b\d+\s+(?:CLI\s+)?refusals?\b/i,
  /\b(?:review|attempt|rejection)\s+counts?\b/i,
  /\bSPV\b/,
  /\brequested[- ]changes\b/i,
  /\bwork[- ]reports?\b/i,
  /\brecord owner\b/i,
];

/** The first tooling-word pattern the text matches, or null when clean. */
export function checkToolingWords(text: string): RegExp | null {
  for (const pattern of TOOLING_WORD_PATTERNS) {
    if (pattern.test(text)) return pattern;
  }
  return null;
}

/**
 * Class B artefact kinds — these MUST pass the brand-exposure check before writing.
 */
export const CLASS_B_KINDS = new Set([
  "test-plan",
  "test-case",
  "rtm",
  "defect",
  "risk-register",
  "closure-report",
  "coverage",
  "effectiveness",
  "defect-trend",
  "compliance-iso25010",
  "compliance-iso5055",
  "compliance-istqb",
  "compliance-cmmi",
  "compliance-gdpr",
  "compliance-pdpa",
  "executive-technical-report",
  "executive-signoff",
  "executive-slides",
] as const);
