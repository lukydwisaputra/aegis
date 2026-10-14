import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { PhaseRecord, RunState } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { assertCallerAllowed } from "../caller.js";
import { RunStateError } from "../errors.js";
import { busPath, runDir, taskmasterDir } from "../paths.js";
import { commitRun, readRun, withRunLock } from "../run.js";
import { reopenPhaseTasks } from "../supersede.js";
import { atomicWrite, iso } from "../util.js";
import {
  compareSignatures, decideProbe, identityDiffers, observe, redactError, selectPages, sourceIdentity,
  type Observed, type PageRef, type PageSignature, type ProbeDecision, type ProbeDiff, type RawObservation, type SourceIdentity,
} from "./identity.js";

/** Visits one page read-only (GET navigation only) as its role. `close` ends the browser; the probe always calls it, also after a throw. */
export interface PageFetcher {
  visit(page: PageRef): Promise<RawObservation>;
  close(): Promise<void>;
}
/** May throw (Playwright missing in the target, the browser does not start): the probe turns that into decision full. */
export type FetcherFactory = () => Promise<PageFetcher>;

export interface BaselineResult {
  runId: string;
  pages: number;
  skipped: number;
  /** Pages selected but not observed (the visit failed or the time budget ran out): the next probe counts each as failed. */
  unobserved: number;
  unavailable: string | null;
  report: string;
}

/** Wall-clock budget of one visit loop; the Bash call that runs the command has a 600 s ceiling. */
export const PROBE_BUDGET_MS = 480_000;

export interface ProbeOptions {
  now?: Date;
  /** Wall-clock budget of the call's identity hashing and visit loop (default PROBE_BUDGET_MS). */
  budgetMs?: number;
  /** How long a fetcher's close() may take before the call goes on without it (default 10 s). */
  closeMs?: number;
}

export interface ProbeResult {
  runId: string;
  decision: ProbeDecision;
  reason: string | null;
  diff: ProbeDiff;
  hints: string[];
  reopened: string[];
  report: string;
}

const EXPLORER = "qa-web-explorer";
const BASELINE_REL = "reports/explore/baseline.json";
const PROBE_REL = "reports/explore/probe.json";
const BUDGET_ERROR = "not observed (time budget)";
/** A fetcher that does not close in this time is left behind: the call must return. */
const CLOSE_MS = 10_000;

interface RoleAuth {
  role: string;
  auth: boolean;
}

interface Baseline {
  takenAt: string;
  baseUrl: string | null;
  pages: PageSignature[];
  skipped: Array<{ role: string; route: string; reason: string }>;
  /** Absent in a baseline written before this field: none. */
  unobserved?: Array<{ role: string; url: string; error: string }>;
  unavailable: string | null;
  identity: SourceIdentity;
  roles: RoleAuth[];
  discoveryConfigHash: string;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** aegis.config.json as a plain object; an unreadable file is reported, never thrown. */
function rawConfig(root: string): { config: Record<string, unknown> } | { error: string } {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, "aegis.config.json"), "utf-8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { error: "aegis.config.json is not an object" };
    return { config: parsed as Record<string, unknown> };
  } catch {
    return { error: "cannot read aegis.config.json" };
  }
}

const objectAt = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** A JSON file of the run read leniently: null when it is missing or not valid JSON. */
function readRunJson(root: string, runId: string, rel: string): unknown {
  try {
    return JSON.parse(readFileSync(join(runDir(root, runId), rel), "utf-8"));
  } catch {
    return null;
  }
}

/**
 * The origin of the run environment's `url` in aegis.config.json, with each `${VAR}` replaced from the process environment.
 * An unset variable, a missing url or one that is not an http(s) address gives the reason instead (it names the variable, never a value).
 */
export function environmentBaseUrl(root: string, environment: string): { url: string } | { error: string } {
  const raw = rawConfig(root);
  if ("error" in raw) return raw;
  const url = objectAt(objectAt(raw.config["environments"])?.[environment])?.["url"];
  if (typeof url !== "string" || url.trim() === "") return { error: `aegis.config.json has no url for environment ${environment}` };
  const missing: string[] = [];
  const resolved = url.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => {
    const v = process.env[name];
    if (v === undefined || v.trim() === "") {
      missing.push(name);
      return "";
    }
    return v.trim();
  });
  if (missing.length > 0) return { error: `the ${environment} url needs ${missing.join(", ")}, which is not set` };
  try {
    const u = new URL(resolved);
    if (u.protocol !== "http:" && u.protocol !== "https:") return { error: `the ${environment} url is not an http(s) address` };
    return { url: u.origin };
  } catch {
    return { error: `the ${environment} url is not a valid address` };
  }
}

