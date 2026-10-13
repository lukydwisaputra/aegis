import React from "react";
import {
  renderToBuffer,
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";

// A word is never split at a line end ("DEF-001-AD-MIN-DATA", "inter-face"): identifiers and ids stay readable and searchable in the PDF text.
Font.registerHyphenationCallback((word) => [word]);

// ─── Tone-check ───────────────────────────────────────────────────────────────

// ~30 banned jargon terms (technical) with their plain-English rewrites
export const JARGON_RULES: Array<{
  pattern: RegExp;
  rewrite: (match: string) => string;
}> = [
  {
    pattern: /p95 latency (\d+)ms/gi,
    rewrite: (m) => {
      const ms = m.match(/(\d+)ms/i)?.[1];
      return `the slowest 5% of requests take ${ms}ms`;
    },
  },
  {
    pattern: /p99 latency/gi,
    rewrite: () => "the slowest 1% of requests",
  },
  { pattern: /\bp95\b/gi, rewrite: () => "95th-percentile response time" },
  { pattern: /\bp99\b/gi, rewrite: () => "99th-percentile response time" },
  { pattern: /\bLCPs?\b/g, rewrite: () => "page load time" },
  { pattern: /\bINPs?\b/g, rewrite: () => "user interaction speed" },
  { pattern: /\bCLSs?\b/g, rewrite: () => "visual layout stability" },
  { pattern: /\bTTFBs?\b/g, rewrite: () => "server response time" },
  { pattern: /\bFCPs?\b/g, rewrite: () => "time until first content appears" },
  { pattern: /\bMTTR\b/g, rewrite: () => "average time to recover from an incident" },
  { pattern: /\bMTTD\b/g, rewrite: () => "average time to detect an issue" },
  { pattern: /\bDORA\b/gi, rewrite: () => "industry deployment performance" },
  {
    pattern: /\bCFR\b|change failure rate/gi,
    rewrite: () => "percentage of deploys that cause incidents",
  },
  {
    pattern: /\bDRE\b|defect removal efficiency/gi,
    rewrite: () => "percentage of bugs caught before release",
  },
  {
    pattern: /\bRTMs?\b|requirements traceability matrix/gi,
    rewrite: () => "test coverage map",
  },
  { pattern: /RBAC/gi, rewrite: () => "role-based access control" },
  { pattern: /monorepo/gi, rewrite: () => "shared codebase" },
  {
    pattern: /semver|semantic versioning/gi,
    rewrite: () => "version numbering",
  },
  { pattern: /\bAPI\b/g, rewrite: () => "application interface" },
  { pattern: /\bCVEs?\b/g, rewrite: () => "known security vulnerability" },
  { pattern: /\bCVSS\b/gi, rewrite: () => "security severity score" },
  { pattern: /\baxe\b/gi, rewrite: () => "accessibility scanner" },
  { pattern: /\bWCAG\b/g, rewrite: () => "accessibility standard" },
  { pattern: /ISO 25010/gi, rewrite: () => "software quality standard" },
  { pattern: /ISO 5055/gi, rewrite: () => "code quality standard" },
];

/**
 * Identifier-shaped tokens: artefact ids (DEF-004-ATT-API, TC-AUTH-001, REQ-REG-04, STORY-..., SCN-..., AC-..., RUN-..., OQ-12, RISK-...,
 * RQ-..., AMB-..., GAP-...) and compliance tags (WSTG-, CWE-, WCAG-, GDPR-, PDPA-, ISTQB-, CMMI-, ISO25010-...). No tone-check or jargon
 * replacement ever rewrites a word inside one: "DEF-004-ATT-API" must never print as "DEF-004-ATT-application interface".
 */
const IDENTIFIER =
  /\b(?:(?:DEF|TC|REQ|STORY|SCN|AC|RUN|OQ|RISK|RQ|AMB|GAP)-[A-Za-z0-9](?:[A-Za-z0-9.\-]*[A-Za-z0-9])?|(?:WSTG|CWE|WCAG|GDPR|PDPA|ISTQB|CMMI|ISO\d{4,5})-[A-Za-z0-9](?:[A-Za-z0-9.\-]*[A-Za-z0-9])?)\b/g;

/** Replace every identifier by a placeholder no rule matches; returns the masked text and the way back. */
function maskIdentifiers(text: string): { masked: string; restore: (t: string) => string } {
  const found: string[] = [];
  const masked = text.replace(IDENTIFIER, (id) => `\u0001${found.push(id) - 1}\u0002`);
  return { masked, restore: (t) => t.replace(/\u0001(\d+)\u0002/g, (_m, i: string) => found[Number(i)] ?? "") };
}

/**
 * Apply all jargon rewrites to a text string.
 * Rules are applied in order; each rule operates on the result of the previous. Identifiers (see IDENTIFIER) are masked first and put
 * back unchanged, so no rule rewrites a word inside one.
 */
export function applyJargonRewrites(text: string): string {
  const { masked, restore } = maskIdentifiers(text);
  return restore(
    JARGON_RULES.reduce((current, rule) => {
      return current.replace(rule.pattern, (match) => rule.rewrite(match));
    }, masked)
  );
}

/**
 * Check if text contains jargon; returns list of flagged phrases with
 * their plain-English suggestions.
 */
export function detectJargon(
  text: string
): Array<{ original: string; suggested: string }> {
  const findings: Array<{ original: string; suggested: string }> = [];
  text = maskIdentifiers(text).masked;
  for (const rule of JARGON_RULES) {
    // Reset lastIndex so global regexes match from the start
    rule.pattern.lastIndex = 0;
    const matches = text.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags));
    for (const match of matches) {
      const original = match[0];
      if (original !== undefined) {
        findings.push({ original, suggested: rule.rewrite(original) });
      }
    }
    rule.pattern.lastIndex = 0;
  }
  return findings;
}

