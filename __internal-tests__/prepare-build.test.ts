import * as fs from 'fs';
import * as path from 'path';

const REPO = path.join(__dirname, '..');
const pkg = (rel: string) => JSON.parse(fs.readFileSync(path.join(REPO, rel, 'package.json'), 'utf-8')) as { name: string; scripts?: Record<string, string>; dependencies?: Record<string, string> };

/** Workspace packages `name` depends on, transitively (workspace: protocol only). */
function closure(dir: string, seen = new Set<string>()): Set<string> {
  for (const [dep, range] of Object.entries(pkg(dir).dependencies ?? {})) {
    if (!range.startsWith('workspace:') || seen.has(dep)) continue;
    seen.add(dep);
    closure(path.join('packages', dep), seen);
  }
  return seen;
}

it('the root prepare script builds the CLI and its workspace dependencies (CO-11)', () => {
  expect(pkg('.').scripts?.['prepare']).toBe('pnpm --filter "@aegis-qa/cli..." run build');
});

it('A17: the prepare filter names the CLI package (apps/cli) and pnpm is pinned, so prepare runs', () => {
  const filter = /--filter "([^"]+)\.\.\."/.exec(pkg('.').scripts?.['prepare'] ?? '')?.[1];
  expect(filter).toBe(pkg(path.join('apps', 'cli')).name);
  // .npmrc sets ignore-scripts=true; the pinned pnpm still runs the root prepare (Task 12), an unpinned one may not.
  expect((pkg('.') as { packageManager?: string }).packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
});

it('every package a hook script loads is built by prepare', () => {
  const built = closure(path.join('apps', 'cli'));
  const imported = new Set<string>();
  for (const f of fs.readdirSync(path.join(REPO, 'scripts', 'hooks')).filter((x) => x.endsWith('.mjs'))) {
    for (const m of fs.readFileSync(path.join(REPO, 'scripts', 'hooks', f), 'utf-8').matchAll(/packages\/@qa\/([a-z0-9-]+)\/dist\//g)) imported.add(`@qa/${m[1]}`);
  }
  expect(imported.size).toBeGreaterThan(0);
  expect([...imported].filter((p) => !built.has(p))).toEqual([]);
});
