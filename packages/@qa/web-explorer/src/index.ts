import { chromium } from '@playwright/test';

export interface ExplorerConfig {
  entryPoints: string[];       // URLs to start BFS from
  baseUrl: string;
  maxDepth: number;            // default 5
  maxPages: number;            // default 100
  rolesToExplore: string[];    // auth roles to crawl as
  captureScreenshots: boolean;
  skipPatterns: string[];      // glob-style URL patterns to skip
  destructiveHeuristics: boolean; // detect+skip "Delete", "Confirm" etc.
}

export interface DiscoveredPage {
  url: string;
  route: string;               // parameterised e.g. "/users/[id]"
  title: string;
  headings: string[];
  forms: Array<{
    fields: Array<{ label: string; type: string; name: string; testId?: string }>;
  }>;
  testIds: string[];           // all data-testid values found
  consoleErrors: string[];
  brokenImages: string[];      // src of 404 images
  screenshotPath?: string;
  depth: number;
  role: string;
}

export interface DiscoveryReport {
  runId: string;
  generatedAt: string;
  config: ExplorerConfig;
  pages: DiscoveredPage[];
  userJourneys: Array<{
    name: string;
    steps: string[];           // URL sequence
  }>;
  missingTestIds: Array<{
    url: string;
    element: string;
  }>;
  uiDefects: Array<{
    url: string;
    kind: 'console-error' | 'broken-image' | 'layout-overflow' | 'a11y';
    description: string;
  }>;
  pomSkeletons: Array<{
    route: string;
    outputPath: string;
    content: string;
  }>;
}

// ---------- helpers ----------

/**
 * Detect if a URL looks destructive (should be skipped during crawl).
 * Checks for "delete", "destroy", "remove", "confirm", "approve" in the path.
 */
export function isDestructiveUrl(url: string, heuristics: boolean): boolean {
  if (!heuristics) return false;
  const DESTRUCTIVE_PATTERNS = /\b(delete|destroy|remove|confirm|approve)\b/i;
  try {
    const { pathname } = new URL(url);
    return DESTRUCTIVE_PATTERNS.test(pathname);
  } catch {
    return DESTRUCTIVE_PATTERNS.test(url);
  }
}

/**
 * Convert a URL pathname to a POM class name.
 * e.g. "/auth/login" → "AuthLoginPage", "/dashboard" → "DashboardPage"
 */
export function urlToClassName(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }

  const parts = pathname
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
    .map((segment) =>
      // Strip leading non-alpha chars (e.g. "[id]" → "Id") and capitalise
      segment
        .replace(/[^a-zA-Z0-9]/g, ' ')
        .trim()
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(''),
    );

  if (parts.length === 0) return 'HomePage';
  return parts.join('') + 'Page';
}

/**
 * Parameterise a URL pathname:
 *   /users/123/posts/456      → /users/[id]/posts/[id]
 *   /users/550e8400-e29b-...  → /users/[uuid]
 */
function parameteriseRoute(pathname: string): string {
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const NUM_RE = /^\d+$/;

  return pathname
    .split('/')
    .map((segment) => {
      if (UUID_RE.test(segment)) return '[uuid]';
      if (NUM_RE.test(segment)) return '[id]';
      return segment;
    })
    .join('/');
}

/**
 * Check if a URL matches any of the skip patterns.
 * Patterns may be simple glob-style strings (only * supported).
 */
function matchesSkipPattern(url: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    // Escape regex special chars except *
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(escaped).test(url);
  });
}

/**
 * Generate a POM skeleton TypeScript file content for a discovered page.
 *
 * Produces something like:
 *   import { Page } from '@playwright/test';
 *   export class LoginPage {
 *     constructor(private page: Page) {}
 *     readonly emailInput = () => this.page.getByTestId('login-form-email-input');
 *     ...
 *     async goto() { await this.page.goto('/login'); }
 *   }
 */
