/**
 * The defect figures the executive PDFs print. The technical report and the sign-off both resolve them
 * here, so the two documents never disagree on how many defects are open (AUD-060).
 *
 * A defect record is a `DefectSchema` object (`severity: {code, name}`, `status: {code, transitionedAt}`);
 * older runs carry plain strings. Both are read.
 */

/** A status recording a resolution: anything matching it is closed, everything else is open. */
export const CLOSED_DEFECT_STATUS = /closed|verified|resolved|won.?t.?fix|duplicate|cannot.?reproduce|not.?a.?bug/i;

const codeOf = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim() !== "") return v;
  if (v !== null && typeof v === "object") {
    const code = (v as { code?: unknown }).code;
    if (typeof code === "string" && code.trim() !== "") return code;
  }
  return null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The record's status code (`status.code`, or a plain string status), or null. */
export function defectStatusCode(record: unknown): string | null {
  return record !== null && typeof record === "object" ? codeOf((record as { status?: unknown }).status) : null;
}

/** The record's severity code (`severity.code`, e.g. "Sev2", or a plain string severity), or null. */
export function defectSeverityCode(record: unknown): string | null {
  return record !== null && typeof record === "object" ? codeOf((record as { severity?: unknown }).severity) : null;
}

export function isClosedDefectStatus(code: string): boolean {
  return CLOSED_DEFECT_STATUS.test(code);
}

export interface DefectFigures {
  /** Open defects; null when neither the closure data nor the records can say. */
  open: number | null;
  /** Closed defects; null when unknown. */
  closed: number | null;
  /** The highest severity code among the open records ("Sev1" is highest), or null. */
  highestOpenSeverity: string | null;
}

/**
 * Open/closed defects: `closure.defectMetrics.confirmedOpen` first (closed = totalLogged − open), then the
 * records' status codes when every record carries one. `records` null means the run has no `defects/`.
 */
export function resolveDefectFigures(closure: unknown, records: readonly unknown[] | null): DefectFigures {
  const dm =
    closure !== null && typeof closure === "object"
      ? ((closure as { defectMetrics?: unknown }).defectMetrics as Record<string, unknown> | undefined)
      : undefined;
  const statuses = records === null ? null : records.map(defectStatusCode);
  const openRecords = (records ?? []).filter((_r, i) => {
    const s = statuses?.[i] ?? null;
    return s === null || !isClosedDefectStatus(s);
  });
  const severities = openRecords
    .map(defectSeverityCode)
    .filter((s): s is string => s !== null)
    .sort();
  const highestOpenSeverity = severities[0] ?? null;

  let open = num(dm?.["confirmedOpen"]);
  let closed: number | null = null;
  if (open !== null) {
    const total = num(dm?.["totalLogged"]);
    closed = total !== null ? total - open : null;
  } else if (statuses !== null && statuses.every((s) => s !== null)) {
    closed = statuses.filter((s) => isClosedDefectStatus(s as string)).length;
    open = statuses.length - closed;
  }
  return { open, closed, highestOpenSeverity };
}

/** The sign-off's one-line open-defect summary, from the same figures the technical report prints. */
export function openDefectsSummary(figures: DefectFigures): string {
  if (figures.open === null) return "Open defects: not available";
  if (figures.open === 0) return "No open defects at sign-off.";
  const noun = figures.open === 1 ? "open defect" : "open defects";
  return `${figures.open} ${noun}; highest severity: ${figures.highestOpenSeverity ?? "not available"}`;
}
