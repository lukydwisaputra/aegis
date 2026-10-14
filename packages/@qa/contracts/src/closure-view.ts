import { RetestVerdictCodeSchema } from "./defect-types.js";
import { SEVERITY_MAP } from "./severity.js";
import { defectRetestVerdict, defectSeverityCode, defectStatusCode, isClosedDefectStatus, isOpenApplicationDefect, resolveDefectFigures } from "./report-defects.js";

/**
 * What the executive documents (technical report, sign-off) print, read from closure.json, the source of truth, with the defect records
 * and the metric files only as fallbacks where the closure does not carry a figure. Pure: both scripts call buildClosureView and hand the
 * result to the renderer, so the two documents cannot disagree. A secondary figure that cannot be read is null (the renderer prints "not
 * available"), never 0. A HEADLINE figure (case counts, open defects, compliance totals, the exit-criteria count) that the closure carries
 * but the view cannot read is never printed as a placeholder: it is listed in ClosureView.unreadable with the field that failed, and the
 * three scripts refuse (exit 11).
 *
 * The closure.json key names read here are the contract with the closure reporter (HANDBOOK 14 and the qa-closure-reporter definition):
 * complianceFindings[].coverageGaps and .highRatedGaps (an array of names), exitCriteria[].met/.evidence/.qualification,
 * ownMistakesCorrected.items[].case/.earlier/.now/.what, defectMetrics.openItems[].defectId, resultsSummary.counts. CLOSURE_FIELDS_READ
 * lists every key path so a test can hold the real-shape fixture to it.
 */

const isPlain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface CaseCounts {
  passed: number | null;
  failed: number | null;
  partial: number | null;
  blocked: number | null;
  skipped: number | null;
  unknown: number | null;
  /** Checks with a result (the base of the pass rate). */
  total: number | null;
  /** passed / total as a percentage, one decimal. */
  passRate: number | null;
}

export interface CaseFigures extends CaseCounts {
  /** Where the headline figures come from: the closure's case-of-record block, the coverage rollup, or the closure's own metrics. */
  source: "case-of-record" | "rollup" | "closure" | "none";
  /** The three bases stated side by side when the closure carries a case of record; null otherwise. */
  note: string | null;
  /** The closure's own reconciliation of the case figures, when it has one. */
  reconciliation: string | null;
}

export interface DefectHeadline {
  /** Open application defects. */
  open: number | null;
  /** How many of the open ones are PARTIALLY FIXED. */
  openPartiallyFixed: number | null;
  fixed: number | null;
  /** REFRAMED: a requirement or hardening question, not an open application defect. */
  reframed: number | null;
  reportWithdrawn: number | null;
  /** Closed records that carry no retest verdict (an older run); null when there are none. */
  closedWithoutVerdict: number | null;
}

/** One open application defect for the sign-off: what it is and what it awaits. */
export interface OpenDefectItem {
  id: string;
  title: string | null;
  /** "Sev4 (Minor)". */
  severity: string;
  state: string;
  /** What the closure says the defect awaits; null when the closure does not say. */
  awaits: string | null;
}

/** A passed case whose first failure came from a wrong test step (closure.json#falsePasses.<key>.wrongStep): the closure's own words. */
export interface WrongStepNote {
  key: string;
  requirement: string | null;
  wrongStep: string;
  whatConforms: string | null;
  whatThePassMeans: string | null;
}

export interface DefectLogRow {
  id: string;
  title: string;
  /** "Sev4 (Minor)". */
  severity: string;
  /** The retest verdict, "Open (new this cycle)" for an open record without one, else the record's status code. */
  state: string;
  open: boolean;
}

export interface OpenQuestionView {
  id: string;
  priority: string | null;
  question: string;
  /** All audiences the closure names, as written. */
  audience: string;
  /** The audiences named after the first (the group the question is under); null when it names one. */
  also: string | null;
}

export interface ExitCriterionView {
  criterion: string;
  met: boolean;
  /** The closure's stated evidence or difference. */
  evidence: string | null;
  /** For a met criterion whose closure text states a qualification: that text (the closure's own words), else null. */
  qualification: string | null;
}

/** A tester's own mistake of the cycle (closure.json#ownMistakesCorrected.items[]), in the closure's words. */
export interface OwnMistakeView {
  case: string;
  earlier: string | null;
  now: string | null;
  what: string;
}

/** A headline figure the closure carries but the view could not read: the field that failed and what it must hold. */
export interface UnreadableField {
  field: string;
  expected: string;
}

export interface ResidualRiskView {
  riskId: string | null;
  title: string;
  rating: string | null;
  mitigationStatus: string | null;
  residualExposure: string | null;
}

export interface ComplianceRowView {
  regulation: string;
  gaps: number | null;
  highGaps: number | null;
}

