import { exitQualification } from "./closure-view.js";

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
 *  - path rules: the framework's own bookkeeping, by name or path: `coverage.json`, `rtm.json`, `rtm.md`, `closure.json`, `closure.md`,
 *    `run.json`, `events.jsonl`, `execution-summary.md|json`, `triage-summary.md`, `risk-register.*`, the metric file names, anything under
 *    `reports/metrics|work|review|closure|compliance|mutation|executive` (with or without a `runs/<run-id>/` prefix), a glob over run files (`defects/*.json`, `cases/*-result.json`), a result file that is
 *    not a case result (`*-result.json`), and local-server references (`localhost`, `127.0.0.1`, `:3002`, "port 3002", the config
 *    ports 54421 and 54422). NEVER flagged, because citing proof is how a defect record or a compliance report works: `evidence/...` and
 *    `runs/<run-id>/evidence/...` paths, `cases/<TC-id>...` and `defects/<DEF-id>...` references (record or evidence citations, a case
 *    result `TC-AUTH-001-result.json` included, with or without its folder), and markdown links to them. Plain English ("reports",
 *    "cases") never matches. In a JSON file, a value that is only a path (no whitespace) under one of the data keys (DATA_PATH_KEYS:
 *    evidence, logs, report, unavailableMetrics, ...) is data a reader program follows and is exempt too.
 * Testing vocabulary stays allowed in tier 1 (the technical report, the hook): oracle, stub, mutation score, HTTP status numbers; tier 2
 * (PLAIN_LANGUAGE_RULES, the sign-off and the deck) refuses it. A bare severity code ("Sev1") and the word
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

const BARE_NAMES = "coverage|rtm|closure|run|events|execution-summary|triage-summary|risk-register|defect-trend|cycle-time|effectiveness|agent-reliability|flaky";

