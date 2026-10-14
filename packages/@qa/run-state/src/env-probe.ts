import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { isReadOnlyEnvironment, type EnvironmentSpecialistConfig, type RunState } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { assertCallerAllowed } from "./caller.js";
import { RunStateError } from "./errors.js";
import { busPath, runDir } from "./paths.js";
import { readRun, withRunLock } from "./run.js";
import { atomicWrite, iso } from "./util.js";
import { redactError } from "./explore/identity.js";
import { environmentUrl, exploreIdentity, objectAt, rawConfig, settleWithin, targetDirOf } from "./explore/probe.js";

/**
 * `aegis env probe`: the environment under test, checked from the outside before Execution starts and again before G2. It GETs the
 * environment url and the project's declared health paths, counts the processes listening on a local port, checks that the project's
 * declared required env names have a value in the QA secrets file (names only), and records the build under test. It writes
 * reports/env/probe-{stage}.json and an env.probed event; barriers only read the report. Every call to the machine goes through the
 * injectable ProbeSystem, has a timeout and runs outside run.lock; the whole probe is bounded by a time budget.
 */

export const PROBE_STAGES = ["execution", "g2"] as const;
export type ProbeStage = (typeof PROBE_STAGES)[number];

export interface ListenerInfo {
  pid: number;
  ppid: number;
}

/** What the probe asks of the machine. The CLI's real one lives in apps/cli (lsof, fetch, files); tests use fakes. */
export interface ProbeSystem {
  /** GET with redirect "manual": the status only, or null with the reason. Never a body or a header. */
  http(url: string, timeoutMs: number): Promise<{ status: number | null; error?: string }>;
  /** The processes listening on a TCP port: [] when nothing listens, null when it cannot be determined (no lsof, no permission, its own timeout). */
  listeners(port: number, timeoutMs: number): Promise<ListenerInfo[] | null>;
  /** The content of the Next build id file at `relPath` inside the target (default .next/BUILD_ID), or null. */
  buildId(targetDir: string, relPath: string): string | null;
  /** The names with a non-empty value in secrets/.env.<environment>, never a value; null when the file does not exist. */
  secretNames(root: string, environment: string): string[] | null;
}

export type ProbeCheckStatus = "ok" | "failed" | "not-checked" | "not-applicable";
export interface ProbeCheck {
  name: string;
  status: ProbeCheckStatus;
  detail: string;
}

export type BuildKind = "next-build-id" | "source" | "unknown";
export interface EnvProbeReport {
  runId: string;
  stage: ProbeStage;
  environment: string;
  takenAt: string;
  ok: boolean;
  /** For kind source, `id` is the head (what build-unchanged compares) and `dirtyHash` the uncommitted changes (recorded, never compared). */
  build: { kind: BuildKind; id: string | null; dirtyHash?: string | null };
  checks: ProbeCheck[];
}

export interface EnvProbeResult {
  runId: string;
  stage: ProbeStage;
  ok: boolean;
  /** The names of the failed checks (the details are in the report). */
  failed: string[];
  report: string;
}

export interface EnvProbeOptions {
  now?: Date;
  /** Wall-clock budget of the whole probe, the source identity included (default ENV_PROBE_BUDGET_MS). */
  budgetMs?: number;
  /** Cap of one external call, http or listeners (default CALL_TIMEOUT_MS); the budget left caps it further. */
  callTimeoutMs?: number;
}

/** The Bash call that runs the command has a 180 s timeout in the orchestrator's procedure. */
export const ENV_PROBE_BUDGET_MS = 120_000;
/** One http GET or one listener lookup. */
export const CALL_TIMEOUT_MS = 10_000;

/** The report of a stage, run-relative. */
export const envProbeReportRel = (stage: ProbeStage): string => `reports/env/probe-${stage}.json`;

/** Where the Next build id is read unless aegis.config.json#environments.<env>.buildIdPath names another target-relative file. */
export const DEFAULT_BUILD_ID_PATH = ".next/BUILD_ID";
const VAULT = "vault";
const VAULT_UNDECLARED = "declare a healthChecks path named vault that exercises it";
/** The names of the checks the probe adds itself: a declared health check may not take one. */
const RESERVED = new Set(["http", "health-checks", "listeners", "env-names", "build", "build-unchanged"]);
const HEALTH_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** The only names secretsFile parses. */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BUDGET_SPENT = "not run (time budget spent)";