export interface ClosureView {
  cases: CaseFigures;
  defects: DefectHeadline;
  defectLog: DefectLogRow[];
  /** The open application defects, each with its severity word and what it awaits (the closure's defectMetrics.openItems, else the open log rows). */
  openItems: OpenDefectItem[];
  /** falsePasses entries that carry a wrong test step (for example the lockout check): printed by both documents. */
  wrongStepNotes: WrongStepNote[];
  variances: Array<{ variance: string; reason: string | null }>;
  exitCriteria: ExitCriterionView[];
  /** "7 of 9 exit criteria are met." computed from exitCriteria[].met; null when the closure lists no criteria. */
  exitCriteriaSummary: string | null;
  /** The tester's own mistakes of this cycle (closure.json#ownMistakesCorrected), printed by both documents; null when the closure has none. */
  ownMistakes: { note: string | null; items: OwnMistakeView[] } | null;
  /** Headline figures the closure carries but the view cannot read; the scripts refuse (exit 11) when this is not empty. */
  unreadable: UnreadableField[];
  /** Exit criteria that are not met, each with the closure's stated reason. */
  unmetCriteria: ExitCriterionView[];
  /** Open questions grouped by the first audience named: PM, owner, developers, then any other, each group in id order. */
  openQuestions: Array<{ audience: string; questions: OpenQuestionView[] }>;
  falsePasses: Array<{ case: string; finding: string; latestResult: string | null }>;
  residualRisks: ResidualRiskView[];
  compliance: { rows: ComplianceRowView[]; totalGaps: number | null; totalHighGaps: number | null; reports: number | null; note: string | null } | null;
  outOfScope: Array<{ caseId: string; reason: string }>;
}

/** Proper names of the compliance reports, by their regulation key. */
export const REGULATION_NAMES: Readonly<Record<string, string>> = {
  iso25010: "ISO/IEC 25010", iso5055: "ISO/IEC 5055", istqb: "ISTQB", cmmi: "CMMI", gdpr: "GDPR", pdpa: "PDPA",
};

/** "iso25010" -> "ISO/IEC 25010"; "ISO/IEC 5055" and unknown names stay as written. */
export function regulationName(key: string): string {
  const k = key.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const known = REGULATION_NAMES[k] ?? REGULATION_NAMES[k.replace(/^isoiec/, "iso")];
  return known ?? key.trim();
}

export interface ClosureViewInput {
  closure: unknown;
  /** The defect records (defects/DEF-*.json), or null when the run has none. */
  defects: readonly unknown[] | null;
  /** The check counts of the coverage rollup (reports/metrics/coverage.json#counts, or the script's own recomputation), or null. */
  rollupCounts: { passed: number; failed: number; partial: number; blocked: number; skipped: number; unknown: number; attempted: number } | null;
  /** The executor's execution-summary.json, or null. */
  executionSummary: unknown;
  /** The customer-readable sentence of a risk by riskId (reports/executive/residual-risks.json), when the run has one. */
  plainRisk?: ReadonlyMap<string, string>;
  /** Compliance reports read from reports/compliance (name, regulation, gap and high-gap counts), the fallback when the closure carries no findings. */
  complianceReports?: ReadonlyArray<{ name: string; regulation?: unknown; gaps: number | null; highGaps: number | null }>;
  /** run.json#descoped or the coverage rollup's descoped list, the fallback for the out-of-scope line. */
  descopedFallback?: ReadonlyArray<{ caseId: string; reason: string }>;
}

