import { randomBytes } from "node:crypto";
import { existsSync, linkSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import lockfile from "proper-lockfile";
import { RunStateError } from "./errors.js";

export function iso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

/** The JSON of `file`; `text` is the file's content when the caller already read it (standard input can be read once). */
export function loadJson(file: string, text?: string): unknown {
  try {
    return JSON.parse(text ?? readFileSync(file, "utf-8"));
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

export interface TrimmedField {
  field: string;
  from: number;
  to: number;
}

/** A string cut to `max` characters, at the last space of its final fifth when there is one, and ended with an ellipsis. */
export function cutToFit(text: string, max: number): string {
  if (text.length <= max) return text;
  let head = text.slice(0, max - 1);
  // a cut between the two halves of a surrogate pair (an emoji) would leave a lone half behind
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  const space = head.lastIndexOf(" ");
  return `${space > max * 0.8 ? head.slice(0, space) : head}\u2026`;
}

/**
 * The strings of `input` that are over their length limit (`issues` from a failed schema parse), cut to the limit: an agent that wrote
 * 512 characters where 500 fit gets its report recorded with the last words shortened, not refused for a turn. `keep` says which fields must
 * stay exact (a rule that is stored as a lesson is refused, never shortened). Returns a copy and what was cut; the input is not changed.
 * A missing minimum, a wrong type or an id format is never touched here: those stay refusals.
 */
export function trimOverlong(input: unknown, issues: LimitIssue[], keep: (path: ReadonlyArray<string | number>) => boolean = () => false): { value: unknown; trimmed: TrimmedField[] } {
  const value = JSON.parse(JSON.stringify(input)) as unknown;
  const trimmed: TrimmedField[] = [];
  for (const i of issues) {
    if (i.code !== "too_big" || i.type !== "string" || typeof i.maximum !== "number" || keep(i.path)) continue;
    let parent: unknown = value;
    for (const key of i.path.slice(0, -1)) parent = parent !== null && typeof parent === "object" ? (parent as Record<string | number, unknown>)[key] : undefined;
    const last = i.path[i.path.length - 1];
    if (parent === null || typeof parent !== "object" || last === undefined) continue;
    const cur = (parent as Record<string | number, unknown>)[last];
    if (typeof cur !== "string" || cur.length <= i.maximum) continue;
    const kept = cutToFit(cur, i.maximum);
    (parent as Record<string | number, unknown>)[last] = kept;
    trimmed.push({ field: i.path.join("."), from: cur.length, to: kept.length });
  }
  return { value, trimmed };
}

/** A lock not refreshed for this long is a crashed holder's: lockfile reclaims it, and a reader's isFileLocked no longer counts it. */
export const LOCK_STALE_MS = 10_000;
const LOCK_OPTIONS = { stale: LOCK_STALE_MS, retries: { retries: 50, minTimeout: 20, maxTimeout: 250 } };

/** Whether `lockPath` is held right now by a live holder (a stale lock does not count). Never waits, never creates the file, never throws. */
export function isFileLocked(lockPath: string): boolean {
  try {
    return existsSync(lockPath) && lockfile.checkSync(lockPath, { stale: LOCK_STALE_MS });
  } catch {
    return false;
  }
}

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