/**
 * The independent processes among the listeners of one port: the same pid listed twice (IPv4 and IPv6) is one, and a process whose
 * parent also listens (a dev server's worker) counts with its parent.
 */
export function distinctListeners(l: readonly ListenerInfo[]): number {
  const pids = new Set(l.map((x) => x.pid));
  const roots = new Set<number>();
  for (const x of l) if (!pids.has(x.ppid) || x.ppid === x.pid) roots.add(x.pid);
  return roots.size;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** An error text from the machine: addresses and credentials redacted, bounded. */
const safe = (s: string): string => redactError(s).replace(/\s+/g, " ").trim().slice(0, 160);

/** Stage windows: a probe never replaces the report its barrier compares against later. */
function assertStageWindow(state: RunState, stage: ProbeStage): void {
  const status = (id: string): string => state.phases[id as keyof RunState["phases"]]?.status ?? "pending";
  if (stage === "execution") {
    const envData = status("env-data");
    if (status("execution") !== "pending" || (envData !== "completed" && envData !== "not-applicable")) {
      throw new RunStateError(
        "out-of-order",
        `the execution probe runs after Env-data has completed and before Execution starts (Env-data: ${envData}, Execution: ${status("execution")})`
      );
    }
  } else if (status("execution") !== "completed") {
    throw new RunStateError("out-of-order", `the g2 probe runs after Execution has completed (Execution: ${status("execution")})`);
  }
}

interface HealthCheck {
  name: string;
  path: string;
  expectStatus: number;
}

/** The project's declared health paths, read leniently: an invalid list is ignored with its reason (one check, never a thrown error). */
function healthChecksOf(env: Record<string, unknown> | null, origin: string | null): { list: HealthCheck[] } | { invalid: string } {
  const value = env?.["healthChecks"];
  if (value === undefined) return { list: [] };
  if (!Array.isArray(value)) return { invalid: "not a list" };
  const list: HealthCheck[] = [];
  const names = new Set<string>();
  for (const [i, entry] of value.entries()) {
    const e = objectAt(entry);
    const name = e?.["name"];
    const path = e?.["path"];
    const expect = e?.["expectStatus"];
    if (typeof name !== "string" || !HEALTH_NAME.test(name) || RESERVED.has(name) || names.has(name)) return { invalid: `entry ${i + 1} needs a unique name of letters, digits, - and _` };
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return { invalid: `entry ${i + 1} needs a path that starts with a single /` };
    if (expect !== undefined && (typeof expect !== "number" || !Number.isInteger(expect) || expect < 100 || expect > 599)) {
      return { invalid: `entry ${i + 1} has an expectStatus that is not an HTTP status` };
    }
    if (origin !== null) {
      let resolved: URL;
      try {
        resolved = new URL(path, origin);
      } catch {
        return { invalid: `entry ${i + 1} has a path that is not a valid address` };
      }
      if (resolved.origin !== origin) return { invalid: `entry ${i + 1} has a path outside the environment origin` };
    }
    names.add(name);
    list.push({ name, path, expectStatus: typeof expect === "number" ? expect : 200 });
  }
  return { list };
}

/** The declared required env names; undefined when none is declared, null when the list is invalid. */
function requiredEnvOf(env: Record<string, unknown> | null): string[] | undefined | null {
  const value = env?.["requiredEnv"];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !ENV_NAME.test(v))) return null;
  return [...new Set(value as string[])];
}

const defaultPort = (u: URL): number => (u.port !== "" ? Number(u.port) : u.protocol === "https:" ? 443 : 80);
/** The path of a URL without its query or fragment: what a detail may show. */
const pathOnly = (u: URL): string => u.pathname;

/** The inner timeout of one call: slightly below the outer cap, so the system's own timeout (lsof killed, fetch aborted) answers first. */
export const innerTimeoutMs = (capMs: number): number => Math.max(1_000, capMs - 500);