export function generatePomSkeleton(page: DiscoveredPage, className: string): string {
  const getters = page.testIds
    .map((id) => {
      // Convert testId to a camelCase property name
      const propName = id
        .replace(/[^a-zA-Z0-9]+(.)/g, (_, char: string) => char.toUpperCase())
        .replace(/^[A-Z]/, (c) => c.toLowerCase());
      return `  readonly ${propName} = () => this.page.getByTestId('${id}');`;
    })
    .join('\n');

  const route = page.route;

  return [
    `import { Page } from '@playwright/test';`,
    ``,
    `export class ${className} {`,
    `  constructor(private page: Page) {}`,
    ``,
    ...(page.testIds.length > 0 ? [getters, ``] : []),
    `  async goto() { await this.page.goto('${route}'); }`,
    `}`,
  ].join('\n');
}

// ---------- main class ----------

export class WebExplorer {
  private readonly config: ExplorerConfig;

  constructor(config: ExplorerConfig) {
    this.config = {
      ...config,
      maxDepth: config.maxDepth ?? 5,
      maxPages: config.maxPages ?? 100,
    };
  }

  /**
   * Run the full BFS discovery and return a report.
   * Does NOT write files — caller writes the report and POM skeletons.
   */
  async explore(runId: string): Promise<DiscoveryReport> {
    const cfg = this.config;
    const browser = await chromium.launch({ headless: true });

    const allPages: DiscoveredPage[] = [];
    const uiDefects: DiscoveryReport['uiDefects'] = [];

    try {
      for (const role of cfg.rolesToExplore.length > 0 ? cfg.rolesToExplore : ['anonymous']) {
        const context = await browser.newContext();

        // BFS queue: { url, depth }
        type QueueItem = { url: string; depth: number };
        const queue: QueueItem[] = cfg.entryPoints.map((u) => ({ url: u, depth: 0 }));
        const visited = new Set<string>();

        while (queue.length > 0 && allPages.length < cfg.maxPages) {
          const item = queue.shift();
          if (!item) break;
          const { url, depth } = item;

          // Normalise URL
          let normalised: string;
          try {
            normalised = new URL(url, cfg.baseUrl).href;
          } catch {
            continue;
          }

          if (visited.has(normalised)) continue;
          if (matchesSkipPattern(normalised, cfg.skipPatterns)) continue;
          if (isDestructiveUrl(normalised, cfg.destructiveHeuristics)) continue;

          visited.add(normalised);

          const playwrightPage = await context.newPage();

          // Collect console errors
          const consoleErrors: string[] = [];
          playwrightPage.on('console', (msg) => {
            if (msg.type() === 'error') {
              consoleErrors.push(msg.text());
            }
          });

          // Collect broken images
          const brokenImages: string[] = [];
          playwrightPage.on('response', (response) => {
            const reqUrl = response.url();
            if (
              response.status() === 404 &&
              /\.(png|jpe?g|gif|svg|webp|ico)(\?.*)?$/i.test(reqUrl)
            ) {
              brokenImages.push(reqUrl);
            }
          });

          try {
            await playwrightPage.goto(normalised, { waitUntil: 'networkidle', timeout: 30_000 });
          } catch {
            await playwrightPage.close();
            continue;
          }

          // --- collect page data ---
          const title = await playwrightPage.title();

          const headings = await playwrightPage.evaluate(() => {
            const els = Array.from(document.querySelectorAll('h1, h2, h3'));
            return els.map((el) => (el as HTMLElement).innerText.trim()).filter(Boolean);
          });

          const testIds = await playwrightPage.evaluate(() => {
            const els = Array.from(document.querySelectorAll('[data-testid]'));
            return els
              .map((el) => el.getAttribute('data-testid') ?? '')
              .filter(Boolean);
          });

          const forms = await playwrightPage.evaluate(() => {
            return Array.from(document.querySelectorAll('form')).map((form) => {
              const inputs = Array.from(
                form.querySelectorAll('input, select, textarea'),
              );
              const fields = inputs.map((input) => {
                const el = input as HTMLInputElement;
                const name = el.name ?? el.id ?? '';
                const type = el.type ?? el.tagName.toLowerCase();
                const testId = el.dataset['testid'] ?? undefined;

                // Try to find an associated label
                let label = '';
                if (el.id) {
                  const labelEl = document.querySelector(`label[for="${el.id}"]`);
                  if (labelEl) label = (labelEl as HTMLElement).innerText.trim();
                }
                if (!label) {
                  const parentLabel = el.closest('label');
                  if (parentLabel) label = (parentLabel as HTMLElement).innerText.trim();
                }

                return { label, type, name, testId } as {
                  label: string;
                  type: string;
                  name: string;
                  testId?: string;
                };
              });
              return { fields };
            });
          });

          // Screenshot
          let screenshotPath: string | undefined;
          if (cfg.captureScreenshots) {
            const safeName = normalised.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 100);
            screenshotPath = `screenshots/${runId}/${role}/${safeName}.png`;
            await playwrightPage.screenshot({ path: screenshotPath, fullPage: true });
          }

          // Collect outbound links for BFS
          const links = await playwrightPage.evaluate((baseUrl: string) => {
            return Array.from(document.querySelectorAll('a[href]'))
              .map((a) => (a as HTMLAnchorElement).href)
              .filter((href) => {
                try {
                  return new URL(href).origin === new URL(baseUrl).origin;
                } catch {
                  return false;
                }
              });
          }, cfg.baseUrl);

          await playwrightPage.close();

          // Build discovered page record
          const urlObj = new URL(normalised);
          const route = parameteriseRoute(urlObj.pathname);

          const discoveredPage: DiscoveredPage = {
            url: normalised,
            route,
            title,
            headings,
            forms,
            testIds,
            consoleErrors,
            brokenImages,
            ...(screenshotPath !== undefined && { screenshotPath }),
            depth,
            role,
          };

          allPages.push(discoveredPage);

          // Record UI defects
          for (const err of consoleErrors) {
            uiDefects.push({
              url: normalised,
              kind: 'console-error',
              description: err,
            });
          }
          for (const src of brokenImages) {
            uiDefects.push({
              url: normalised,
              kind: 'broken-image',
              description: `Broken image: ${src}`,
            });
          }

          // Enqueue child links
          if (depth < cfg.maxDepth) {
            for (const link of links) {
              let normLink: string;
              try {
                normLink = new URL(link).href;
              } catch {
                continue;
              }
              if (!visited.has(normLink)) {
                queue.push({ url: normLink, depth: depth + 1 });
              }
            }
          }
        }

        await context.close();
      }
    } finally {
      await browser.close();
    }

