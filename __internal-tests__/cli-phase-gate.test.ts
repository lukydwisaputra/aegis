import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`cli-phase-gate skipped: ${stale} (run pnpm build)`);

let t: TmpAegis;
beforeEach(() => { t = makeAegisRoot(); });
afterEach(() => t.cleanup());

function aegis(agent: string, ...args: string[]) {
  const env = { ...process.env, AEGIS_AGENT: agent, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: t.root, encoding: 'utf-8', env });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr ? JSON.parse(r.stderr) : null };
}

(stale ? it.skip : it)('phase, gate and run commands print JSON and refuse with exit 2 (spec §4.1)', () => {
  expect(aegis('owner', 'run', 'create', '--env', 'development', '--module', 'AUTH', '--health', 'passed')).toMatchObject({ status: 0, out: { status: 'created', preflight: { health: 'passed' } } });
  expect(aegis('owner', 'run', 'status').out.next).toEqual({ kind: 'start-phase', phase: 'intake' });
  expect(aegis('qa-orchestrator', 'phase', 'start', '--phase', 'scan')).toMatchObject({ status: 2, err: { error: 'out-of-order' } });
  expect(aegis('owner', 'phase', 'start', '--phase', 'intake')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
  expect(aegis('qa-orchestrator', 'phase', 'start', '--phase', 'intake')).toMatchObject({ status: 0, out: { currentPhase: 'intake' } });
  expect(aegis('qa-orchestrator', 'phase', 'complete', '--phase', 'intake')).toMatchObject({ status: 0 });
  expect(aegis('owner', 'gate', 'decide', '--gate', '1', '--decision', 'approved', '--note', 'early')).toMatchObject({ status: 2, err: { error: 'out-of-order' } });
  expect(aegis('qa-orchestrator', 'gate', 'open', '--gate', 'G1')).toMatchObject({ status: 2, err: { error: 'out-of-order' } });
  expect(aegis('qa-orchestrator', 'run', 'complete')).toMatchObject({ status: 2, err: { error: 'out-of-order' } });
  expect(aegis('owner', 'escalation', 'decide', '--task', 'T-1', '--decision', 'retry', '--reason', 'x')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
  expect(fs.existsSync(path.join(t.root, 'runs'))).toBe(true);
}, 60_000);

(stale ? it.skip : it)('run reissue is an owner command of the built CLI: refused for an agent, reopens executive for the owner', () => {
  const runId = aegis('owner', 'run', 'create', '--env', 'development', '--module', 'AUTH').out.runId as string;
  expect(aegis('owner', 'run', 'reissue', '--phase', 'executive', '--reason', 'x')).toMatchObject({ status: 2, err: { error: 'out-of-order' } });
  // Leave the run the way `aegis run complete` does: every phase done, every gate approved.
  const file = path.join(t.root, 'runs', runId, 'run.json');
  const s = JSON.parse(fs.readFileSync(file, 'utf-8'));
  for (const id of Object.keys(s.phases)) s.phases[id] = { status: 'completed' };
  const approved = { status: 'approved', decisions: 1 };
  fs.writeFileSync(file, JSON.stringify({ ...s, status: 'completed', gates: { G1: approved, G2: approved, G3: approved } }));
  expect(aegis('qa-orchestrator', 'run', 'reissue', '--phase', 'executive', '--reason', 'x')).toMatchObject({ status: 2, err: { error: 'caller-forbidden' } });
  expect(aegis('owner', 'run', 'reissue', '--phase', 'executive')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
  expect(aegis('owner', 'run', 'reissue', '--phase', 'planning', '--reason', 'x')).toMatchObject({ status: 2, err: { error: 'invalid-input' } });
  const ok = aegis('owner', 'run', 'reissue', '--phase', 'executive', '--reason', 'Wording fix');
  expect(ok).toMatchObject({ status: 0, out: { status: 'running', next: { kind: 'start-phase', phase: 'executive' }, activeRun: runId, previousActiveRun: null } });
  expect(aegis('owner', 'run', 'status').out.next).toEqual({ kind: 'start-phase', phase: 'executive' });
  expect(aegis('owner', 'integrity', 'verify')).toMatchObject({ status: 0, out: { ok: true } });
  const log = fs.readFileSync(path.join(t.root, 'runs', runId, 'events.jsonl'), 'utf-8').trim().split('\n');
  expect(JSON.parse(log[log.length - 1]!)).toMatchObject({ type: 'run.reissued', phase: 'executive', reason: 'Wording fix', emittedBy: 'owner' });
}, 60_000);