/** The target-relative path of the Next build id file, or why the declared one is invalid (absolute, or leaving the target). */
export function buildIdPathOf(env: Record<string, unknown> | null): { path: string } | { invalid: string } {
  const value = env?.["buildIdPath"];
  if (value === undefined) return { path: DEFAULT_BUILD_ID_PATH };
  if (typeof value !== "string" || value.trim() === "") return { invalid: "not a path" };
  const p = value.trim().replace(/\\/g, "/");
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return { invalid: "an absolute path; a path relative to the target is expected" };
  if (p.split("/").includes("..")) return { invalid: "a path that leaves the target" };
  return { path: p };
}

/**
 * Probes the run's environment for `stage` and records the result: the env.probed event first (under run.lock, short), then the report,
 * written atomically. A failed append leaves no report (an earlier report of the stage is removed, under run.lock with the window check,
 * before the probe starts); a failed report write throws after the event exists and the command is simply repeated. Failed checks never
 * throw: they are in the result.
 */
export async function probeEnvironment(
  root: string,
  runId: string,
  caller: string,
  stage: ProbeStage,
  system: ProbeSystem,
  opts: EnvProbeOptions = {}
): Promise<EnvProbeResult> {
  assertCallerAllowed(caller, "env.probe");
  if (!(PROBE_STAGES as readonly string[]).includes(stage)) throw new RunStateError("invalid-input", `--stage must be one of ${PROBE_STAGES.join(", ")}`);
  const reportRel = envProbeReportRel(stage);
  const reportFile = join(runDir(root, runId), reportRel);
  const before = await withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    assertStageWindow(state, stage);
    // A new probe starts: an earlier report of this stage must never be read as this one's. A refused probe never gets here.
    rmSync(reportFile, { force: true });
    return state;
  });

  const startedAt = Date.now();
  const deadline = startedAt + (opts.budgetMs ?? ENV_PROBE_BUDGET_MS);
  const callCap = opts.callTimeoutMs ?? CALL_TIMEOUT_MS;

  /** One external call, bounded by its cap and the budget left; a throw or a timeout is the reason, never an exception. */
  async function call<T>(work: (innerMs: number) => Promise<T>): Promise<{ value: T } | { error: string }> {
    const left = deadline - Date.now();
    if (left <= 0) return { error: BUDGET_SPENT };
    const ms = Math.min(callCap, left);
    const p = Promise.resolve().then(() => work(innerTimeoutMs(ms)));
    p.catch(() => undefined); // a call that rejects after its time ran out must not be an unhandled rejection
    try {
      const r = await settleWithin(p, ms);
      return r.done ? { value: r.value } : { error: `no answer within ${ms} ms` };
    } catch (e) {
      return { error: safe(messageOf(e)) };
    }
  }
  const sync = <T>(work: () => T): { value: T } | { error: string } => {
    try {
      return { value: work() };
    } catch (e) {
      return { error: safe(messageOf(e)) };
    }
  };

  const environment = before.environment;
  const raw = rawConfig(root);
  const envConfig = "config" in raw ? objectAt(objectAt(raw.config["environments"])?.[environment]) : null;
  const resolved = environmentUrl(root, environment);
  const url = "url" in resolved ? resolved.url : null;

  // The machine checks: a local url of a mutating environment only.
  const readOnly = envConfig !== null && isReadOnlyEnvironment(envConfig as EnvironmentSpecialistConfig);
  const local = url !== null && LOCAL_HOSTS.has(url.hostname);
  let machine: "yes" | "not-applicable" | "unknown";
  if (readOnly) machine = "not-applicable";
  else if (url === null) machine = "unknown";
  else machine = local ? "yes" : "not-applicable";
  const why = readOnly ? `the ${environment} environment is read-only` : "the environment url is not local";
  // Synchronous hashing first, only when the build check needs it: it cannot be preempted, so it is charged to the budget.
  const identity = machine === "yes" ? exploreIdentity(root) : null;

  const checks: ProbeCheck[] = [];
  // http: the environment url, then each declared health path.
  const httpCheck = async (name: string, target: URL, accept: (status: number) => boolean, expected: string): Promise<void> => {
    const r = await call((innerMs) => system.http(target.href, innerMs));
    const at = `GET ${pathOnly(target)}`;
    if ("error" in r) checks.push({ name, status: "failed", detail: `${at}: ${r.error}` });
    else if (r.value.status === null) checks.push({ name, status: "failed", detail: `${at}: ${safe(r.value.error ?? "no response")}` });
    else checks.push({ name, status: accept(r.value.status) ? "ok" : "failed", detail: `${at} answered ${r.value.status} (expected ${expected})` });
  };
  if (url === null) checks.push({ name: "http", status: "failed", detail: (resolved as { error: string }).error });
  else await httpCheck("http", url, (s) => s < 500, "below 500");

  const health = healthChecksOf(envConfig, url?.origin ?? null);
  let vaultDeclared = false;
  if ("invalid" in health) checks.push({ name: "health-checks", status: "not-checked", detail: `healthChecks invalid: ${health.invalid}` });
  else {
    for (const h of health.list) {
      if (h.name === VAULT) vaultDeclared = true;
      if (url === null) checks.push({ name: h.name, status: "failed", detail: `GET ${h.path.split(/[?#]/)[0]}: the environment url is not resolved` });
      else await httpCheck(h.name, new URL(h.path, url.origin), (s) => s === h.expectStatus, String(h.expectStatus));
    }
  }
  if (!vaultDeclared) checks.push({ name: VAULT, status: "not-checked", detail: VAULT_UNDECLARED });

  let build: EnvProbeReport["build"] = { kind: "unknown", id: null };
  if (machine !== "yes") {
    const status: ProbeCheckStatus = machine === "unknown" ? "not-checked" : "not-applicable";
    const detail = machine === "unknown" ? "the environment url is not resolved" : why;
    for (const name of ["listeners", "env-names", "build"]) checks.push({ name, status, detail });
  } else {
    const port = defaultPort(url!);
    const l = await call((innerMs) => system.listeners(port, innerMs));
    if ("error" in l) checks.push({ name: "listeners", status: "failed", detail: `the listeners on port ${port}: ${l.error}` });
    else if (l.value === null) {
      checks.push({ name: "listeners", status: "not-checked", detail: `the listeners on port ${port} could not be determined (lsof unavailable, not permitted or not answering in time)` });
    } else {
      const n = distinctListeners(l.value);
      if (n === 1) checks.push({ name: "listeners", status: "ok", detail: `one process listens on port ${port}` });
      else if (n === 0) checks.push({ name: "listeners", status: "failed", detail: `nothing listens on port ${port}` });
      else {
        const pids = [...new Set(l.value.map((x) => x.pid))].sort((a, b) => a - b);
        checks.push({ name: "listeners", status: "failed", detail: `${n} independent processes listen on port ${port} (pids ${pids.join(", ")})` });
      }
    }

    const required = requiredEnvOf(envConfig);
    if (required === undefined || (required !== null && required.length === 0)) {
      checks.push({ name: "env-names", status: "not-checked", detail: "no requiredEnv list is declared for this environment" });
    } else if (required === null) {
      checks.push({ name: "env-names", status: "not-checked", detail: "requiredEnv invalid: a list of names in capitals, digits and _ is expected" });
    } else {
      const names = sync(() => system.secretNames(root, environment));
      if ("error" in names) checks.push({ name: "env-names", status: "failed", detail: `the QA secrets file could not be read: ${names.error}` });
      else if (names.value === null) checks.push({ name: "env-names", status: "not-checked", detail: `there is no QA secrets file for ${environment}` });
      else {
        const have = new Set(names.value);
        const missing = required.filter((n) => !have.has(n));
        checks.push(
          missing.length === 0
            ? { name: "env-names", status: "ok", detail: `${required.length} required names have a value` }
            : { name: "env-names", status: "failed", detail: `no value in the QA secrets file for ${missing.join(", ")}` }
        );
      }
    }

    const idPath = buildIdPathOf(envConfig);
    const id = "invalid" in idPath ? null : sync(() => system.buildId(targetDirOf(root), idPath.path));
    if ("invalid" in idPath) checks.push({ name: "build", status: "not-checked", detail: `buildIdPath invalid: ${idPath.invalid}` });
    else if (id !== null && "error" in id) checks.push({ name: "build", status: "failed", detail: `the build id could not be read: ${id.error}` });
    else if (id !== null && typeof id.value === "string" && id.value.trim() !== "") {
      build = { kind: "next-build-id", id: id.value.trim() };
      checks.push({ name: "build", status: "ok", detail: `next build id ${build.id!.slice(0, 12)} (${idPath.path})` });
    } else if (identity!.head !== null) {
      // The head is what is compared; the uncommitted changes are recorded only (QA writes untracked files into the target every run).
      build = { kind: "source", id: identity!.head, dirtyHash: identity!.dirtyHash };
      checks.push({ name: "build", status: "ok", detail: `no next build id; source head ${identity!.head.slice(0, 12)}` });
    } else checks.push({ name: "build", status: "not-checked", detail: "no next build id and the target is not a readable git checkout" });
  }

  if (stage === "g2") checks.push(machine === "yes" ? buildUnchanged(root, runId, build) : { name: "build-unchanged", status: "not-applicable", detail: machine === "unknown" ? "the environment url is not resolved" : why });

  const ok = !checks.some((c) => c.status === "failed");
  const failed = checks.filter((c) => c.status === "failed").map((c) => c.name);

  const ts = await withRunLock(root, runId, async () => {
    // The window is checked again: the phase may have moved while the probe ran.
    assertStageWindow(readRun(root, runId), stage);
    const at = iso(opts.now);
    await appendChained(
      { type: "env.probed", ts: at, agent: caller, stage, environment, ok, failed, build: build.id === null ? build.kind : `${build.kind}:${build.id.slice(0, 12)}` },
      busPath(root, runId),
      { emittedBy: caller, runId }
    );
    return at;
  });
  const report: EnvProbeReport = { runId, stage, environment, takenAt: ts, ok, build, checks };
  mkdirSync(dirname(reportFile), { recursive: true });
  atomicWrite(reportFile, JSON.stringify(report, null, 2) + "\n");
  return { runId, stage, ok, failed, report: reportRel };
}

