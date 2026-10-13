import { RetestVerdictCodeSchema } from "./defect-types.js";
import { SEVERITY_MAP } from "./severity.js";
import { defectRetestVerdict, defectSeverityCode, defectStatusCode, isClosedDefectStatus, isOpenApplicationDefect, resolveDefectFigures } from "./report-defects.js";

/**
 * What the executive documents (technical report, sign-off) print, read from closure.json, the source of truth, with the defect records
 * and the metric files only as fallbacks where the closure does not carry a figure. Pure: both scripts call buildClosureView and hand the
 * result to the renderer, so the two documents cannot disagree. Every figure that cannot be read is null (the renderer prints "not
 * available"), never 0.
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
}

export interface ExitCriterionView {
  criterion: string;
  met: boolean;
  /** The closure's stated evidence or difference. */
  evidence: string | null;
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
  variances: Array<{ variance: string; reason: string | null }>;
  exitCriteria: ExitCriterionView[];
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
    return { source: "case-of-record", ...figs, note: `Figures are those of the case of record${basis === null ? "" : ` (${basis})`}. ${parts.join(". ")}.`, reconciliation };
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
  const openPartially =
    countOf(dm["partiallyFixedOpen"]) ?? (records === null ? null : recs.filter((r, i) => verdicts[i] === "PARTIALLY FIXED" && isOpenApplicationDefect(r)).length);
  const closedWithoutVerdict =
    records === null ? null : recs.filter((r, i) => verdicts[i] === null && !isOpenApplicationDefect(r) && (defectStatusCode(r) === null ? false : isClosedDefectStatus(defectStatusCode(r)!))).length;
  const headline: DefectHeadline = {
    open: num(dm["openApplicationDefects"]) ?? figures.open,
    openPartiallyFixed: openPartially,
    fixed: countOf(isPlain(baseline["FIXED"]) ? baseline["FIXED"] : null) ?? fromRecords("FIXED"),
    reframed: countOf(dm["reframedNotOpenApplicationDefects"]) ?? fromRecords("REFRAMED"),
    reportWithdrawn: countOf(dm["reportWithdrawn"]) ?? fromRecords("REPORT WITHDRAWN"),
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
    g.push({ id: str(q["id"]) ?? "", priority: str(q["priority"]), question: str(q["question"])!, audience });
    groups.set(key, g);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = AUDIENCE_ORDER.findIndex((x) => x.toLowerCase() === a.toLowerCase());
    const ib = AUDIENCE_ORDER.findIndex((x) => x.toLowerCase() === b.toLowerCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return keys.map((audience) => ({ audience, questions: groups.get(audience)!.sort((a, b) => idNumber(a.id) - idNumber(b.id)) }));
}

/** The closure's view for the executive documents. See the interface comments for each field's source. */
export function buildClosureView(input: ClosureViewInput): ClosureView {
  const closure = isPlain(input.closure) ? input.closure : {};
  const { headline, log } = defectView(closure, input.defects);
  const exitCriteria: ExitCriterionView[] = (Array.isArray(closure["exitCriteria"]) ? closure["exitCriteria"] : []).map((c) => ({
    criterion: typeof c === "string" ? c : String(isPlain(c) ? (c["criterion"] ?? c["name"] ?? "not available") : "not available"),
    met: isPlain(c) && c["met"] === true,
    evidence: isPlain(c) ? (str(c["evidence"]) ?? str(c["difference"]) ?? str(c["reason"])) : null,
  }));
  const rs = isPlain(closure["resultsSummary"]) ? closure["resultsSummary"] : {};
  const oos = Array.isArray(rs["outOfScope"]) ? rs["outOfScope"] : null;
  const outOfScope =
    (oos ?? input.descopedFallback ?? []).flatMap((e) => (isPlain(e) && typeof e["caseId"] === "string" ? [{ caseId: e["caseId"], reason: str(e["reason"]) ?? "reason not recorded" }] : []));
  const findings = Array.isArray(closure["complianceFindings"]) ? closure["complianceFindings"].filter(isPlain) : [];
  const totals = isPlain(closure["complianceTotals"]) ? closure["complianceTotals"] : null;
  const rows: ComplianceRowView[] =
    findings.length > 0
      ? findings.map((f) => ({ regulation: regulationName(String(f["regulation"] ?? f["report"] ?? "not available")), gaps: num(f["gapCount"]), highGaps: num(f["highSeverityGapCount"]) }))
      : (input.complianceReports ?? []).map((r) => ({ regulation: regulationName(typeof r.regulation === "string" && r.regulation.trim() !== "" ? r.regulation : r.name), gaps: r.gaps, highGaps: r.highGaps }));
  const sum = (xs: Array<number | null>): number | null => (xs.length > 0 && xs.every((x) => x !== null) ? (xs as number[]).reduce((a, b) => a + b, 0) : null);
  const compliance =
    rows.length === 0 && totals === null
      ? null
      : {
          rows,
          totalGaps: num(totals?.["gaps"]) ?? sum(rows.map((r) => r.gaps)),
          totalHighGaps: num(totals?.["highSeverityGaps"]) ?? sum(rows.map((r) => r.highGaps)),
          reports: num(totals?.["reports"]) ?? (rows.length > 0 ? rows.length : null),
          note: str(closure["complianceNote"]),
        };
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
    cases: caseFigures(closure, input.rollupCounts, input.executionSummary),
    defects: headline,
    defectLog: log,
    variances: (Array.isArray(closure["variancesFromPlan"]) ? closure["variancesFromPlan"] : []).flatMap((v) =>
      typeof v === "string" ? [{ variance: v, reason: null }] : isPlain(v) && str(v["variance"]) !== null ? [{ variance: str(v["variance"])!, reason: str(v["reason"]) }] : []
    ),
    exitCriteria,
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
