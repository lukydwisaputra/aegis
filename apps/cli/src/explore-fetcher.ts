import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { environmentBaseUrl, readRun, RunStateError, runDir, type PageFetcher, type PageRef, type RawObservation } from "@qa/run-state";

/**
 * The real page fetcher of the explore probe: one headless Chromium from the TARGET's Playwright (never a dependency of this repo), one
 * browser context per role with that role's storage state, and read-only GET navigation of one page at a time.
 * The Playwright surface it uses is typed structurally here, so a fake page can drive `visitPage` in a test.
 */

export interface ConsoleMessageLike {
  type(): string;
  text(): string;
}
export interface PageLike {
  on(event: "console" | "pageerror", listener: (arg: never) => void): unknown;
  goto(url: string, options: { waitUntil: "load"; timeout: number }): Promise<{ status(): number } | null>;
  waitForLoadState(state: "networkidle", options: { timeout: number }): Promise<void>;
  url(): string;
  title(): Promise<string>;
  locator(selector: string): { first(): { textContent(options: { timeout: number }): Promise<string | null> } };
  $$eval<R>(selector: string, fn: (els: Array<{ getAttribute(name: string): string | null }>) => R): Promise<R>;
  close(): Promise<void>;
}
interface ContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}
interface BrowserLike {
  newContext(options: { baseURL: string; storageState?: string }): Promise<ContextLike>;
  close(): Promise<void>;
  process?(): { kill(signal?: NodeJS.Signals): boolean } | null;
}
interface ChromiumLike {
  launch(options: { headless: boolean }): Promise<BrowserLike>;
}

export const PLAYWRIGHT_MISSING = "playwright is not installed in the target";
/** A browser that does not close in this time is killed, so the CLI process can end. */
export const BROWSER_CLOSE_MS = 5_000;
const OUTSIDE = "outside the environment origin";

/** Resolves a module id from a directory (createRequire from that directory's package.json); throws when it does not resolve. */
export type ModuleResolver = (fromDir: string, id: string) => string;
const realOrSame = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
/**
 * Node's resolution from `fromDir`, kept only when the module sits in a node_modules directory of `fromDir` or one of its parents:
 * NODE_PATH and the global folders (pnpm sets NODE_PATH to this repo's own store when it runs a script) never count as the target's.
 */
const nodeResolver: ModuleResolver = (fromDir, id) => {
  const found = createRequire(join(fromDir, "package.json")).resolve(id);
  const chain: string[] = [];
  for (let d = resolve(fromDir); ; d = dirname(d)) {
    chain.push(realOrSame(join(d, "node_modules")) + sep);
    if (dirname(d) === d) break;
  }
  if (!chain.some((nm) => found.startsWith(nm))) throw new Error(`${id} resolves outside the target`);
  return found;
};

/** The target's Playwright entry: `playwright`, else `@playwright/test`; neither resolving is refused with PLAYWRIGHT_MISSING. */
export function resolvePlaywright(targetDir: string, resolver: ModuleResolver = nodeResolver): string {
  for (const id of ["playwright", "@playwright/test"]) {
    try {
      return resolver(targetDir, id);
    } catch {
      // try the next one
    }
  }
  throw new RunStateError("invalid-input", PLAYWRIGHT_MISSING);
}

/** The target directory: aegis.config.json#targetProjectRoot (default `..`) resolved against the aegis root. */
export function targetDirOf(root: string): string {
  let target = "..";
  try {
    const cfg: unknown = JSON.parse(readFileSync(join(root, "aegis.config.json"), "utf-8"));
    const t = cfg !== null && typeof cfg === "object" ? (cfg as Record<string, unknown>)["targetProjectRoot"] : undefined;
    if (typeof t === "string" && t !== "") target = t;
  } catch {
    // the default
  }
  return resolve(root, target);
}

/**
 * Role -> absolute storage-state path from the run's env-auth-report.json (`roles[].storageState`, target-relative). A role entry
 * without one is unauthenticated (null); a role listed twice uses the first entry that names a storage state. A missing or unreadable
 * report gives no role.
 */
export function storageStates(root: string, runId: string, targetDir: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(join(runDir(root, runId), "env-auth-report.json"), "utf-8"));
  } catch {
    return out;
  }
  const roles = report !== null && typeof report === "object" ? (report as Record<string, unknown>)["roles"] : undefined;
  if (!Array.isArray(roles)) return out;
  for (const entry of roles) {
    if (entry === null || typeof entry !== "object") continue;
    const role = (entry as Record<string, unknown>)["role"];
    const state = (entry as Record<string, unknown>)["storageState"];
    if (typeof role !== "string" || role === "") continue;
    const path = typeof state === "string" && state !== "" ? resolve(targetDir, state) : null;
    if (!out.has(role) || (out.get(role) === null && path !== null)) out.set(role, path);
  }
  return out;
}

