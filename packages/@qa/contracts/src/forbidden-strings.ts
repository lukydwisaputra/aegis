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
 * Tooling wording: how the QA work was done, or where its files live, rather than what the application does. It is kept out of the
 * customer-facing defects, closure and compliance reports (`runs/*\/defects/**`, `reports/closure/**`, `reports/compliance/**`; H1 checks
 * writes to them) and out of everything the executive documents print (the report scripts refuse a closure that carries it).
 * Tooling facts belong in events and work reports. The list is narrow on purpose. Two kinds of rule:
 *  - word rules: the CLI, the RTM defect map, event sequence numbers, a "framework defect", refusal, review and attempt counts, the SPV,
 *    "requested changes", work reports and the "record owner";
 *  - path rules: a path or file name of a run or framework file (`reports/...`, `defects/...`, `cases/...`, `evidence/...`, `runs/...`
 *    followed by a deeper path, a file extension, `*` or an id; bare names such as `coverage.json`, `rtm.md`, `closure.json`,
 *    `triage-summary.md`, `*-result.json`) and local-server references (`localhost`, `127.0.0.1`, `:3002`, "port 3002", the config
 *    ports 54421 and 54422). Plain English ("reports", "cases", "the report of the cases") never matches: a path rule needs a directory
 *    slash plus a deeper path, extension, `*` or id, or a file extension. In a JSON file, a value that is only a path (no whitespace)
 *    under one of the data keys (DATA_PATH_KEYS: evidence, logs, report, unavailableMetrics, ...) is exempt from path rules: it is
 *    data a reader program follows, not prose. The same path inside a sentence, or under any other key, is not exempt.
 * Testing vocabulary stays allowed: oracle, stub, mutation score, HTTP status numbers. A bare severity code ("Sev1") and the word
 * "blocker" are not in the list (severity codes are data in a defect record); the shared wording rule forbids them in prose instead.
 * False positives it risks: a target with its own command-line tool ("CLI"), a "work report" feature or "defect map" screen, a database
 * column named seq, or a target document literally named like a framework file. The denial names the phrase and what to write instead.
 */
export interface ToolingRule {
  pattern: RegExp;
  kind: "word" | "path";
  /** What to write instead of a phrase this rule matched. */
  instead: (phrase: string) => string;
}

const PATH_DIRS = "reports|defects|cases|evidence|runs";
const BARE_NAMES =
  "coverage|rtm|closure|run|events|execution-summary|defect-trend|cycle-time|effectiveness|agent-reliability|flaky|risk-register|target-profile|discovery-report|dev-test-review|plan|triage-summary|residual-risks|executive-deck";

