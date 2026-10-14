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
 * slug such as `user-profile-edit-2` and a word with a trailing digit such as `userProfileEditForm2` keep their words.
 */
const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12,}/gi;
// Interleaved letters and digits (a digit next to a letter on both sides of the run): `userProfileEditForm2` is a word with a suffix, `clx9k3j2h0000` is an id.
const TOKEN = /\b(?=[A-Za-z0-9]*\d[A-Za-z])(?=[A-Za-z0-9]*[A-Za-z]\d)[A-Za-z0-9]{13,}\b/g;
const flat = (s: unknown): string => String(s ?? "").replace(ID, "#").replace(TOKEN, "#").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
const NOISE = /failed to load resource|favicon/i;

export function signatureOf(raw: RawPage): PageSignature {
  const ids = [...new Set(raw.testids.map(flat))].sort();
  return {
    role: raw.role,
    url: raw.url,
    // Only the path: a query or fragment of a redirect target can carry a token (`/cb?token=...#access_token=...`).
    finalPath: raw.finalPath.replace(/[?#][\s\S]*$/, ""),
    status: raw.status,
    title: flat(raw.title),
    h1: flat(raw.h1),
    testidHash: createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 16),
    hasErrors: raw.consoleErrors.some((m) => !NOISE.test(m)),
  };
}

/**
 * Cut to 120 characters after replacing what can carry a secret or a host: URLs of any scheme, `Authorization:` header values, Bearer
 * or Basic followed by a credential-looking token (8+ characters with a digit, or a lowercase letter next to an uppercase letter or
 * symbol, so the words in "Basic authentication failed" stay), IP and localhost addresses with a port, and `token=`, `key=`,
 * `secret=` or `password=` pairs.
 */
export function redactError(message: string): string {
  return message
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/\bAuthorization:\s*(?:(?:Bearer|Basic)\s+)?\S+/gi, "Authorization: <credential>")
    .replace(/\b(?:Bearer|Basic|bearer|basic)\s+(?=\S{8})(?=\S*(?:[a-z][A-Z._~+/=-]|\d))\S+/g, "<credential>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}:\d+\S*/g, "<url>")
    .replace(/\blocalhost:\d+\S*/gi, "<url>")
    .replace(/\b[a-z0-9_]*(?:token|key|secret|password)=\S+/gi, "<redacted>")
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
/** Lowercase words of a name: split on `-`, `_`, `.`, spaces and camelCase boundaries (`resetPassword`, `X-Amz-Credential`). */
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[-_.\s]+/)
    .filter((w) => w !== "");
}
/** A whole word of a path segment whose GET can change state (consume a one-time link, confirm, reset, unsubscribe, accept an invite). */
const SIDE_EFFECT_WORDS = new Set(["callback", "verify", "confirm", "reset", "activate", "deactivate", "reactivate", "unsubscribe", "invite", "accept", "magic"]);
/** A whole word of a query parameter name that carries a credential or a one-time value. */
const SENSITIVE_WORDS = new Set(["token", "secret", "password", "signature", "credential", "jwt", "otp", "nonce", "ticket"]);
/** Parameter names that are sensitive only as the whole name (`code`, `state`, `key`), and the API key spellings. */
const SENSITIVE_NAMES = new Set(["code", "state", "key", "apikey", "api_key", "api-key", "access_key"]);

const isSideEffectPath = (pathname: string): boolean => pathname.split("/").some((seg) => wordsOf(seg).some((w) => SIDE_EFFECT_WORDS.has(w)));
const isSensitiveParam = (name: string): boolean => SENSITIVE_NAMES.has(name.toLowerCase()) || wordsOf(name).some((w) => SENSITIVE_WORDS.has(w));

/**
 * The concrete pages a probe visits, from a discovery report's `pages` array: each entry needs a role and a `url` or `route`.
 * Other origins, route patterns (`/x/[id]`), logout-like routes (a GET there changes the session), side-effect routes (a whole word
 * such as callback, verify, reset or invite in a path segment) and pages whose query holds a sensitive parameter are skipped and named.
 * A skipped entry stores the pathname only, never the query.
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
      skipped.push({ role, route: where.split(/[?#]/)[0]!.slice(0, 80), reason: "invalid page address" });
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
      skipped.push({ role, route: pathname, reason: "skip pattern" });
      continue;
    }
    // Only the pathname is a route pattern: brackets in a query string (`?filter[status]=new`) are data.
    if (DYNAMIC.test(decode(pathname))) {
      skipped.push({ role, route: pathname, reason: "dynamic route pattern" });
      continue;
    }
    if (LOGOUT.test(path)) {
      skipped.push({ role, route: pathname, reason: "logout-like route" });
      continue;
    }
    if (isSideEffectPath(decode(pathname))) {
      skipped.push({ role, route: pathname, reason: "side-effect route" });
      continue;
    }
    if ([...new URLSearchParams(path.slice(pathname.length)).keys()].some(isSensitiveParam)) {
      skipped.push({ role, route: pathname, reason: "sensitive query" });
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

/** Environment variables that point git at another repository, index or object store: removed so a hook or a parent git process cannot redirect it. */
const GIT_OVERRIDES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"];