/** Where the target source stands, with the aegis directory and the tests directory left out. Never throws. */
export function exploreIdentity(root: string): SourceIdentity {
  try {
    const raw = rawConfig(root);
    const config = "config" in raw ? raw.config : {};
    const target = resolve(root, typeof config["targetProjectRoot"] === "string" ? config["targetProjectRoot"] : "..");
    const testsDir = typeof config["testsDir"] === "string" ? config["testsDir"] : "../tests/qa";
    return sourceIdentity(target, [relative(target, root), relative(target, resolve(root, testsDir))]);
  } catch {
    return { head: null, dirtyHash: null };
  }
}

/** JSON with sorted keys, so the same settings always give the same hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = objectAt(value);
  if (o !== null) return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

interface ProbeSetting {
  origin: string | null;
  /** Why no page can be visited (the environment url or the config), or null. */
  unavailable: string | null;
  roles: RoleAuth[];
  discoveryConfigHash: string;
  skip: RegExp[];
}

/** What a baseline and a probe both read the same way: the environment origin, the roles of env-auth-report.json and the discovery settings. */
function probeSetting(root: string, runId: string, environment: string): ProbeSetting {
  const base = environmentBaseUrl(root, environment);
  const raw = rawConfig(root);
  const discovery = "config" in raw ? (raw.config["discovery"] ?? null) : null;
  const discoveryConfigHash = createHash("sha256").update(canonical(discovery)).digest("hex").slice(0, 16);
  const byRole = new Map<string, boolean>();
  const report = objectAt(readRunJson(root, runId, "env-auth-report.json"));
  for (const entry of Array.isArray(report?.["roles"]) ? (report!["roles"] as unknown[]) : []) {
    const e = objectAt(entry);
    const role = e?.["role"];
    if (typeof role !== "string" || role === "") continue;
    const auth = typeof e!["storageState"] === "string" && e!["storageState"] !== "";
    byRole.set(role, (byRole.get(role) ?? false) || auth);
  }
  const roles = [...byRole].map(([role, auth]) => ({ role, auth })).sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : 0));
  let unavailable = "error" in base ? base.error : null;
  const skip: RegExp[] = [];
  const patterns = objectAt(discovery)?.["skipPatterns"];
  if (patterns !== undefined) {
    if (!Array.isArray(patterns) || patterns.some((p) => typeof p !== "string")) unavailable ??= "aegis.config.json#discovery.skipPatterns must be a list of strings";
    else
      for (const p of patterns as string[]) {
        try {
          skip.push(new RegExp(p));
        } catch {
          unavailable ??= "aegis.config.json#discovery.skipPatterns holds a pattern that is not a valid regular expression";
        }
      }
  }
  return { origin: "url" in base ? base.url : null, unavailable, roles, discoveryConfigHash, skip };
}