/** A sentence ends with a full stop (or ! or ?); one that does not gets one. */
export function terminated(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** One open application defect as a printed line: id, severity word and state, the title as a sentence, and what it awaits. */
export function openDefectLine(o: OpenDefectItem): string {
  // The state already inside brackets ("Open (new this cycle)") is joined with a comma so the line never closes two brackets in a row.
  const state = o.state.replace(/\s*\(([^()]*)\)/g, ", $1");
  // Written without nesting: "DEF-001-AAA-API, Sev4 (Minor), PARTIALLY FIXED: Title. Awaits: ..."
  return `${o.id}, ${o.severity}, ${state}${o.title ? `: ${terminated(o.title)}` : "."}${o.awaits ? ` Awaits: ${terminated(o.awaits)}` : ""}`;
}

function rate(passed: number | null, total: number | null): number | null {
  return passed === null || total === null || total <= 0 ? null : round1((100 * passed) / total);
}

function caseFigures(closure: Record<string, unknown>, rollup: ClosureViewInput["rollupCounts"], execSummary: unknown): CaseFigures {
  const rs = isPlain(closure["resultsSummary"]) ? closure["resultsSummary"] : {};
  const metrics = isPlain(closure["metrics"]) ? closure["metrics"] : {};
  const block = isPlain(rs["caseOfRecord"]) && num(rs["caseOfRecord"]["passed"]) !== null ? rs["caseOfRecord"] : null;
  const fromMetrics =
    block === null && num(metrics["passedCaseOfRecord"]) !== null
      ? { passed: metrics["passedCaseOfRecord"], failed: metrics["failedCaseOfRecord"] ?? metrics["failed"], blocked: metrics["blockedCaseOfRecord"], partial: metrics["partialCaseOfRecord"], passRate: metrics["passRateCaseOfRecord"], basis: null }
      : null;
  const cor = block ?? fromMetrics;
  const rollupFig: CaseCounts | null = rollup === null ? null : { passed: rollup.passed, failed: rollup.failed, partial: rollup.partial, blocked: rollup.blocked, skipped: rollup.skipped, unknown: rollup.unknown, total: rollup.attempted, passRate: rate(rollup.passed, rollup.attempted) };
  const reconciliations = Array.isArray(closure["reconciliations"]) ? closure["reconciliations"] : [];
  const rec = reconciliations.find((r) => isPlain(r) && typeof r["point"] === "string" && /case figures|case counts|pass rate/i.test(r["point"]) && str(r["statement"]) !== null);
  const reconciliation = isPlain(rec) ? str(rec["statement"]) : str(metrics["passRateBasisNote"]);

  const es = isPlain(execSummary) && isPlain(execSummary["totals"]) ? execSummary["totals"] : null;
  const esPassed = es === null ? null : num(es["passed"]);
  const esTotal = es === null ? null : (esPassed ?? 0) + (num(es["failed"]) ?? 0) + (num(es["blocked"]) ?? 0);
  const fmt = (label: string, c: { passed: number | null; failed: number | null; partial?: number | null; blocked: number | null }, pr: number | null, extra = ""): string =>
    `${label}: ${c.passed ?? "n/a"} passed, ${c.failed ?? "n/a"} failed${c.partial === undefined ? "" : `, ${c.partial ?? "n/a"} partial`}, ${c.blocked ?? "n/a"} blocked${pr === null ? "" : ` (${pr}% passed)`}${extra}`;

  if (cor !== null) {
    const passed = num(cor["passed"]);
    const total = rollup?.attempted ?? num(isPlain(rs["counts"]) ? rs["counts"]["attempted"] : null) ?? num(metrics["attempted"]) ?? [passed, num(cor["failed"]), num(cor["blocked"]), num(cor["partial"])].reduce<number | null>((a, b) => (a === null || b === null ? null : a + b), 0);
    const figs: CaseCounts = {
      passed, failed: num(cor["failed"]), partial: num(cor["partial"]), blocked: num(cor["blocked"]),
      skipped: rollup?.skipped ?? null, unknown: rollup?.unknown ?? null, total,
      passRate: num(cor["passRate"]) ?? rate(passed, total),
    };
    const parts = [
      rollupFig === null ? null : fmt("Coverage rollup", rollupFig, rollupFig.passRate),
      es === null ? null : fmt("Execution summary", { passed: esPassed, failed: num(es["failed"]), blocked: num(es["blocked"]) }, rate(esPassed, esTotal), " (it has no partial status)"),
      fmt("Case of record", figs, figs.passRate),
    ].filter((p): p is string => p !== null);
    const basis = isPlain(cor) ? str(cor["basis"]) : null;
    // ONE paragraph: the case-of-record statement, its basis, then either the closure's own reconciliation (which already states the rollup,
    // the execution summary and the case of record) or, without one, the three bases built from the numbers. Never both.
    const body = reconciliation !== null ? terminated(reconciliation) : `${parts.join(". ")}.`;
    return { source: "case-of-record", ...figs, note: `Figures are those of the case of record.${basis === null ? "" : ` ${terminated(basis)}`} ${body}`, reconciliation };
  }
  if (rollupFig !== null) return { source: "rollup", ...rollupFig, note: null, reconciliation };
  const passed = num(metrics["passed"]);
  const failed = num(metrics["failed"]);
  const blocked = num(metrics["blocked"]);
  const total = passed !== null && failed !== null && blocked !== null ? passed + failed + blocked : null;
  if (passed === null && failed === null && blocked === null) return { source: "none", passed: null, failed: null, partial: null, blocked: null, skipped: null, unknown: null, total: null, passRate: null, note: null, reconciliation };
  return { source: "closure", passed, failed, partial: null, blocked, skipped: num(metrics["skipped"]), unknown: null, total, passRate: num(metrics["passRate"]) ?? rate(passed, total), note: null, reconciliation };
}

const VERDICT_ORDER: Readonly<Record<string, number>> = { "PARTIALLY FIXED": 0, "NOT FIXED": 0, "CANNOT VERIFY": 0, REFRAMED: 2, "REPORT WITHDRAWN": 3, FIXED: 4 };

function defectView(closure: Record<string, unknown>, records: readonly unknown[] | null): { headline: DefectHeadline; log: DefectLogRow[] } {
  const dm = isPlain(closure["defectMetrics"]) ? closure["defectMetrics"] : {};
  const countOf = (v: unknown): number | null => (isPlain(v) ? num(v["count"]) : num(v));
  const recs = records ?? [];
  const verdicts = recs.map(defectRetestVerdict);
  const fromRecords = (v: string): number | null => (records === null ? null : verdicts.filter((x) => x === v).length);
  const figures = resolveDefectFigures(closure, records);
  const baseline = isPlain(dm["baseline24"]) ? dm["baseline24"] : {};
  const byVerdict = isPlain(dm["recordsByVerdict"]) ? dm["recordsByVerdict"] : {};
  const openPartially =
    countOf(dm["partiallyFixedOpen"]) ?? (records === null ? null : recs.filter((r, i) => verdicts[i] === "PARTIALLY FIXED" && isOpenApplicationDefect(r)).length);
  const closedWithoutVerdict =
    records === null ? null : recs.filter((r, i) => verdicts[i] === null && !isOpenApplicationDefect(r) && (defectStatusCode(r) === null ? false : isClosedDefectStatus(defectStatusCode(r)!))).length;
  const headline: DefectHeadline = {
    open: num(dm["openApplicationDefects"]) ?? figures.open,
    openPartiallyFixed: openPartially,
    // The closure's own counts first (baseline24, then recordsByVerdict, which counts every record), the defect records last.
    fixed: countOf(isPlain(baseline["FIXED"]) ? baseline["FIXED"] : null) ?? countOf(byVerdict["FIXED"]) ?? fromRecords("FIXED"),
    reframed: countOf(dm["reframedNotOpenApplicationDefects"]) ?? countOf(byVerdict["REFRAMED"]) ?? fromRecords("REFRAMED"),
    reportWithdrawn: countOf(dm["reportWithdrawn"]) ?? countOf(byVerdict["REPORT WITHDRAWN"]) ?? fromRecords("REPORT WITHDRAWN"),
    closedWithoutVerdict: closedWithoutVerdict !== null && closedWithoutVerdict > 0 ? closedWithoutVerdict : null,
  };
  const log: DefectLogRow[] = recs
    .map((r, i) => {
      const verdict = verdicts[i] ?? null;
      const open = isOpenApplicationDefect(r);
      const sev = defectSeverityCode(r);
      const rec = isPlain(r) ? r : {};
      return {
        row: {
          id: typeof rec["id"] === "string" ? rec["id"] : "not available",
          title: typeof rec["title"] === "string" ? rec["title"] : "not available",
          severity: sev === null ? "not available" : Object.hasOwn(SEVERITY_MAP, sev) ? `${sev} (${SEVERITY_MAP[sev as keyof typeof SEVERITY_MAP]})` : sev,
          state: verdict !== null ? (open ? `${verdict} (open)` : verdict) : open ? "Open (new this cycle)" : (defectStatusCode(r) ?? "not available"),
          open,
        },
        order: open ? 0 : VERDICT_ORDER[verdict ?? ""] ?? 5,
        sev: sev ?? "Sev9",
      };
    })
    .sort((a, b) => a.order - b.order || a.sev.localeCompare(b.sev) || a.row.id.localeCompare(b.row.id))
    .map((x) => x.row);
  return { headline, log };
}

function severityWord(code: unknown): string {
  const c = typeof code === "string" ? code : isPlain(code) && typeof code["code"] === "string" ? code["code"] : null;
  return c === null ? "not available" : Object.hasOwn(SEVERITY_MAP, c) ? `${c} (${SEVERITY_MAP[c as keyof typeof SEVERITY_MAP]})` : c;
}

/** The open application defects: the closure's defectMetrics.openItems when it lists them, else the open rows of the defect log. */
function openItemsOf(closure: Record<string, unknown>, log: readonly DefectLogRow[]): OpenDefectItem[] {
  const dm = isPlain(closure["defectMetrics"]) ? closure["defectMetrics"] : {};
  const fromClosure = (Array.isArray(dm["openItems"]) ? dm["openItems"] : []).flatMap((o) =>
    isPlain(o) && str(o["defectId"]) !== null ? [{ id: str(o["defectId"])!, title: str(o["title"]), severity: severityWord(o["severity"]), state: str(o["state"]) ?? "open", awaits: str(o["awaits"]) }] : []
  );
  return fromClosure.length > 0 ? fromClosure : log.filter((d) => d.open).map((d) => ({ id: d.id, title: d.title, severity: d.severity, state: d.state, awaits: null }));
}

const AUDIENCE_ORDER = ["PM", "owner", "developers"];
const firstAudience = (a: string): string => (a.split(/[,/&]|\band\b/)[0] ?? a).trim() || "unassigned";
const idNumber = (id: string): number => Number(/(\d+)$/.exec(id)?.[1] ?? Number.MAX_SAFE_INTEGER);

function questions(closure: Record<string, unknown>): ClosureView["openQuestions"] {
  const list = Array.isArray(closure["openQuestions"]) ? closure["openQuestions"] : [];
  const groups = new Map<string, OpenQuestionView[]>();
  for (const q of list) {
    if (!isPlain(q) || str(q["question"]) === null) continue;
    const status = str(q["status"]);
    if (status !== null && /^(closed|answered|resolved)$/i.test(status)) continue;
    const audience = str(q["audience"]) ?? "unassigned";
    const key = firstAudience(audience);
    const g = groups.get(key) ?? [];
    const others = audience.split(/[,/&]|\band\b/).map((a) => a.trim()).filter((a) => a !== "").slice(1);
    g.push({ id: str(q["id"]) ?? "", priority: str(q["priority"]), question: str(q["question"])!, audience, also: others.length > 0 ? others.join(", ") : null });
    groups.set(key, g);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = AUDIENCE_ORDER.findIndex((x) => x.toLowerCase() === a.toLowerCase());
    const ib = AUDIENCE_ORDER.findIndex((x) => x.toLowerCase() === b.toLowerCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return keys.map((audience) => ({ audience, questions: groups.get(audience)!.sort((a, b) => idNumber(a.id) - idNumber(b.id)) }));
}

/**
 * A closure sentence may point to one of ITS OWN numbered sections ("section 6", "Sections 2 and 3"). The executive documents have no
 * numbered sections, so such a reference would dangle: it is rewritten to "the closure report delivered with this run", a document that
 * exists and says where to look. A legal reference ("section 24 of the PDPA") and a lettered one ("section 26C") are left alone.
 */
export function rewriteSectionReferences(text: string): string {
  return text.replace(/\b([Ss])ections?\s+\d+(?![A-Za-z0-9])(?:\s*(?:,|and|to|-|\u2013)\s*\d+(?![A-Za-z0-9]))*(?!\s+of\s+the\s+(?:PDPA|GDPR|Act)\b)/g, (_m, _f: string, at: number) => (at === 0 || /(?:^|[.!?]\s+|\n\s*)(?:[-\u2022*]\s+)?$/.test(text.slice(0, at)) ? "The closure report delivered with this run" : "the closure report delivered with this run"));
}

/** rewriteSectionReferences over every string of a JSON-like value. */
export function rewriteSectionReferencesDeep<T>(value: T): T {
  if (typeof value === "string") return rewriteSectionReferences(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => rewriteSectionReferencesDeep(v)) as unknown as T;
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, rewriteSectionReferencesDeep(v)])) as unknown as T;
  return value;
}

