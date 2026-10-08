import { spawnSync } from 'child_process';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { staleBuild } from '@qa/alignment';

const ROOT = path.join(__dirname, '..');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`pdf-renderer-jargon skipped: ${stale} (run pnpm build)`);
const DIST = pathToFileURL(path.join(ROOT, 'packages', '@qa', 'pdf-renderer', 'dist', 'index.js')).href;

/** applyJargonRewrites and detectJargon of the built renderer, which is an ES module jest cannot load directly. */
function tone(texts: string[]): Array<{ rewritten: string; found: string[] }> {
  const script =
    `import { applyJargonRewrites, detectJargon } from ${JSON.stringify(DIST)};` +
    `const texts = JSON.parse(process.argv[1]);` +
    `process.stdout.write(JSON.stringify(texts.map((t) => ({ rewritten: applyJargonRewrites(t), found: detectJargon(t).map((f) => f.original) }))));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(texts)], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

(stale ? describe.skip : describe)('JARGON_RULES act on words, not on letter runs', () => {
  it('rewrites jargon but leaves ordinary words alone', () => {
    const [ok, address, input, mixed] = tone([
      'DRE and the RTM show p95 latency 900ms; CLS, LCP, CVE-2024-1 and WCAG apply',
      'Please address the issue; the Android address book',
      'The INPUT field accepts text; INP is slow',
      'MTTR, MTTD, TTFB and FCP are tracked',
    ]) as [{ rewritten: string; found: string[] }, { rewritten: string; found: string[] }, { rewritten: string; found: string[] }, { rewritten: string; found: string[] }];
    expect(ok.rewritten).toBe('percentage of bugs caught before release and the test coverage map show the slowest 5% of requests take 900ms; visual layout stability, page load time, known security vulnerability-2024-1 and accessibility standard apply');
    expect(address.rewritten).toBe('Please address the issue; the Android address book');
    expect(address.found).toEqual([]);
    expect(input.rewritten).toBe('The INPUT field accepts text; user interaction speed is slow');
    expect(mixed.rewritten).toBe('average time to recover from an incident, average time to detect an issue, server response time and time until first content appears are tracked');
  });
});