// ─── What the barriers read ──────────────────────────────────────────────────

/** The recorded report of a stage, read leniently: what a barrier needs (stage, takenAt, ok, checks) or why it cannot be used. */
export type ProbeReportRead =
  | { kind: "missing" }
  | { kind: "unreadable" }
  | { kind: "ok"; report: Pick<EnvProbeReport, "stage" | "takenAt" | "ok" | "checks"> };

/** Reads reports/env/probe-{stage}.json and nothing else: no process, no network. A report of another stage is unreadable. */
export function readProbeReport(root: string, runId: string, stage: ProbeStage): ProbeReportRead {
  let text: string;
  try {
    text = readFileSync(join(runDir(root, runId), envProbeReportRel(stage)), "utf-8");
  } catch (e) {
    return (e as NodeJS.ErrnoException | null)?.code === "ENOENT" ? { kind: "missing" } : { kind: "unreadable" };
  }
  let r: Record<string, unknown> | null;
  try {
    r = objectAt(JSON.parse(text));
  } catch {
    return { kind: "unreadable" };
  }
  const takenAt = r?.["takenAt"];
  if (r === null || r["stage"] !== stage || typeof r["ok"] !== "boolean" || typeof takenAt !== "string" || Number.isNaN(Date.parse(takenAt))) return { kind: "unreadable" };
  const checks: ProbeCheck[] = [];
  for (const c of Array.isArray(r["checks"]) ? r["checks"] : []) {
    const o = objectAt(c);
    const status = o?.["status"];
    if (typeof o?.["name"] !== "string" || (status !== "ok" && status !== "failed" && status !== "not-checked" && status !== "not-applicable")) continue;
    checks.push({ name: o["name"], status, detail: typeof o["detail"] === "string" ? o["detail"] : "" });
  }
  return { kind: "ok", report: { stage, takenAt, ok: r["ok"], checks } };
}

