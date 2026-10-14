# Explore Reuse (verified by a probe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a gate rejection that reopens Requirements, Env-auth or Scan, the Explore phase does not run its full web crawl again when the running application still looks the same; when it does not, only the changed pages are explored again. The owner can always force a full explore.

**Architecture:** A rejection keeps the previous `qa-web-explorer` task done (marked `carried`) instead of reopening it. The Explore phase cannot complete while discovery is carried and unverified. `aegis explore probe` re-visits every page of the stored discovery report as each role (read-only GET, the same fields the explorer already records: final path, status, title, headings, test-id count, console errors) and compares. Same everywhere: discovery is reused. Different or unreachable: the explorer task is reopened with the list of changed pages and runs its existing diff mode. The decision never rests on the source code alone: the source and environment identity are recorded next to it as hints, but the observed behaviour decides.

**Tech Stack:** TypeScript, jest (`__internal-tests__`), commander (`apps/cli`), Playwright resolved from the target project (dynamic import, only in the real page fetcher).

**Spec:** `docs/superpowers/specs/2026-10-14-lighter-framework-design.md` (section "Item 4: explore reuse" and the owner decision 4).

## Global Constraints

- Owner decision 4: Explore repeats only when the app version changed, or when the owner asks (`gate decide --re-explore`, or `--reopen-phase explore`).
- "Version" is judged by what the app does, not by git alone. Evidence from the slec run (2026-10-05): five Explore rounds, zero commits in the target between 5 and 13 October, and one round that was truly needed because the local Supabase Vault was empty and the encryption keys were missing: an environment change a git-only identity cannot see.
- The probe is read-only: GET navigation, no form fill, no clicks, no writes to the target, the same discipline as the explorer. It never runs on a read-only environment differently from the explorer (production is explored read-only already).
- Unknown means re-explore: an unreachable app, a role without a storage state, a page that errors, a missing report: the decision is `full`, never `reuse`.
- Secrets never leave the identity hash: `.env*` contents are hashed, never stored or printed.
- Gate: `pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align` stay green; the align ratchet (207) does not grow. (In a worktree under `.claude/worktrees`, 4 tests of `customer-wording.test.ts` fail by location only; CI is their real run.)

## Review Focus

- The Vault case: source and git identical, a page that errored now renders: the probe must say `changed`, not `reuse`.
- An uncommitted edit hot-reloaded by a dev server (no restart, HEAD unchanged): the dirty-source hash changes and is reported as a hint; the pages decide.
- A page whose text is data (a list with other rows, a counter, a date in the title): same structure must stay `same`.
- A role whose storage state is missing or expired (the probe lands on the login page): `failed`, so the decision is not `reuse`.
- The app is down: `full`, with the reason.
- `--re-explore` and `--reopen-phase explore`: the explorer task reopens exactly as before.
- A rejection that does not reach Explore (reopen at planning): nothing is carried.
- A run created before this change (no identity, no carried flag): behaves as today.

---

### Task 1: Page signatures, the comparison, the decision and the source/environment identity