/** The plain document name for a file path or file name. */
function documentName(phrase: string): string {
  const p = phrase.toLowerCase();
  if (/coverage/.test(p)) return "the coverage summary";
  if (/rtm/.test(p)) return "the traceability matrix";
  if (/triage-summary/.test(p)) return "the triage summary";
  if (/closure/.test(p)) return "the closure report";
  if (/-result/.test(p) || /cases\//.test(p)) return "the case result files";
  if (/defects\//.test(p)) return "the defect records";
  if (/evidence\//.test(p)) return "the evidence";
  if (/reports\/compliance/.test(p)) return "the compliance report";
  if (/reports\/metrics/.test(p)) return "the coverage summary";
  if (/reports\/mutation/.test(p)) return "the mutation test report";
  if (/reports\/(work|review)/.test(p)) return "nothing: work reports and reviews are internal";
  if (/reports\/executive/.test(p)) return "the executive report";
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
  // Path rules: the framework's bookkeeping by path or name. Evidence, case and defect citations are NOT in this list.
  { kind: "path", pattern: new RegExp(`(?<![\\w.-])(?:runs\\/RUN-\\d{8}-\\d{3}\\/)?reports\\/(?:metrics|work|review|closure|compliance|mutation|executive)\\b[\\w./*{}-]*`), instead: documentName },
  { kind: "path", pattern: /(?<![\w.-])(?:cases|defects|evidence)\/[^\s)`]*\*[^\s)`]*/, instead: documentName },
  { kind: "path", pattern: new RegExp(`(?<![\\w.-])(?:${BARE_NAMES})\\.(?:jsonl?|md)\\b`), instead: documentName },
  // A result file is a case citation only when it names a case (TC-AUTH-001-result.json); a glob or any other *-result.json is bookkeeping.
  { kind: "path", pattern: /(?<![\w.-])(?!TC-[A-Z]{2,8}-\d)[A-Za-z*][\w*-]*-result(?:-[\w-]+)?\.json\b/, instead: () => "the case result files" },
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
 * TIER 2: plain business language. The sign-off is a formal attestation for stakeholders and the deck is business language; both print or
 * summarise closure prose, so a closure whose sign-off-fed fields (see signoffFedTexts) or a deck whose content carries engineering
 * vocabulary is refused (sign-off exit 9, deck exit 10), with the plain replacement for each phrase. The technical report is an
 * engineering document: it uses tier 1 (TOOLING_WORD_RULES) only, so HTTP status numbers, route paths, CWE ids, oracle, stub and
 * mutation score stay acceptable there and in the case results and defect records. Rules: oracle, stub, mutant or mutation, an env flag
 * in CAPITAL_SNAKE_CASE, an HTTP status written as a number beside status/HTTP/answers/returns/code, CWE- and WSTG- ids, API route paths,
 * snake_case code strings, "exit code", "build cache", "bypass module", "HTTP route", "no PR", "NRIC/SPD", a bare severity code
 * ("Sev1" without its word) and the noun "blocker" (the severity name "(Blocker)" and a count such as "1 Blocker" are allowed).
 */
export const PLAIN_LANGUAGE_RULES: Array<{ pattern: RegExp; instead: string }> = [
  { pattern: /\boracles?\b/i, instead: "the expected result" },
  { pattern: /\bstubs?\b/i, instead: "a locally built stand-in" },
  { pattern: /\bmutants?\b|\bmutation\b/i, instead: "a test of the tests" },
  { pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/, instead: "the setting, described in words (for example \"the switch that hides new features\")" },
  { pattern: /\b(?:HTTP|status(?:\s+code)?|answers?|returns?|returned|responds?|responded|code)\s*:?\s*[2-5]\d\d\b|\b[2-5]\d\d\s+(?:status|response|error|expected|observed)\b|\bx\s*[2-5]\d\d\b/i, instead: "the outcome in words: a refusal status, a success status, a server error" },
  { pattern: /\b(?:CWE|WSTG)-[\w.-]+/, instead: "the weakness or test category in words" },
  { pattern: /(?<![\w])\/api\/[\w/{}.-]*/, instead: "the feature in words (for example \"the export feature\")" },
  { pattern: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/, instead: "the code or field, described in words" },
  { pattern: /\bexit codes?\b/i, instead: "what it reported" },
  { pattern: /\bbuild cache\b/i, instead: "the test server's working files" },
  { pattern: /\bbypass module\b/i, instead: "the code that skips sign-in during testing" },
  { pattern: /\bHTTP routes?\b/i, instead: "the page address" },
  { pattern: /\bno PR\b/i, instead: "no fix recorded" },
  { pattern: /\bNRIC\/SPD\b/, instead: "personal identity data" },
  { pattern: /\bSev[1-5]\b(?!\s*\()/, instead: "the severity with its word (\"Sev1 (Blocker)\")" },
  { pattern: /(?<!\()(?<!\d\s)\bblockers?\b(?!\))/i, instead: "what stopped the check, in words" },
  { pattern: /\bship\s*\/\s*no[- ]ship\b|\bno[- ]ship\b/i, instead: "nothing: the document itself says it gives no release recommendation and no compliance verdict" },
];

export interface PlainLanguageHit {
  phrase: string;
  instead: string;
  location: string;
}

/** Every tier-2 phrase in a text. */
export function findPlainLanguage(text: string, location = ""): PlainLanguageHit[] {
  const hits: PlainLanguageHit[] = [];
  for (const rule of PLAIN_LANGUAGE_RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    for (const m of text.matchAll(re)) hits.push({ phrase: m[0], instead: rule.instead, location });
  }
  return hits;
}

/** Every tier-2 phrase in the string values of a JSON-like value, each with its field path under `base`. */
export function findPlainLanguageIn(value: unknown, base: string): PlainLanguageHit[] {
  if (typeof value === "string") return findPlainLanguage(value, base);
  if (Array.isArray(value)) return value.flatMap((v, i) => findPlainLanguageIn(v, `${base}[${i}]`));
  if (value !== null && typeof value === "object") return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => findPlainLanguageIn(v, `${base}.${k}`));
  return [];
}

/** Like describeToolingHits, for tier-2 hits. */
export function describePlainLanguageHits(hits: readonly PlainLanguageHit[], max = 5): string {
  if (hits.length === 0) return "";
  const shown = hits.slice(0, max).map((h) => `  ${h.location === "" ? "" : `${h.location}: `}"${h.phrase}" -> write ${h.instead}`);
  return `${hits.length} engineering term${hits.length === 1 ? "" : "s"} in text for stakeholders (first ${shown.length}):\n${shown.join("\n")}`;
}

/**
 * The closure.json text the sign-off prints, each with its field, for the tier-2 check: the criterion of every exit criterion and the
 * stated reason of an unmet one, the plan variances (variance and reason), the case-of-record basis, the out-of-scope reasons, the
 * reconciliation of the case figures, the wrong-step notes of falsePasses, and the residual risks (the executive reporter's plain sentence,
 * else the closure title); the open-defect lines the sign-off prints are checked by the script from the view. Nothing else is printed; falsePasses and openQuestions are printed by the technical report only (tier 1).
 */
export function signoffFedTexts(closure: unknown, plainRisk?: ReadonlyMap<string, string>): Array<{ location: string; text: string }> {
  const out: Array<{ location: string; text: string }> = [];
  const c = closure !== null && typeof closure === "object" && !Array.isArray(closure) ? (closure as Record<string, unknown>) : {};
  const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const add = (location: string, v: unknown): void => { if (typeof v === "string" && v.trim() !== "") out.push({ location, text: v }); };
  (Array.isArray(c["exitCriteria"]) ? c["exitCriteria"] : []).forEach((e, i) => {
    const r = rec(e);
    add(`closure.json.exitCriteria[${i}].criterion`, typeof e === "string" ? e : (r["criterion"] ?? r["name"]));
    if (r["met"] !== true || exitQualification(e) !== null) add(`closure.json.exitCriteria[${i}].evidence`, r["evidence"] ?? r["difference"] ?? r["reason"]);
    add(`closure.json.exitCriteria[${i}].qualification`, r["qualification"]);
  });
  (Array.isArray(c["variancesFromPlan"]) ? c["variancesFromPlan"] : []).forEach((v, i) => {
    add(`closure.json.variancesFromPlan[${i}]`, typeof v === "string" ? v : undefined);
    add(`closure.json.variancesFromPlan[${i}].variance`, rec(v)["variance"]);
    add(`closure.json.variancesFromPlan[${i}].reason`, rec(v)["reason"]);
  });
  const rs = rec(c["resultsSummary"]);
  add("closure.json.resultsSummary.caseOfRecord.basis", rec(rs["caseOfRecord"])["basis"]);
  (Array.isArray(rs["outOfScope"]) ? rs["outOfScope"] : []).forEach((o, i) => add(`closure.json.resultsSummary.outOfScope[${i}].reason`, rec(o)["reason"]));
  const recs = Array.isArray(c["reconciliations"]) ? c["reconciliations"] : [];
  const at = recs.findIndex((r) => typeof rec(r)["point"] === "string" && /case figures|case counts|pass rate/i.test(rec(r)["point"] as string) && typeof rec(r)["statement"] === "string");
  if (at >= 0) add(`closure.json.reconciliations[${at}].statement`, rec(recs[at])["statement"]);
  else add("closure.json.metrics.passRateBasisNote", rec(c["metrics"])["passRateBasisNote"]);
  for (const [key, v] of Object.entries(rec(c["falsePasses"]))) {
    const r = rec(v);
    if (typeof r["wrongStep"] !== "string") continue;
    for (const f of ["requirement", "wrongStep", "whatConforms", "whatThePassMeans"]) add(`closure.json.falsePasses.${key}.${f}`, r[f]);
  }
  const own = rec(c["ownMistakesCorrected"]);
  add("closure.json.ownMistakesCorrected.note", own["note"]);
  (Array.isArray(own["items"]) ? own["items"] : []).forEach((it, i) => {
    for (const f of ["case", "earlier", "now", "what"]) add(`closure.json.ownMistakesCorrected.items[${i}].${f}`, rec(it)[f]);
  });
  (Array.isArray(c["residualRiskSummary"]) ? c["residualRiskSummary"] : []).forEach((r, i) => {
    const id = rec(r)["riskId"];
    const plain = typeof id === "string" ? plainRisk?.get(id) : undefined;
    if (plain === undefined) add(`closure.json.residualRiskSummary[${i}].title`, rec(r)["title"]);
  });
  for (const [id, plain] of plainRisk ?? []) add(`residual-risks.json[${id}].plain`, plain);
  return out;
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