// ─── Slide deck spec ──────────────────────────────────────────────────────────

export interface SlideSpec {
  title: string;
  keyFinding: string; // Slide 1 punchline
  supportingInsights: Array<{
    what: string; // data point
    soWhat: string; // business meaning
    nowWhat: string; // recommended action
  }>;
  recommendations: Array<{
    action: string;
    owner: string;
    deadline: string;
    impact: "HIGH" | "MEDIUM" | "LOW";
  }>;
  residualRisks: Array<{
    plain: string; // business-language risk description
  }>;
}

// ─── Technical report spec ────────────────────────────────────────────────────

export interface TechnicalReportSpec {
  runId: string;
  projectName: string;
  generatedAt: string;
  scope: string;
  /** null = the input was absent; the report prints "not available", never 0. */
  metrics: {
    totalTests: number | null;
    passed: number | null;
    failed: number | null;
    /** Checks that passed in part; omitted by callers that do not know it, null prints "not available". */
    partial?: number | null;
    blocked: number | null;
    skipped: number | null;
    /** Checks with a result whose outcome could not be determined; omitted by callers that do not know it, null prints "not available". */
    undetermined?: number | null;
    /** Designed checks the owner descoped; printed as its own row only when above 0, and never part of totalTests. */
    outOfScope?: number | null;
    passRate: number | null;
    coveragePercent: number | null;
    openDefects: number | null;
    /** Deprecated and never printed: a record that is not open is fixed, reframed or withdrawn (see defectHeadline), not "closed". */
    closedDefects?: number | null;
  };
  /**
   * The defect headline block: open application defects (with how many are PARTIALLY FIXED), fixed, reframed (a requirement or hardening
   * question, not open) and report withdrawn. When set it replaces the single "Open Defects" row.
   */
  defectHeadline?: {
    open: number | null;
    openPartiallyFixed: number | null;
    fixed: number | null;
    reframed: number | null;
    reportWithdrawn: number | null;
    closedWithoutVerdict?: number | null;
  };
  /** States which bases the case figures follow (coverage rollup, execution summary, case of record); printed under the summary table. */
  caseNote?: string | null;
  /** The closure's own reconciliation of the case figures; printed only when caseNote does not already carry it. */
  reconciliation?: string | null;
  /** The open application defects, one printed line each (id, severity word, state, title, what it awaits), shown before the defect log. */
  openDefectLines?: string[];
  /** Designed checks the owner descoped, each with the owner's reason. */
  outOfScopeCases?: Array<{ caseId: string; reason: string }>;
  /** The defect log: severity reads "Sev4 (Minor)", status the retest verdict or "Open (new this cycle)"; callers pass it open first. */
  defects: Array<{
    id: string;
    title: string;
    severity: string;
    status: string;
  }>;
  /** Coverage gaps per standard. `covered` is no longer printed (it had no stated unit); `highGaps` is the number rated high. */
  compliance: Record<string, { covered: number | null; gapped: number | null; highGaps?: number | null }>;
  /** Totals and the no-verdict statement printed under the compliance table. */
  complianceTotals?: { reports: number | null; totalGaps: number | null; totalHighGaps: number | null; note?: string | null };
  /** Narrative sections, all taken from the closure report; each is printed only when it has content. */
  variances?: Array<{ variance: string; reason: string | null }>;
  exitCriteria?: Array<{ criterion: string; met: boolean; evidence: string | null }>;
  openQuestions?: Array<{ audience: string; questions: Array<{ id: string; priority: string | null; question: string; also?: string | null }> }>;
  falsePasses?: Array<{ case: string; finding: string; latestResult: string | null }>;
  /** A passed case whose first failure came from a wrong test step, in the closure's words; printed beside the false passes. */
  wrongStepNotes?: Array<{ requirement: string | null; wrongStep: string; whatConforms: string | null; whatThePassMeans: string | null }>;
  residualRisks?: Array<{ title: string; rating: string | null; mitigationStatus: string | null; residualExposure: string | null }>;
  /** Optional evidence index — base64-encoded PNG data URIs keyed by defect ID */
  evidenceScreenshots?: Array<{
    defectId: string;
    tcId?: string;
    /** base64 data URI: "data:image/png;base64,..." */
    dataUri: string;
    label: string;
  }>;
}