/** A git call that hangs (a lock, a network filesystem) gives up: the probe's time budget includes the identity. */
const GIT_TIMEOUT_MS = 30_000;

function git(dir: string, args: string[]): string | null {
  const env = { ...process.env };
  for (const k of GIT_OVERRIDES) delete env[k];
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024, env, timeout: GIT_TIMEOUT_MS });
  } catch {
    return null;
  }
}

/** The head part of sourceIdentity, from normalised `dirs`: two git calls, no file is read or hashed. */
function scopedHead(targetDir: string, dirs: readonly string[]): string | null {
  const headOfAll = git(targetDir, ["rev-parse", "HEAD"])?.trim() ?? null;
  const scoped = git(targetDir, ["log", "-1", "--format=%H", "HEAD", "--", ".", ...dirs.map((d) => `:(exclude,literal)${d}`)])?.trim() ?? "";
  return headOfAll === null ? null : /^[0-9a-f]{40}$/.test(scoped) ? scoped : headOfAll;
}

/** Only the `head` of sourceIdentity (the same rule: the last commit outside `excludeDirs`), without hashing the uncommitted changes. Never throws. */
export function sourceHead(targetDir: string, excludeDirs: readonly string[]): string | null {
  return scopedHead(targetDir, excludeDirs.map(normaliseDir).filter((d): d is string => d !== null));
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
 * not move it; with every path excluded, or a repository holding only QA commits, it falls back to the repository HEAD), and
 * `dirtyHash` covers every uncommitted change (modified, deleted, renamed and untracked-not-ignored files, by path and content; a
 * rename enters the hash with both its old and its new path). Every path and every content enters the hash behind its tag and its
 * byte length, so no two different trees frame the same bytes. Gitignored files are not read, and neither is an environment file (`.env`, `.envrc`, `.env.<anything>`, `.env-<anything>`, `.env_<anything>`, except the example, sample and template variants) that is not gitignored. `excludeDirs`
 * (target-relative) leave out the QA tree and the tests directory, which change every round. A directory that is not a git checkout
 * gives null parts. Call it outside run.lock: hashing a large dirty tree is synchronous. It never throws.
 */
export function sourceIdentity(targetDir: string, excludeDirs: readonly string[]): SourceIdentity {
  const dirs = excludeDirs.map(normaliseDir).filter((d): d is string => d !== null);
  const head = scopedHead(targetDir, dirs);
  const changed = git(targetDir, ["diff", "HEAD", "--name-only", "--no-renames", "--relative", "-z"]);
  const untracked = git(targetDir, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (head === null || changed === null || untracked === null) return { head, dirtyHash: null };
  // An environment file is never read, gitignored or not; the example, sample and template variants are source and count.
  const envFile = (p: string): boolean => {
    const base = p.slice(p.lastIndexOf("/") + 1);
    return /^\.env(?:[._-].*|rc)?$/.test(base) && !/\.(example|sample|template)$/.test(base);
  };
  const skip = (p: string): boolean => envFile(p) || dirs.some((d) => p === d || p.startsWith(`${d}/`));
  const names = [...new Set([...changed.split("\0"), ...untracked.split("\0")])].filter((p) => p !== "" && !skip(p)).sort();
  const h = createHash("sha256");
  const frame = (tag: string, payload: Buffer): void => {
    h.update(`${tag}${payload.length}\0`).update(payload);
  };
  for (const p of names) {
    frame("P", Buffer.from(p));
    const f = fileFrame(join(targetDir, p));
    frame(f.tag, f.payload);
  }
  return { head, dirtyHash: h.digest("hex") };
}

/** One tag per kind: D deleted or missing, F file content, B big file (size and mtime), L symlink target, S directory or submodule path, U unreadable. */
function fileFrame(abs: string): { tag: string; payload: Buffer } {
  const none = Buffer.alloc(0);
  try {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) return { tag: "L", payload: Buffer.from(readlinkSync(abs)) };
    if (!st.isFile()) return { tag: "S", payload: none };
    // A huge file is hashed by size and mtime, not read into memory.
    if (st.size > 5 * 1024 * 1024) return { tag: "B", payload: Buffer.from(`${st.size}:${st.mtimeMs}`) };
    return { tag: "F", payload: readFileSync(abs) };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { tag: code === "ENOENT" || code === "ENOTDIR" ? "D" : "U", payload: none }; // an unreadable file must not stop Explore from completing
  }
}

export function identityDiffers(a: SourceIdentity | undefined, b: SourceIdentity): string[] {
  const parts = ["head", "dirtyHash"] as const;
  return parts.filter((p) => a === undefined || a[p] !== b[p]);
}