/** The plain document name for a file path or file name. */
function documentName(phrase: string): string {
  const p = phrase.toLowerCase();
  if (/coverage/.test(p)) return "the coverage summary";
  if (/rtm/.test(p)) return "the traceability matrix";
  if (/triage-summary/.test(p)) return "the triage summary";
  if (/closure/.test(p)) return "the closure report";
  if (/-result/.test(p) || /^cases\//.test(p)) return "the case result files";
  if (/^defects\//.test(p)) return "the defect records";
  if (/^evidence\//.test(p)) return "the evidence";
  if (/^reports\/compliance/.test(p)) return "the compliance report";
  if (/plan/.test(p)) return "the test plan";
  if (/events|run\.json|^runs\//.test(p)) return "the run record";
  return "the plain name of the document";
}

export const TOOLING_WORD_RULES: ToolingRule[] = [
  { kind: "word", pattern: /\bCLI\b/, instead: () => "what the application does (a real command-line tool of the target: \"command-line tool\")" },
  { kind: "word", pattern: /\bdefectMap\b|\bdefect[- ]map\b/i, instead: () => "the traceability matrix" },
  { kind: "word", pattern: /\bseq\s*(?:no\.?|number|#)?\s*\d+/i, instead: () => "nothing: event numbers are for the events, not the report" },
  { kind: "word", pattern: /\bevent\s+sequence\b/i, instead: () => "nothing: event numbers are for the events, not the report" },
  { kind: "word", pattern: /\bframework[- ]defect\b|\bframework\.defect/i, instead: () => "nothing: a QA tooling fact belongs in the events and the work report" },
  { kind: "word", pattern: /\bcli\.refused\b|\b\d+\s+(?:CLI\s+)?refusals?\b/i, instead: () => "nothing: refusal counts belong in the events" },
  { kind: "word", pattern: /\b(?:review|attempt|rejection)\s+counts?\b/i, instead: () => "nothing: review and attempt counts belong in the work report" },
  { kind: "word", pattern: /\bSPV\b/, instead: () => "\"the review\"" },
  { kind: "word", pattern: /\brequested[- ]changes\b/i, instead: () => "\"the review asked for changes\" only if the reader needs it, else nothing" },
  { kind: "word", pattern: /\bwork[- ]reports?\b/i, instead: () => "nothing: work reports are internal" },
  { kind: "word", pattern: /\brecord owner\b/i, instead: () => "the named audience (the product owner, the developers)" },
  // Path rules: a run or framework file by its path or name.
  { kind: "path", pattern: new RegExp(`(?<![\\w/.-])(?:${PATH_DIRS})\\/(?:[\\w{}-]+\\/[\\w.*{}-]*|[\\w{}-]*(?:\\.[A-Za-z0-9]{1,6}\\b|\\*)|(?:DEF|TC)-[\\w-]+)`), instead: documentName },
  { kind: "path", pattern: new RegExp(`(?<![\\w/.-])(?:${BARE_NAMES})\\.(?:jsonl?|md)\\b`), instead: documentName },
  { kind: "path", pattern: /(?<![\w/.-])\*?[A-Za-z0-9-]*-result(?:-[\w-]+)?\.json\b/, instead: () => "the case result files" },
  // Local-server references.
  { kind: "path", pattern: /\blocalhost\b/i, instead: () => "the local test server" },
  { kind: "path", pattern: /\b127\.0\.0\.1\b/, instead: () => "the local test server" },
  { kind: "path", pattern: /:(?:3002|3011|3998|54421|54422)\b/, instead: () => "the local test server (no port)" },
  { kind: "path", pattern: /\bports?\s+\d{4,5}\b/i, instead: () => "the local test server (no port)" },
];

export const TOOLING_WORD_PATTERNS: RegExp[] = TOOLING_WORD_RULES.map((r) => r.pattern);

export interface ToolingHit {
  /** The offending phrase as written. */
  phrase: string;
  pattern: RegExp;
  /** What to write instead. */
  instead: string;
  /** Where it was found (a closure.json field path, e.g. "closure.json#openQuestions[3].question"); empty for plain text. */
  location: string;
}

/** JSON keys whose whitespace-free string values are data paths (evidence lists, a report's file, metric file names), not prose. */
export const DATA_PATH_KEYS: ReadonlySet<string> = new Set([
  "evidence", "evidencePaths", "evidenceRef", "logs", "screenshots", "videos", "har", "report", "reportPath", "unavailableMetrics", "file", "files", "path", "paths",
]);

/** Every tooling phrase in a text. `exemptBarePaths`: a text with no whitespace is a data path, not prose, and path rules skip it. */
export function findToolingWords(text: string, opts: { exemptBarePaths?: boolean; location?: string } = {}): ToolingHit[] {
  const hits: ToolingHit[] = [];
  const bare = opts.exemptBarePaths === true && !/\s/.test(text);
  for (const rule of TOOLING_WORD_RULES) {
    if (bare && rule.kind === "path") continue;
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    for (const m of text.matchAll(re)) hits.push({ phrase: m[0], pattern: rule.pattern, instead: rule.instead(m[0]), location: opts.location ?? "" });
  }
  return hits;
}

/**
 * Every tooling phrase in the string values of a JSON-like value (keys are not read), each with its field path under `base`. A
 * whitespace-free value under a DATA_PATH_KEYS key (or inside an array under one) is a data path and skips the path rules.
 */
export function findToolingWordsIn(value: unknown, base: string, dataKey = false): ToolingHit[] {
  if (typeof value === "string") return findToolingWords(value, { exemptBarePaths: dataKey, location: base });
  if (Array.isArray(value)) return value.flatMap((v, i) => findToolingWordsIn(v, `${base}[${i}]`, dataKey));
  if (value !== null && typeof value === "object") return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => findToolingWordsIn(v, `${base}.${k}`, DATA_PATH_KEYS.has(k)));
  return [];
}

/** The first tooling-word pattern the text matches, or null when clean. */
export function checkToolingWords(text: string): RegExp | null {
  return findToolingWords(text)[0]?.pattern ?? null;
}

/**
 * The message the report scripts exit with: the first `max` offending phrases, each with its location and what to write instead, so the
 * orchestrator can report them to the owner. Empty string when there are none.
 */
export function describeToolingHits(hits: readonly ToolingHit[], max = 5): string {
  if (hits.length === 0) return "";
  const shown = hits.slice(0, max).map((h) => `  ${h.location === "" ? "" : `${h.location}: `}"${h.phrase}" -> write ${h.instead}`);
  return `${hits.length} tooling phrase${hits.length === 1 ? "" : "s"} in customer-facing text (first ${shown.length}):\n${shown.join("\n")}`;
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
