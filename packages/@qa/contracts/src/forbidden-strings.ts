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
  /qa-email-specialist/,
  /qa-web-explorer/,
  /qa-ui-designer/,
  /qa-database-specialist/,
  /qa-realtime-specialist/,
  /qa-feature-flag-specialist/,
  /qa-responsive-specialist/,
  /qa-github-(planner|implementer|spv)/,
  /qa-cicd-(planner|implementer|spv|evaluator)/,
  /qa-compliance-(iso25010|iso5055|istqb|cmmi|gdpr|pdpa)/,
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