/**
 * A probe is stale when it was taken at or before `completedAt` (the phase it must follow). A missing or unreadable `completedAt`
 * (test fixtures, runs recorded before the field) is never a reason to call it stale.
 */
export function probeIsStale(takenAt: string, completedAt: string | undefined): boolean {
  if (completedAt === undefined) return false;
  const done = Date.parse(completedAt);
  return !Number.isNaN(done) && Date.parse(takenAt) <= done;
}

/**
 * Why Execution may not start yet, from the execution probe report only (the startPhase guard, inside run.lock): [] when a probe taken
 * after Env-data completed says ok. Each entry is one failed check of the barrier.
 */
export function executionProbeProblems(root: string, runId: string, state: RunState): string[] {
  const read = readProbeReport(root, runId, "execution");
  if (read.kind === "missing") return [`no execution probe is recorded (${envProbeReportRel("execution")})`];
  if (read.kind === "unreadable") return [`the execution probe report (${envProbeReportRel("execution")}) cannot be read`];
  const problems: string[] = [];
  const envData = state.phases["env-data"]?.completedAt;
  if (probeIsStale(read.report.takenAt, envData)) problems.push(`the execution probe was taken at ${read.report.takenAt}, not after Env-data completed at ${envData}`);
  if (!read.report.ok) {
    const failed = read.report.checks.filter((c) => c.status === "failed").map((c) => c.name);
    problems.push(`the execution probe failed${failed.length > 0 ? ` (${failed.join(", ")})` : ""}`);
  }
  return problems;
}

