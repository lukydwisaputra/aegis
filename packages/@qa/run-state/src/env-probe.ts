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
  /** The processes listening on a TCP port: [] when nothing listens, null when it cannot be determined (no lsof, no permission). */
  listeners(port: number): Promise<ListenerInfo[] | null>;
  /** The content of .next/BUILD_ID in the target, or null. */
  buildId(targetDir: string): string | null;
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
  build: { kind: BuildKind; id: string | null };
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

/**
 * Probes the run's environment for `stage` and records the result: the env.probed event first (under run.lock, short), then the report,
 * written atomically. A failed append leaves no report (an earlier report of the stage is removed before the probe starts); a failed
 * report write throws after the event exists and the command is simply repeated. Failed checks never throw: they are in the result.
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
  const before = readRun(root, runId);
  assertStageWindow(before, stage);
  const reportRel = envProbeReportRel(stage);
  const reportFile = join(runDir(root, runId), reportRel);
  // A new probe starts: an earlier report of this stage must never be read as this one's.
  rmSync(reportFile, { force: true });

  const startedAt = Date.now();
  const identity = exploreIdentity(root); // synchronous hashing first: it cannot be preempted, so it is charged to the budget
  const deadline = startedAt + (opts.budgetMs ?? ENV_PROBE_BUDGET_MS);
  const callCap = opts.callTimeoutMs ?? CALL_TIMEOUT_MS;

  /** One external call, bounded by its cap and the budget left; a throw or a timeout is the reason, never an exception. */
  async function call<T>(work: () => Promise<T>): Promise<{ value: T } | { error: string }> {
    const left = deadline - Date.now();
    if (left <= 0) return { error: BUDGET_SPENT };
    const ms = Math.min(callCap, left);
    const p = Promise.resolve().then(work);
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
  const checks: ProbeCheck[] = [];

  // http: the environment url, then each declared health path.
  const httpCheck = async (name: string, target: URL, accept: (status: number) => boolean, expected: string): Promise<void> => {
    const r = await call(() => system.http(target.href, Math.min(callCap, Math.max(0, deadline - Date.now()))));
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

  // The machine checks: a local url of a mutating environment only.
  const readOnly = envConfig !== null && isReadOnlyEnvironment(envConfig as EnvironmentSpecialistConfig);
  const local = url !== null && LOCAL_HOSTS.has(url.hostname);
  let build: EnvProbeReport["build"] = { kind: "unknown", id: null };
  let machine: "yes" | "not-applicable" | "unknown";
  if (readOnly) machine = "not-applicable";
  else if (url === null) machine = "unknown";
  else machine = local ? "yes" : "not-applicable";
  const why = readOnly ? `the ${environment} environment is read-only` : "the environment url is not local";

  if (machine !== "yes") {
    const status: ProbeCheckStatus = machine === "unknown" ? "not-checked" : "not-applicable";
    const detail = machine === "unknown" ? "the environment url is not resolved" : why;
    for (const name of ["listeners", "env-names", "build"]) checks.push({ name, status, detail });
  } else {
    const port = defaultPort(url!);
    const l = await call(() => system.listeners(port));
    if ("error" in l) checks.push({ name: "listeners", status: "failed", detail: `the listeners on port ${port}: ${l.error}` });
    else if (l.value === null) checks.push({ name: "listeners", status: "not-checked", detail: `the listeners on port ${port} could not be determined (lsof unavailable or not permitted)` });
    else {
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

    const id = sync(() => system.buildId(targetDirOf(root)));
    if ("error" in id) checks.push({ name: "build", status: "failed", detail: `the build id could not be read: ${id.error}` });
    else if (typeof id.value === "string" && id.value.trim() !== "") {
      build = { kind: "next-build-id", id: id.value.trim() };
      checks.push({ name: "build", status: "ok", detail: `next build id ${build.id!.slice(0, 12)}` });
    } else if (identity.head !== null) {
      build = { kind: "source", id: identity.dirtyHash === null ? identity.head : `${identity.head}:${identity.dirtyHash}` };
      checks.push({ name: "build", status: "ok", detail: `no next build id; source identity ${identity.head.slice(0, 12)}` });
    } else checks.push({ name: "build", status: "not-checked", detail: "no next build id and the target is not a readable git checkout" });
  }

  if (stage === "g2") checks.push(machine === "yes" ? buildUnchanged(root, runId, build) : { name: "build-unchanged", status: "not-applicable", detail: machine === "unknown" ? "the environment url is not resolved" : why });

  const ok = !checks.some((c) => c.status === "failed");
  const failed = checks.filter((c) => c.status === "failed").map((c) => c.name);

  const ts = iso(opts.now);
  const report: EnvProbeReport = { runId, stage, environment, takenAt: ts, ok, build, checks };
  await withRunLock(root, runId, async () => {
    // The window is checked again: the phase may have moved while the probe ran.
    assertStageWindow(readRun(root, runId), stage);
    await appendChained(
      { type: "env.probed", ts, agent: caller, stage, environment, ok, failed, build: build.id === null ? build.kind : `${build.kind}:${build.id.slice(0, 12)}` },
      busPath(root, runId),
      { emittedBy: caller, runId }
    );
  });
  mkdirSync(dirname(reportFile), { recursive: true });
  atomicWrite(reportFile, JSON.stringify(report, null, 2) + "\n");
  return { runId, stage, ok, failed, report: reportRel };
}

/** The g2 build against the execution probe's: only a Next build id that changed, appeared or vanished fails. */
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
    return before.id === now.id ? { name, status: "ok", detail: "source identity unchanged since Execution" } : { name, status: "not-checked", detail: "source identity changed (hint)" };
  }
  return { name, status: "not-checked", detail: "the build could not be compared (no build id or source identity at one of the probes)" };
}
