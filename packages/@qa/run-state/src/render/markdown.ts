import type { Scenario, TestCase, UserStory } from "@qa/contracts";

// Pure renderers: the Markdown view of a test case and of a scenario, computed from their JSON (and the story JSON a scenario
// belongs to). No I/O, no clock, no filesystem order: the same JSON always gives the same bytes. Every rule prints only fields of
// the JSON; an absent or empty field prints nothing (no empty heading, line or table).

/** The case keys the Markdown prints. With CASE_KEYS_NOT_RENDERED it covers every key of the case schema (a guard test pins it). */
export const CASE_KEYS_RENDERED: readonly string[] = [
  "id", "title", "module", "feature", "scenarioId", "order", "traceability", "testLevel", "testType", "testTechnique", "priority",
  "automationStatus", "automationBlocker", "automatedTestRef", "viewportScope", "requiresManual", "manualReason", "manualJustification",
  "pageObjects", "compliance", "designRationale", "preconditions", "gherkin", "steps", "postconditions", "testData",
];

/** Metadata the Markdown leaves out: who wrote the case and when (author is brand-risky). The JSON keeps them. */
export const CASE_KEYS_NOT_RENDERED: readonly string[] = ["author", "reviewer", "createdAt", "lastUpdatedAt"];

// The labels the case Markdown gives the retest keys it names; any other retest key prints under its own key.
const RETEST_LABELS: Readonly<Record<string, string>> = {
  defectId: "Retest of defect",
  buildDrivenChange: "Build-driven change (not a regression)",
  candidate: "Exploratory candidate",
  executionOrder: "Execution order",
};

const MAX_DEPTH = 3;

type Scalar = string | number | boolean;

function isScalar(v: unknown): v is Scalar {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (isPlainObject(v)) return Object.keys(v).length === 0;
  return false;
}

/** A line break (any form) becomes `<br>`, so a value stays on its line. */
function oneLine(s: string): string {
  return s.replace(/\r\n|\r|\n/g, "<br>");
}

/** A table cell: one line, and a pipe escaped so it cannot split the cell. */
function cell(v: unknown): string {
  return oneLine(plain(v)).replace(/\|/g, "\\|");
}

/** A value as text: a string as is, an array of scalars joined with ", ", anything else as compact JSON. */
function plain(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.every(isScalar)) return v.map(String).join(", ");
  if (v === undefined) return "";
  return JSON.stringify(v);
}

/** `- **Label:** value`, or nothing when the value is empty. */
function fact(lines: string[], label: string, value: unknown): void {
  if (isEmpty(value)) return;
  lines.push(`- **${label}:** ${oneLine(plain(value))}`);
}

/** A fact whose plain-object value prints as nested bullets (two spaces per level, at most MAX_DEPTH levels; deeper as JSON). */
function bullets(lines: string[], label: string, value: unknown, depth = 0): void {
  if (isEmpty(value)) return;
  const indent = "  ".repeat(depth);
  if (isPlainObject(value) && depth < MAX_DEPTH - 1) {
    lines.push(`${indent}- **${label}:**`);
    for (const [k, v] of Object.entries(value)) bullets(lines, k, v, depth + 1);
    return;
  }
  lines.push(`${indent}- **${label}:** ${oneLine(plain(value))}`);
}

