import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
export interface ResponseLike {
  status(): number;
  url(): string;
}
export interface RouteLike {
  request(): { url(): string; isNavigationRequest(): boolean; frame(): unknown };
  abort(): Promise<void>;
  continue(): Promise<void>;
}
export interface PageLike {
  on(event: "console" | "pageerror" | "response", listener: (arg: never) => void): unknown;
  /** Absent on a fake page: no request is intercepted. */
  route?(pattern: string, handler: (route: RouteLike) => unknown): Promise<void>;
  mainFrame?(): unknown;
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
}
interface ChromiumLike {
  launch(options: { headless: boolean }): Promise<BrowserLike>;
}

export const PLAYWRIGHT_MISSING = "playwright is not installed in the target";
/** How long the fetcher waits for the browser to close before the call goes on without it. */
export const BROWSER_CLOSE_MS = 5_000;
/** The hard cap of one visit (context, page, navigation, reads and close): one stuck renderer cannot eat the probe's budget. */
export const VISIT_CAP_MS = 25_000;
const OUTSIDE = "outside the environment origin";
export const VISIT_CAPPED = "the visit exceeded its time cap";
export const REDIRECTED_OUTSIDE = "redirected outside the environment origin";
export const STATE_OUTSIDE = "the storage state of this role is not a file inside the target";
export const CONTEXT_FAILED = "the browser context of this role could not be created (storage state missing or unreadable)";

/** Resolves a module id from a directory (createRequire from that directory's package.json); throws when it does not resolve. */
export type ModuleResolver = (fromDir: string, id: string) => string;
/**
 * A module counts as installed in the target only when some directory of the target's parent chain has it in its own node_modules
 * (the path before any symlink is followed: a pnpm store outside the target is fine). NODE_PATH and the global folders (pnpm sets
 * NODE_PATH to this repo's own store when it runs a script) never count. It is then resolved from the target, which finds that copy
 * first.
 */
const nodeResolver: ModuleResolver = (fromDir, id) => {
  let installed = false;
  for (let d = resolve(fromDir); ; d = dirname(d)) {
    if (existsSync(join(d, "node_modules", ...id.split("/"), "package.json"))) {
      installed = true;
      break;
    }
    if (dirname(d) === d) break;
  }
  if (!installed) throw new Error(`${id} is not installed in the target`);
  return createRequire(join(fromDir, "package.json")).resolve(id);
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

/** A role's storage state: an absolute path inside the target, none (unauthenticated), or why it is refused (a fixed message). */
export type RoleState = { storageState: string | null } | { error: string };

/**
 * Role -> storage state from the run's env-auth-report.json (`roles[].storageState`). The path must be relative to the target and stay
 * inside it (no absolute path, no `..`); any other value makes every page of that role unobserved with STATE_OUTSIDE. A role entry without
 * one is unauthenticated; a role listed twice uses the first entry that names a storage state. A missing or unreadable report gives no role.
 */
export function storageStates(root: string, runId: string, targetDir: string): Map<string, RoleState> {
  const out = new Map<string, RoleState>();
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(join(runDir(root, runId), "env-auth-report.json"), "utf-8"));
  } catch {
    return out;
  }
  const roles = report !== null && typeof report === "object" ? (report as Record<string, unknown>)["roles"] : undefined;
  if (!Array.isArray(roles)) return out;
  const target = resolve(targetDir);
  for (const entry of roles) {
    if (entry === null || typeof entry !== "object") continue;
    const role = (entry as Record<string, unknown>)["role"];
    const state = (entry as Record<string, unknown>)["storageState"];
    if (typeof role !== "string" || role === "") continue;
    let value: RoleState;
    if (typeof state !== "string" || state === "") value = { storageState: null };
    else {
      const abs = resolve(target, state);
      const rel = relative(target, abs);
      const inside = !isAbsolute(state) && rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
      value = inside ? { storageState: abs } : { error: STATE_OUTSIDE };
    }
    const had = out.get(role);
    if (had === undefined || ("storageState" in had && had.storageState === null && !("storageState" in value && value.storageState === null))) out.set(role, value);
  }
  return out;
}

/** The first line of an error: Playwright appends a multi-line call log. */
const firstLine = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.trim();

