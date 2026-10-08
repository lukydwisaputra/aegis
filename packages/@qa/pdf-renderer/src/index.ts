import React from "react";
import {
  renderToBuffer,
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";

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
 * Apply all jargon rewrites to a text string.
 * Rules are applied in order; each rule operates on the result of the previous.
 */
export function applyJargonRewrites(text: string): string {
  return JARGON_RULES.reduce((current, rule) => {
    return current.replace(rule.pattern, (match) => rule.rewrite(match));
  }, text);
}

/**
 * Check if text contains jargon; returns list of flagged phrases with
 * their plain-English suggestions.
 */
export function detectJargon(
  text: string
): Array<{ original: string; suggested: string }> {
  const findings: Array<{ original: string; suggested: string }> = [];
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
    blocked: number | null;
    skipped: number | null;
    passRate: number | null;
    coveragePercent: number | null;
    openDefects: number | null;
    closedDefects: number | null;
  };
  defects: Array<{
    id: string;
    title: string;
    severity: string;
    status: string;
  }>;
  compliance: Record<string, { covered: number | null; gapped: number | null }>;
  tokenCostUsd: number | null;
  /** Total cycle wall-clock in milliseconds; null when no cycle-time data exists. */
  cycleTimeMs?: number | null;
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

export interface SignoffSpec {
  projectName: string;
  version: string;
  signoffDate: string;
  documentId: string;
  scope: string;
  verdict: "GO" | "NO-GO" | "CONDITIONAL";
  exitCriteria: Array<{ criterion: string; met: boolean }>;
  /** The line printed when exitCriteria is empty; defaults to "Exit criteria: not available". */
  exitCriteriaNote?: string;
  openDefectsSummary: string;
  residualRisk: string;
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
  verdictGo: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#1e8449",
  },
  verdictNoGo: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#c0392b",
  },
  verdictConditional: {
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
function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return NOT_AVAILABLE;
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
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
        ),
        React.createElement(
          Text,
          { style: baseStyles.body },
          `Token Cost: ${spec.tokenCostUsd == null ? NOT_AVAILABLE : `$${spec.tokenCostUsd.toFixed(4)}`}`
        ),
        React.createElement(
          Text,
          { style: baseStyles.body },
          `Cycle Time: ${formatDuration(spec.cycleTimeMs)}`
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
        ["Blocked", formatCount(spec.metrics.blocked)],
        ["Skipped", formatCount(spec.metrics.skipped)],
        ["Pass Rate", formatPercent(spec.metrics.passRate)],
        ["Requirements Coverage", formatPercent(spec.metrics.coveragePercent)],
        ["Open Defects", formatCount(spec.metrics.openDefects)],
        ["Closed Defects", formatCount(spec.metrics.closedDefects)],
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
      React.createElement(
        Text,
        { style: { ...baseStyles.subheader, marginTop: 20 } },
        "Compliance Coverage"
      ),
      React.createElement(View, { style: baseStyles.divider }),
      React.createElement(
        View,
        { style: { ...baseStyles.row, marginBottom: 6 } },
        React.createElement(Text, { style: baseStyles.cellBold }, "Standard"),
        React.createElement(Text, { style: baseStyles.cellBold }, "Covered"),
        React.createElement(Text, { style: baseStyles.cellBold }, "Gaps")
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
          React.createElement(Text, { style: baseStyles.cell }, standard),
          React.createElement(
            Text,
            { style: baseStyles.cell },
            formatCount(counts.covered)
          ),
          React.createElement(
            Text,
            { style: baseStyles.cell },
            formatCount(counts.gapped)
          )
        )
      )
    ),
    // Defects page
    React.createElement(
      Page,
      { size: "A4", style: baseStyles.page },
      React.createElement(Text, { style: baseStyles.subheader }, "Defect Log"),
      React.createElement(View, { style: baseStyles.divider }),
      React.createElement(
        View,
        { style: { ...baseStyles.row, marginBottom: 6 } },
        React.createElement(Text, { style: baseStyles.cellBold }, "ID"),
        React.createElement(
          Text,
          { style: { ...baseStyles.cellBold, flex: 3 } },
          "Title"
        ),
        React.createElement(Text, { style: baseStyles.cellBold }, "Severity"),
        React.createElement(Text, { style: baseStyles.cellBold }, "Status")
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
          React.createElement(Text, { style: baseStyles.cell }, defect.id),
          React.createElement(
            Text,
            { style: { ...baseStyles.cell, flex: 3 } },
            defect.title
          ),
          React.createElement(
            Text,
            { style: baseStyles.cell },
            defect.severity
          ),
          React.createElement(Text, { style: baseStyles.cell }, defect.status)
        )
      )
    ),
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
  const verdictStyle =
    spec.verdict === "GO"
      ? baseStyles.verdictGo
      : spec.verdict === "NO-GO"
        ? baseStyles.verdictNoGo
        : baseStyles.verdictConditional;

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
      // Verdict
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
          "RELEASE VERDICT"
        ),
        React.createElement(Text, { style: verdictStyle }, spec.verdict)
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
                color: criterion.met ? "#1a1a1a" : "#c0392b",
              },
            },
            criterion.criterion
          )
        )
      ),
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