/** Settles `work` or gives up after `ms`; the timer never keeps the process alive. */
async function within<T>(work: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ done: false }>((res) => {
    timer = setTimeout(() => res({ done: false }), Math.max(0, ms));
  });
  try {
    return await Promise.race([work.then((value) => ({ done: true as const, value })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The visit loop's share of the budget: what the identity hashing before it left over. */
const budgetLeft = (opts: ProbeOptions, startedAt: number): number => Math.max(0, (opts.budgetMs ?? PROBE_BUDGET_MS) - (Date.now() - startedAt));

/**
 * Builds the fetcher and visits `pages` one at a time within `budgetMs`: each visit is raced against the budget left, and every page
 * not visited in time is an error observation. A throwing visit is an error observation too. The fetcher is closed exactly once,
 * whatever happens; a factory that throws, or does not answer within the budget, gives the redacted reason instead.
 */
async function visitAll(factory: FetcherFactory, pages: readonly PageRef[], budgetMs: number, closeMs: number): Promise<{ observed: Observed[] } | { error: string }> {
  // No budget left (the identity hashing spent it): no browser is started and no page is observed.
  if (budgetMs <= 0) return { observed: pages.map((page) => ({ ...page, error: BUDGET_ERROR })) };
  const deadline = Date.now() + budgetMs;
  let fetcher: PageFetcher;
  const starting = Promise.resolve().then(factory);
  try {
    const started = await within(starting, budgetMs);
    if (!started.done) {
      // A fetcher that starts after the call gave up is closed as soon as it exists.
      starting.then((f) => f.close()).catch(() => undefined);
      return { error: "the page fetcher did not start within the time budget" };
    }
    fetcher = started.value;
  } catch (e) {
    return { error: redactError(messageOf(e)) };
  }
  const observed: Observed[] = [];
  try {
    for (const page of pages) {
      const left = deadline - Date.now();
      if (left <= 0) {
        observed.push({ ...page, error: BUDGET_ERROR });
        continue;
      }
      const visit = Promise.resolve().then(() => fetcher.visit(page));
      visit.catch(() => undefined); // a visit that rejects after its time ran out must not be an unhandled rejection
      let raw: RawObservation;
      try {
        const r = await within(visit, left);
        raw = r.done ? r.value : { ...page, error: BUDGET_ERROR };
      } catch (e) {
        raw = { ...page, error: messageOf(e) };
      }
      // Matched to the baseline by the page asked for, whatever address the fetcher names.
      observed.push(observe({ ...raw, role: page.role, url: page.url }));
    }
  } finally {
    const closing = Promise.resolve().then(() => fetcher.close());
    closing.catch(() => undefined);
    await within(closing, closeMs).catch(() => undefined);
  }
  return { observed };
}

const notInProgress = (state: RunState): boolean => state.phases["explore"]?.status !== "in-progress";

function assertBaselineAllowed(state: RunState): void {
  if (notInProgress(state)) throw new RunStateError("invalid-input", "the baseline is taken while Explore is in progress, after the explorer's review passed");
  if (state.phases["explore"]?.carried === true) {
    throw new RunStateError("invalid-input", "discovery is carried over and not verified: verify the carried discovery first (explore probe without --baseline)");
  }
}

function assertProbeAllowed(state: RunState): void {
  if (notInProgress(state)) {
    throw new RunStateError("invalid-input", "the probe runs while Explore is in progress: start Explore after Env-auth has completed again, then run the probe");
  }
  if (state.phases["explore"]?.carried !== true) throw new RunStateError("invalid-input", "discovery is not carried over in this run: nothing to verify");
}

/**
 * Visits every concrete page of the discovery report as its role and stores one signature per page in reports/explore/baseline.json, so a
 * later probe compares like with like. A page that cannot be observed (its visit failed, or the time budget ran out) is stored in
 * `unobserved`, and the next probe counts it as failed, never as reused. It never throws for a missing report, an unresolved environment url or a fetcher that cannot
 * start: the baseline is then `unavailable` with zero pages, and the next probe answers full. run.lock is held only for the short write.
 */
export async function takeBaseline(root: string, runId: string, caller: string, factory: FetcherFactory, opts: ProbeOptions = {}): Promise<BaselineResult> {
  assertCallerAllowed(caller, "explore.probe");
  const before = readRun(root, runId);
  assertBaselineAllowed(before);
  const startedAt = Date.now();
  const identity = exploreIdentity(root); // synchronous hashing: outside run.lock, inside the time budget
  const setting = probeSetting(root, runId, before.environment);
  let unavailable = setting.unavailable;
  const skipped: Baseline["skipped"] = [];
  const pages: PageRef[] = [];
  if (unavailable === null) {
    const discovery = objectAt(readRunJson(root, runId, "discovery-report.json"));
    if (discovery === null) unavailable = "discovery-report.json is missing or not valid JSON";
    else if (!Array.isArray(discovery["pages"])) unavailable = "discovery-report.json has no pages array";
    else {
      const selected = selectPages(discovery["pages"], setting.origin!, setting.skip);
      skipped.push(...selected.skipped);
      const listed = new Set(setting.roles.map((r) => r.role));
      for (const p of selected.pages) {
        if (listed.has(p.role)) pages.push(p);
        else skipped.push({ role: p.role, route: p.url, reason: "role without auth state" });
      }
    }
  }
  const signatures: PageSignature[] = [];
  const unobserved: NonNullable<Baseline["unobserved"]> = [];
  if (unavailable === null && pages.length > 0) {
    const visited = await visitAll(factory, pages, budgetLeft(opts, startedAt), opts.closeMs ?? CLOSE_MS);
    if ("error" in visited) unavailable = `the page fetcher could not start: ${visited.error}`;
    else {
      for (const o of visited.observed) {
        if ("error" in o) unobserved.push({ role: o.role, url: o.url, error: o.error });
        else signatures.push(o);
      }
    }
  }
  return withRunLock(root, runId, async () => {
    assertBaselineAllowed(readRun(root, runId));
    const ts = iso(opts.now);
    const baseline: Baseline = {
      takenAt: ts, baseUrl: setting.origin, pages: signatures, skipped, unobserved, unavailable, identity, roles: setting.roles, discoveryConfigHash: setting.discoveryConfigHash,
    };
    mkdirSync(join(runDir(root, runId), "reports", "explore"), { recursive: true });
    atomicWrite(join(runDir(root, runId), BASELINE_REL), JSON.stringify(baseline, null, 2) + "\n");
    await appendChained(
      { type: "explore.probed", ts, agent: caller, mode: "baseline", decision: "none", pages: signatures.length, same: 0, changed: 0, failed: unobserved.length, hints: [] },
      busPath(root, runId),
      { emittedBy: caller, runId }
    );
    return { runId, pages: signatures.length, skipped: skipped.length, unobserved: unobserved.length, unavailable, report: BASELINE_REL };
  });
}

/** baseline.json, or why it cannot be compared with. */
function readBaseline(root: string, runId: string): { baseline: Baseline } | { reason: string } {
  const raw = readRunJson(root, runId, BASELINE_REL);
  if (raw === null) return { reason: "no baseline of the explored pages was taken in this run" };
  const b = objectAt(raw);
  const pages = b?.["pages"];
  const pageOk = (p: unknown): boolean => {
    const o = objectAt(p);
    return o !== null && typeof o["role"] === "string" && typeof o["url"] === "string";
  };
  const unobserved = b?.["unobserved"];
  const unobservedOk = unobserved === undefined || (Array.isArray(unobserved) && unobserved.every((u) => pageOk(u) && typeof objectAt(u)!["error"] === "string"));
  if (b === null || !Array.isArray(pages) || !pages.every(pageOk) || !unobservedOk || !Array.isArray(b["roles"]) || typeof b["discoveryConfigHash"] !== "string") {
    return { reason: "the baseline file is incomplete" };
  }
  if (typeof b["unavailable"] === "string") return { reason: `the baseline was not available (${b["unavailable"]})` };
  if (pages.length === 0) return { reason: "the baseline holds no page to compare with" };
  return { baseline: b as unknown as Baseline };
}

const roleText = (roles: readonly RoleAuth[]): string => roles.map((r) => `${r.role}${r.auth ? "" : " (no auth state)"}`).join(", ") || "none";

/** The source identity as hints next to the decision: the pages decide, never git. */
function identityHints(before: SourceIdentity | undefined, now: SourceIdentity): string[] {
  const text: Record<string, string> = {
    head: "head: the target has another app commit than at the baseline",
    dirtyHash: "dirtyHash: the uncommitted changes in the target differ from the baseline",
  };
  return identityDiffers(before, now).map((p) => {
    if (before === undefined) return `${text[p]} (none was recorded)`;
    // Null is unreadable (not a git checkout, or git did not answer): it says nothing about a change.
    const k = p as keyof SourceIdentity;
    if (before[k] === null) return `${p}: could not be read at the baseline`;
    if (now[k] === null) return `${p}: could not be read now`;
    return text[p]!;
  });
}

/**
 * Verifies carried-over discovery: visits every baseline page with the same fetcher, compares and decides reuse, partial or full.
 * Anything unknown (no baseline, a fetcher that cannot start, other roles or discovery settings than at the baseline) is full with a
 * reason, never an exception. When the decision is not reuse the explorer's task is reopened with a fresh attempt count; carried is
 * removed and the source identity recorded in the same commit. run.lock is never held while pages are visited.
 */
export async function probeExplore(root: string, runId: string, caller: string, factory: FetcherFactory, opts: ProbeOptions = {}): Promise<ProbeResult> {
  assertCallerAllowed(caller, "explore.probe");
  const before = await withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    assertProbeAllowed(state);
    return state;
  });
  const startedAt = Date.now();
  const identity = exploreIdentity(root); // synchronous hashing: outside run.lock, inside the time budget
  const read = readBaseline(root, runId);
  const baseline = "baseline" in read ? read.baseline : null;
  let reason: string | null = "reason" in read ? read.reason : null;
  let observed: Observed[] | null = null;
  if (baseline !== null) {
    const now = probeSetting(root, runId, before.environment);
    if (now.unavailable !== null) reason = now.unavailable;
    else if (now.origin !== baseline.baseUrl) reason = "the environment address changed since the baseline";
    else if (canonical(now.roles) !== canonical(baseline.roles)) {
      reason = `the logged-in roles changed since the baseline (then: ${roleText(baseline.roles)}; now: ${roleText(now.roles)})`;
    } else if (now.discoveryConfigHash !== baseline.discoveryConfigHash) reason = "the discovery settings in aegis.config.json changed since the baseline";
    else {
      const visited = await visitAll(factory, baseline.pages.map((p) => ({ role: p.role, url: p.url })), budgetLeft(opts, startedAt), opts.closeMs ?? CLOSE_MS);
      if ("error" in visited) reason = `the page fetcher could not start: ${visited.error}`;
      else observed = visited.observed;
    }
  }
  // Compared only when the pages were visited; a reason-driven full compares nothing, so every count is zero.
  let diff: ProbeDiff = { same: 0, changed: [], failed: [], total: 0 };
  if (observed !== null) {
    const compared = compareSignatures(baseline!.pages, observed);
    // A page the baseline could not observe has no signature to compare with: it is never reused, it is explored again.
    const unobserved = baseline!.unobserved ?? [];
    diff = {
      ...compared,
      failed: [...compared.failed, ...unobserved.map((u) => ({ role: u.role, url: u.url, error: `not observed at baseline: ${u.error}` }))],
      total: compared.total + unobserved.length,
    };
  }
  let decision: ProbeDecision = reason === null ? decideProbe(diff) : "full";
  if (decision === "full" && reason === null) reason = `${diff.changed.length + diff.failed.length} of ${diff.total} pages changed or could not be observed`;
  const hints = identityHints(baseline?.identity ?? before.phases["explore"]?.identity, identity);

  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    assertProbeAllowed(state);
    const ts = iso(opts.now);
    const client = createTaskmasterClient(taskmasterDir(root, runId));
    const explorer = (await client.list()).filter((t) => t.phase === "explore" && t.assignee === EXPLORER);
    // An earlier try of this probe reopened the explorer and could not record its result: its work is gone, so reuse is not possible.
    if (decision === "reuse" && explorer.some((t) => t.status === "pending" || t.status === "in-progress" || t.status === "blocked")) {
      decision = "full";
      reason = "the explorer task was already reopened by an earlier probe of this run";
    }
    const open = decision === "reuse" ? state : await reopenPhaseTasks(root, runId, state, new Set(["explore"]), ts, (t) => t.assignee !== EXPLORER);
    const reopened = decision === "reuse" ? [] : (await client.list()).filter((t) => t.phase === "explore" && t.assignee === EXPLORER && t.status === "pending").map((t) => t.id).sort();
    const { carried: _carried, ...record }: PhaseRecord = open.phases["explore"] ?? { status: "in-progress" };
    const next: RunState = { ...open, phases: { ...open.phases, explore: { ...record, identity } }, updatedAt: ts };
    const changedPages = [...diff.changed, ...diff.failed].map((p) => ({ role: p.role, url: p.url }));
    mkdirSync(join(runDir(root, runId), "reports", "explore"), { recursive: true });
    atomicWrite(join(runDir(root, runId), PROBE_REL), JSON.stringify({ decidedAt: ts, decision, reason, diff, hints, reopened, changedPages }, null, 2) + "\n");
    // Unrecorded: run.json goes back to `open`, still carried, so the same command can be repeated.
    await commitRun(root, open, next, () =>
      appendChained(
        { type: "explore.probed", ts, agent: caller, mode: "verify", decision, pages: diff.total, same: diff.same, changed: diff.changed.length, failed: diff.failed.length, hints },
        busPath(root, runId),
        { emittedBy: caller, runId }
      )
    );
    return { runId, decision, reason, diff, hints, reopened, report: PROBE_REL };
  });
}

/** The entry of the explore probe command: the baseline with `baseline: true`, the verify probe otherwise. */
export async function exploreProbe(root: string, runId: string, caller: string, factory: FetcherFactory, opts: ProbeOptions & { baseline?: boolean } = {}): Promise<BaselineResult | ProbeResult> {
  return opts.baseline === true ? takeBaseline(root, runId, caller, factory, opts) : probeExplore(root, runId, caller, factory, opts);
}