/** `work`, or `onTimeout` after `ms`; the timer never keeps the process alive. */
async function capped<T>(work: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((res) => {
    timer = setTimeout(() => res(onTimeout), Math.max(0, ms));
    timer.unref();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const originOf = (u: string): string | null => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

export interface VisitOptions {
  /** Hard cap of the whole visit (default VISIT_CAP_MS). */
  capMs?: number;
}

/**
 * Visits one page read-only: the only navigation is `goto` of a same-origin address. A main-frame navigation to another origin is
 * aborted (a server redirect is not interceptable, so the final address is checked too): a page that ends on another origin is read
 * not at all and returns REDIRECTED_OUTSIDE, which compares as failed, never as same. The final path is the pathname only (a redirect's
 * query or fragment can carry a token). Console errors, page errors and same-origin responses with status 500 or more (as
 * `response <status>`, without the address) are the error signals. The whole visit is capped; any failure is an error observation.
 */
export async function visitPage(newPage: () => Promise<PageLike>, ref: PageRef, baseURL: string, opts: VisitOptions = {}): Promise<RawObservation> {
  const { role, url } = ref;
  let target: URL;
  try {
    target = new URL(url, baseURL);
  } catch {
    return { role, url, error: "invalid page address" };
  }
  const origin = new URL(baseURL).origin;
  if (target.origin !== origin) return { role, url, error: OUTSIDE };
  const capMs = opts.capMs ?? VISIT_CAP_MS;
  let page: PageLike | undefined;
  let finished = false;
  const work = async (): Promise<RawObservation> => {
    try {
      page = await newPage();
    } catch (e) {
      return { role, url, error: firstLine(e) };
    }
    // The cap may have passed while the page was being created: close it and stop.
    if (finished) {
      page.close().catch(() => undefined);
      return { role, url, error: VISIT_CAPPED };
    }
    const p = page;
    let leftOrigin = false;
    const consoleErrors: string[] = [];
    p.on("console", ((m: ConsoleMessageLike) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    }) as (arg: never) => void);
    p.on("pageerror", ((e: Error) => consoleErrors.push(e.message)) as (arg: never) => void);
    p.on("response", ((r: ResponseLike) => {
      if (r.status() >= 500 && originOf(r.url()) === origin) consoleErrors.push(`response ${r.status()}`);
    }) as (arg: never) => void);
    try {
      if (p.route !== undefined) {
        const main = p.mainFrame?.();
        await p.route("**/*", (route) => {
          const req = route.request();
          let mainNav = false;
          try {
            mainNav = req.isNavigationRequest() && (main === undefined || req.frame() === main);
          } catch {
            // a service-worker request has no frame
          }
          if (mainNav && originOf(req.url()) !== origin) {
            leftOrigin = true;
            return route.abort().catch(() => undefined);
          }
          return route.continue().catch(() => undefined);
        });
      }
      let resp: { status(): number } | null;
      try {
        resp = await p.goto(target.toString(), { waitUntil: "load", timeout: 15_000 });
      } catch (e) {
        if (leftOrigin) return { role, url, error: REDIRECTED_OUTSIDE };
        throw e;
      }
      if (leftOrigin || originOf(p.url()) !== origin) return { role, url, error: REDIRECTED_OUTSIDE };
      await p.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => undefined);
      if (leftOrigin || originOf(p.url()) !== origin) return { role, url, error: REDIRECTED_OUTSIDE };
      const testids = await p.$$eval("[data-testid]", (els) => els.map((e) => e.getAttribute("data-testid") ?? ""));
      return {
        role,
        url,
        finalPath: new URL(p.url()).pathname,
        status: resp?.status() ?? null,
        title: await p.title(),
        h1: (await p.locator("h1").first().textContent({ timeout: 1_000 }).catch(() => null)) ?? "",
        testids: [...new Set(testids)],
        consoleErrors: [...consoleErrors],
      };
    } catch (e) {
      return { role, url, error: firstLine(e) };
    } finally {
      await p.close().catch(() => undefined);
    }
  };
  const result = await capped(work(), capMs, { role, url, error: VISIT_CAPPED });
  finished = true;
  if ("error" in result && result.error === VISIT_CAPPED) page?.close().catch(() => undefined);
  return result;
}

/**
 * Closes the browser, waiting at most `ms`; never throws. A browser from launch() exposes no process handle, so nothing is killed here:
 * the guarantee that a hung browser does not outlive the call is the explore command's process.exit after it printed its result, and
 * Playwright's own exit handler, which kills the browser processes it launched when the Node process exits.
 */
export async function closeBrowser(browser: BrowserLike, ms: number = BROWSER_CLOSE_MS): Promise<void> {
  await capped(Promise.resolve().then(() => browser.close()).catch(() => undefined), ms, undefined);
}

export interface FetcherDeps {
  /** Loads the Playwright module from its resolved path (default: dynamic import). */
  load?: (modulePath: string) => Promise<unknown>;
  resolver?: ModuleResolver;
  closeMs?: number;
  visitCapMs?: number;
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
 * A role whose storage state is refused or cannot be loaded has every page unobserved, with a fixed message (never the file's text).
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
      const state = states.get(role) ?? { storageState: null };
      if ("error" in state) ctx = Promise.reject(new Error(state.error));
      else {
        const options = state.storageState === null ? { baseURL } : { baseURL, storageState: state.storageState };
        ctx = Promise.resolve()
          .then(() => browser.newContext(options))
          .catch(() => {
            throw new Error(CONTEXT_FAILED);
          });
      }
      ctx.catch(() => undefined);
      contexts.set(role, ctx);
    }
    return ctx;
  };
  return {
    visit: (ref) => visitPage(async () => (await contextOf(ref.role)).newPage(), ref, baseURL, deps.visitCapMs === undefined ? {} : { capMs: deps.visitCapMs }),
    close: () => closeBrowser(browser, deps.closeMs),
  };
}
