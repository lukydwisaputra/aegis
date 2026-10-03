import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { busPath, recordCliRefusal } from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';

// P2c — NEW-06: the CLI records an agent's invalid-input or internal refusal as cli.refused (spec §4.12).
const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`cli-refused (built CLI) skipped: ${stale} (run pnpm build)`);

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = await startedRun(t.root);
});
afterEach(() => t.cleanup());

const lines = (): Array<Record<string, unknown>> =>
  fs.readFileSync(busPath(t.root, runId), 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>);
const refused = () => lines().filter((e) => e['type'] === 'cli.refused');

describe('recordCliRefusal', () => {
  it('appends one chained cli.refused line for an agent invalid-input refusal, message cut to 300 characters', async () => {
    await expect(recordCliRefusal(t.root, { caller: 'qa-ui-specialist' }, { command: 'task.claim', code: 'invalid-input', message: 'x'.repeat(400) })).resolves.toBe(true);
    const [line] = refused();
    expect(line).toMatchObject({ type: 'cli.refused', runId, emittedBy: 'qa-ui-specialist', command: 'task.claim', code: 'invalid-input', caller: 'qa-ui-specialist' });
    expect((line!['message'] as string).length).toBe(300);
    expect(typeof line!['seq']).toBe('number');
    expect(line!['caller']).toBe(line!['emittedBy']);
  });

  it('records the crash path (internal), on the run --run names', async () => {
    await expect(recordCliRefusal(t.root, { caller: 'qa-test-executor', run: runId }, { command: 'task.list', code: 'internal', message: 'boom' })).resolves.toBe(true);
    expect(refused()).toHaveLength(1);
  });

  it('records nothing for the owner, for other codes, or without a resolvable run', async () => {
    const before = lines().length;
    await expect(recordCliRefusal(t.root, { caller: 'owner' }, { command: 'run.create', code: 'invalid-input', message: 'typo' })).resolves.toBe(false);
    for (const code of ['cap-reached', 'caller-forbidden', 'barrier', 'busy']) {
      await expect(recordCliRefusal(t.root, { caller: 'qa-ui-specialist' }, { command: 'task.claim', code, message: 'm' })).resolves.toBe(false);
    }
    await expect(recordCliRefusal(t.root, { caller: 'qa-ui-specialist', run: 'RUN-20990101-001' }, { command: 'task.claim', code: 'invalid-input', message: 'm' })).resolves.toBe(false);
    fs.rmSync(path.join(t.root, 'runs', '.active'));
    await expect(recordCliRefusal(t.root, { caller: 'qa-ui-specialist' }, { command: 'task.claim', code: 'invalid-input', message: 'm' })).resolves.toBe(false);
    expect(lines()).toHaveLength(before);
  });

  it('a log it cannot append to (torn tail) records nothing and does not throw', async () => {
    fs.appendFileSync(busPath(t.root, runId), '{"seq":');
    const bytes = fs.readFileSync(busPath(t.root, runId), 'utf-8');
    await expect(recordCliRefusal(t.root, { caller: 'qa-ui-specialist' }, { command: 'task.claim', code: 'internal', message: 'm' })).resolves.toBe(false);
    expect(fs.readFileSync(busPath(t.root, runId), 'utf-8')).toBe(bytes);
  });
});

describe('the built CLI records refusals without changing them', () => {
  const aegis = (agent: string, ...args: string[]) => {
    const env = { ...process.env, AEGIS_AGENT: agent, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: t.root, encoding: 'utf-8', env });
    return { status: r.status, stderr: r.stderr };
  };
  const ctest = stale ? it.skip : it;

  ctest('an agent invalid-input refusal: exit 2, the usual envelope, one cli.refused line', () => {
    const r = aegis('qa-ui-specialist', 'event', 'append', '--type', 'discovery.step-complete', '--json', 'not json');
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(JSON.stringify({ error: 'invalid-input', message: '--json is not valid JSON' }) + '\n');
    expect(refused()).toEqual([expect.objectContaining({ command: 'event.append', code: 'invalid-input', caller: 'qa-ui-specialist', message: '--json is not valid JSON' })]);
  }, 60_000);

  ctest('a parse error from an agent is recorded under the command it named', () => {
    const r = aegis('qa-ui-specialist', 'task', 'claim', '--bogus');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stderr)).toMatchObject({ error: 'invalid-input' });
    expect(refused()).toEqual([expect.objectContaining({ command: 'task.claim', code: 'invalid-input' })]);
  }, 60_000);

  ctest('an agent appending cli.refused itself is refused; the only line is the CLI record of that refusal', () => {
    const r = aegis('qa-ui-specialist', 'event', 'append', '--type', 'cli.refused', '--json', '{"command":"x","code":"internal","caller":"qa-ui-specialist","message":"forged"}');
    expect(r.status).toBe(2);
    expect(refused()).toEqual([expect.objectContaining({ command: 'event.append', code: 'invalid-input', emittedBy: 'qa-ui-specialist' })]);
    expect(refused()[0]!['message']).toMatch(/recorded by the CLI/);
  }, 60_000);

  ctest('owner refusals and other refusal codes record nothing', () => {
    const before = lines().length;
    expect(aegis('owner', 'escalation', 'decide', '--task', 'T-1', '--decision', 'retry', '--reason', 'x').status).toBe(2);
    expect(aegis('qa-ui-specialist', 'phase', 'start', '--phase', 'scan').status).toBe(2);
    expect(lines()).toHaveLength(before);
  }, 60_000);
});
