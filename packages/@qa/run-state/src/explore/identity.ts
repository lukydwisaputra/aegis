import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface RawPage {
  role: string;
  url: string;
  finalPath: string;
  status: number | null;
  title: string;
  h1: string;
  testids: string[];
  consoleErrors: string[];
}
export type RawObservation = RawPage | { role: string; url: string; error: string };

export interface PageSignature {
  role: string;
  url: string;
  finalPath: string;
  status: number | null;
  title: string;
  h1: string;
  testidHash: string;
  hasErrors: boolean;
}
export type Observed = PageSignature | { role: string; url: string; error: string };

/** Text that is data, not structure: UUIDs, long hex ids and digits become `#` so a counter, a date, a row id or a row count is not a change. */
const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12,}/gi;
const flat = (s: unknown): string => String(s ?? "").replace(ID, "#").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
const NOISE = /failed to load resource|favicon/i;

export function signatureOf(raw: RawPage): PageSignature {
  const ids = [...new Set(raw.testids.map(flat))].sort();
  return {
    role: raw.role,
    url: raw.url,
    finalPath: raw.finalPath,
    status: raw.status,
    title: flat(raw.title),
    h1: flat(raw.h1),
    testidHash: createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 16),
    hasErrors: raw.consoleErrors.some((m) => !NOISE.test(m)),
  };
}

export function redactError(message: string): string {
  return message.replace(/https?:\/\/\S+/g, "<url>").slice(0, 120);
}

export function observe(raw: RawObservation): Observed {
  return "error" in raw ? { role: raw.role, url: raw.url, error: redactError(raw.error) } : signatureOf(raw);
}

export interface ProbeDiff {
  same: number;
  changed: Array<{ role: string; url: string; fields: string[] }>;
  failed: Array<{ role: string; url: string; error: string }>;
  total: number;
}

const FIELDS = ["finalPath", "status", "title", "h1", "testidHash", "hasErrors"] as const;
const key = (p: { role: string; url: string }): string => `${p.role}\u0000${p.url}`;

export function compareSignatures(baseline: readonly PageSignature[], observed: readonly Observed[]): ProbeDiff {
  const now = new Map(observed.map((o) => [key(o), o]));
  const diff: ProbeDiff = { same: 0, changed: [], failed: [], total: baseline.length };
  for (const p of baseline) {
    const o = now.get(key(p));
    if (o === undefined) diff.failed.push({ role: p.role, url: p.url, error: "not observed" });
    else if ("error" in o) diff.failed.push({ role: p.role, url: p.url, error: o.error });
    else {
      const fields = FIELDS.filter((f) => p[f] !== o[f]);
      if (fields.length === 0) diff.same++;
      else diff.changed.push({ role: p.role, url: p.url, fields: [...fields] });
    }
  }
  return diff;
}

export type ProbeDecision = "reuse" | "partial" | "full";

/** Nothing changed or failed: reuse. At most 30% of the pages: only those are explored again. More, every page failed, or nothing to compare: full. */
export function decideProbe(diff: ProbeDiff): ProbeDecision {
  if (diff.total === 0) return "full";
  const bad = diff.changed.length + diff.failed.length;
  if (bad === 0) return "reuse";
  return bad / diff.total <= 0.3 ? "partial" : "full";
}

export interface PageRef {
  role: string;
  url: string;
}

const DYNAMIC = /\[[^\]]+\]|\/:[A-Za-z_]|\{[^}]+\}/;
const LOGOUT = /(?:^|\/)(?:log-?out|sign-?out|switch-profile)(?:[/?#]|$)/i;

/**
 * The concrete pages a probe visits, from a discovery report's `pages` array: each entry needs a role and a `url` or `route`.
 * Other origins, route patterns (`/x/[id]`) and logout-like routes (a GET there changes the session) are skipped and named.
 */
export function selectPages(entries: unknown, baseOrigin: string, extraSkip: readonly RegExp[] = []): { pages: PageRef[]; skipped: Array<{ role: string; route: string; reason: string }> } {
  const pages: PageRef[] = [];
  const skipped: Array<{ role: string; route: string; reason: string }> = [];
  const seen = new Set<string>();
  if (!Array.isArray(entries)) return { pages, skipped };
  for (const e of entries) {
    if (e === null || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const role = r["role"];
    const where = typeof r["url"] === "string" && r["url"] !== "" ? r["url"] : typeof r["route"] === "string" ? r["route"] : "";
    if (typeof role !== "string" || role === "" || where === "") continue;
    let path: string;
    try {
      const u = new URL(where, baseOrigin);
      if (u.origin !== new URL(baseOrigin).origin) {
        skipped.push({ role, route: u.pathname, reason: "other origin" });
        continue;
      }
      path = u.pathname + u.search;
    } catch {
      skipped.push({ role, route: where.slice(0, 80), reason: "invalid page address" });
      continue;
    }
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // keep the raw path: a stray % must not throw
    }
    if (extraSkip.some((re) => re.test(decoded))) {
      skipped.push({ role, route: path, reason: "skip pattern" });
      continue;
    }
    if (DYNAMIC.test(decoded)) {
      skipped.push({ role, route: path, reason: "dynamic route pattern" });
      continue;
    }
    if (LOGOUT.test(path)) {
      skipped.push({ role, route: path, reason: "logout-like route" });
      continue;
    }
    const k = key({ role, url: path });
    if (seen.has(k)) continue;
    seen.add(k);
    pages.push({ role, url: path });
  }
  return { pages, skipped };
}

export interface SourceIdentity {
  head: string | null;
  dirtyHash: string | null;
}

function git(dir: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/**
 * Where the app source stands: the commit and a hash of every uncommitted change (modified, deleted, renamed and untracked-not-ignored
 * files, by path and content). Gitignored files, including `.env*`, are not read. `excludeDirs` (target-relative) leave out the QA tree
 * and the tests directory, which change every round. A directory that is not a git checkout gives null parts.
 * Call it outside run.lock: hashing a large dirty tree is synchronous. It never throws.
 */
export function sourceIdentity(targetDir: string, excludeDirs: readonly string[]): SourceIdentity {
  const head = git(targetDir, ["rev-parse", "HEAD"])?.trim() ?? null;
  const changed = git(targetDir, ["diff", "HEAD", "--name-only", "--relative", "-z"]);
  const untracked = git(targetDir, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (head === null || changed === null || untracked === null) return { head, dirtyHash: null };
  const skip = (p: string): boolean => excludeDirs.some((d) => d !== "" && (p === d || p.startsWith(`${d}/`)));
  const names = [...new Set([...changed.split("\0"), ...untracked.split("\0")])].filter((p) => p !== "" && !skip(p)).sort();
  const h = createHash("sha256");
  for (const p of names) {
    const abs = join(targetDir, p);
    h.update(p).update("\0");
    try {
      if (!existsSync(abs) || !statSync(abs).isFile()) h.update("deleted");
      else {
        const st = statSync(abs);
        // A huge file is hashed by size and mtime, not read into memory.
        h.update(st.size > 5 * 1024 * 1024 ? `big:${st.size}:${st.mtimeMs}` : readFileSync(abs));
      }
    } catch {
      h.update("unreadable"); // an unreadable file must not stop Explore from completing
    }
    h.update("\0");
  }
  return { head, dirtyHash: h.digest("hex") };
}

export function identityDiffers(a: SourceIdentity | undefined, b: SourceIdentity): string[] {
  const parts = ["head", "dirtyHash"] as const;
  return parts.filter((p) => a === undefined || a[p] !== b[p]);
}
