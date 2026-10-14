# Explore Reuse (verified by a probe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a gate rejection that reopens Requirements, Env-auth or Scan, the Explore phase does not run its full web crawl again when the running application still looks the same; when it does not, only the changed pages are explored again. The owner can always force a full explore.

**Architecture:** While the explorer's work is accepted, the CLI takes a **baseline**: the same read-only probe visits every concrete page of the discovery report as its role and stores a small signature per page (`reports/explore/baseline.json`). A rejection keeps the `qa-web-explorer` task done and marks Explore `carried`. Explore cannot complete while carried and unverified. `aegis explore probe` visits the same pages with the same code, compares with the baseline and decides `reuse` / `partial` / `full`. Because baseline and probe come from the same fetcher and the same normaliser, the comparison is like for like (it never compares a probe with a hand-written report). The decision rests on what the app shows; the source identity (commit and uncommitted-change hash) is recorded only as a hint next to it.

**Tech Stack:** TypeScript, jest (`__internal-tests__`), commander (`apps/cli`), Playwright resolved from the target project (dynamic import, only in the real page fetcher).

**Spec:** `docs/superpowers/specs/2026-10-14-lighter-framework-design.md` (owner decision 4). This plan refines it: the spec said "record the build identity at run create, keep Explore completed when unchanged". Because the app can change without a commit (dev server rebuilt from the working tree, a fixed environment), identity alone is not trusted: Explore goes back to pending, carried, and the probe decides. Task 4 edits the spec text to match.

## Global Constraints

- Owner decision 4: Explore repeats only when the app changed, or when the owner asks (`gate decide --re-explore`, or `--reopen-phase explore`).
- "Changed" is judged by what the app does, not by git. Evidence (slec, 2026-10-05..13): five Explore rounds, zero target commits, and one round truly needed because the local Supabase Vault was empty: an environment change a git-only identity cannot see.
- The probe is read-only: GET navigation of pages the explorer already visited; no clicks, no form input, no writes. It visits only the environment's own origin and skips logout-like routes (`/log-?out`, `/sign-?out`, `/switch-profile`).
- Unknown means explore again, and the run never gets stuck: no baseline, no readable pages, Playwright missing in the target, the app down, every page failed: decision `full` (the explorer reopens), never an exception that leaves the phase blocked. A few individual pages that failed or changed count as changed and are explored again (`partial`).
- No secret leaves the machine through the identity: the source identity is a hash of tracked-modified and untracked-not-ignored files; `.env*` files are gitignored, are never read, and no hash of them is stored. Error text in reports has URLs replaced by `<url>`.
- Gate: `pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align` stay green; the align ratchet (207) does not grow. (In a worktree under `.claude/worktrees`, 4 tests of `customer-wording.test.ts` fail by location only; CI is their real run.)
- Never write a backticked dotted token in agent, HANDBOOK or docs prose unless it is a registered event type (`event-type-drift.test.ts` reads every backticked dotted name as an event). The event is `explore.probed`; the command id `explore.probe` appears only in code.

## Review Focus

- The Vault case: source and git identical, a page that errored now renders: `changed`, never `reuse`.
- An uncommitted edit hot-reloaded by a dev server (HEAD unchanged): the pages decide; the dirty hash shows as a hint.
- A page whose text is data (a list with other rows, a counter, a date in the title, `row-12` test ids): same structure stays `same`.
- A role whose storage state expired (the probe lands on the login page): the final path differs, so `changed`/`failed`, never `same`.
- The app is down, Playwright is missing, the baseline is missing: `full` with a reason; Explore can always be completed afterwards.
- `startPhase` must not wipe `carried` (it replaces the phase record today).
- A reopened explorer has a fresh attempt count (reopen through `reopenPhaseTasks`, not a bare `client.reopen`).
- `--re-explore` and `--reopen-phase explore`: the explorer reopens as before; `--re-explore` on an approval or a reopen range without Explore is refused.
- A run created before this change (no baseline): a rejection carries, the probe finds no baseline and answers `full`: the same work as today.

---

### Task 1: Page signatures, comparison, decision and source identity (pure code)