**Files:**
- Create: `packages/@qa/run-state/src/explore/identity.ts`
- Modify: `packages/@qa/run-state/src/index.ts` (add `export * from "./explore/identity.js";`)
- Test: `__internal-tests__/explore-identity.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export interface PageSignature { role: string; route: string; finalPath: string; status: number | null; title: string; headings: string[]; testidCount: number; consoleErrors: number }
  export type ObservedPage = PageSignature | { role: string; route: string; error: string };
  export function toSignature(raw: unknown): PageSignature | null;           // a discovery-report page entry, normalised
  export interface ProbeDiff { same: number; changed: Array<{ role: string; route: string; fields: string[] }>; failed: Array<{ role: string; route: string; error: string }>; total: number }
  export function compareSignatures(previous: readonly PageSignature[], observed: readonly ObservedPage[]): ProbeDiff;
  export type ProbeDecision = "reuse" | "partial" | "full";
  export function decide(diff: ProbeDiff): ProbeDecision;                   // reuse: nothing changed or failed; partial: at most 30% of the pages; full: more, or nothing observed
  export interface AppIdentity { head: string | null; dirtyHash: string | null; envHash: string | null }
  export function appIdentity(targetDir: string, excludeDirs: readonly string[]): AppIdentity;
  export function identityDiffers(a: AppIdentity | undefined, b: AppIdentity): string[];   // names of the parts that differ ("head", "dirtyHash", "envHash"); a missing `a` means every part
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appIdentity, compareSignatures, decide, identityDiffers, toSignature, type ObservedPage, type PageSignature } from '@qa/run-state';

const page = (over: Partial<PageSignature> = {}): PageSignature => ({
  role: 'volunteer', route: '/home', finalPath: '/home', status: 200, title: 'Home', headings: ['H1:Welcome'], testidCount: 4, consoleErrors: 0, ...over,
});

describe('toSignature', () => {
  it('reads a discovery-report page entry and normalises digits in text', () => {
    const s = toSignature({ role: 'volunteer', route: '/home', finalPath: '/home', status: 200, title: 'Home (3 new)', headings: ['H1:Welcome 12', 'H2:Events'], testidCount: 4, consoleErrors: 0, screenshot: 'x.png', inBaseline: true });
    expect(s).toEqual(page({ title: 'Home (# new)', headings: ['H1:Events'.replace('Events', 'Events'), 'H1:Welcome #'].sort().map((h) => h.replace('H1:Events', 'H2:Events')) }));
  });
  it('is null for an entry without a role or a route', () => {
    expect(toSignature({ route: '/x' })).toBeNull();
    expect(toSignature(null)).toBeNull();
  });
});

describe('compareSignatures and decide', () => {
  const prev = [page(), page({ role: 'admin', route: '/admin' }), page({ route: '/events', title: 'Events' })];

  it('same structure with different data is same (a counter, a date, a row count)', () => {
    const now: ObservedPage[] = [page({ title: 'Home' }), page({ role: 'admin', route: '/admin' }), page({ route: '/events', title: 'Events' })];
    const diff = compareSignatures(prev, now);
    expect(diff).toMatchObject({ same: 3, changed: [], failed: [], total: 3 });
    expect(decide(diff)).toBe('reuse');
  });

  it('a page that errored before and renders now is changed (the Vault case)', () => {
    const before = [page({ route: '/profile', status: 500, consoleErrors: 3, testidCount: 0 })];
    const diff = compareSignatures(before, [page({ route: '/profile', status: 200, consoleErrors: 0, testidCount: 6 })]);
    expect(diff.changed).toEqual([{ role: 'volunteer', route: '/profile', fields: ['status', 'testidCount', 'consoleErrors'] }]);
    expect(decide(diff)).toBe('partial');
  });

  it('a redirect to login (an expired role) and an unreachable page are failed, never same', () => {
    const now: ObservedPage[] = [page({ finalPath: '/login' }), { role: 'admin', route: '/admin', error: 'timeout' }, page({ route: '/events', title: 'Events' })];
    const diff = compareSignatures(prev, now);
    expect(diff.changed).toEqual([{ role: 'volunteer', route: '/home', fields: ['finalPath'] }]);
    expect(diff.failed).toEqual([{ role: 'admin', route: '/admin', error: 'timeout' }]);
    expect(decide(diff)).toBe('full'); // 2 of 3 pages
  });

  it('a recorded page that was not observed is failed; nothing observed is full', () => {
    expect(compareSignatures(prev, []).failed).toHaveLength(3);
    expect(decide(compareSignatures(prev, []))).toBe('full');
    expect(decide(compareSignatures([], []))).toBe('full'); // no discovery to reuse
  });

  it('partial up to 30% of the pages, full beyond', () => {
    const ten = Array.from({ length: 10 }, (_, i) => page({ route: `/p${i}` }));
    const changed = (n: number): ObservedPage[] => ten.map((p, i) => (i < n ? { ...p, title: 'Other' } : p));
    expect(decide(compareSignatures(ten, changed(3)))).toBe('partial');
    expect(decide(compareSignatures(ten, changed(4)))).toBe('full');
  });
});

describe('appIdentity', () => {
  let dir: string;
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@e.com', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-id-'));
    git('init', '-q');
    fs.writeFileSync(path.join(dir, 'app.ts'), 'one');
    git('add', '.');
    git('commit', '-qm', 'init');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('is stable, and changes with an uncommitted edit, an untracked file and an env file, without printing secrets', () => {
    const base = appIdentity(dir, []);
    expect(appIdentity(dir, [])).toEqual(base);
    expect(base.head).toMatch(/^[0-9a-f]{40}$/);
    fs.writeFileSync(path.join(dir, 'app.ts'), 'two');
    const edited = appIdentity(dir, []);
    expect(identityDiffers(base, edited)).toEqual(['dirtyHash']);
    fs.writeFileSync(path.join(dir, 'new.ts'), 'x');
    expect(appIdentity(dir, []).dirtyHash).not.toBe(edited.dirtyHash);
    fs.writeFileSync(path.join(dir, '.env.local'), 'SECRET=abc');
    const withEnv = appIdentity(dir, []);
    expect(identityDiffers(edited, withEnv)).toContain('envHash');
    expect(JSON.stringify(withEnv)).not.toContain('abc');
    fs.writeFileSync(path.join(dir, '.env.local'), 'SECRET=abd');
    expect(appIdentity(dir, []).envHash).not.toBe(withEnv.envHash);
  });

  it('ignores the excluded directories and gitignored files; a non-git directory gives null parts', () => {
    fs.mkdirSync(path.join(dir, 'aegis'));
    const base = appIdentity(dir, ['aegis']);
    fs.writeFileSync(path.join(dir, 'aegis', 'run.json'), '{}');
    expect(appIdentity(dir, ['aegis'])).toEqual(base);
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-plain-'));
    expect(appIdentity(plain, [])).toEqual({ head: null, dirtyHash: null, envHash: null });
    fs.rmSync(plain, { recursive: true, force: true });
  });

  it('identityDiffers names every part when there is no earlier identity', () => {
    expect(identityDiffers(undefined, { head: 'a', dirtyHash: 'b', envHash: null })).toEqual(['head', 'dirtyHash', 'envHash']);
  });
});
```

