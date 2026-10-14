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

type LimitIssue = { path: Array<string | number>; message: string; code?: string; type?: string; maximum?: number | bigint; minimum?: number | bigint };

/**
 * formatIssues for a submitted JSON file (work report, review): an issue about a length limit names the field, its limit and the length
 * it actually has ("approach: 612 characters; the limit is 500"), so the author can cut exactly what is over. Every other issue reads as in formatIssues.
 */
export function formatLimitIssues(input: unknown, issues: LimitIssue[]): string {
  return issues
    .map((i) => {
      const where = i.path.join(".") || "(root)";
      if ((i.code === "too_big" || i.code === "too_small") && (i.type === "string" || i.type === "array")) {
        let cur: unknown = input;
        for (const key of i.path) cur = cur !== null && typeof cur === "object" ? (cur as Record<string | number, unknown>)[key] : undefined;
        const size = typeof cur === "string" || Array.isArray(cur) ? cur.length : undefined;
        const unit = i.type === "string" ? "characters" : "items";
        const bound = i.code === "too_big" ? `the limit is ${String(i.maximum)}` : `the minimum is ${String(i.minimum)}`;
        if (size !== undefined) return `${where}: ${size} ${unit}; ${bound}`;
      }
      return `${where}: ${i.message}`;
    })
    .join("; ");
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