/** An unmet or met-with-qualification exit criterion: the closure's `qualification` field, else the evidence of a met criterion that says it is met with a qualification. */
export function exitQualification(entry: unknown): string | null {
  if (!isPlain(entry) || entry["met"] !== true) return null;
  const q = str(entry["qualification"]);
  if (q !== null) return q;
  const ev = str(entry["evidence"]);
  return ev !== null && /\bqualification\b/i.test(ev) ? ev : null;
}

const countOrLength = (v: unknown): number | null => (Array.isArray(v) ? v.length : num(v));

/** One compliance finding's counts: coverageGaps (else gapCount, else a gaps list) and highRatedGaps (an array of names: its length; else a number, else highSeverityGapCount, else bySeverity.High). */
function findingCounts(f: Record<string, unknown>): { gaps: number | null; high: number | null } {
  const bySeverity = isPlain(f["bySeverity"]) ? f["bySeverity"] : {};
  return {
    gaps: num(f["coverageGaps"]) ?? num(f["gapCount"]) ?? countOrLength(f["gaps"]),
    high: countOrLength(f["highRatedGaps"]) ?? num(f["highSeverityGapCount"]) ?? num(bySeverity["High"]),
  };
}

interface ComplianceRead {
  rows: ComplianceRowView[];
  totalGaps: number | null;
  totalHighGaps: number | null;
  reports: number | null;
  problems: UnreadableField[];
}