(The first `toSignature` assertion is written out long-hand: fix the expected value to what the normaliser really returns, `headings` sorted and unique with digits replaced by `#`; the point of the test is the digits and the dropped screenshot fields.)

- [ ] **Step 2: Run it to see it fail**

Run: `cd __internal-tests__ && npx jest explore-identity`
Expected: FAIL (`toSignature` is not exported).

- [ ] **Step 3: Implement**

`packages/@qa/run-state/src/explore/identity.ts`:

```ts
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface PageSignature {
  role: string;
  route: string;
  finalPath: string;
  status: number | null;
  title: string;
  headings: string[];
  testidCount: number;
  consoleErrors: number;
}
export type ObservedPage = PageSignature | { role: string; route: string; error: string };

/** Text that is data, not structure: digits become `#` so a counter, a date or a row count is not a change. */
const flat = (s: unknown): string => String(s ?? "").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A discovery-report page entry (or a freshly observed page) in its comparable form; null when it has no role or route. */
export function toSignature(raw: unknown): PageSignature | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["role"] !== "string" || typeof r["route"] !== "string" || r["role"] === "" || r["route"] === "") return null;
  const headings = Array.isArray(r["headings"]) ? [...new Set(r["headings"].map(flat))].sort() : [];
  return {
    role: r["role"],
    route: r["route"],
    finalPath: typeof r["finalPath"] === "string" ? r["finalPath"] : r["route"],
    status: typeof r["status"] === "number" ? r["status"] : null,
    title: flat(r["title"]),
    headings,
    testidCount: int(r["testidCount"]),
    consoleErrors: int(r["consoleErrors"]),
  };
}

export interface ProbeDiff {
  same: number;
  changed: Array<{ role: string; route: string; fields: string[] }>;
  failed: Array<{ role: string; route: string; error: string }>;
  total: number;
}

const FIELDS = ["finalPath", "status", "title", "headings", "testidCount", "consoleErrors"] as const;
const key = (p: { role: string; route: string }): string => `${p.role}\u0000${p.route}`;

export function compareSignatures(previous: readonly PageSignature[], observed: readonly ObservedPage[]): ProbeDiff {
  const now = new Map(observed.map((o) => [key(o), o]));
  const diff: ProbeDiff = { same: 0, changed: [], failed: [], total: previous.length };
  for (const p of previous) {
    const o = now.get(key(p));
    if (o === undefined) diff.failed.push({ role: p.role, route: p.route, error: "not observed" });
    else if ("error" in o) diff.failed.push({ role: p.role, route: p.route, error: o.error });
    else {
      const fields = FIELDS.filter((f) => JSON.stringify(p[f]) !== JSON.stringify(o[f]));
      if (fields.length === 0) diff.same++;
      else diff.changed.push({ role: p.role, route: p.route, fields: [...fields] });
    }
  }
  return diff;
}

export type ProbeDecision = "reuse" | "partial" | "full";

/** Nothing changed or failed: reuse. At most 30% of the pages: only those are explored again. More, or nothing to compare: a full explore. */
export function decide(diff: ProbeDiff): ProbeDecision {
  if (diff.total === 0) return "full";
  const bad = diff.changed.length + diff.failed.length;
  if (bad === 0) return "reuse";
  return bad / diff.total <= 0.3 ? "partial" : "full";
}

export interface AppIdentity {
  head: string | null;
  dirtyHash: string | null;
  envHash: string | null;
}

const sha = (h: ReturnType<typeof createHash>): string => h.digest("hex");