    // --- derive higher-level data from collected pages ---

    // Missing testIds: interactive elements (buttons, inputs) without data-testid
    const missingTestIds: DiscoveryReport['missingTestIds'] = allPages.flatMap((p) =>
      p.forms.flatMap((form) =>
        form.fields
          .filter((f) => !f.testId)
          .map((f) => ({
            url: p.url,
            element: `${f.type}[name="${f.name}"]`,
          })),
      ),
    );

    // Simple user journeys: group pages by role
    const userJourneys: DiscoveryReport['userJourneys'] = cfg.rolesToExplore.map((role) => ({
      name: `${role} journey`,
      steps: allPages.filter((p) => p.role === role).map((p) => p.url),
    }));

    // POM skeletons
    const seenRoutes = new Set<string>();
    const pomSkeletons: DiscoveryReport['pomSkeletons'] = [];
    for (const p of allPages) {
      if (seenRoutes.has(p.route)) continue;
      seenRoutes.add(p.route);
      const className = urlToClassName(p.route);
      const content = generatePomSkeleton(p, className);
      const outputPath = `poms/${className}.ts`;
      pomSkeletons.push({ route: p.route, outputPath, content });
    }

    return {
      runId,
      generatedAt: new Date().toISOString(),
      config: cfg,
      pages: allPages,
      userJourneys,
      missingTestIds,
      uiDefects,
      pomSkeletons,
    };
  }
}