/**
 * Compliance counts through a fallback chain. Per standard: coverageGaps / gapCount and the length of highRatedGaps (or a number,
 * highSeverityGapCount, bySeverity.High). Totals: complianceTotals when present and coherent (numbers, high not above gaps, equal to the
 * rows when the rows are all readable), else the sum of the rows. With no findings the reports of reports/compliance fill the rows.
 * When the closure carries compliance data (findings, totals, a status or a note) and no total can be read, the problems name the field.
 */
export function readCompliance(closure: Record<string, unknown>, fallback: NonNullable<ClosureViewInput["complianceReports"]>): ComplianceRead {
  const problems: UnreadableField[] = [];
  const findings = Array.isArray(closure["complianceFindings"]) ? closure["complianceFindings"] : [];
  const totalsObj = isPlain(closure["complianceTotals"]) ? closure["complianceTotals"] : null;
  const rows: ComplianceRowView[] = [];
  findings.forEach((f, i) => {
    if (!isPlain(f)) {
      problems.push({ field: `complianceFindings[${i}]`, expected: "an object with regulation, coverageGaps (a number) and highRatedGaps (an array of names)" });
      return;
    }
    const { gaps, high } = findingCounts(f);
    if (gaps === null) problems.push({ field: `complianceFindings[${i}].coverageGaps`, expected: "a number" });
    if (high === null) problems.push({ field: `complianceFindings[${i}].highRatedGaps`, expected: "an array of names (or a number)" });
    rows.push({ regulation: regulationName(String(f["regulation"] ?? f["report"] ?? "not available")), gaps, highGaps: high });
  });
  if (findings.length === 0) {
    for (const r of fallback) rows.push({ regulation: regulationName(typeof r.regulation === "string" && r.regulation.trim() !== "" ? r.regulation : r.name), gaps: r.gaps, highGaps: r.highGaps });
  }
  const sum = (xs: Array<number | null>): number | null => (xs.length > 0 && xs.every((x) => x !== null) ? (xs as number[]).reduce((a, b) => a + b, 0) : null);
  const rowGaps = sum(rows.map((r) => r.gaps));
  const rowHigh = sum(rows.map((r) => r.highGaps));
  const tGaps = totalsObj === null ? null : (num(totalsObj["gaps"]) ?? num(totalsObj["totalGaps"]) ?? num(totalsObj["coverageGaps"]));
  const tHigh = totalsObj === null ? null : (countOrLength(totalsObj["highSeverityGaps"]) ?? countOrLength(totalsObj["totalHighGaps"]) ?? countOrLength(totalsObj["highRatedGaps"]));
  const coherent = tGaps !== null && tHigh !== null && tGaps >= 0 && tHigh >= 0 && tHigh <= tGaps && (rowGaps === null || rowGaps === tGaps) && (rowHigh === null || rowHigh === tHigh);
  const totalGaps = coherent ? tGaps : rowGaps ?? tGaps;
  const totalHighGaps = coherent ? tHigh : rowHigh ?? tHigh;
  const tReports = totalsObj === null ? null : num(totalsObj["reports"]);
  const reports = tReports ?? (rows.length > 0 ? rows.length : null);
  const present = findings.length > 0 || totalsObj !== null || str(closure["complianceStatus"]) !== null || str(closure["complianceNote"]) !== null || Object.hasOwn(closure, "complianceFindings");
  if (present && problems.length === 0 && (totalGaps === null || totalHighGaps === null)) {
    problems.push(
      totalsObj !== null && findings.length === 0
        ? { field: "complianceTotals.gaps / complianceTotals.highSeverityGaps", expected: "numbers" }
        : { field: "complianceFindings", expected: "an array with one entry per standard: regulation, coverageGaps (a number) and highRatedGaps (an array of names)" },
    );
  }
  return { rows, totalGaps, totalHighGaps, reports, problems };
}