function git(dir: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

const ENV_FILE = /^\.env(?:\..+)?$/;
const ENV_TEMPLATE = /\.(?:example|sample|template)$/;

/**
 * Where the app comes from: the commit, a hash of everything uncommitted that is not ignored (modified and untracked files, by path
 * and content), and a hash of the `.env*` files (an environment switch lives there and is gitignored). Contents are hashed, never stored.
 * `excludeDirs` (target-relative) leave out the QA tree itself. A directory that is not a git checkout gives null parts.
 */
export function appIdentity(targetDir: string, excludeDirs: readonly string[]): AppIdentity {
  const head = git(targetDir, ["rev-parse", "HEAD"])?.trim() ?? null;
  const status = git(targetDir, ["status", "--porcelain", "-z", "--untracked-files=all"]);
  let dirtyHash: string | null = null;
  if (head !== null && status !== null) {
    const h = createHash("sha256");
    const skip = (p: string): boolean => excludeDirs.some((d) => p === d || p.startsWith(`${d}/`));
    for (const entry of status.split("\0").filter((e) => e !== "").sort()) {
      const path = entry.slice(3);
      if (skip(path)) continue;
      h.update(entry).update("\0");
      const abs = join(targetDir, path);
      if (existsSync(abs) && statSync(abs).isFile()) h.update(readFileSync(abs));
    }
    dirtyHash = sha(h);
  }
  let envHash: string | null = null;
  if (existsSync(targetDir)) {
    const names = readdirSync(targetDir).filter((n) => ENV_FILE.test(n) && !ENV_TEMPLATE.test(n) && statSync(join(targetDir, n)).isFile()).sort();
    if (names.length > 0) {
      const h = createHash("sha256");
      for (const n of names) h.update(relative(targetDir, join(targetDir, n))).update("\0").update(readFileSync(join(targetDir, n))).update("\0");
      envHash = sha(h);
    }
  }
  return { head, dirtyHash, envHash };
}

export function identityDiffers(a: AppIdentity | undefined, b: AppIdentity): string[] {
  const parts = ["head", "dirtyHash", "envHash"] as const;
  return parts.filter((p) => a === undefined || a[p] !== b[p]);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm build && cd __internal-tests__ && npx jest explore-identity`
Expected: PASS. If the `toSignature` expectation needs adjusting, adjust the expected value, not the normaliser: the digits and the dropped fields are the behaviour under test.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src/explore packages/@qa/run-state/src/index.ts __internal-tests__/explore-identity.test.ts
git commit -m "feat(explore): page signatures, comparison, decision and app identity"
```

---

### Task 2: The probe: decision record, event, and reopening the explorer on a change

**Files:**
- Create: `packages/@qa/run-state/src/explore/probe.ts`
- Modify: `packages/@qa/contracts/src/run-state.ts` (`PhaseRecordSchema`: optional `identity` and `carried`), `packages/@qa/contracts/src/events.ts` (`ExploreProbedEventSchema` + union), `packages/@qa/run-state/src/caller.ts` (`CLI_COMMANDS` `"explore.probe"`, `OWNER_COMMANDS`, `AGENT_SET_COMMANDS` `["qa-orchestrator"]`, `CLI_RECORDED_TYPES` `"explore.probed"`), `packages/@qa/run-state/src/hook-context.ts` (`CLI_USAGE`), `packages/@qa/alignment/src/cli-records.ts`, `__internal-tests__/alignment/cli-records.test.ts` (`ENTRY`), `docs/D13-event-bus-spec.md`, `packages/@qa/path-guard/src/roles.ts` + `guard.ts` (`reports/explore` CLI-only, the same four places `reports/lint` was added), `packages/@qa/run-state/src/index.ts`
- Test: `__internal-tests__/explore-probe.test.ts` (create)

**Interfaces:**
- Consumes: `PageSignature`, `ObservedPage`, `compareSignatures`, `decide`, `appIdentity`, `identityDiffers`, `toSignature` (Task 1).
- Produces:
  ```ts
  export interface PageFetcher { visit(page: { role: string; route: string }): Promise<ObservedPage>; close(): Promise<void> }
  export interface ProbeResult { runId: string; decision: ProbeDecision; diff: ProbeDiff; hints: string[]; reopened: string[]; report: string }
  export async function probeExplore(root: string, runId: string, caller: string, fetcher: PageFetcher, now?: Date): Promise<ProbeResult>
  ```
- Event `explore.probed { agent, decision, same, changed, failed, hints }`, CLI-recorded. Report file `reports/explore/probe.json`. `PhaseRecord.identity?: AppIdentity` (recorded when Explore completes, Task 3) and `PhaseRecord.carried?: boolean`.

- [ ] **Step 1: Write the failing test**

Use the helpers the lint tests used (`makeAegisRoot`, a run created with `createRun`). Seed `runs/{id}/discovery-report.json` with `pages` (three entries as in a real report), a done `qa-web-explorer` task in phase `explore` (use the existing test helpers for tasks: see `run-state-gates.test.ts` `workTask`/`fastForward`; the simplest is `addTask` + `claimTask` + `submitWorkReport` + `releaseTask done` + a passing `submitReview` for `qa-web-explorer-spv`), and `state.phases.explore.carried = true` written through the run state writer the other tests use. Tests (each with a fake `PageFetcher` built from a map):

```ts
it('reuse: every page matches; the explorer task stays done, carried becomes false, one event, the report is written', async () => {
  const r = await probeExplore(t.root, runId, 'qa-orchestrator', fetcherOf(samePages));
  expect(r).toMatchObject({ decision: 'reuse', reopened: [] });
  expect(readRun(t.root, runId).phases['explore']).toMatchObject({ carried: false });
  expect(taskStatus('T-explore-1')).toBe('done');
  expect(events().find((e) => e.type === 'explore.probed')).toMatchObject({ agent: 'qa-orchestrator', decision: 'reuse', same: 3, changed: 0, failed: 0 });
  expect(JSON.parse(read('reports/explore/probe.json')).decision).toBe('reuse');
});

it('partial: the changed page is named, the explorer task is reopened for a diff run, carried becomes false', async () => {
  const r = await probeExplore(t.root, runId, 'qa-orchestrator', fetcherOf({ ...samePages, '/profile': { ...samePages['/profile'], status: 200, testidCount: 6, consoleErrors: 0 } }));
  expect(r).toMatchObject({ decision: 'partial', reopened: ['T-explore-1'] });
  expect(r.diff.changed.map((c) => c.route)).toEqual(['/profile']);
  expect(taskStatus('T-explore-1')).toBe('pending');
});

it('full: the app is unreachable; the explorer task is reopened and the reason is in the report', async () => { /* fetcher returns {error:'ECONNREFUSED'} for every page */ });

it('hints: an edited working tree and a changed env file are reported next to a reuse decision, never as the decision', async () => { /* appIdentity differs from phases.explore.identity; decision stays reuse; hints contain 'dirtyHash' */ });

it('refuses when discovery is not carried, when there is no discovery-report, and for a caller that is not the orchestrator or the owner', async () => {
  /* carried false -> invalid-input "discovery is not carried over"; no discovery-report.json -> invalid-input; caller qa-ui-specialist -> caller-forbidden */
});

it('always closes the fetcher, also when a visit throws', async () => { /* fetcher.visit throws: result is full (error recorded), close() was called once */ });
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd __internal-tests__ && npx jest explore-probe`
Expected: FAIL (`probeExplore` is not exported).

- [ ] **Step 3: Register the event, the command, the record fields and the CLI-only path**

Follow the same touch points as the `lint.completed` event (`git log -S lint.completed --oneline` shows the commit; copy its shape): schema

```ts
/** `aegis explore probe` compared the running app with the stored discovery and decided whether it is reused. */
export const ExploreProbedEventSchema = EventBase.extend({
  type: z.literal("explore.probed"),
  agent: z.string(),
  decision: z.enum(["reuse", "partial", "full"]),
  same: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  hints: z.array(z.string()),
});
```

`PhaseRecordSchema` gets `identity: z.object({ head: z.string().nullable(), dirtyHash: z.string().nullable(), envHash: z.string().nullable() }).strict().optional()` and `carried: z.boolean().optional()`. `CLI_USAGE["explore.probe"] = "explore probe [--run <id>]"`. `reports/explore` is CLI-only exactly as `reports/lint`.

- [ ] **Step 4: Write `probeExplore`**

`packages/@qa/run-state/src/explore/probe.ts` (read `lint/run-lint.ts` for the I/O style, `supersede.ts` for `createTaskmasterClient` use):

```ts
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { appendChained } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { assertCallerAllowed } from "../caller.js";
import { readRunConfig } from "../config.js";
import { RunStateError } from "../errors.js";
import { busPath, runDir, taskmasterDir } from "../paths.js";
import { readRun, withRunLock, writeRun } from "../run.js";
import { atomicWrite, iso } from "../util.js";
import { appIdentity, compareSignatures, decide, identityDiffers, toSignature, type ObservedPage, type PageSignature, type ProbeDecision, type ProbeDiff } from "./identity.js";

export interface PageFetcher {
  visit(page: { role: string; route: string }): Promise<ObservedPage>;
  close(): Promise<void>;
}

export interface ProbeResult {
  runId: string;
  decision: ProbeDecision;
  diff: ProbeDiff;
  hints: string[];
  reopened: string[];
  report: string;
}

const EXPLORER = "qa-web-explorer";

export async function probeExplore(root: string, runId: string, caller: string, fetcher: PageFetcher, now?: Date): Promise<ProbeResult> {
  assertCallerAllowed(caller, "explore.probe");
  const state0 = readRun(root, runId);
  if (state0.phases["explore"]?.carried !== true) throw new RunStateError("invalid-input", "discovery is not carried over in this run: there is nothing to verify (the explorer runs as usual)");
  const reportFile = join(runDir(root, runId), "discovery-report.json");
  if (!existsSync(reportFile)) throw new RunStateError("invalid-input", "discovery-report.json is missing: the explorer must run in full");
  let previous: PageSignature[] = [];
  try {
    const doc = JSON.parse(readFileSync(reportFile, "utf-8")) as { pages?: unknown };
    previous = (Array.isArray(doc.pages) ? doc.pages : []).map(toSignature).filter((s): s is PageSignature => s !== null);
  } catch {
    previous = [];
  }
  const observed: ObservedPage[] = [];
  try {
    for (const p of previous) {
      try {
        observed.push(await fetcher.visit({ role: p.role, route: p.route }));
      } catch (e) {
        observed.push({ role: p.role, route: p.route, error: (e as Error).message.slice(0, 120) });
      }
    }
  } finally {
    await fetcher.close();
  }
  const diff = compareSignatures(previous, observed);
  const decision = decide(diff);
  const config = readRunConfig(root);
  const targetDir = resolve(root, config.targetProjectRoot);
  const identity = appIdentity(targetDir, [relativeTo(targetDir, root)].filter((d) => d !== ""));
  const hints = identityDiffers(state0.phases["explore"]?.identity, identity).map((p) => `${p} differs from the last explore`);

  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    const client = createTaskmasterClient(taskmasterDir(root, runId));
    const reopened: string[] = [];
    if (decision !== "reuse") {
      for (const t of await client.list()) {
        if (t.phase === "explore" && t.assignee === EXPLORER && (t.status === "done" || t.status === "failed")) {
          await client.reopen(t.id);
          reopened.push(t.id);
        }
      }
    }
    const ts = iso(now);
    const report = "reports/explore/probe.json";
    mkdirSync(join(runDir(root, runId), "reports", "explore"), { recursive: true });
    atomicWrite(join(runDir(root, runId), report), JSON.stringify({ runId, decidedAt: ts, decision, diff, hints, reopened, changedPages: [...diff.changed, ...diff.failed].map((c) => ({ role: c.role, route: c.route })) }, null, 2) + "\n");
    writeRun(root, { ...state, phases: { ...state.phases, explore: { ...state.phases["explore"]!, carried: false, identity } }, updatedAt: ts });
    await appendChained(
      { type: "explore.probed", ts, agent: caller, decision, same: diff.same, changed: diff.changed.length, failed: diff.failed.length, hints },
      busPath(root, runId),
      { emittedBy: caller, runId }
    );
    return { runId, decision, diff, hints, reopened, report };
  });
}

/** `aegis` lives inside the target: its directory (target-relative) is left out of the source identity. */
function relativeTo(target: string, root: string): string {
  const rel = root.startsWith(`${target}/`) ? root.slice(target.length + 1) : "";
  return rel;
}
```

(`createTaskmasterClient`'s task shape has `phase`, `assignee`, `status`; check `packages/@qa/taskmaster-client/src/index.ts` for the exact field names and use them; `client.reopen` already exists.)

- [ ] **Step 5: Run it to see it pass, then the whole suite**

Run: `pnpm build && cd __internal-tests__ && npx jest explore-probe cli-records event-type-drift && cd .. && pnpm test && pnpm typecheck && pnpm aegis align`
Expected: PASS; ratchet 207. Agent prose that mentions the new command must sit in a contract `cli:` list or avoid a backticked `aegis ...` (the align checker reads it as a command the file runs).

- [ ] **Step 6: Commit**

```bash
git add packages apps __internal-tests docs
git commit -m "feat(explore): aegis explore probe decides reuse, partial or full and reopens the explorer on a change"
```

---

### Task 3: A rejection carries the discovery over; Explore cannot complete until the probe verified it

**Files:**
- Modify: `packages/@qa/run-state/src/gates.ts` (`DecideGateInput.reExplore`, `decideGate`), `packages/@qa/run-state/src/supersede.ts` (`reopenPhaseTasks` gets an optional `keep` predicate), `packages/@qa/run-state/src/phases.ts` (`barrierProblems` and `completePhase`: record `identity` when Explore completes), `apps/cli/src/commands/gate.ts` (`--re-explore`), `packages/@qa/run-state/src/hook-context.ts` (`CLI_USAGE["gate.decide"]`)
- Test: `__internal-tests__/explore-carry.test.ts` (create)

**Interfaces:**
- Consumes: `PhaseRecord.carried` and `.identity` (Task 2), `appIdentity` (Task 1).
- Produces: `reopenPhaseTasks(root, runId, state, phases, ts, keep?: (task) => boolean)`; `DecideGateInput.reExplore?: boolean`.

- [ ] **Step 1: Write the failing test** (use the gate helpers `run-state-gates.test.ts` uses to drive a full run to an open G1 with a completed Explore)

```ts
it('a G1 rejection that reopens Requirements keeps the web-explorer task done and marks discovery carried; the other explore tasks reopen', async () => {
  await decideGate(t.root, runId, { gate: 'G1', decision: 'rejected', note: 'developer answers', reopenPhase: 'requirements' }, 'owner');
  expect(taskStatus('T-explore-1')).toBe('done');        // qa-web-explorer
  expect(taskStatus('T-explore-2')).toBe('pending');     // qa-exploratory-specialist
  expect(readRun(t.root, runId).phases['explore']).toMatchObject({ status: 'pending', carried: true });
});

it('Explore cannot complete while discovery is carried and unverified, and completes after a reuse probe', async () => {
  /* after the rejection above: drive Env-auth, start Explore, finish the exploratory task; completePhase('explore') -> barrier "carried-over discovery has not been verified: run the explore probe" */
  /* probeExplore(... reuse) then completePhase('explore') succeeds and run.json phases.explore.identity is recorded */
});

it('--reopen-phase explore and --re-explore reopen everything as before and nothing is carried', async () => { /* both: taskStatus('T-explore-1') is pending, carried absent/false */ });

it('a rejection that does not reach Explore (reopen at planning) carries nothing; a run whose explorer task was not done carries nothing', async () => { /* ... */ });

it('a run created before this change (no carried flag anywhere) completes Explore as today', async () => { /* ... */ });
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd __internal-tests__ && npx jest explore-carry`
Expected: FAIL (the explorer task is reopened).

- [ ] **Step 3: Implement**

`supersede.ts`: add the optional last parameter to `reopenPhaseTasks`:

```ts
export async function reopenPhaseTasks(root: string, runId: string, state: RunState, phases: ReadonlySet<string>, ts: string, keep: (t: { assignee?: string; phase?: string; status: string }) => boolean = () => false): Promise<RunState> {
  const client = createTaskmasterClient(taskmasterDir(root, runId));
  const tasks = (await client.list()).filter((t) => t.phase !== undefined && phases.has(t.phase) && !keep(t));
```

(the rest unchanged: `supersedeAttempts` and the reopen loop already work on the filtered `tasks`).

`gates.ts` `decideGate`, where `reopenPhaseTasks` is called for a rejection:

```ts
    let carried = false;
    if (reopen !== undefined) {
      const phases = new Set<string>(reopenedPhaseIds(reopen, gate));
      // Discovery is carried over (the explorer's task stays done) unless the owner reopens Explore itself or asks for a full explore:
      // the probe verifies it after Env-auth, and reopens the task when the app changed.
      const carry = phases.has("explore") && reopen !== "explore" && input.reExplore !== true;
      const explorerDone = carry && (await createTaskmasterClient(taskmasterDir(root, runId)).list()).some((t) => t.phase === "explore" && t.assignee === "qa-web-explorer" && t.status === "done");
      carried = carry && explorerDone;
      open = await reopenPhaseTasks(root, runId, state, phases, ts, carried ? (t) => t.phase === "explore" && t.assignee === "qa-web-explorer" : undefined);
    }
```

and after `reopenPhases(open, reopen, gate)` computes the phases for the written state, set `phases.explore = { ...phases.explore, status: "pending", carried: true }` when `carried` (keep `identity` of the earlier record). Add `reExplore?: boolean` to `DecideGateInput`, `--re-explore` to `gate decide` (hidden from the usage when false), `CLI_USAGE["gate.decide"]` gets `[--re-explore]`.

`phases.ts`: in `barrierProblems`, for `phase === "explore"` add `if (state.phases["explore"]?.carried === true) problems.push("carried-over discovery has not been verified: run the explore probe (it compares the running app with discovery-report.json and reopens the explorer when the app changed)");`. In `completePhase`, when `id === "explore"` completes, record `identity: appIdentity(<target dir>, [<aegis dir relative to the target>])` in the phase record (the same value the probe records), so the next probe has a reference.

- [ ] **Step 4: Run the tests, the whole suite and align**

Run: `pnpm build && cd __internal-tests__ && npx jest explore-carry explore-probe run-state-gates cli-phase-gate hooks-final-wave && cd .. && pnpm test && pnpm typecheck && pnpm test:smoke && pnpm aegis align`
Expected: PASS, ratchet 207.

- [ ] **Step 5: Commit**

```bash
git add packages apps __internal-tests
git commit -m "feat(gate): a rejection carries the web-explorer discovery over until the probe verifies it"
```

---

### Task 4: The real page fetcher, `aegis explore probe`, and the agent procedure

**Files:**
- Create: `apps/cli/src/commands/explore.ts`, `apps/cli/src/explore-fetcher.ts`
- Modify: `apps/cli/src/program.ts`, `.claude/agents/orchestrator/qa-orchestrator.md` (Explore step and Contract `cli:`), `.claude/agents/tier1-phase/qa-web-explorer.md` (diff mode with a page list; Contract), `HANDBOOK/04-stlc-walkthrough.md` (one paragraph), `CLAUDE.md` (the `gate decide --re-explore` flag in the in-chat commands list if gate decide is listed, and `reports/explore/` in the run tree)
- Test: `__internal-tests__/explore-cli.test.ts` (create; help and refusal paths through the built CLI; the real fetcher is verified by hand, see Step 5)

**Interfaces:**
- Consumes: `probeExplore`, `PageFetcher` (Task 2).
- Produces: `aegis explore probe [--run <id>]` and `makePlaywrightFetcher(opts): Promise<PageFetcher>`.

- [ ] **Step 1: Write the failing test**

Through the built CLI (pattern: `__internal-tests__/cli-lenient-input.test.ts`): `explore probe --help` exits 0 and lists no choices; a run whose Explore is not carried refuses with `discovery is not carried over`; an unknown caller (`qa-ui-specialist`) is refused with `caller-forbidden`. The A16 test (`hooks-final-wave`) must still pass with `explore.probe` in `CLI_COMMANDS` and `CLI_USAGE`.

- [ ] **Step 2: Run it to see it fail**

Run: `cd __internal-tests__ && npx jest explore-cli`
Expected: FAIL (no `explore` command).

- [ ] **Step 3: The fetcher**

`apps/cli/src/explore-fetcher.ts`: resolves Playwright from the TARGET (never a dependency of this repo): `createRequire(join(targetDir, "package.json")).resolve("playwright")`, falling back to `@playwright/test`; if neither resolves, throw `RunStateError("invalid-input", "playwright is not installed in the target: install it (the environment engineer does) or explore in full")`. It opens one headless Chromium and, per role, one context with the role's storage state (`tests/qa/state/{role}.json`; `public` has none). `visit({role, route})`:

```ts
const page = await context.newPage();
let errors = 0;
page.on("console", (m) => { if (m.type() === "error") errors++; });
page.on("pageerror", () => { errors++; });
const resp = await page.goto(new URL(route, baseURL).toString(), { waitUntil: "load", timeout: 15_000 });
await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
const signature = {
  role, route,
  finalPath: new URL(page.url()).pathname,
  status: resp?.status() ?? null,
  title: await page.title(),
  headings: await page.$$eval("h1,h2", (hs) => hs.map((h) => `${h.tagName}:${(h.textContent ?? "").trim()}`)),
  testidCount: await page.locator("[data-testid]").count(),
  consoleErrors: errors,
};
await page.close();
return signature; // a navigation error is returned as { role, route, error }
```

Headings use the same `H1:text` form as the discovery report (check one real `discovery-report.json`: `"headings": ["H1:Welcome ..."]`; the comparison normalises digits). Read-only: only `goto`, no clicks, no form input. The base URL is `aegis.config.json#environments.{env}.url` of the run's environment; a missing or env-variable URL (`${TESTING_PREVIEW_URL}`) that does not resolve is an error naming the variable. Concurrency 1 (the explorer crawled the same pages one at a time; keep it gentle on a dev server).

`apps/cli/src/commands/explore.ts`:

```ts
import { Command } from "commander";
import { probeExplore } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";
import { makePlaywrightFetcher } from "../explore-fetcher.js";

export function exploreCommand(): Command {
  const explore = new Command("explore").description("Verify that the stored discovery still matches the running app");
  explore
    .command("probe")
    .description("Re-visit every recorded page as its role (read-only), compare with discovery-report.json and decide: reuse, partial (changed pages only) or full")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action(async (o: { run?: string }) => {
        const ctx = context();
        const runId = runIdFor(ctx, o.run);
        const fetcher = await makePlaywrightFetcher(ctx.root, runId);
        return probeExplore(ctx.root, runId, ctx.caller, fetcher);
      })
    );
  return explore;
}
```

Register it in `program.ts`.

- [ ] **Step 4: The procedure**

`qa-orchestrator.md`, Explore step: after Env-auth and before dispatching the explorer, when the run's Explore is carried (the CLI status shows the Explore phase `carried`), run the probe (Contract `cli:` gets `explore.probe`) and follow its decision: `reuse` — dispatch no explorer task; add the per-story exploratory tasks only for stories that are new or whose text changed since the earlier round; `partial` — the explorer task is already reopened: put `reports/explore/probe.json#changedPages` in its brief and tell it to run its diff mode over exactly those pages; `full` — the explorer task is reopened: it explores in full. The owner forces a full explore with the gate decision flag for a full explore, or by reopening the Explore phase itself. In `qa-web-explorer.md`: one paragraph: given a changed-page list in the brief, crawl only those pages and their new links and merge into discovery-report.json (the file keeps every other page entry as recorded); no list: full BFS as today. HANDBOOK/04: one paragraph (the carry-over, the probe's fields, the three decisions, the owner flag). No backticked `aegis ...` command outside a contract; the align ratchet must stay 207.

- [ ] **Step 5: Run the whole gate, then verify the fetcher by hand once**

Run: `pnpm build && pnpm test && pnpm typecheck && pnpm test:smoke && pnpm aegis align`
Expected: PASS, ratchet 207.

Manual check (record the result in the PR description): against a target with Playwright installed and a running dev server, copy a finished run's `discovery-report.json` and storage states into a scratch aegis root, mark Explore carried, run `aegis explore probe`: it must return `reuse` for an untouched app, and `partial` after you edit a page title in the target (or `full` with the server stopped). If a real page differs only by data (a list with other rows), it must stay `same`.

- [ ] **Step 6: Commit**

```bash
git add apps packages .claude HANDBOOK CLAUDE.md __internal-tests
git commit -m "feat(cli): aegis explore probe with a Playwright page fetcher, and the orchestrator procedure"
```

---

## Self-review

- Spec/decision coverage: reuse unless the version changed or the owner asks (Tasks 2-3, `--re-explore`), version judged by behaviour with source and environment identity as hints (Tasks 1-2), unknown means re-explore (Task 2 `full`), the Vault case (Task 1 test, Review Focus), secrets only hashed (Task 1).
- Placeholders: the Task 2 and 3 tests name their setup helpers and give the assertions; their bodies reuse the existing gate and lint test helpers by name, as the earlier plans did. No step says "add handling" without code or an exact edit.
- Types: `PageSignature`, `ObservedPage`, `ProbeDiff`, `ProbeDecision`, `AppIdentity`, `PageFetcher`, `ProbeResult`, `probeExplore`, `reopenPhaseTasks(..., keep)` are used with the same names across tasks.

## Known limits (stated, not hidden)

- The probe sees what a page shows on load: a change visible only after an interaction (a modal, a form step) or only in an API response is not seen; Execution still tests behaviour, and the exploratory sessions still run for new or changed stories.
- A new route reachable only from an unchanged page is not discovered by the probe (the explorer finds it when it runs; the probe compares recorded pages only). A later slice can record each page's link set.
- The per-story exploratory tasks are not made conditional by this plan beyond the orchestrator's instruction; a story hash that skips unchanged stories is a later slice.
- Only the web-explorer task is carried over; a rejection that reopens Explore itself, or Scan with a changed profile that the owner wants re-explored, uses the owner flag.