/** The probe reports a reopen of `reopened` makes stale: the execution one when Execution reopens, the g2 one when Triage does. */
export function staleProbeReports(reopened: readonly string[]): string[] {
  return [...(reopened.includes("execution") ? [envProbeReportRel("execution")] : []), ...(reopened.includes("triage") ? [envProbeReportRel("g2")] : [])];
}

/**
 * Removes the probe reports a reopen made stale, after the reopen is recorded. Never throws: a report that cannot be removed is still
 * compared by its takenAt with the phase it follows (which catches it whenever that phase was reopened too).
 */
export function removeStaleProbeReports(root: string, runId: string, reopened: readonly string[]): void {
  for (const rel of staleProbeReports(reopened)) {
    try {
      rmSync(join(runDir(root, runId), rel), { force: true });
    } catch {
      // the decision stands
    }
  }
}

/** The g2 build against the execution probe's: only a Next build id that changed, appeared or vanished fails; a source head change is a hint. */
function buildUnchanged(root: string, runId: string, now: EnvProbeReport["build"]): ProbeCheck {
  const name = "build-unchanged";
  let before: EnvProbeReport["build"] | null = null;
  try {
    const r = objectAt(JSON.parse(readFileSync(join(runDir(root, runId), envProbeReportRel("execution")), "utf-8")));
    const b = objectAt(r?.["build"]);
    const kind = b?.["kind"];
    const id = b?.["id"];
    if (kind === "next-build-id" || kind === "source" || kind === "unknown") before = { kind, id: typeof id === "string" ? id : null };
  } catch {
    before = null;
  }
  if (before === null) return { name, status: "not-checked", detail: "no Execution probe" };
  const p = (id: string | null): string => (id ?? "").slice(0, 12);
  if (before.kind === "next-build-id" && now.kind === "next-build-id") {
    return before.id === now.id
      ? { name, status: "ok", detail: `next build id ${p(now.id)} unchanged since Execution` }
      : { name, status: "failed", detail: `the build under test changed during Execution (next build id ${p(before.id)} became ${p(now.id)})` };
  }
  if (now.kind === "next-build-id") return { name, status: "failed", detail: "a production build appeared during Execution (a next build id exists now and did not at the execution probe)" };
  if (before.kind === "next-build-id") return { name, status: "failed", detail: "the build under test vanished (the next build id of the execution probe is gone)" };
  if (before.kind === "source" && now.kind === "source") {
    return before.id === now.id
      ? { name, status: "ok", detail: "source head unchanged since Execution (uncommitted changes are not compared)" }
      : { name, status: "not-checked", detail: `source identity changed (hint): the head ${p(before.id)} became ${p(now.id)}` };
  }
  return { name, status: "not-checked", detail: "the build could not be compared (no build id or source head at one of the probes)" };
}