**Files:**
- Create: `packages/@qa/run-state/src/explore/identity.ts`
- Modify: `packages/@qa/run-state/src/index.ts` (add `export * from "./explore/identity.js";`)
- Test: `__internal-tests__/explore-identity.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export interface RawPage { role: string; url: string; finalPath: string; status: number | null; title: string; h1: string; testids: string[]; consoleErrors: string[] }
  export type RawObservation = RawPage | { role: string; url: string; error: string };
  export interface PageSignature { role: string; url: string; finalPath: string; status: number | null; title: string; h1: string; testidHash: string; hasErrors: boolean }
  export function signatureOf(raw: RawPage): PageSignature;
  export type Observed = PageSignature | { role: string; url: string; error: string };
  export function observe(raw: RawObservation): Observed;                     // signatureOf for a page, the redacted error for a failure
  export interface ProbeDiff { same: number; changed: Array<{ role: string; url: string; fields: string[] }>; failed: Array<{ role: string; url: string; error: string }>; total: number }
  export function compareSignatures(baseline: readonly PageSignature[], observed: readonly Observed[]): ProbeDiff;
  export type ProbeDecision = "reuse" | "partial" | "full";
  export function decideProbe(diff: ProbeDiff): ProbeDecision;
  export function redactError(message: string): string;                     // URLs become <url>, cut to 120 chars
  export interface PageRef { role: string; url: string }
  export function selectPages(entries: unknown, baseOrigin: string): { pages: PageRef[]; skipped: Array<{ role: string; route: string; reason: string }> };
  export interface SourceIdentity { head: string | null; dirtyHash: string | null }
  export function sourceIdentity(targetDir: string, excludeDirs: readonly string[]): SourceIdentity;
  export function identityDiffers(a: SourceIdentity | undefined, b: SourceIdentity): string[];
  ```
  `url` is always path + query (no origin, no hash), starting with `/`.

- [ ] **Step 1: Write the failing test**