/** Exit criteria entries the view cannot count: an object without a true/false `met`. */
function exitProblems(closure: Record<string, unknown>): UnreadableField[] {
  const list = Array.isArray(closure["exitCriteria"]) ? closure["exitCriteria"] : [];
  return list.flatMap((c, i) => (typeof c === "string" || (isPlain(c) && typeof c["met"] === "boolean") ? [] : [{ field: `exitCriteria[${i}].met`, expected: "true or false" }]));
}

/** Case figures and the open-defect headline the closure carries (a non-empty metrics, resultsSummary.counts or defectMetrics) but the view could not read. */
function headlineProblems(closure: Record<string, unknown>, cases: CaseFigures, open: number | null): UnreadableField[] {
  const out: UnreadableField[] = [];
  const has = (v: unknown): boolean => isPlain(v) && Object.keys(v).length > 0;
  const rs = isPlain(closure["resultsSummary"]) ? closure["resultsSummary"] : {};
  if ((has(closure["metrics"]) || has(rs["counts"])) && (cases.passed === null || cases.failed === null)) {
    out.push({ field: has(rs["counts"]) ? "resultsSummary.counts.passed / resultsSummary.counts.failed" : "metrics.passed / metrics.failed", expected: "numbers" });
  }
  if (has(closure["defectMetrics"]) && open === null) out.push({ field: "defectMetrics.openApplicationDefects", expected: "a number" });
  return out;
}