// ─── Sign-off document spec ───────────────────────────────────────────────────

/** The owner's Gate 3 decision as recorded in gates/gate-3-decision.json#decision. */
export type SignoffDecision = "approved" | "approved-with-conditions" | "rejected";

/** What the banner prints for each decision. */
export const SIGNOFF_DECISION_TEXT: Readonly<Record<SignoffDecision, string>> = {
  approved: "APPROVED",
  "approved-with-conditions": "APPROVED WITH CONDITIONS",
  rejected: "REJECTED",
};

/** The banner label: the decision is the owner's, not the QA team's release judgement. */
export const SIGNOFF_DECISION_LABEL = "GATE 3 DECISION (owner)";

export interface SignoffSpec {
  projectName: string;
  version: string;
  signoffDate: string;
  documentId: string;
  scope: string;
  decision: SignoffDecision;
  exitCriteria: Array<{ criterion: string; met: boolean }>;
  /** The line printed when exitCriteria is empty; defaults to "Exit criteria: not available". */
  exitCriteriaNote?: string;
  openDefectsSummary: string;
  residualRisk: string;
  /** Further blocks printed after the exit criteria (tests executed, variances, defects, compliance coverage, unmet criteria, out of scope). */
  sections?: Array<{ title: string; lines: string[] }>;
  signatoryRoles: string[]; // e.g. ["QA Lead", "Engineering Lead", "Product Owner"]
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const baseStyles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 11,
    padding: 40,
    color: "#1a1a1a",
    backgroundColor: "#ffffff",
  },
  header: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    marginBottom: 12,
    color: "#0d3b66",
  },
  subheader: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
    color: "#1a5276",
  },
  section: {
    marginBottom: 16,
  },
  label: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: "#555555",
    marginBottom: 2,
  },
  body: {
    fontSize: 11,
    lineHeight: 1.5,
    marginBottom: 4,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: "#cccccc",
    marginBottom: 12,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    marginBottom: 4,
  },
  cell: {
    flex: 1,
    fontSize: 10,
  },
  cellBold: {
    flex: 1,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  tag: {
    fontSize: 9,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    marginRight: 4,
  },
  tagHigh: {
    backgroundColor: "#fdecea",
    color: "#c0392b",
  },
  tagMedium: {
    backgroundColor: "#fef9e7",
    color: "#d68910",
  },
  tagLow: {
    backgroundColor: "#eafaf1",
    color: "#1e8449",
  },
  checkmark: {
    width: 16,
    fontSize: 10,
    marginRight: 6,
  },
  exitStatus: {
    width: 44,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginRight: 6,
  },
  decisionApproved: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#1e8449",
  },
  decisionRejected: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#c0392b",
  },
  decisionConditions: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#d68910",
  },
});

// ─── Slide deck component ─────────────────────────────────────────────────────

