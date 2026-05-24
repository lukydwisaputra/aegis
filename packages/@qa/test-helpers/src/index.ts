/**
 * @qa/test-helpers
 * Shared Playwright/Jest helpers, HAR sanitizer, evidence-naming utilities,
 * test-data seeding helpers, and factory cleanup tracker.
 */

// ─── HAR sanitizer ────────────────────────────────────────────────────────────

const DEFAULT_HEADERS_TO_STRIP = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
]);

interface HarHeader {
  name: string;
  value: string;
}

interface HarRequest {
  headers?: HarHeader[];
  [key: string]: unknown;
}

interface HarResponse {
  headers?: HarHeader[];
  [key: string]: unknown;
}

interface HarEntry {
  request?: HarRequest;
  response?: HarResponse;
  [key: string]: unknown;
}

interface HarLog {
  entries?: HarEntry[];
  [key: string]: unknown;
}

interface HarObject {
  log?: HarLog;
  [key: string]: unknown;
}

function filterHeaders(headers: HarHeader[], stripSet: Set<string>): HarHeader[] {
  return headers.filter((h) => !stripSet.has(h.name.toLowerCase()));
}

/**
 * Strips auth headers/cookies from a HAR object.
 * Always strips: Authorization, Cookie, Set-Cookie, X-Api-Key, X-Auth-Token.
 * Pass extraHeadersToStrip to remove additional headers by name (case-insensitive).
 * Returns the input unchanged if it is not a HAR-shaped object.
 */
export function sanitizeHar(har: unknown, extraHeadersToStrip?: string[]): unknown {
  if (har === null || typeof har !== "object") return har;

  const harObj = har as HarObject;
  if (!harObj.log || typeof harObj.log !== "object") return har;

  const log = harObj.log as HarLog;
  if (!Array.isArray(log.entries)) return har;

  const stripSet = new Set(DEFAULT_HEADERS_TO_STRIP);
  if (extraHeadersToStrip) {
    for (const h of extraHeadersToStrip) {
      stripSet.add(h.toLowerCase());
    }
  }

  const sanitizedEntries: HarEntry[] = log.entries.map((entry) => {
    const sanitized: HarEntry = { ...entry };

    if (sanitized.request && typeof sanitized.request === "object") {
      const req = { ...sanitized.request } as HarRequest;
      if (Array.isArray(req.headers)) {
        req.headers = filterHeaders(req.headers, stripSet);
      }
      sanitized.request = req;
    }

    if (sanitized.response && typeof sanitized.response === "object") {
      const res = { ...sanitized.response } as HarResponse;
      if (Array.isArray(res.headers)) {
        res.headers = filterHeaders(res.headers, stripSet);
      }
      sanitized.response = res;
    }

    return sanitized;
  });

  return {
    ...harObj,
    log: {
      ...log,
      entries: sanitizedEntries,
    },
  };
}

// ─── Evidence naming ──────────────────────────────────────────────────────────

/**
 * Returns a filename-safe evidence file name.
 * Format: `{tcId}_{stepOrEvent}_{isoZ}.{ext}`
 * Example: "TC-AUTH-031_step3_20260523T143000Z.png"
 */
export function evidenceFileName(
  tcId: string,
  stepOrEvent: string | number,
  ext: string
): string {
  // Build compact ISO timestamp suitable for filenames: YYYYMMDDTHHmmss
  const iso = new Date()
    .toISOString()
    .replace(/[-:]/g, "")   // remove dashes and colons
    .replace(/\.\d+Z$/, "Z") // remove milliseconds, keep Z
    .slice(0, 15);            // YYYYMMDDTHHmmss (15 chars)
  return `${tcId}_${stepOrEvent}_${iso}Z.${ext}`;
}

/**
 * Returns the evidence directory path for a given run + test case.
 * Format: `{runsRoot}/{runId}/evidence/{tcId}/`
 */
export function evidenceDir(runId: string, tcId: string, runsRoot: string): string {
  return `${runsRoot}/${runId}/evidence/${tcId}/`;
}

// ─── Deterministic seed ───────────────────────────────────────────────────────

/**
 * Returns a deterministic numeric seed derived from a TC ID string.
 * Uses a djb2 hash. Pass the result to `faker.seed()`.
 */
export function deterministicSeed(tcId: string): number {
  let h = 5381;
  for (const c of tcId) {
    h = ((h << 5) + h) ^ c.charCodeAt(0);
  }
  return h >>> 0;
}

// ─── Locator hierarchy note ───────────────────────────────────────────────────

/**
 * Documents the canonical Playwright locator selection hierarchy.
 * Prefer: getByRole → getByLabel → getByPlaceholder/getByText → getByTestId → CSS.
 * Never XPath.
 */
export const LOCATOR_HIERARCHY_NOTE =
  "Prefer: getByRole → getByLabel → getByPlaceholder/getByText → getByTestId → CSS. Never XPath.";

// ─── data-testid convention ───────────────────────────────────────────────────

/**
 * Builds a data-testid string following the Aegis convention:
 * `{scope}-{component}-{element}-{type}`
 * Example: testId("checkout", "form", "email", "input") → "checkout-form-email-input"
 */
export function testId(
  scope: string,
  component: string,
  element: string,
  type: string
): string {
  return `${scope}-${component}-${element}-${type}`;
}

// ─── FactoryCleanupTracker ────────────────────────────────────────────────────

/**
 * Tracks async cleanup functions registered during test factory calls.
 * Call `runAll()` in afterEach to run all cleanups in parallel.
 * Errors from individual cleanups are logged but do not cause `runAll` to throw.
 *
 * @example
 * const cleanup = new FactoryCleanupTracker();
 * afterEach(() => cleanup.runAll());
 *
 * const user = await createUser();
 * cleanup.register(() => deleteUser(user.id));
 */
export class FactoryCleanupTracker {
  private readonly _fns: Array<() => Promise<void>> = [];

  register(cleanup: () => Promise<void>): void {
    this._fns.push(cleanup);
  }

  async runAll(): Promise<void> {
    if (this._fns.length === 0) return;

    const results = await Promise.allSettled(this._fns.map((fn) => fn()));

    for (const result of results) {
      if (result.status === "rejected") {
        console.error("[FactoryCleanupTracker] cleanup error:", result.reason);
      }
    }

    this.reset();
  }

  reset(): void {
    this._fns.length = 0;
  }
}