/**
 * The headline fields of a closure.json the executive documents cannot read, from the closure and the compliance reports alone (the deck
 * script, which has no other inputs, uses this; the view lists the same compliance and exit-criteria problems plus the case and defect ones).
 */
export function closureReadProblems(closure: unknown, fallback: NonNullable<ClosureViewInput["complianceReports"]> = []): UnreadableField[] {
  const c = isPlain(closure) ? closure : {};
  return [...readCompliance(c, fallback).problems, ...exitProblems(c)];
}

/** The refusal text of the three scripts (exit 11): the first five fields, each with what it must hold. */
export function describeUnreadable(problems: readonly UnreadableField[], max = 5): string {
  const shown = problems.slice(0, max).map((p) => `  closure.json.${p.field}: write ${p.expected}`);
  return `${problems.length} headline figure${problems.length === 1 ? "" : "s"} in closure.json cannot be read (first ${shown.length}):\n${shown.join("\n")}`;
}

/**
 * Every closure.json key path the view reads, so a test can hold the real-shape fixture to it (a renamed field cannot pass again).
 * "[]" stands for every entry of an array.
 */
export const CLOSURE_FIELDS_READ: readonly string[] = [
  "metrics", "metrics.passRateBasisNote", "unavailableMetrics",
  "resultsSummary.counts", "resultsSummary.caseOfRecord.basis", "resultsSummary.outOfScope[].caseId", "resultsSummary.outOfScope[].reason",
  "reconciliations[].point", "reconciliations[].statement",
  "defectMetrics.openApplicationDefects", "defectMetrics.partiallyFixedOpen.count", "defectMetrics.baseline24.FIXED.count",
  "defectMetrics.recordsByVerdict.REFRAMED", "defectMetrics.recordsByVerdict.REPORT WITHDRAWN", "defectMetrics.openItems[].defectId", "defectMetrics.openItems[].severity",
  "defectMetrics.openItems[].state", "defectMetrics.openItems[].title", "defectMetrics.openItems[].awaits",
  "falsePasses.confirmed[].case", "falsePasses.confirmed[].finding", "falsePasses.confirmed[].latestResult",
  "falsePasses.authThree.requirement", "falsePasses.authThree.wrongStep", "falsePasses.authThree.whatConforms", "falsePasses.authThree.whatThePassMeans",
  "ownMistakesCorrected.note", "ownMistakesCorrected.items[].case", "ownMistakesCorrected.items[].earlier", "ownMistakesCorrected.items[].now", "ownMistakesCorrected.items[].what",
  "variancesFromPlan[].variance", "variancesFromPlan[].reason",
  "exitCriteria[].criterion", "exitCriteria[].met", "exitCriteria[].evidence",
  "openQuestions[].id", "openQuestions[].priority", "openQuestions[].audience", "openQuestions[].question", "openQuestions[].status",
  "residualRiskSummary[].riskId", "residualRiskSummary[].title", "residualRiskSummary[].rating", "residualRiskSummary[].mitigationStatus", "residualRiskSummary[].residualExposure",
  "complianceFindings[].regulation", "complianceFindings[].coverageGaps", "complianceFindings[].highRatedGaps", "complianceNote", "complianceStatus",
];

