import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CALL_TIMEOUT_MS, secretsFile, type ListenerInfo, type ProbeSystem } from "@qa/run-state";

/**
 * The real machine behind `aegis env probe`: lsof for the listeners of a port, fetch for the HTTP checks, the target's .next/BUILD_ID
 * and the NAMES of the QA secrets file. Every external call has a timeout; no shell string is ever built; no value of the secrets file
 * leaves secretNames, and no body or header leaves http.
 */

/** The listeners in `lsof -F pR` output: a `p` line starts a process, its `R` line is the parent pid; `f` and other lines are ignored. */
export function parseLsof(stdout: string): ListenerInfo[] {
  const out: ListenerInfo[] = [];
  const seen = new Set<number>();
  let current: ListenerInfo | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("p")) {
      const pid = Number(line.slice(1));
      current = Number.isInteger(pid) && pid > 0 && !seen.has(pid) ? { pid, ppid: 0 } : null;
      if (current !== null) {
        seen.add(pid);
        out.push(current);
      }
    } else if (line.startsWith("R") && current !== null) {
      const ppid = Number(line.slice(1));
      if (Number.isInteger(ppid) && ppid >= 0) current.ppid = ppid;
    }
  }
  return out;
}

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  timeoutMs: number
) => Promise<{ code: number | string | null; stdout: string }>;

/** execFile with a timeout: the exit code (or the error code, ENOENT for a missing binary) and stdout; it never rejects. */
const runFile: ExecFileFn = (file, args, timeoutMs) =>
  new Promise((res) => {
    execFile(file, [...args], { encoding: "utf-8", timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err === null) return res({ code: 0, stdout });
      const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
      res({ code: e.killed === true ? "TIMEOUT" : (e.code ?? null), stdout: typeof stdout === "string" ? stdout : "" });
    });
  });

/** The processes listening on `port`: [] when lsof finds none (exit 1, no output), null when lsof is missing, times out or fails. */
export async function lsofListeners(port: number, timeoutMs = CALL_TIMEOUT_MS, run: ExecFileFn = runFile): Promise<ListenerInfo[] | null> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const r = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-FpR"], timeoutMs);
  if (r.code === 0) return parseLsof(r.stdout);
  // lsof exits 1 when nothing matched; with output it also exits 1 when it could not read some files, and what it found still counts.
  if (r.code === 1) return r.stdout.trim() === "" ? [] : parseLsof(r.stdout);
  return null;
}

/** The status of a GET with redirect "manual", or the error kind (never the address, a header or the body). */
export async function httpStatus(url: string, timeoutMs: number): Promise<{ status: number | null; error?: string }> {
  try {
    const r = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(Math.max(1, timeoutMs)) });
    await r.body?.cancel().catch(() => undefined);
    return { status: r.status };
  } catch (e) {
    const err = e as Error & { cause?: { code?: unknown } };
    if (err.name === "TimeoutError" || err.name === "AbortError") return { status: null, error: `no answer within ${timeoutMs} ms` };
    const code = typeof err.cause?.code === "string" ? err.cause.code : null;
    return { status: null, error: code ?? "the request failed" };
  }
}

/** .next/BUILD_ID of the target, trimmed; null when it is absent or unreadable. */
export function nextBuildId(targetDir: string): string | null {
  try {
    const id = readFileSync(join(targetDir, ".next", "BUILD_ID"), "utf-8").trim();
    return id === "" ? null : id;
  } catch {
    return null;
  }
}

/** The names with a non-empty value in the QA secrets file of `environment` (the file aegis env check opens); null when it does not exist. */
export function qaSecretNames(root: string, environment: string): string[] | null {
  if (!existsSync(join(root, "secrets", [".env", environment].join(".")))) return null;
  const file = secretsFile(root, environment);
  return Object.keys(file).filter((name) => file[name] !== "").sort();
}

export function makeProbeSystem(): ProbeSystem {
  return {
    http: httpStatus,
    listeners: (port) => lsofListeners(port),
    buildId: nextBuildId,
    secretNames: qaSecretNames,
  };
}
