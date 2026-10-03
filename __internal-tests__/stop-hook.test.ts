import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appendLedger } from '@qa/path-guard';
import { addTask, claimTask } from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { hookStale, REPO, runHook } from './helpers/hooks';

const stale = hookStale();
if (stale) console.warn(`stop-hook skipped: ${stale} (run pnpm build)`);
const test = stale ? it.skip : it;

let t: TmpAegis;
afterEach(() => t.cleanup());

const UI = 'qa-ui-specialist';
const systemMessage = (stdout: string): string => (JSON.parse(stdout.trim()) as { systemMessage: string }).systemMessage;

test('the SubagentStop hook exits 2 with the reason for a worker without a work report, 0 otherwise', async () => {
  t = makeAegisRoot();
  const runId = await startedRun(t.root);
  await addTask(t.root, runId, { id: 'T-1', title: 'one', agent: UI }, 'qa-test-executor');
  // H1 logs the claim in PreToolUse, before the CLI claim runs.
  appendLedger(t.root, runId, { ts: new Date().toISOString(), agentId: 'a1', agentType: UI, kind: 'claim', taskId: 'T-1' });
  await claimTask(t.root, runId, 'T-1', UI);
  const blocked = runHook('require-work-report', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: UI, stop_hook_active: false }, t.root);
  expect(blocked.status).toBe(2);
  expect(blocked.stderr).toMatch(/aegis stop check: task T-1/);
  expect(runHook('require-work-report', { hook_event_name: 'SubagentStop', agent_id: 'b1', agent_type: 'Explore' }, t.root).status).toBe(0);
});

test('the caller signal is agent_id: agent_type alone is the main thread, which is never held', async () => {
  t = makeAegisRoot();
  const runId = await startedRun(t.root);
  await addTask(t.root, runId, { id: 'T-1', title: 'one', agent: UI }, 'qa-test-executor');
  appendLedger(t.root, runId, { ts: new Date().toISOString(), agentId: 'a1', agentType: UI, kind: 'claim', taskId: 'T-1' });
  await claimTask(t.root, runId, 'T-1', UI);
  const main = runHook('require-work-report', { hook_event_name: 'SubagentStop', agent_type: UI }, t.root);
  expect(main).toMatchObject({ status: 0, stderr: '' });
  expect(runHook('require-work-report', 'not json', t.root).status).toBe(0);
});

test('a guard error fails open: exit 0 with a systemMessage, never exit 1', () => {
  t = makeAegisRoot();
  // runs/.active as a directory makes reading the active run throw (EISDIR).
  fs.mkdirSync(path.join(t.root, 'runs', '.active'), { recursive: true });
  const r = runHook('require-work-report', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: UI }, t.root);
  expect(r.status).toBe(0);
  expect(systemMessage(r.stdout)).toMatch(/aegis stop check: internal error .*stop allowed/);
});

test('without the build the hook fails open with a systemMessage (decision 3)', () => {
  t = makeAegisRoot();
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-nobuild-'));
  try {
    const script = path.join(fake, 'scripts', 'hooks', 'require-work-report.mjs');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'scripts', 'hooks', 'require-work-report.mjs'), script);
    const r = runHook('require-work-report', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: UI }, t.root, { script });
    expect(r.status).toBe(0);
    expect(systemMessage(r.stdout)).toMatch(/aegis stop check unavailable .*pnpm install/);
  } finally {
    fs.rmSync(fake, { recursive: true, force: true });
  }
});