function table(header: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string[] {
  return [
    `| ${header.map(cell).join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ];
}

function section(out: string[], heading: string, body: readonly string[]): void {
  if (body.length === 0) return;
  out.push("", `## ${heading}`, "", ...body);
}

function finish(out: string[]): string {
  return `${out.join("\n").replace(/\s+$/, "")}\n`;
}

/** An object whose values are all strings: a two-column table (the verdict oracle). */
function isStringMap(v: unknown): v is Record<string, string> {
  return isPlainObject(v) && Object.keys(v).length > 0 && Object.values(v).every((x) => typeof x === "string");
}

/** An array of flat objects (scalar values only): a table whose header is the union of the keys in first-seen order. */
function isFlatObjectList(v: unknown): v is Array<Record<string, unknown>> {
  return Array.isArray(v) && v.length > 0 && v.every((x) => isPlainObject(x) && Object.values(x).every((y) => y === null || isScalar(y)));
}

function flatObjectTable(rows: ReadonlyArray<Record<string, unknown>>): string[] {
  const header: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!header.includes(k)) header.push(k);
  return table(header, rows.map((r) => header.map((k) => (r[k] === undefined ? "" : r[k]))));
}

/** The Markdown of one test case. Ends with exactly one newline. */
export function renderCaseMarkdown(tc: TestCase): string {
  const out: string[] = [`# ${oneLine(tc.id)}: ${oneLine(tc.title)}`, ""];
  const tr = tc.traceability;

  fact(out, "Module", tc.module);
  fact(out, "Feature", tc.feature);
  fact(out, "Scenario", `${tc.scenarioId} (order ${tc.order})`);
  fact(out, "User story", tr.userStoryId);
  fact(out, "Requirement", tr.requirementId);
  fact(out, "Acceptance criteria covered", tr.acIds);
  fact(out, "Risk", tr.riskId);
  fact(out, "Test level", tc.testLevel);
  fact(out, "Test type", tc.testType);
  fact(out, "Test technique", tc.testTechnique);
  fact(out, "Priority", `${tc.priority.code} (${tc.priority.name})`);
  fact(out, "Automation status", tc.automationStatus);
  fact(out, "Automation blocker", tc.automationBlocker);
  fact(out, "Automated test", tc.automatedTestRef);
  // "all" is the schema default and says nothing; any narrower scope prints.
  if (tc.viewportScope !== "all") fact(out, "Viewport scope", tc.viewportScope);
  if (tc.requiresManual) fact(out, "Requires manual", tc.manualReason ? `yes, ${tc.manualReason}` : "yes");
  else fact(out, "Requires manual", tc.manualReason ? `no, ${tc.manualReason}` : undefined);
  fact(out, "Manual justification", tc.manualJustification);
  fact(out, "Covered by (developer test)", tr.coveredBy?.ref);
  fact(out, "Page object(s)", tc.pageObjects);
  fact(out, "Compliance tags", tc.compliance);

  // The retest block: its plain facts join the fact list (wave first), its tables become sections after the preconditions.
  const testData = tc.testData ?? {};
  const retest = isPlainObject(testData.retest) ? testData.retest : {};
  const retestTables: Array<[string, string[]]> = [];
  const { wave, waveLabel } = retest;
  if (!isEmpty(waveLabel)) {
    const label = plain(waveLabel);
    fact(out, "Retest wave", isEmpty(wave) || label.includes(plain(wave)) ? label : `${label} (wave ${plain(wave)})`);
  } else {
    fact(out, "Retest wave", wave);
  }
  for (const [k, v] of Object.entries(retest)) {
    if (k === "wave" || k === "waveLabel" || isEmpty(v)) continue;
    if (isStringMap(v)) {
      retestTables.push([k === "verdictOracle" ? "Verdict oracle" : k,
        table(k === "verdictOracle" ? ["Verdict", "Condition"] : ["Key", "Value"], Object.entries(v))]);
    } else if (isFlatObjectList(v)) {
      retestTables.push([k, flatObjectTable(v)]);
    } else {
      bullets(out, RETEST_LABELS[k] ?? k, v);
    }
  }

  if (tc.designRationale) section(out, "Design rationale (technique evidence)", [tc.designRationale]);
  section(out, "Preconditions", tc.preconditions.filter((p) => p !== "").map((p) => `- ${oneLine(p)}`));
  for (const [heading, body] of retestTables) section(out, heading, body);
  if (tc.gherkin) {
    const g = tc.gherkin;
    const body: string[] = [];
    for (const [label, clauses] of [["Given", g.given], ["When", g.when], ["Then", g.then]] as const) {
      if (clauses.length === 0) continue;
      if (body.length > 0) body.push("");
      body.push(`**${label}**`, ...clauses.map((c) => `- ${oneLine(c)}`));
    }
    section(out, "Gherkin", body);
  }
  if (tc.steps.length > 0) {
    section(out, "Steps", table(["#", "Action", "Expected"], tc.steps.map((s) => [s.step, s.action, s.expected])));
  }
  section(out, "Postconditions", tc.postconditions.filter((p) => p !== "").map((p) => `- ${oneLine(p)}`));
  const data: string[] = [];
  for (const [k, v] of Object.entries(testData)) if (k !== "retest") bullets(data, k, v);
  section(out, "Test data", data);

  return finish(out);
}

/**
 * The Markdown of one scenario. The heading and the "So that" line come from the story the scenario belongs to; without a story
 * the heading falls back to the scenario title. A case id without JSON prints its row with an empty title and empty AC ids.
 */
export function renderScenarioMarkdown(s: Scenario, cases: ReadonlyMap<string, TestCase>, story?: UserStory): string {
  const heading = story ? `${story.asA} — ${story.iWant}` : s.title;
  const out: string[] = [`# ${oneLine(s.scenarioId)}: ${oneLine(heading)}`, ""];

  fact(out, "Story", s.storyId);
  if (story) fact(out, "So that", story.soThat);
  fact(out, "Test cases (run order)", s.testCaseIds);
  const coverage = Object.entries(s.coverage ?? {}).filter(([, v]) => v.length > 0).map(([k, v]) => `${k} (${v.join(", ")})`);
  fact(out, "Coverage", coverage.join(", "));
  const seed = s.sharedSeed;
  if (seed) {
    const parts: string[] = [];
    if (seed.factory) parts.push(`factory=\`${seed.factory}\``);
    if (seed.reuseAcross && seed.reuseAcross.length > 0) parts.push(`reused across ${seed.reuseAcross.join(", ")}`);
    fact(out, "Shared seed", parts.join(", "));
  }
  const known = new Set(["scenarioId", "storyId", "title", "testCaseIds", "coverage", "sharedSeed"]);
  if (seed) for (const [k, v] of Object.entries(seed)) if (k !== "factory" && k !== "reuseAcross") bullets(out, k, v);
  for (const [k, v] of Object.entries(s)) if (!known.has(k)) bullets(out, k, v);

  if (s.testCaseIds.length > 0) {
    section(out, "Test cases", table(["Order", "TC", "Title", "AC ids"], s.testCaseIds.map((id, i) => {
      const tc = cases.get(id);
      return [tc ? tc.order : i + 1, id, tc ? tc.title : "", tc ? (tc.traceability.acIds ?? []).join(", ") : ""];
    })));
  }
  return finish(out);
}
