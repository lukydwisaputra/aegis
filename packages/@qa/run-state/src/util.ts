import { randomBytes } from "node:crypto";
import { existsSync, linkSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import lockfile from "proper-lockfile";
import { RunStateError } from "./errors.js";

export function iso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

export function loadJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    throw new RunStateError("invalid-input", `cannot read ${file}: ${(e as Error).message}`);
  }
}

export function formatIssues(issues: Array<{ path: Array<string | number>; message: string }>): string {
  return issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

const LOCK_OPTIONS = { stale: 10_000, retries: { retries: 50, minTimeout: 20, maxTimeout: 250 } };

/** Hold an exclusive cross-process lock on `lockPath` (created empty if missing, never truncated) while `fn` runs. */
export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  if (!existsSync(lockPath)) writeFileSync(lockPath, "", { encoding: "utf-8", flag: "a" });
  const release = await lockfile.lock(lockPath, LOCK_OPTIONS);
  try {
    return await fn();
  } finally {
    await release();
  }
}

/**
 * Write `data` to `file` so readers never see a partial file: the full content goes to a unique
 * temp file first. Default: rename over `file`. `exclusive`: hard-link into place, failing with
 * EEXIST if `file` already exists.
 */
export function atomicWrite(file: string, data: string, opts: { exclusive?: boolean } = {}): void {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, data, { encoding: "utf-8", flag: "wx" });
    if (opts.exclusive === true) linkSync(tmp, file);
    else renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}
