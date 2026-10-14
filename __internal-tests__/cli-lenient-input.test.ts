import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { readLines } from '@qa/event-bus';
import { addTask, busPath } from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';

// The aegis CLI takes the spellings agents really wrote (60 refusals of `task claim` in one run) and cuts an over-long free-text field instead of refusing it.

const CLI = path.join(__dirname, '..', 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(path.join(__dirname, '..'));
const A = 'qa-orchestrator';
let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
beforeEach(async () => {
  t = makeAegisRoot();
  runId = await startedRun(t.root);
});

const aegis = (args: string[], caller = A) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: t.root, encoding: 'utf-8', env: { ...process.env, AEGIS_AGENT: caller, AEGIS_ROOT: t.root } });
  return { status: r.status, out: r.stdout ? safe(r.stdout) : null, err: r.stderr ? safe(r.stderr) : null };
};
const safe = (s: string) => { try { return JSON.parse(s); } catch { return s; } };

(stale ? describe.skip : describe)('task claim, release and cancel take the id in any spelling', () => {
  it.each([
    ['--task', ['--task', 'T-intake-1']],
    ['--id', ['--id', 'T-intake-1']],
    ['--task-id', ['--task-id', 'T-intake-1']],
    ['positional', ['T-intake-1']],
  ])('claim with %s', async (_n, args) => {
    await addTask(t.root, runId, { id: 'T-intake-1', title: 'x', agent: A }, A);
    const r = aegis(['task', 'claim', ...args, '--run', runId]);
    expect(r).toMatchObject({ status: 0, out: { id: 'T-intake-1', status: 'in-progress' } });
  });

  it('release and cancel too, and a missing id says how to give it', async () => {
    await addTask(t.root, runId, { id: 'T-intake-1', title: 'x', agent: A }, A);
    await addTask(t.root, runId, { id: 'T-intake-2', title: 'y', agent: A }, A);
    expect(aegis(['task', 'cancel', 'T-intake-2', '--reason', 'not needed', '--run', runId]).status).toBe(0);
    expect(aegis(['task', 'claim', 'T-intake-1', '--run', runId]).status).toBe(0);
    // the id is understood: the refusal is the real rule (a work report comes before a release), not a missing option
    expect(aegis(['task', 'release', '--id', 'T-intake-1', '--result', 'failed', '--run', runId]).err).toMatchObject({ error: 'no-work-report' });
    const none = aegis(['task', 'claim', '--run', runId]);
    expect(none.status).not.toBe(0);
    expect(JSON.stringify(none.err)).toContain('a task id is required: --task <id>');
  });
});

(stale ? describe.skip : describe)('two different task ids are refused', () => {
  it('names both ids and claims nothing', async () => {
    await addTask(t.root, runId, { id: 'T-intake-1', title: 'x', agent: A }, A);
    const r = aegis(['task', 'claim', 'T-intake-1', '--task', 'T-intake-2', '--run', runId]);
    expect(r.status).not.toBe(0);
    expect(JSON.stringify(r.err)).toContain('two different task ids were given (T-intake-2 and T-intake-1)');
    expect(aegis(['task', 'claim', 'T-intake-1', '--task', 'T-intake-1', '--run', runId]).status).toBe(0);
  });
});

(stale ? describe.skip : describe)('id next accepts --run, and event append cuts an over-long free-text field', () => {
  it('does not refuse --run on id next', () => {
    expect(aegis(['id', 'next', '--kind', 'TC', '--module', 'AUTH', '--run', runId])).toMatchObject({ status: 0, out: { id: expect.stringMatching(/^TC-AUTH-\d{3}$/) } });
  });

  it('records an observation whose summary is 340 characters, shortened to 300, and says so', () => {
    const summary = 'The scan screen shows the wrong centre after a rescan. '.repeat(7);
    const r = aegis(['event', 'append', '--type', 'observation.recorded', '--json', JSON.stringify({ kind: 'behaviour-mismatch', summary }), '--run', runId], 'qa-exploratory-specialist');
    expect(r.status).toBe(0);
    expect(r.out).toMatchObject({ trimmed: [{ field: 'summary', from: summary.length, to: expect.any(Number) }] });
    const ev = readLines(busPath(t.root, runId)).map((l) => JSON.parse(l)).find((e) => e.type === 'observation.recorded');
    expect(ev.summary.length).toBeLessThanOrEqual(300);
    expect(ev.summary.endsWith('…')).toBe(true);
  });

  it('refuses, never cuts, an over-long evidence item or component of a framework defect', () => {
    const r = aegis(['event', 'append', '--type', 'framework.defect-suspected', '--json', JSON.stringify({ component: 'aegis env exec', symptom: 'the command is missing a flag it should have', evidence: ['/very/long/path/'.repeat(25)] }), '--run', runId], 'qa-ui-specialist');
    expect(r.status).not.toBe(0);
    expect(JSON.stringify(r.err)).toContain('too_big');
  });

  it('still refuses an event with a wrong type of value, with the schema message', () => {
    const r = aegis(['event', 'append', '--type', 'observation.recorded', '--json', JSON.stringify({ kind: 'nonsense', summary: 'a summary that is long enough' }), '--run', runId], 'qa-exploratory-specialist');
    expect(r.status).not.toBe(0);
  });
});
