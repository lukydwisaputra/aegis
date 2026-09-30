import { spawnSync } from 'child_process';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');

it('the built aegis CLI runs align on this repo with exit 0 (run after pnpm build)', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'cli', 'dist', 'index.js'), 'align'], { cwd: ROOT, encoding: 'utf-8' });
  expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
  expect(r.stdout).toMatch(/^ratchet: ok$/m);
}, 60_000);