function SlideDeckDocument({ spec }: { spec: SlideSpec }) {
  const impactStyle = (impact: "HIGH" | "MEDIUM" | "LOW") => {
    if (impact === "HIGH") return { ...baseStyles.tag, ...baseStyles.tagHigh };
    if (impact === "MEDIUM")
      return { ...baseStyles.tag, ...baseStyles.tagMedium };
    return { ...baseStyles.tag, ...baseStyles.tagLow };
  };

  return React.createElement(
    Document,
    null,
    // Slide 1: Title + Key Finding
    React.createElement(
      Page,
      { size: "A4", style: baseStyles.page, orientation: "landscape" },
      React.createElement(
        View,
        { style: { flex: 1, justifyContent: "center" } },
        React.createElement(Text, { style: baseStyles.header }, spec.title),
        React.createElement(View, { style: baseStyles.divider }),
        React.createElement(
          Text,
          { style: { fontSize: 16, lineHeight: 1.6, color: "#1a5276" } },
          spec.keyFinding
        )
      )
    ),
    // Slides 2-N: Supporting insights (one per slide, up to 5)
    ...spec.supportingInsights.slice(0, 5).map((insight, i) =>
      React.createElement(
        Page,
        {
          key: `insight-${i}`,
          size: "A4",
          style: baseStyles.page,
          orientation: "landscape",
        },
        React.createElement(
          Text,
          { style: baseStyles.header },
          `Insight ${i + 1}`
        ),
        React.createElement(View, { style: baseStyles.divider }),
        React.createElement(
          View,
          { style: baseStyles.section },
          React.createElement(Text, { style: baseStyles.label }, "WHAT"),
          React.createElement(Text, { style: baseStyles.body }, insight.what)
        ),
        React.createElement(
          View,
          { style: baseStyles.section },
          React.createElement(Text, { style: baseStyles.label }, "SO WHAT"),
          React.createElement(Text, { style: baseStyles.body }, insight.soWhat)
        ),
        React.createElement(
          View,
          { style: baseStyles.section },
          React.createElement(Text, { style: baseStyles.label }, "NOW WHAT"),
          React.createElement(
            Text,
            { style: baseStyles.body },
            insight.nowWhat
          )
        )
      )
    ),
    // Recommendations slide
    React.createElement(
      Page,
      { size: "A4", style: baseStyles.page, orientation: "landscape" },
      React.createElement(
        Text,
        { style: baseStyles.header },
        "Recommendations"
      ),
      React.createElement(View, { style: baseStyles.divider }),
      // Table header
      React.createElement(
        View,
        { style: { ...baseStyles.row, marginBottom: 8 } },
        React.createElement(Text, { style: baseStyles.cellBold }, "Action"),
        React.createElement(Text, { style: baseStyles.cellBold }, "Owner"),
        React.createElement(Text, { style: baseStyles.cellBold }, "Deadline"),
        React.createElement(Text, { style: baseStyles.cellBold }, "Impact")
      ),
      ...spec.recommendations.map((rec, i) =>
        React.createElement(
          View,
          { key: `rec-${i}`, style: baseStyles.row },
          React.createElement(Text, { style: baseStyles.cell }, rec.action),
          React.createElement(Text, { style: baseStyles.cell }, rec.owner),
          React.createElement(Text, { style: baseStyles.cell }, rec.deadline),
          React.createElement(
            Text,
            { style: impactStyle(rec.impact) },
            rec.impact
          )
        )
      )
    ),
    // Residual risks slide
    React.createElement(
      Page,
      { size: "A4", style: baseStyles.page, orientation: "landscape" },
      React.createElement(Text, { style: baseStyles.header }, "Residual Risks"),
      React.createElement(View, { style: baseStyles.divider }),
      ...spec.residualRisks.map((risk, i) =>
        React.createElement(
          View,
          { key: `risk-${i}`, style: { ...baseStyles.row, marginBottom: 8 } },
          React.createElement(Text, { style: baseStyles.checkmark }, "-"),
          React.createElement(Text, { style: baseStyles.body }, risk.plain)
        )
      )
    )
  );
}

// ─── Technical report component ───────────────────────────────────────────────

/** What the report prints for an absent input: an absent figure is never shown as 0. */
export const NOT_AVAILABLE = "not available";
const formatCount = (v: number | null | undefined): string => (v == null ? NOT_AVAILABLE : String(v));
const formatPercent = (v: number | null | undefined): string => (v == null ? NOT_AVAILABLE : `${v.toFixed(1)}%`);

/** "iso25010" -> "ISO/IEC 25010"; a name that already reads as a proper name stays. */
function standardName(key: string): string {
  const k = key.trim().toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^isoiec/, "iso");
  return ({ iso25010: "ISO/IEC 25010", iso5055: "ISO/IEC 5055", istqb: "ISTQB", cmmi: "CMMI", gdpr: "GDPR", pdpa: "PDPA" } as Record<string, string>)[k] ?? key.trim();
}

const sectionTitle = (key: string, title: string) => [
  React.createElement(Text, { key: `${key}-t`, style: { ...baseStyles.subheader, marginTop: 14 } }, title),
  React.createElement(View, { key: `${key}-d`, style: baseStyles.divider }),
];
const paragraph = (key: string, text: string, bold = false) =>
  React.createElement(Text, { key, style: bold ? { ...baseStyles.body, fontFamily: "Helvetica-Bold" } : baseStyles.body }, text);