```ts
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compareSignatures, decideProbe, identityDiffers, observe, redactError, selectPages, signatureOf, sourceIdentity, type PageSignature, type RawPage } from '@qa/run-state';

const raw = (over: Partial<RawPage> = {}): RawPage => ({
  role: 'volunteer', url: '/home', finalPath: '/home', status: 200, title: 'Home', h1: 'Welcome', testids: ['nav', 'row-1', 'row-2'], consoleErrors: [], ...over,
});
const sig = (over: Partial<RawPage> = {}): PageSignature => signatureOf(raw(over));

describe('signatureOf', () => {
  it('turns digits and spacing in text into #, and test ids into a hash of the distinct digit-free values', () => {
    const a = signatureOf(raw({ title: 'Home (3 new)', h1: ' Welcome  12 ', testids: ['nav', 'row-1', 'row-2', 'row-3'] }));
    expect(a).toMatchObject({ title: 'Home (# new)', h1: 'Welcome #', hasErrors: false });
    expect(a.testidHash).toBe(signatureOf(raw({ testids: ['row-9', 'nav'] })).testidHash); // same distinct values: nav, row-#
    expect(a.testidHash).not.toBe(signatureOf(raw({ testids: ['nav'] })).testidHash);
  });
  it('console errors count except resource-load noise (favicon, "Failed to load resource")', () => {
    expect(signatureOf(raw({ consoleErrors: ['Failed to load resource: 404 /favicon.ico'] })).hasErrors).toBe(false);
    expect(signatureOf(raw({ consoleErrors: ['TypeError: x is undefined'] })).hasErrors).toBe(true);
  });
});

describe('compareSignatures and decideProbe', () => {
  const four = [raw(), raw({ url: '/events', title: 'Events' }), raw({ role: 'admin', url: '/admin' }), raw({ url: '/profile', status: 500, consoleErrors: ['boom'], testids: [] })].map(signatureOf);

  it('same structure with different data is same: reuse', () => {
    const now = [raw({ title: 'Home (9 new)', testids: ['nav', 'row-7'] }), raw({ url: '/events', title: 'Events' }), raw({ role: 'admin', url: '/admin' }), raw({ url: '/profile', status: 500, consoleErrors: ['boom'], testids: [] })].map(observe);
    const diff = compareSignatures(four, now);
    expect(diff).toMatchObject({ same: 4, changed: [], failed: [], total: 4 });
    expect(decideProbe(diff)).toBe('reuse');
  });

  it('a page that errored before and renders now is changed (the Vault case): partial with 1 of 4', () => {
    const now = [raw(), raw({ url: '/events', title: 'Events' }), raw({ role: 'admin', url: '/admin' }), raw({ url: '/profile', status: 200, consoleErrors: [], testids: ['profile-form'] })].map(observe);
    const diff = compareSignatures(four, now);
    expect(diff.changed).toEqual([{ role: 'volunteer', url: '/profile', fields: ['status', 'testidHash', 'hasErrors'] }]);
    expect(decideProbe(diff)).toBe('partial');
  });

  it('a redirect to login and an unreachable page are never same; a missing observation is failed', () => {
    const now = [observe(raw({ finalPath: '/login' })), observe({ role: 'volunteer', url: '/events', error: 'timeout at https://x.test/events?token=abc' })];
    const diff = compareSignatures(four, now);
    expect(diff.changed).toEqual([{ role: 'volunteer', url: '/home', fields: ['finalPath'] }]);
    expect(diff.failed.map((f) => f.url)).toEqual(['/events', '/admin', '/profile']);
    expect(JSON.stringify(diff)).not.toContain('token=abc');
    expect(decideProbe(diff)).toBe('full');
  });

  it('partial up to 30% of the pages, full beyond, full for no pages and for every page failed', () => {
    const ten = Array.from({ length: 10 }, (_, i) => raw({ url: `/p${i}` }));
    const base = ten.map(signatureOf);
    const changed = (n: number) => compareSignatures(base, ten.map((p, i) => observe(i < n ? { ...p, title: 'Other' } : p)));
    expect(decideProbe(changed(3))).toBe('partial');
    expect(decideProbe(changed(4))).toBe('full');
    expect(decideProbe(compareSignatures([], []))).toBe('full');
    expect(decideProbe(compareSignatures(base, []))).toBe('full');
  });
});

describe('selectPages', () => {
  const entries = [
    { role: 'volunteer', url: 'https://app.test/home', route: '/home' },
    { role: 'admin', route: '/volunteers?status=new#top' },
    { role: 'admin', url: 'https://other.example/x', route: '/x' },
    { role: 'admin', route: '/volunteers/[id]' },
    { role: 'admin', route: '/groups/:id' },
    { role: 'admin', route: '/logout' },
    { role: 'admin', route: '/switch-profile' },
    { role: 'volunteer', route: '/home' },
    { role: 'volunteer' },
    null,
  ];
  it('keeps concrete same-origin pages once, strips origin and hash, and names what it skipped and why', () => {
    const r = selectPages(entries, 'https://app.test');
    expect(r.pages).toEqual([{ role: 'volunteer', url: '/home' }, { role: 'admin', url: '/volunteers?status=new' }]);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(['dynamic route pattern', 'dynamic route pattern', 'logout-like route', 'logout-like route', 'other origin']);
  });
  it('is empty for anything that is not an array', () => {
    expect(selectPages(undefined, 'https://app.test')).toEqual({ pages: [], skipped: [] });
  });
});

describe('redactError', () => {
  it('replaces URLs and cuts to 120 characters', () => {
    expect(redactError('failed https://a.test/x?token=1 now')).toBe('failed <url> now');
    expect(redactError('x'.repeat(300))).toHaveLength(120);
  });
});

describe('sourceIdentity', () => {
  let dir: string;
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@e.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { encoding: 'utf8' });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-id-'));
    git('init', '-q');
    fs.writeFileSync(path.join(dir, 'app.ts'), 'one');
    git('add', '.');
    git('commit', '-qm', 'init');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('is stable; changes with an edit, a new untracked file, a deletion and a rename; ignores gitignored files and never reads .env', () => {
    const base = sourceIdentity(dir, []);
    expect(sourceIdentity(dir, [])).toEqual(base);
    expect(base.head).toMatch(/^[0-9a-f]{40}$/);
    fs.writeFileSync(path.join(dir, 'app.ts'), 'two');
    const edited = sourceIdentity(dir, []);
    expect(identityDiffers(base, edited)).toEqual(['dirtyHash']);
    fs.writeFileSync(path.join(dir, 'new.ts'), 'x');
    const added = sourceIdentity(dir, []);
    expect(added.dirtyHash).not.toBe(edited.dirtyHash);
    git('mv', 'app.ts', 'renamed.ts');
    expect(sourceIdentity(dir, []).dirtyHash).not.toBe(added.dirtyHash);
    fs.writeFileSync(path.join(dir, '.gitignore'), '.env.local\n');
    git('add', '.gitignore');
    const beforeEnv = sourceIdentity(dir, []);
    fs.writeFileSync(path.join(dir, '.env.local'), 'SECRET=abc');
    expect(sourceIdentity(dir, [])).toEqual(beforeEnv);
    expect(JSON.stringify(sourceIdentity(dir, []))).not.toContain('abc');
  });

  it('leaves out the excluded directories; a non-git directory gives null parts', () => {
    fs.mkdirSync(path.join(dir, 'aegis'));
    fs.mkdirSync(path.join(dir, 'tests', 'qa'), { recursive: true });
    const base = sourceIdentity(dir, ['aegis', 'tests/qa']);
    fs.writeFileSync(path.join(dir, 'aegis', 'run.json'), '{}');
    fs.writeFileSync(path.join(dir, 'tests', 'qa', 'pom.ts'), 'x');
    expect(sourceIdentity(dir, ['aegis', 'tests/qa'])).toEqual(base);
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-plain-'));
    expect(sourceIdentity(plain, [])).toEqual({ head: null, dirtyHash: null });
    fs.rmSync(plain, { recursive: true, force: true });
  });

  it('identityDiffers names every part when there is no earlier identity', () => {
    expect(identityDiffers(undefined, { head: 'a', dirtyHash: 'b' })).toEqual(['head', 'dirtyHash']);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm build && cd __internal-tests__ && npx jest explore-identity`
Expected: FAIL (`signatureOf` is not exported).

- [ ] **Step 3: Implement**

`packages/@qa/run-state/src/explore/identity.ts`:

```ts
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

/** Text that is data, not structure: digits become `#` so a counter, a date or a row count is not a change. */
const flat = (s: unknown): string => String(s ?? "").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
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
export function selectPages(entries: unknown, baseOrigin: string): { pages: PageRef[]; skipped: Array<{ role: string; route: string; reason: string }> } {
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
      continue;
    }
    if (DYNAMIC.test(decodeURIComponent(where)) || DYNAMIC.test(path)) {
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
 * Call it outside run.lock: hashing a large dirty tree is synchronous.
 */
export function sourceIdentity(targetDir: string, excludeDirs: readonly string[]): SourceIdentity {
  const head = git(targetDir, ["rev-parse", "HEAD"])?.trim() ?? null;
  const changed = git(targetDir, ["diff", "HEAD", "--name-only", "-z"]);
  const untracked = git(targetDir, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (head === null || changed === null || untracked === null) return { head, dirtyHash: null };
  const skip = (p: string): boolean => excludeDirs.some((d) => d !== "" && (p === d || p.startsWith(`${d}/`)));
  const names = [...new Set([...changed.split("\0"), ...untracked.split("\0")])].filter((p) => p !== "" && !skip(p)).sort();
  const h = createHash("sha256");
  for (const p of names) {
    const abs = join(targetDir, p);
    h.update(p).update("\0");
    h.update(existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs) : "deleted").update("\0");
  }
  return { head, dirtyHash: h.digest("hex") };
}

export function identityDiffers(a: SourceIdentity | undefined, b: SourceIdentity): string[] {
  const parts = ["head", "dirtyHash"] as const;
  return parts.filter((p) => a === undefined || a[p] !== b[p]);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm build && cd __internal-tests__ && npx jest explore-identity`
Expected: PASS. (`sig` in the test file is a convenience helper: drop it if unused.) A rename shows in `git diff HEAD --name-only` as the new path and the old path as a deletion; the test only needs the hash to change.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src/explore packages/@qa/run-state/src/index.ts __internal-tests__/explore-identity.test.ts
git commit -m "feat(explore): page signatures, comparison, decision, page selection and source identity"
```

---

### Task 2: Baseline and probe: records, event, reopening the explorer on a change

**Files:**
- Create: `packages/@qa/run-state/src/explore/probe.ts`
- Modify: `packages/@qa/contracts/src/run-state.ts` (`PhaseRecordSchema`: optional `carried: boolean` and `identity: {head, dirtyHash}` both nullable strings), `packages/@qa/contracts/src/events.ts` (`ExploreProbedEventSchema` + union), `packages/@qa/run-state/src/caller.ts` (`CLI_COMMANDS` `"explore.probe"`, `OWNER_COMMANDS`, `AGENT_SET_COMMANDS` `["qa-orchestrator"]`, `CLI_RECORDED_TYPES` `"explore.probed"`), `packages/@qa/run-state/src/hook-context.ts` (`CLI_USAGE`), `packages/@qa/alignment/src/cli-records.ts`, `__internal-tests__/alignment/cli-records.test.ts` (**add `src/explore` to the scanned directories next to `src` and `src/lint`**, then the `ENTRY`), `docs/D13-event-bus-spec.md`, `packages/@qa/path-guard/src/roles.ts` + `guard.ts` (`reports/explore` CLI-only: the same places `reports/lint` was added; `git log -S "reports/lint" --oneline` finds them), `packages/@qa/run-state/src/index.ts`
- Test: `__internal-tests__/explore-probe.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 exports; `reopenPhaseTasks` (`supersede.ts`; it gets its optional 6th `keep` parameter in this task, the one-line change listed in Task 3: do it here first and Task 3 reuses it), `commitRun`, `readRun`, `withRunLock` (`run.ts`), `readRunConfig`, `busPath`/`runDir`, `appendChained`.
- Produces:
  ```ts
  export interface PageFetcher { visit(page: PageRef): Promise<RawObservation>; close(): Promise<void> }
  export type FetcherFactory = () => Promise<PageFetcher>;     // may throw: the probe turns that into decision full
  export interface BaselineResult { runId: string; pages: number; skipped: number; unavailable: string | null; report: string }
  export async function takeBaseline(root: string, runId: string, caller: string, factory: FetcherFactory, now?: Date): Promise<BaselineResult>
  export interface ProbeResult { runId: string; decision: ProbeDecision; reason: string | null; diff: ProbeDiff; hints: string[]; reopened: string[]; report: string }
  export async function probeExplore(root: string, runId: string, caller: string, factory: FetcherFactory, now?: Date): Promise<ProbeResult>
  ```
- Files: `reports/explore/baseline.json` = `{ takenAt, baseUrl, pages: PageSignature[], skipped, unavailable, identity }`; `reports/explore/probe.json` = `{ decidedAt, decision, reason, diff, hints, reopened, changedPages: [{role, url}] }`.
- Event `explore.probed { agent, mode: "baseline"|"verify", decision: "reuse"|"partial"|"full"|"none", pages, same, changed, failed, hints }` (`decision` is `none` for a baseline). CLI-recorded.

Behaviour to implement:

- `takeBaseline`: caller allowed (`assertCallerAllowed(caller, "explore.probe")`); refuses unless `phases.explore.status === "in-progress"` (`invalid-input`: "the baseline is taken while Explore is in progress, after the explorer's review passed"). Reads `discovery-report.json` leniently (a missing or unparsable file or no `pages` array gives `pages: 0` and `unavailable: "<reason>"`, never throws), the base URL from the run's environment in `aegis.config.json`, the roles from `env-auth-report.json#roles[]` (an entry without `storageState` is an unauthenticated role; a page whose role is not listed is skipped with reason `role without auth state`). Calls `selectPages`, builds the fetcher inside try/catch (a failure sets `unavailable`), visits pages one at a time, writes `baseline.json` (with `identity` from `sourceIdentity`, computed before taking any lock), appends the event under `commitRun`/`withRunLock` only for the short write, never while visiting.
- `probeExplore`: caller allowed; under the lock check `phases.explore.carried === true` else `invalid-input` ("discovery is not carried over in this run: nothing to verify"); release the lock; build the fetcher (failure: decision `full`, reason is the redacted message); read `baseline.json` (missing, `unavailable` set, or zero pages: decision `full`, reason says so); visit every baseline page; `compareSignatures` + `decideProbe`; compute `sourceIdentity` outside the lock; then under the lock re-check `carried`, and in one `commitRun` do: when the decision is not `reuse`, reopen the explorer's tasks with `reopenPhaseTasks(root, runId, state, new Set(["explore"]), ts, (t) => t.assignee !== "qa-web-explorer")` (a fresh attempt count: it records the earlier attempts as superseded); set `phases.explore = { ...record, identity }` with `carried` removed; write `probe.json`; append the event. Always closes the fetcher, also when a visit throws (a throwing visit becomes an `error` observation).
- Both functions: the report file is written before the commit and overwritten on a retry; a failed event append leaves `carried` set so the call can be repeated.

- [ ] **Step 1: Write the failing test**

Use the helpers the lint and gate tests use (`makeAegisRoot` and a run created with `createRun`; read `__internal-tests__/run-state-gates.test.ts` for `workTask`/`fastForward` and how the explorer task is made done). Make the target a real temp git repo by writing `targetProjectRoot` into the test's `aegis.config.json` (the helper leaves it as `..`). Seed `discovery-report.json` with `pages` (at least four entries with `role`, `url`), `env-auth-report.json` with `roles[{role, storageState}]` and one role without a state. Fake `PageFetcher` from a map of url to `RawPage`. Tests:

```ts
it('baseline: stores one signature per concrete page, names what it skipped, records identity, one event; refuses outside Explore in-progress', async () => { /* ... */ });

it('baseline never throws: no discovery pages, or a factory that throws, give unavailable and zero pages', async () => { /* ... */ });

it('reuse: every page matches; the explorer task stays done, carried is removed, the identity is recorded, one verify event, probe.json written', async () => { /* ... */ });

it('partial: 1 of 4 pages changed; the explorer task goes back to pending with its earlier attempts superseded; the other explore tasks are untouched; probe.json names the page', async () => { /* ... */ });

it('full without throwing: no baseline file, an unavailable baseline, a factory that throws, every page failing: the explorer is reopened, carried removed, reason recorded', async () => { /* ... */ });

it('hints: an edited working tree is reported as a hint next to a reuse decision, never as the decision', async () => {
  expect(r.decision).toBe('reuse');
  expect(r.hints).toContainEqual(expect.stringContaining('dirtyHash'));
});

it('refuses when discovery is not carried and for a caller that is not the orchestrator or the owner, before any fetcher is built', async () => { /* factory is a jest.fn that must not be called */ });

it('closes the fetcher exactly once, also when a visit throws (that page becomes failed)', async () => { /* ... */ });
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd __internal-tests__ && npx jest explore-probe`
Expected: FAIL (`probeExplore` is not exported).

- [ ] **Step 3: Register the event, the command, the record fields and the CLI-only path**

Copy the touch points of `lint.completed` (`git log -S lint.completed --oneline`). Schema:

```ts
/** `aegis explore probe` took a baseline of the explored pages, or compared the running app with it and decided what is reused. */
export const ExploreProbedEventSchema = EventBase.extend({
  type: z.literal("explore.probed"),
  agent: z.string(),
  mode: z.enum(["baseline", "verify"]),
  decision: z.enum(["reuse", "partial", "full", "none"]),
  pages: z.number().int().nonnegative(),
  same: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  hints: z.array(z.string()),
});
```

`PhaseRecordSchema` (it is `.strict()`): `carried: z.boolean().optional()`, `identity: z.object({ head: z.string().nullable(), dirtyHash: z.string().nullable() }).strict().optional()`. `CLI_USAGE["explore.probe"] = "explore probe [--baseline] [--run <id>]"`. `reports/explore` is CLI-only exactly as `reports/lint`; add `reports/explore/` to the CLI-only lists in CLAUDE.md (read/write policy row) and `HANDBOOK/13-mechanics.md` (the list near line 45).

- [ ] **Step 4: Implement `takeBaseline` and `probeExplore`** in `explore/probe.ts` as specified above. Read `lint/run-lint.ts` for the I/O style (atomic writes, `runDir`), `gates.ts` `decideGate` for the `reopenPhaseTasks` + `commitRun(root, reopenedState, next, append)` pattern, and `apps/cli/src/commands/lint.ts` for the CLI result shape.

- [ ] **Step 5: Run it to see it pass, then the suite**

Run: `pnpm build && cd __internal-tests__ && npx jest explore-probe cli-records event-type-drift && cd .. && pnpm test && pnpm typecheck && pnpm aegis align`
Expected: PASS; ratchet 207.

- [ ] **Step 6: Commit**

```bash
git add packages apps __internal-tests docs CLAUDE.md HANDBOOK
git commit -m "feat(explore): baseline and probe decide reuse, partial or full and reopen the explorer on a change"
```

---

### Task 3: A rejection carries the discovery over; Explore cannot complete until the probe verified it

**Files:**
- Modify: `packages/@qa/run-state/src/gates.ts` (`DecideGateInput.reExplore`, `decideGate`), `packages/@qa/run-state/src/supersede.ts` (`reopenPhaseTasks` optional `keep` predicate, if Task 2 did not add it), `packages/@qa/run-state/src/phases.ts` (`startPhase` keeps `carried` and `identity`; `barrierProblems`; `completePhase` records identity), `packages/@qa/contracts/src/events.ts` (`gate.decided` gets optional `reExplore: boolean`), `apps/cli/src/commands/gate.ts` (`--re-explore`), `packages/@qa/run-state/src/hook-context.ts` (`CLI_USAGE["gate.decide"]`), `.claude/skills/qa-gate-decide/SKILL.md` (usage line, argument table, and the step that builds the CLI command)
- Test: `__internal-tests__/explore-carry.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 `sourceIdentity`, Task 2 `PhaseRecord.carried` and `.identity`.
- Produces: `reopenPhaseTasks(root, runId, state, phases, ts, keep?: (task) => boolean)` (a task for which `keep` is true is not reopened and keeps its attempts); `DecideGateInput.reExplore?: boolean`.

Behaviour to implement:

- `reopenPhaseTasks`: filter `!keep(t)` before superseding and reopening.
- `decideGate` on a rejection whose reopened range includes `explore`: when `reopen !== "explore"` and `reExplore !== true` and a task of phase `explore` assigned to `qa-web-explorer` is `done`, pass `keep = (t) => t.phase === "explore" && t.assignee === "qa-web-explorer"` and, after `reopenPhases` builds the new phase map, set `phases.explore = { status: "pending", carried: true, ...(identity of the earlier explore record, when it had one) }` (`reopenPhases` replaces the record with `{status:"pending"}`, so the identity must come from `open.phases.explore`).
- `--re-explore` is refused (`invalid-input`) unless the decision is `rejected` and the reopened range includes `explore` (mirror the range check in `gates.ts` around the `reopenedPhaseIds` call); it is recorded as `reExplore: true` in the `gate.decided` event.
- `startPhase`: when starting `explore`, keep `carried` and `identity` of the previous record: `{ status: "in-progress", startedAt: ts, ...(prev?.carried ? { carried: true } : {}), ...(prev?.identity ? { identity: prev.identity } : {}) }` (today it replaces the record, which would wipe the flag).
- `barrierProblems` for `explore`: `state.phases["explore"]?.carried === true` adds `carried-over discovery has not been verified: run the explore probe (it compares the running app with the baseline and reopens the explorer when the app changed)`.
- `completePhase` for `explore`: record `identity: sourceIdentity(target dir, [aegis dir and tests dir, both target-relative])` in the phase record; compute it before taking the run lock. The tests directory comes from the raw `aegis.config.json#testsDir` (`readRunConfig` does not expose it).
- `/qa-gate-decide` skill: add `--re-explore` to the usage line, the argument table ("with a rejection that reopens Explore: do not reuse the earlier discovery") and the step that builds the CLI command.

- [ ] **Step 1: Write the failing test** (drive a full run to an open G1 with a completed Explore with the gate helpers of `run-state-gates.test.ts`)

```ts
it('a G1 rejection that reopens Requirements keeps the web-explorer task done and its attempts, marks discovery carried and keeps the identity; the other explore tasks reopen', async () => {
  await decideGate(t.root, runId, { gate: 'G1', decision: 'rejected', note: 'developer answers', reopenPhase: 'requirements' }, 'owner');
  expect(taskStatus('T-explore-1')).toBe('done');        // qa-web-explorer
  expect(taskStatus('T-explore-2')).toBe('pending');     // qa-exploratory-specialist
  expect(readRun(t.root, runId).phases['explore']).toMatchObject({ status: 'pending', carried: true, identity: earlierIdentity });
});

it('carried survives startPhase; Explore cannot complete until a verify probe ran; after a reuse probe it completes and records the identity', async () => { /* start explore: phases.explore.carried still true; completePhase -> barrier text above; probeExplore(reuse); completePhase ok */ });

it('after a full probe (explorer reopened) the explorer runs again, a new baseline is taken, and Explore completes', async () => { /* ... */ });

it('--reopen-phase explore and --re-explore reopen everything as before, nothing is carried, and the event records reExplore', async () => { /* ... */ });

it('--re-explore is refused on an approval and when the reopened range does not include Explore', async () => { /* ... */ });

it('a rejection that does not reach Explore, or whose explorer task was not done, carries nothing; a run without a baseline is carried and the probe answers full', async () => { /* ... */ });
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd __internal-tests__ && npx jest explore-carry`
Expected: FAIL (the explorer task is reopened).

- [ ] **Step 3: Implement** as specified above.

- [ ] **Step 4: Run the tests, the whole suite and align**

Run: `pnpm build && cd __internal-tests__ && npx jest explore-carry explore-probe run-state-gates cli-phase-gate hooks-final-wave && cd .. && pnpm test && pnpm typecheck && pnpm test:smoke && pnpm aegis align`
Expected: PASS, ratchet 207.

- [ ] **Step 5: Commit**

```bash
git add packages apps __internal-tests .claude/skills
git commit -m "feat(gate): a rejection carries the web-explorer discovery over until the probe verifies it"
```

---

### Task 4: The real page fetcher, `aegis explore probe`, and the agent procedure

**Files:**
- Create: `apps/cli/src/commands/explore.ts`, `apps/cli/src/explore-fetcher.ts`
- Modify: `apps/cli/src/program.ts`, `.claude/agents/orchestrator/qa-orchestrator.md` (Explore step and Contract `cli:`), `.claude/agents/tier2-specialist/qa-web-explorer.md` (page entries, diff mode, Contract reads `reports/explore/probe.json`), `.claude/agents/spv/qa-web-explorer-spv.md` (checklist: page entries have role and a concrete same-origin url; a diff-mode report keeps the unchanged entries and passes completeness), `HANDBOOK/04-stlc-walkthrough.md` (one paragraph), `docs/superpowers/specs/2026-10-14-lighter-framework-design.md` (decision 4 text: baseline and probe, see Spec above), `CLAUDE.md` (run tree: `reports/explore/`)
- Test: `__internal-tests__/explore-cli.test.ts` (create; help and refusal paths through the built CLI; the real fetcher is verified by hand, Step 5)

**Interfaces:**
- Consumes: `takeBaseline`, `probeExplore`, `PageFetcher`, `FetcherFactory` (Task 2).
- Produces: `aegis explore probe [--baseline] [--run <id>]` and `makePlaywrightFetcher(root: string, runId: string): Promise<PageFetcher>`.

- [ ] **Step 1: Write the failing test**

Through the built CLI (pattern: `__internal-tests__/cli-lenient-input.test.ts`): `explore probe --help` exits 0; a run whose Explore is not carried refuses with `discovery is not carried over` **without starting a browser** (the factory is only called after the check, so this passes on a machine without Playwright); `caller-forbidden` for `qa-ui-specialist`; `--baseline` outside Explore in-progress refuses. The A16 test (`hooks-final-wave`) must still pass with `explore.probe` in `CLI_COMMANDS` and `CLI_USAGE`.

- [ ] **Step 2: Run it to see it fail**

Run: `cd __internal-tests__ && npx jest explore-cli`
Expected: FAIL (no `explore` command).

- [ ] **Step 3: The fetcher and the command**

`apps/cli/src/explore-fetcher.ts`: resolves Playwright from the TARGET (never a dependency of this repo): `createRequire(join(targetDir, "package.json")).resolve("playwright")`, falling back to `@playwright/test`; neither resolving throws `RunStateError("invalid-input", "playwright is not installed in the target")` (the probe turns it into decision `full`). One headless Chromium; per role one context created with the storage state named by `env-auth-report.json#roles[].storageState` (target-relative; a role entry without one is unauthenticated). The base URL is the run environment's `url` from `aegis.config.json`; an unresolved `${VAR}` throws naming the variable. `visit({role, url})`:

```ts
const target = new URL(url, baseURL);
if (target.origin !== new URL(baseURL).origin) return { role, url, error: "outside the environment origin" };
const page = await context.newPage();
const consoleErrors: string[] = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(e.message));
try {
  const resp = await page.goto(target.toString(), { waitUntil: "load", timeout: 15_000 });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  return {
    role, url,
    finalPath: new URL(page.url()).pathname,
    status: resp?.status() ?? null,
    title: await page.title(),
    h1: (await page.locator("h1").first().textContent({ timeout: 1_000 }).catch(() => null)) ?? "",
    testids: await page.$$eval("[data-testid]", (els) => els.map((e) => e.getAttribute("data-testid") ?? "")),
    consoleErrors,
  };
} catch (e) {
  return { role, url, error: (e as Error).message };
} finally {
  await page.close();
}
```

Read-only: only `goto`; one page at a time (gentle on a dev server).

`apps/cli/src/commands/explore.ts`: the `explore` group with `probe` (`--baseline`, `--run`); the action builds `const factory = () => makePlaywrightFetcher(ctx.root, runId)` and calls `takeBaseline` or `probeExplore` (the fetcher is never built before the caller and carried checks). Register it in `program.ts`.

- [ ] **Step 4: The procedure**

`qa-orchestrator.md`, Explore step: (1) after Env-auth, when Explore is carried (the CLI status shows it), start Explore, then run the probe with a long Bash timeout (600000 ms; the default 2 minutes is short for 60+ pages); (2) `reuse`: dispatch no explorer; the exploratory-session tasks the rejection reopened are dispatched again as usual (a task that was claimed once cannot be cancelled; skipping unchanged stories is a later slice); `partial`: the explorer task is already reopened: put the changed pages of the probe report in its brief and tell it to work in diff mode over exactly those pages; `full`: the explorer task is reopened and explores in full; (3) every time the explorer's work passed its SPV, run the baseline command before completing Explore (a failed baseline is not an error: it only makes the next probe answer `full`). Contract `cli:` gets the explore probe command. In `qa-web-explorer.md`: each `pages[]` entry of `discovery-report.json` carries `role`, `url` (the concrete same-origin URL visited, never a route pattern) and `route`; **diff mode**: given a changed-page list in the brief, crawl only those pages and any new links found from them, merge into `discovery-report.json` keeping every other entry as recorded; no list: full BFS as today. SPV checklist as above. HANDBOOK/04: one paragraph (baseline at acceptance, carried discovery, the three decisions, the owner flags, the limits). No backticked `aegis ...` command in agent prose outside a contract; the align ratchet stays 207.

- [ ] **Step 5: Run the whole gate, then verify the fetcher by hand once**

Run: `pnpm build && pnpm test && pnpm typecheck && pnpm test:smoke && pnpm aegis align`
Expected: PASS, ratchet 207.

Manual check (record the result in the PR description): against a target with Playwright installed and a running dev server, in a scratch aegis root with a finished run's `discovery-report.json`, `env-auth-report.json` and storage states, set Explore in progress and take a baseline, mark it carried, run the probe: `reuse` for an untouched app; `partial` after editing a page title or a heading in the target; `full` with the server stopped; and a list page with other rows stays `same`.

- [ ] **Step 6: Commit**

```bash
git add apps packages .claude HANDBOOK docs CLAUDE.md __internal-tests
git commit -m "feat(cli): aegis explore probe with a Playwright page fetcher, and the orchestrator procedure"
```

---

## Self-review

- Spec/decision coverage: reuse unless the app changed or the owner asks (Tasks 2-3, `--re-explore`); judged by behaviour with the source identity as a hint (Tasks 1-2); unknown means explore again and never stuck (Task 2); the Vault case (Task 1 test, Review Focus); no secrets (identity reads no ignored file, URLs redacted).
- Findings of the first independent review folded in: `startPhase` wipe (Task 3), stuck run (Task 2: full, factory after checks), report shape mismatch (own baseline, `selectPages`, Task 4 explorer entries), normalisation and like-for-like fields (Task 1), fresh attempts and `commitRun` (Task 2), reuse procedure (exploratory tasks rerun), explorer diff mode and SPV (Task 4), owner flag reachable (Task 3 skill and validation), alignment scan directory (Task 2), test counts (4+ pages), identity noise and rename handling, env hash dropped, origin and logout limits, touch points and typos.
- Placeholders: the Task 2 and 3 tests with `/* ... */` bodies name their setup and assertions in the sentence above; they reuse the existing gate and lint helpers by name (the implementer reads those helpers), as the earlier plans did.
- Types: `RawPage`, `RawObservation`, `PageSignature`, `Observed`, `ProbeDiff`, `ProbeDecision`, `decideProbe`, `PageRef`, `SourceIdentity`, `PageFetcher`, `FetcherFactory`, `takeBaseline`, `probeExplore`, `reopenPhaseTasks(..., keep)` keep the same names across tasks.

## Known limits (stated, not hidden)

- The probe sees what a page shows on load: a change visible only after an interaction or only in an API response is not seen; Execution still tests behaviour.
- Route patterns (`/volunteers/[id]`) are skipped (listed in `baseline.json#skipped`); a later slice can record one sample URL per pattern. A new route reachable only from an unchanged page is found only when the explorer runs.
- The per-story exploratory tasks the rejection reopens are rerun; making them conditional on a story hash is a later slice.
- An old-format discovery report (no `pages[]` with `role` and `url`/`route`) gives an empty baseline, so the probe answers `full`: the same work as today.
- Only the web-explorer task is carried; a rejection that reopens Explore itself, or an owner who wants a fresh crawl, uses `--reopen-phase explore` or `--re-explore`.
