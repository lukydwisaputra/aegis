import { spawnSync } from 'child_process';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';

const ROOT = path.join(__dirname, '..');

// Locally the smoke test needs a fresh `pnpm build`; skip with a reason rather than fail. CI always runs it.
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`align-cli-smoke skipped: ${stale} (run pnpm build)`);

(stale ? it.skip : it)('the built aegis CLI runs align on this repo with exit 0 (run after pnpm build)', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'cli', 'dist', 'index.js'), 'align'], { cwd: ROOT, encoding: 'utf-8' });
  expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
  expect(r.stdout).toMatch(/^ratchet: ok$/m);
}, 60_000);