/** The closure's narrative as report sections; a section with nothing to say is left out, never printed empty. */
function narrativePages(spec: TechnicalReportSpec): React.ReactElement[] {
  const blocks: React.ReactElement[] = [];
  if ((spec.exitCriteria ?? []).length > 0) {
    blocks.push(...sectionTitle("exit", "Exit Criteria"));
    (spec.exitCriteria ?? []).forEach((c, i) => {
      blocks.push(
        React.createElement(
          View,
          { key: `exit-${i}`, style: { marginBottom: 6 } },
          React.createElement(
            View,
            { style: baseStyles.row },
            React.createElement(Text, { style: { ...baseStyles.exitStatus, color: c.met ? "#1e8449" : "#c0392b" } }, c.met ? "Met" : "Not met"),
            React.createElement(Text, { style: { ...baseStyles.body, flex: 1 } }, c.criterion)
          ),
          ...(c.evidence ? [React.createElement(Text, { key: `exit-ev-${i}`, style: { ...baseStyles.body, marginLeft: 50, color: "#555555" } }, c.evidence)] : [])
        )
      );
    });
  }
  if ((spec.variances ?? []).length > 0) {
    blocks.push(...sectionTitle("var", "Variances from the Test Plan"));
    (spec.variances ?? []).forEach((v, i) => blocks.push(paragraph(`var-${i}`, `${v.variance}${v.reason ? ` Reason: ${v.reason}` : ""}`)));
  }
  if ((spec.falsePasses ?? []).length > 0 || (spec.wrongStepNotes ?? []).length > 0) {
    blocks.push(...sectionTitle("fp", "Passes That Did Not Hold"));
    (spec.falsePasses ?? []).forEach((f, i) => blocks.push(paragraph(`fp-${i}`, `${f.case}: ${f.finding}${f.latestResult ? ` Latest result: ${f.latestResult}` : ""}`)));
    (spec.wrongStepNotes ?? []).forEach((n, i) => {
      blocks.push(paragraph(`ws-${i}-t`, "A wrong test step", true));
      for (const [label, text] of [["Requirement", n.requirement], ["The wrong step", n.wrongStep], ["What conforms", n.whatConforms], ["What the pass means", n.whatThePassMeans]] as const) {
        if (text) blocks.push(paragraph(`ws-${i}-${label}`, `${label}: ${text}`));
      }
    });
  }
  if ((spec.residualRisks ?? []).length > 0) {
    blocks.push(...sectionTitle("risk", "Residual Risks"));
    (spec.residualRisks ?? []).forEach((r, i) =>
      blocks.push(paragraph(`risk-${i}`, `${r.rating ? `[Originally ${r.rating}] ` : ""}${r.title}${r.mitigationStatus ? ` (${r.mitigationStatus})` : ""}${r.residualExposure ? `: ${r.residualExposure}` : ""}`))
    );
  }
  if ((spec.openQuestions ?? []).length > 0) {
    blocks.push(...sectionTitle("oq", "Open Questions"));
    blocks.push(paragraph("oq-intro", "Decisions the QA team has not been given. Each question names who decides."));
    (spec.openQuestions ?? []).forEach((g, gi) => {
      blocks.push(paragraph(`oq-g-${gi}`, `For ${g.audience} (${g.questions.length})`, true));
      g.questions.forEach((q, qi) => blocks.push(paragraph(`oq-${gi}-${qi}`, `${q.id}${q.priority ? ` [${q.priority}]` : ""}: ${q.question}${q.also ? ` [also: ${q.also}]` : ""}`)));
    });
  }
  return blocks.length === 0 ? [] : [React.createElement(Page, { key: "narrative", size: "A4", style: baseStyles.page }, ...blocks)];
}

