import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
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

/**
 * Text that is data, not structure: UUIDs, long hex ids, long mixed letter-digit tokens (cuid, ULID, nanoid) and digits become `#`
 * so a counter, a date, a row id or a row count is not a change. The token rule is alphanumeric only (no hyphen or underscore), so a
 * slug such as `user-profile-edit-2` keeps its words.
 */
const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12,}/gi;
const TOKEN = /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{13,}\b/g;
const flat = (s: unknown): string => String(s ?? "").replace(ID, "#").replace(TOKEN, "#").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
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

/** URLs of any scheme (and localhost addresses) become `<url>`, Bearer and Basic credentials `<credential>`; cut to 120 characters. */
export function redactError(message: string): string {
  return message
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "<credential>")
    .replace(/\blocalhost:\d+\S*/gi, "<url>")
    .slice(0, 120);
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
  // A global or sticky regex keeps lastIndex between test() calls: every skip pattern is made stateless.
  const skips = extraSkip.map((re) => new RegExp(re.source, re.flags.replace(/[gy]/g, "")));
  for (const e of entries) {
    if (e === null || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const role = r["role"];
    const where = typeof r["url"] === "string" && r["url"] !== "" ? r["url"] : typeof r["route"] === "string" ? r["route"] : "";
    if (typeof role !== "string" || role === "" || where === "") continue;
    let path: string;
    let pathname: string;
    try {
      const u = new URL(where, baseOrigin);
      if (u.origin !== new URL(baseOrigin).origin) {
        skipped.push({ role, route: u.pathname, reason: "other origin" });
        continue;
      }
      path = u.pathname + u.search;
      pathname = u.pathname;
    } catch {
      skipped.push({ role, route: where.slice(0, 80), reason: "invalid page address" });
      continue;
    }
    const decode = (v: string): string => {
      try {
        return decodeURIComponent(v);
      } catch {
        return v; // a stray % must not throw
      }
    };
    const decoded = decode(path);
    if (skips.some((re) => re.test(decoded))) {
      skipped.push({ role, route: path, reason: "skip pattern" });
      continue;
    }
    // Only the pathname is a route pattern: brackets in a query string (`?filter[status]=new`) are data.
    if (DYNAMIC.test(decode(pathname))) {
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

/** Git run without the caller's repository overrides, so a hook or a parent git process cannot point it at another checkout. */
function git(dir: string, args: string[]): string | null {
  const env = { ...process.env };
  delete env["GIT_DIR"];
  delete env["GIT_WORK_TREE"];
  delete env["GIT_INDEX_FILE"];
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024, env });
  } catch {
    return null;
  }
}

/** Target-relative, forward slashes, no leading `./` or trailing `/`; an empty entry or one with a `..` segment is dropped. */
function normaliseDir(d: string): string | null {
  let n = d.replace(/\\/g, "/");
  while (n.startsWith("./")) n = n.slice(2);
  n = n.replace(/\/+$/, "");
  if (n === "" || n === "." || n.split("/").includes("..")) return null;
  return n;
}

/**
 * Where the app source stands: `head` is the last commit that touched anything outside `excludeDirs` (so a commit of QA files only does
 * not move it), and `dirtyHash` covers every uncommitted change (modified, deleted, renamed and untracked-not-ignored files, by path and
 * content; a rename enters the hash with both its old and its new path). Gitignored files, including `.env*`, are not read.
 * `excludeDirs` (target-relative) leave out the QA tree and the tests directory, which change every round. A directory that is not a
 * git checkout gives null parts. Call it outside run.lock: hashing a large dirty tree is synchronous. It never throws.
 */
export function sourceIdentity(targetDir: string, excludeDirs: readonly string[]): SourceIdentity {
  const dirs = excludeDirs.map(normaliseDir).filter((d): d is string => d !== null);
  const headOfAll = git(targetDir, ["rev-parse", "HEAD"])?.trim() ?? null;
  const headOfSource = dirs.length === 0 ? null : git(targetDir, ["log", "-1", "--format=%H", "HEAD", "--", ".", ...dirs.map((d) => `:(exclude,literal)${d}`)])?.trim() ?? null;
  const head = headOfAll === null ? null : headOfSource !== null && /^[0-9a-f]{40}$/.test(headOfSource) ? headOfSource : headOfAll;
  const changed = git(targetDir, ["diff", "HEAD", "--name-only", "--no-renames", "--relative", "-z"]);
  const untracked = git(targetDir, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (head === null || changed === null || untracked === null) return { head, dirtyHash: null };
  const skip = (p: string): boolean => dirs.some((d) => p === d || p.startsWith(`${d}/`));
  const names = [...new Set([...changed.split("\0"), ...untracked.split("\0")])].filter((p) => p !== "" && !skip(p)).sort();
  const h = createHash("sha256");
  for (const p of names) {
    h.update(p).update("\0").update(fileFrame(join(targetDir, p))).update("\0");
  }
  return { head, dirtyHash: h.digest("hex") };
}

/** One unambiguous framing per kind: D deleted or missing, F file, L symlink, S directory or submodule path, U unreadable. */
function fileFrame(abs: string): Buffer | string {
  try {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) return `L\0${readlinkSync(abs)}`;
    if (st.isDirectory()) return "S\0";
    if (!st.isFile()) return "S\0";
    // A huge file is hashed by size and mtime, not read into memory.
    if (st.size > 5 * 1024 * 1024) return `F\0big:${st.size}:${st.mtimeMs}`;
    return Buffer.concat([Buffer.from("F\0"), readFileSync(abs)]);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "D\0" : "U\0"; // an unreadable file must not stop Explore from completing
  }
}

export function identityDiffers(a: SourceIdentity | undefined, b: SourceIdentity): string[] {
  const parts = ["head", "dirtyHash"] as const;
  return parts.filter((p) => a === undefined || a[p] !== b[p]);
}