/** The closure's view for the executive documents. See the interface comments for each field's source. */
export function buildClosureView(input: ClosureViewInput): ClosureView {
  const closure = isPlain(input.closure) ? input.closure : {};
  const { headline, log } = defectView(closure, input.defects);
  const exitCriteria: ExitCriterionView[] = (Array.isArray(closure["exitCriteria"]) ? closure["exitCriteria"] : []).map((c) => ({
    criterion: typeof c === "string" ? c : String(isPlain(c) ? (c["criterion"] ?? c["name"] ?? "not available") : "not available"),
    met: isPlain(c) && c["met"] === true,
    evidence: isPlain(c) ? (str(c["evidence"]) ?? str(c["difference"]) ?? str(c["reason"])) : null,
    qualification: exitQualification(c),
  }));
  const cases = caseFigures(closure, input.rollupCounts, input.executionSummary);
  const omc = isPlain(closure["ownMistakesCorrected"]) ? closure["ownMistakesCorrected"] : null;
  const ownItems: OwnMistakeView[] = omc === null || !Array.isArray(omc["items"]) ? [] : omc["items"].flatMap((i) => (isPlain(i) && str(i["what"]) !== null ? [{ case: str(i["case"]) ?? "A case", earlier: str(i["earlier"]), now: str(i["now"]), what: str(i["what"])! }] : []));
  const rs = isPlain(closure["resultsSummary"]) ? closure["resultsSummary"] : {};
  const oos = Array.isArray(rs["outOfScope"]) ? rs["outOfScope"] : null;
  const outOfScope =
    (oos ?? input.descopedFallback ?? []).flatMap((e) => (isPlain(e) && typeof e["caseId"] === "string" ? [{ caseId: e["caseId"], reason: str(e["reason"]) ?? "reason not recorded" }] : []));
  const comp = readCompliance(closure, input.complianceReports ?? []);
  const compliance =
    comp.rows.length === 0 && comp.totalGaps === null && comp.totalHighGaps === null
      ? null
      : { rows: comp.rows, totalGaps: comp.totalGaps, totalHighGaps: comp.totalHighGaps, reports: comp.reports, note: str(closure["complianceNote"]) };
  const residual: ResidualRiskView[] = (Array.isArray(closure["residualRiskSummary"]) ? closure["residualRiskSummary"] : []).flatMap((r) => {
    if (!isPlain(r)) return [];
    const riskId = str(r["riskId"]);
    const title = (riskId !== null ? input.plainRisk?.get(riskId) : undefined) ?? str(r["title"]);
    if (title === null || title === undefined) return [];
    const score = str(r["originalLikelihoodImpactScore"]);
    const rating = str(r["rating"]) ?? str(r["severity"]) ?? /\((Critical|High|Medium|Low)\)/.exec(score ?? "")?.[1] ?? null;
    return [{ riskId, title, rating, mitigationStatus: str(r["mitigationStatus"]), residualExposure: str(r["residualExposure"]) }];
  });
  const fp = isPlain(closure["falsePasses"]) && Array.isArray(closure["falsePasses"]["confirmed"]) ? closure["falsePasses"]["confirmed"] : [];
  return {
    cases,
    defects: headline,
    defectLog: log,
    openItems: openItemsOf(closure, log),
    wrongStepNotes: Object.entries(isPlain(closure["falsePasses"]) ? closure["falsePasses"] : {}).flatMap(([key, v]) =>
      isPlain(v) && str(v["wrongStep"]) !== null ? [{ key, requirement: str(v["requirement"]), wrongStep: str(v["wrongStep"])!, whatConforms: str(v["whatConforms"]), whatThePassMeans: str(v["whatThePassMeans"]) }] : []
    ),
    variances: (Array.isArray(closure["variancesFromPlan"]) ? closure["variancesFromPlan"] : []).flatMap((v) =>
      typeof v === "string" ? [{ variance: v, reason: null }] : isPlain(v) && str(v["variance"]) !== null ? [{ variance: str(v["variance"])!, reason: str(v["reason"]) }] : []
    ),
    exitCriteria,
    exitCriteriaSummary: exitCriteria.length === 0 ? null : `${exitCriteria.filter((c) => c.met).length} of ${exitCriteria.length} exit criteria are met.`,
    ownMistakes: ownItems.length === 0 ? null : { note: str(omc?.["note"]), items: ownItems },
    unreadable: [...comp.problems, ...exitProblems(closure), ...headlineProblems(closure, cases, headline.open)],
    unmetCriteria: exitCriteria.filter((c) => !c.met),
    openQuestions: questions(closure),
    falsePasses: fp.flatMap((f) => (isPlain(f) && str(f["case"]) !== null && str(f["finding"]) !== null ? [{ case: str(f["case"])!, finding: str(f["finding"])!, latestResult: str(f["latestResult"]) }] : [])),
    residualRisks: residual,
    compliance,
    outOfScope,
  };
}

/** The six retest verdict words, for callers that list them. */
export const RETEST_VERDICT_WORDS: readonly string[] = RetestVerdictCodeSchema.options;

/**
 * The deterministic tier-2 rewrite of one tester's term: "NRIC-shaped value(s)" and "NRIC number(s)" are written for stakeholders as
 * "value(s) shaped like national ID numbers" and "national ID numbers". A rewrite, not a refusal; the technical report keeps the term.
 */
export function rewriteNationalIdTerms(text: string): string {
  return text.replace(/\bNRIC-shaped (values?)/gi, "$1 shaped like national ID numbers").replace(/\bNRIC numbers?\b/gi, "national ID numbers");
}

/** rewriteNationalIdTerms over every string of a JSON-like value. */
export function rewriteNationalIdTermsDeep<T>(value: T): T {
  if (typeof value === "string") return rewriteNationalIdTerms(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => rewriteNationalIdTermsDeep(v)) as unknown as T;
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, rewriteNationalIdTermsDeep(v)])) as unknown as T;
  return value;
}