function TechnicalReportDocument({ spec }: { spec: TechnicalReportSpec }) {
  return React.createElement(
    Document,
    null,
    // Cover page
    React.createElement(
      Page,
      { size: "A4", style: baseStyles.page },
      React.createElement(
        View,
        { style: { flex: 1, justifyContent: "center" } },
        React.createElement(
          Text,
          { style: baseStyles.header },
          "QA Technical Report"
        ),
        React.createElement(
          Text,
          { style: { fontSize: 16, marginBottom: 8 } },
          spec.projectName
        ),
        React.createElement(View, { style: baseStyles.divider }),
        React.createElement(
          Text,
          { style: baseStyles.body },
          `Run ID: ${spec.runId}`
        ),
        React.createElement(
          Text,
          { style: baseStyles.body },
          `Generated: ${spec.generatedAt}`
        ),
        React.createElement(
          Text,
          { style: baseStyles.body },
          `Scope: ${spec.scope}`
        )
      )
    ),
    // Summary + metrics page
    React.createElement(
      Page,
      { size: "A4", style: baseStyles.page },
      React.createElement(Text, { style: baseStyles.subheader }, "Test Summary"),
      React.createElement(View, { style: baseStyles.divider }),
      // Metrics table header
      React.createElement(
        View,
        { style: { ...baseStyles.row, marginBottom: 6 } },
        React.createElement(Text, { style: baseStyles.cellBold }, "Metric"),
        React.createElement(Text, { style: baseStyles.cellBold }, "Value")
      ),
      ...[
        ["Total Tests", formatCount(spec.metrics.totalTests)],
        ["Passed", formatCount(spec.metrics.passed)],
        ["Failed", formatCount(spec.metrics.failed)],
        ...(spec.metrics.partial === undefined ? [] : [["Partial", formatCount(spec.metrics.partial)]]),
        ["Blocked", formatCount(spec.metrics.blocked)],
        ["Skipped", formatCount(spec.metrics.skipped)],
        ...(spec.metrics.undetermined === undefined ? [] : [["Undetermined", formatCount(spec.metrics.undetermined)]]),
        ...(typeof spec.metrics.outOfScope === "number" && Number.isInteger(spec.metrics.outOfScope) && spec.metrics.outOfScope > 0 ? [["Out of scope", formatCount(spec.metrics.outOfScope)]] : []),
        ["Pass Rate", formatPercent(spec.metrics.passRate)],
        ["Requirements Coverage", formatPercent(spec.metrics.coveragePercent)],
        ...(spec.defectHeadline === undefined
          ? [["Open Defects", formatCount(spec.metrics.openDefects)]]
          : [
              ["Open application defects", formatCount(spec.defectHeadline.open)],
              ["Of which partially fixed", formatCount(spec.defectHeadline.openPartiallyFixed)],
              ["Fixed", formatCount(spec.defectHeadline.fixed)],
              ["Reframed (requirement or hardening question, not open)", formatCount(spec.defectHeadline.reframed)],
              ["Report withdrawn", formatCount(spec.defectHeadline.reportWithdrawn)],
              ...(typeof spec.defectHeadline.closedWithoutVerdict === "number" ? [["Closed without a retest verdict", formatCount(spec.defectHeadline.closedWithoutVerdict)]] : []),
            ]),
      ].map(([label, value], i) =>
        React.createElement(
          View,
          {
            key: `metric-${i}`,
            style: {
              ...baseStyles.row,
              backgroundColor: i % 2 === 0 ? "#f7f9fb" : "#ffffff",
              paddingVertical: 3,
            },
          },
          React.createElement(Text, { style: baseStyles.cell }, String(label)),
          React.createElement(Text, { style: baseStyles.cell }, String(value))
        )
      ),
      ...(spec.caseNote ? [React.createElement(Text, { key: "case-note", style: { ...baseStyles.body, marginTop: 8 } }, spec.caseNote)] : []),
      ...(spec.reconciliation ? [React.createElement(Text, { key: "reconciliation", style: baseStyles.body }, `Reconciliation: ${spec.reconciliation}`)] : []),
      ...((spec.outOfScopeCases ?? []).length > 0
        ? [
            React.createElement(
              Text,
              { key: "out-of-scope", style: baseStyles.body },
              `Out of scope, by the owner's decision and in none of the counts above: ${(spec.outOfScopeCases ?? []).map((c) => `${c.caseId}: ${c.reason}`).join("; ")}`
            ),
          ]
        : []),
      React.createElement(
        Text,
        { style: { ...baseStyles.subheader, marginTop: 20 } },
        "Compliance Coverage"
      ),
      React.createElement(View, { style: baseStyles.divider }),
      React.createElement(
        Text,
        { style: baseStyles.body },
        "Gaps are test-coverage gaps in each standard, rated by the standard's own review. They are not defects. This document gives no release recommendation and no compliance verdict."
      ),
      React.createElement(
        View,
        { style: { ...baseStyles.row, marginBottom: 6 } },
        React.createElement(Text, { style: { ...baseStyles.cellBold, flex: 2 } }, "Standard"),
        React.createElement(Text, { style: baseStyles.cellBold }, "Coverage gaps"),
        React.createElement(Text, { style: baseStyles.cellBold }, "Gaps rated high")
      ),
      ...(Object.keys(spec.compliance).length === 0
        ? [React.createElement(Text, { key: "compliance-none", style: baseStyles.body }, `Compliance reports: ${NOT_AVAILABLE}`)]
        : []),
      ...Object.entries(spec.compliance).map(([standard, counts], i) =>
        React.createElement(
          View,
          {
            key: `compliance-${i}`,
            style: {
              ...baseStyles.row,
              backgroundColor: i % 2 === 0 ? "#f7f9fb" : "#ffffff",
              paddingVertical: 3,
            },
          },
          React.createElement(Text, { style: { ...baseStyles.cell, flex: 2 } }, standardName(standard)),
          React.createElement(Text, { style: baseStyles.cell }, formatCount(counts.gapped)),
          React.createElement(Text, { style: baseStyles.cell }, formatCount(counts.highGaps ?? null))
        )
      ),
      ...(spec.complianceTotals === undefined
        ? []
        : [
            React.createElement(
              Text,
              { key: "compliance-totals", style: { ...baseStyles.body, marginTop: 6 } },
              `Total: ${formatCount(spec.complianceTotals.totalGaps)} coverage gaps across ${formatCount(spec.complianceTotals.reports)} reports, ${formatCount(spec.complianceTotals.totalHighGaps)} rated high.${spec.complianceTotals.note ? ` ${spec.complianceTotals.note}` : ""}`
            ),
          ])
    ),
    // Defects page
    React.createElement(
      Page,
      { size: "A4", style: baseStyles.page },
      ...((spec.openDefectLines ?? []).length > 0
        ? [
            React.createElement(Text, { key: "open-defects-t", style: baseStyles.subheader }, "Open Application Defects"),
            React.createElement(View, { key: "open-defects-d", style: baseStyles.divider }),
            ...(spec.openDefectLines ?? []).map((l, i) => React.createElement(Text, { key: `open-defect-${i}`, style: baseStyles.body }, l)),
            React.createElement(View, { key: "open-defects-gap", style: { marginBottom: 10 } }),
          ]
        : []),
      React.createElement(Text, { style: baseStyles.subheader }, "Defect Log"),
      React.createElement(View, { style: baseStyles.divider }),
      React.createElement(
        View,
        { style: { ...baseStyles.row, marginBottom: 6 } },
        React.createElement(Text, { style: { ...baseStyles.cellBold, flex: 1.6, paddingRight: 6 } }, "ID"),
        React.createElement(
          Text,
          { style: { ...baseStyles.cellBold, flex: 3, paddingRight: 6 } },
          "Title"
        ),
        React.createElement(Text, { style: { ...baseStyles.cellBold, flex: 1.2, paddingRight: 6 } }, "Severity"),
        React.createElement(Text, { style: { ...baseStyles.cellBold, flex: 1.4 } }, "Retest verdict")
      ),
      ...spec.defects.map((defect, i) =>
        React.createElement(
          View,
          {
            key: `defect-${i}`,
            style: {
              ...baseStyles.row,
              backgroundColor: i % 2 === 0 ? "#f7f9fb" : "#ffffff",
              paddingVertical: 3,
            },
          },
          React.createElement(Text, { style: { ...baseStyles.cell, flex: 1.6, paddingRight: 6 } }, defect.id),
          React.createElement(
            Text,
            { style: { ...baseStyles.cell, flex: 3, paddingRight: 6 } },
            defect.title
          ),
          React.createElement(
            Text,
            { style: { ...baseStyles.cell, flex: 1.2, paddingRight: 6 } },
            defect.severity
          ),
          React.createElement(Text, { style: { ...baseStyles.cell, flex: 1.4 } }, defect.status)
        )
      )
    ),
    // Narrative sections from the closure report (printed only when present)
    ...narrativePages(spec),
    // Evidence appendix — one screenshot per page entry (only when evidence provided)
    ...(spec.evidenceScreenshots ?? []).map((entry, i) =>
      React.createElement(
        Page,
        { key: `evidence-${i}`, size: "A4", style: baseStyles.page },
        React.createElement(
          Text,
          { style: baseStyles.subheader },
          `Evidence: ${entry.defectId}${entry.tcId ? ` (${entry.tcId})` : ""}`
        ),
        React.createElement(View, { style: baseStyles.divider }),
        React.createElement(
          Text,
          { style: { ...baseStyles.label, marginBottom: 8 } },
          entry.label
        ),
        React.createElement(Image, {
          src: entry.dataUri,
          style: { maxWidth: "100%", objectFit: "contain" },
        })
      )
    )
  );
}