/** The first line of an error: Playwright appends a multi-line call log. */
const firstLine = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.trim();

/**
 * Visits one page read-only: the only navigation is `goto` of a same-origin address (another origin is never opened). The final path is
 * the pathname only (a redirect's query or fragment can carry a token); a failure becomes an error observation, never a throw.
 */
export async function visitPage(newPage: () => Promise<PageLike>, ref: PageRef, baseURL: string): Promise<RawObservation> {
  const { role, url } = ref;
  let target: URL;
  try {
    target = new URL(url, baseURL);
  } catch {
    return { role, url, error: "invalid page address" };
  }
  if (target.origin !== new URL(baseURL).origin) return { role, url, error: OUTSIDE };
  let page: PageLike;
  try {
    page = await newPage();
  } catch (e) {
    return { role, url, error: firstLine(e) };
  }
  const consoleErrors: string[] = [];
  page.on("console", ((m: ConsoleMessageLike) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  }) as (arg: never) => void);
  page.on("pageerror", ((e: Error) => consoleErrors.push(e.message)) as (arg: never) => void);
  try {
    const resp = await page.goto(target.toString(), { waitUntil: "load", timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    const testids = await page.$$eval("[data-testid]", (els) => els.map((e) => e.getAttribute("data-testid") ?? ""));
    return {
      role,
      url,
      finalPath: new URL(page.url()).pathname,
      status: resp?.status() ?? null,
      title: await page.title(),
      h1: (await page.locator("h1").first().textContent({ timeout: 1_000 }).catch(() => null)) ?? "",
      testids: [...new Set(testids)],
      consoleErrors,
    };
  } catch (e) {
    return { role, url, error: firstLine(e) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Settles `work` within `ms`; false when the time ran out. The timer never keeps the process alive. */
async function settlesWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((res) => {
    timer = setTimeout(() => res(false), ms);
    timer.unref();
  });
  try {
    return await Promise.race([work.then(() => true, () => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Closes the browser; one that does not close within `ms` has its process killed. Never throws. */
export async function closeBrowser(browser: BrowserLike, ms: number = BROWSER_CLOSE_MS): Promise<void> {
  const closed = await settlesWithin(Promise.resolve().then(() => browser.close()), ms);
  if (closed) return;
  try {
    browser.process?.()?.kill("SIGKILL");
  } catch {
    // already gone
  }
}

export interface FetcherDeps {
  /** Loads the Playwright module from its resolved path (default: dynamic import). */
  load?: (modulePath: string) => Promise<unknown>;
  resolver?: ModuleResolver;
  closeMs?: number;
}

function chromiumOf(mod: unknown): ChromiumLike {
  const m = mod as { chromium?: ChromiumLike; default?: { chromium?: ChromiumLike } } | null;
  const chromium = m?.chromium ?? m?.default?.chromium;
  if (chromium === undefined || typeof chromium.launch !== "function") throw new RunStateError("invalid-input", PLAYWRIGHT_MISSING);
  return chromium;
}

/**
 * The page fetcher of the run: the environment's base URL from aegis.config.json (an unresolved `${VAR}` is refused naming the
 * variable), Playwright resolved from the target, one headless Chromium and one context per role, created on the role's first page.
 */
export async function makePlaywrightFetcher(root: string, runId: string, deps: FetcherDeps = {}): Promise<PageFetcher> {
  const base = environmentBaseUrl(root, readRun(root, runId).environment);
  if ("error" in base) throw new RunStateError("invalid-input", base.error);
  const baseURL = base.url;
  const targetDir = targetDirOf(root);
  const modulePath = resolvePlaywright(targetDir, deps.resolver);
  const load = deps.load ?? ((p: string) => import(pathToFileURL(p).href));
  const chromium = chromiumOf(await load(modulePath));
  const states = storageStates(root, runId, targetDir);
  const browser = await chromium.launch({ headless: true });
  const contexts = new Map<string, Promise<ContextLike>>();
  const contextOf = (role: string): Promise<ContextLike> => {
    let ctx = contexts.get(role);
    if (ctx === undefined) {
      const storageState = states.get(role) ?? undefined;
      ctx = browser.newContext(storageState === undefined ? { baseURL } : { baseURL, storageState });
      contexts.set(role, ctx);
    }
    return ctx;
  };
  return {
    visit: (ref) => visitPage(async () => (await contextOf(ref.role)).newPage(), ref, baseURL),
    close: () => closeBrowser(browser, deps.closeMs),
  };
}
