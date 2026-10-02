import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`cli-integrity skipped: ${stale} (run pnpm build)`);
const test = stale ? it.skip : it;

let t: TmpAegis;
beforeEach(() => { t = makeAegisRoot(); });
afterEach(() => t.cleanup());

function aegis(agent: string, ...args: string[]) {
  const env = { ...process.env, AEGIS_AGENT: agent, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: t.root, encoding: 'utf-8', env });
  const parse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
  return { status: r.status, out: parse(r.stdout), err: parse(r.stderr) };
}

test('run resume lists the acknowledged errors; run status keeps them as integrityWaived (CO-10)', () => {
  const runId = aegis('owner', 'run', 'create', '--env', 'development', '--module', 'AUTH').out.runId as string;
  expect(aegis('owner', 'run', 'stop', '--reason', 'pause').status).toBe(0);
  const bus = path.join(t.root, 'runs', runId, 'events.jsonl');
  fs.writeFileSync(bus, fs.readFileSync(bus, 'utf-8').replace('"environment":"development"', '"environment":"production"'));
  expect(aegis('owner', 'integrity', 'verify').status).toBe(2);
  const resumed = aegis('owner', 'run', 'resume', '--acknowledge-integrity', '--reason', 'reviewed manual edit');
  expect(resumed.status).toBe(0);
  expect(resumed.out.acknowledgedErrors.length).toBeGreaterThan(0);
  expect(resumed.out.acknowledgedErrors).toEqual(resumed.out.integrityAcknowledged.errors);
  expect(aegis('owner', 'run', 'status').out.integrityWaived).toEqual(resumed.out.acknowledgedErrors);
});

test('integrity repair-tail is an owner command of the built CLI (CO-02)', () => {
  const runId = aegis('owner', 'run', 'create', '--env', 'development', '--module', 'AUTH').out.runId as string;
  fs.appendFileSync(path.join(t.root, 'runs', runId, 'events.jsonl'), '{"seq":2');
  expect(aegis('qa-orchestrator', 'integrity', 'repair-tail')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
  expect(aegis('owner', 'integrity', 'repair-tail')).toMatchObject({ status: 0, out: { runId, removedBytes: 8 } });
  expect(aegis('owner', 'integrity', 'repair-tail')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
});