// ─── Sign-off document component ──────────────────────────────────────────────

function SignoffDocument({ spec }: { spec: SignoffSpec }) {
  const decisionStyle =
    spec.decision === "approved"
      ? baseStyles.decisionApproved
      : spec.decision === "rejected"
        ? baseStyles.decisionRejected
        : baseStyles.decisionConditions;

  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: baseStyles.page },
      // Header
      React.createElement(
        Text,
        { style: baseStyles.header },
        "QA Sign-Off Document"
      ),
      React.createElement(View, { style: baseStyles.divider }),
      // Document metadata
      React.createElement(
        View,
        { style: baseStyles.section },
        React.createElement(
          View,
          { style: baseStyles.row },
          React.createElement(Text, { style: baseStyles.cellBold }, "Project:"),
          React.createElement(
            Text,
            { style: baseStyles.cell },
            spec.projectName
          )
        ),
        React.createElement(
          View,
          { style: baseStyles.row },
          React.createElement(Text, { style: baseStyles.cellBold }, "Version:"),
          React.createElement(Text, { style: baseStyles.cell }, spec.version)
        ),
        React.createElement(
          View,
          { style: baseStyles.row },
          React.createElement(
            Text,
            { style: baseStyles.cellBold },
            "Sign-Off Date:"
          ),
          React.createElement(
            Text,
            { style: baseStyles.cell },
            spec.signoffDate
          )
        ),
        React.createElement(
          View,
          { style: baseStyles.row },
          React.createElement(
            Text,
            { style: baseStyles.cellBold },
            "Document ID:"
          ),
          React.createElement(
            Text,
            { style: baseStyles.cell },
            spec.documentId
          )
        ),
        React.createElement(
          View,
          { style: baseStyles.row },
          React.createElement(Text, { style: baseStyles.cellBold }, "Scope:"),
          React.createElement(Text, { style: baseStyles.cell }, spec.scope)
        )
      ),
      // Gate 3 decision
      React.createElement(
        View,
        {
          style: {
            ...baseStyles.section,
            borderWidth: 1,
            borderColor: "#cccccc",
            padding: 12,
            borderRadius: 4,
          },
        },
        React.createElement(
          Text,
          { style: { ...baseStyles.label, marginBottom: 6 } },
          SIGNOFF_DECISION_LABEL
        ),
        React.createElement(Text, { style: decisionStyle }, SIGNOFF_DECISION_TEXT[spec.decision])
      ),
      // Exit criteria checklist
      React.createElement(
        Text,
        { style: { ...baseStyles.subheader, marginTop: 8 } },
        "Exit Criteria"
      ),
      React.createElement(View, { style: baseStyles.divider }),
      ...(spec.exitCriteria.length === 0
        ? [
            React.createElement(
              Text,
              { key: "exit-none", style: baseStyles.body },
              spec.exitCriteriaNote ?? `Exit criteria: ${NOT_AVAILABLE}`
            ),
          ]
        : []),
      ...spec.exitCriteria.map((criterion, i) =>
        React.createElement(
          View,
          { key: `exit-${i}`, style: { ...baseStyles.row, marginBottom: 6 } },
          // The number lets the "not met" block below point at a criterion without repeating its text.
          React.createElement(Text, { style: { ...baseStyles.body, width: 16, marginRight: 4 } }, `${i + 1}.`),
          React.createElement(
            Text,
            // Words, not check-mark glyphs: the standard Helvetica font is WinAnsi-encoded and has none.
            { style: { ...baseStyles.exitStatus, color: criterion.met ? "#1e8449" : "#c0392b" } },
            criterion.met ? "Met" : "Not met"
          ),
          React.createElement(
            Text,
            {
              style: {
                ...baseStyles.body,
                // flex: 1 gives the text the width left beside the status column, so a long criterion wraps inside the page
                // instead of running past its right edge.
                flex: 1,
                color: criterion.met ? "#1a1a1a" : "#c0392b",
              },
            },
            criterion.criterion
          )
        )
      ),
      // Further blocks from the closure report
      ...(spec.sections ?? []).flatMap((sec, si) => [
        React.createElement(Text, { key: `sec-t-${si}`, style: { ...baseStyles.label, marginTop: 8 } }, sec.title.toUpperCase()),
        ...sec.lines.map((line, li) => React.createElement(Text, { key: `sec-${si}-${li}`, style: baseStyles.body }, line)),
      ]),
      // Open defects summary
      React.createElement(
        View,
        { style: { ...baseStyles.section, marginTop: 8 } },
        React.createElement(
          Text,
          { style: baseStyles.label },
          "OPEN DEFECTS SUMMARY"
        ),
        React.createElement(
          Text,
          { style: baseStyles.body },
          spec.openDefectsSummary
        )
      ),
      // Residual risk
      React.createElement(
        View,
        { style: baseStyles.section },
        React.createElement(
          Text,
          { style: baseStyles.label },
          "RESIDUAL RISK"
        ),
        React.createElement(
          Text,
          { style: baseStyles.body },
          spec.residualRisk
        )
      ),
      // Signature rows
      React.createElement(
        Text,
        { style: { ...baseStyles.subheader, marginTop: 12 } },
        "Signatories"
      ),
      React.createElement(View, { style: baseStyles.divider }),
      ...spec.signatoryRoles.map((role, i) =>
        React.createElement(
          View,
          {
            key: `sig-${i}`,
            style: {
              ...baseStyles.row,
              borderBottomWidth: 1,
              borderBottomColor: "#cccccc",
              paddingBottom: 24,
              marginBottom: 16,
            },
          },
          React.createElement(
            View,
            { style: { flex: 2 } },
            React.createElement(Text, { style: baseStyles.label }, role),
            React.createElement(
              Text,
              { style: { fontSize: 9, color: "#999999" } },
              "Signature"
            )
          ),
          React.createElement(
            View,
            { style: { flex: 1 } },
            React.createElement(
              Text,
              { style: baseStyles.label },
              "Date"
            ),
            React.createElement(
              Text,
              { style: { fontSize: 9, color: "#999999" } },
              "____/____/________"
            )
          )
        )
      )
    )
  );
}

// ─── PDF generators ───────────────────────────────────────────────────────────

/**
 * Generate executive slide deck PDF bytes.
 */
export async function renderSlideDeck(spec: SlideSpec): Promise<Buffer> {
  const element = React.createElement(SlideDeckDocument, { spec }) as React.ReactElement<DocumentProps>;
  return renderToBuffer(element);
}

/**
 * Generate technical report PDF bytes.
 */
export async function renderTechnicalReport(
  spec: TechnicalReportSpec
): Promise<Buffer> {
  const element = React.createElement(TechnicalReportDocument, { spec }) as React.ReactElement<DocumentProps>;
  return renderToBuffer(element);
}

/**
 * Generate sign-off document PDF bytes.
 */
export async function renderSignoffDocument(spec: SignoffSpec): Promise<Buffer> {
  const element = React.createElement(SignoffDocument, { spec }) as React.ReactElement<DocumentProps>;
  return renderToBuffer(element);
}
