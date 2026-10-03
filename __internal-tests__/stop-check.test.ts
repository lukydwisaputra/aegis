import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { appendLedger, readLedger } from '@qa/path-guard';
import { createTaskmasterClient } from '@qa/taskmaster-client';
import {
  addTask, busPath, checkSubagentStop, claimTask, freshAttempt, MAX_STOP_BLOCKS, releaseTask, submitReview, submitWorkReport, taskmasterDir, transcriptUsage,
} from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { review, workReport } from './helpers/pipeline';

const UI = 'qa-ui-specialist';
const SPV = 'qa-ui-specialist-spv';
let t: TmpAegis;
let runId: string;

const json = (name: string, value: unknown) => {
  const file = path.join(t.root, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
};
const ledger = (agentId: string, agentType: string, kind: 'start' | 'claim', taskId?: string, ts = new Date().toISOString()) =>
  appendLedger(t.root, runId, { ts, agentId, agentType, kind, ...(taskId !== undefined ? { taskId } : {}) });
/** H1 writes the ledger claim in PreToolUse, before the CLI claim runs (m5): the same order here. */
const claimAs = async (agentId: string, taskId: string, agent = UI) => {
  ledger(agentId, agent, 'claim', taskId);
  await claimTask(t.root, runId, taskId, agent);
};
const stop = (agentId: string, agentType: string, transcriptPath?: string) =>
  checkSubagentStop(t.root, { agentId, agentType, ...(transcriptPath !== undefined ? { transcriptPath } : {}) });
const status = async (taskId: string) => (await createTaskmasterClient(taskmasterDir(t.root, runId)).get(taskId))!.status;
const tokenEvents = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l)).filter((e) => e.type === 'token.used');

beforeEach(async () => {
  t = makeAegisRoot({ maxSpecialists: 2 });
  runId = await startedRun(t.root);
  await addTask(t.root, runId, { id: 'T-1', title: 'one', agent: UI }, 'qa-test-executor');
  await addTask(t.root, runId, { id: 'T-2', title: 'two', agent: UI }, 'qa-test-executor');
});
afterEach(() => t.cleanup());

describe('H2 for workers (spec §4.2)', () => {
  it('blocks a worker that stops holding a claim without a work report', async () => {
    await claimAs('a1', 'T-1');
    const v = await stop('a1', UI);
    expect(v.block).toBe(true);
    expect(v.reason).toMatch(/task T-1 .*work-report submit/);
  });

  it('releases done for the agent once a fresh work report exists (AUD-016)', async () => {
    await claimAs('a1', 'T-1');
    await submitWorkReport(t.root, runId, json('wr.json', workReport(UI, 'T-1')), UI);
    expect(await stop('a1', UI)).toMatchObject({ block: false, released: ['T-1'] });
    expect(await status('T-1')).toBe('done');
  });

  it('judges two instances of one agent type by their own claims', async () => {
    await claimAs('a1', 'T-1');
    await claimAs('a2', 'T-2');
    await submitWorkReport(t.root, runId, json('wr1.json', workReport(UI, 'T-1')), UI);
    await releaseTask(t.root, runId, 'T-1', 'done', UI);
    expect((await stop('a1', UI)).block).toBe(false);
    expect((await stop('a2', UI)).block).toBe(true);
  });

  it('stops blocking after MAX_STOP_BLOCKS and warns instead', async () => {
    await claimAs('a1', 'T-1');
    for (let i = 0; i < MAX_STOP_BLOCKS; i++) expect((await stop('a1', UI)).block).toBe(true);
    const v = await stop('a1', UI);
    expect(v.block).toBe(false);
    expect(v.warnings.join('\n')).toMatch(/unresolved/);
    expect(readLedger(t.root, runId, 'a1').map((e) => e.kind)).toEqual(['claim', 'stop-blocked', 'stop-blocked', 'stop-blocked', 'stop-unresolved']);
  });

  it('lets non-qa agents, the orchestrator and agents with no claim stop', async () => {
    expect((await stop('x', 'general-purpose')).block).toBe(false);
    expect((await stop('o', 'qa-orchestrator')).block).toBe(false);
    expect((await stop('p', 'qa-test-planner')).block).toBe(false);
  });
});

describe('m5: H2 acts only on a claim the CLI actually granted to this instance', () => {
  it('a ledger claim whose CLI claim was refused neither blocks nor releases', async () => {
    // a2 holds T-1; a1 then tries the same task: H1 logs a1's claim, the CLI refuses it (already claimed).
    await claimAs('a2', 'T-1');
    ledger('a1', UI, 'claim', 'T-1');
    await expect(claimTask(t.root, runId, 'T-1', UI)).rejects.toThrow(/already-claimed/);
    // Without a report a1 is not held by a2's open task …
    expect(await stop('a1', UI)).toMatchObject({ block: false, released: [] });
    // … and with a2's fresh report a1 does not release a2's task on a2's behalf.
    await submitWorkReport(t.root, runId, json('wr.json', workReport(UI, 'T-1')), UI);
    expect(await stop('a1', UI)).toMatchObject({ block: false, released: [] });
    expect(await status('T-1')).toBe('in-progress');
    expect(readLedger(t.root, runId, 'a1').map((e) => e.kind)).toEqual(['claim']);
    // a2, whose claim the CLI did grant, is the one released.
    expect(await stop('a2', UI)).toMatchObject({ block: false, released: ['T-1'] });
  });

  it('a ledger claim that never reached the CLI (task claim --help) leaves the pending task alone', async () => {
    ledger('a1', UI, 'claim', 'T-2');
    expect(await stop('a1', UI)).toMatchObject({ block: false, released: [] });
    expect(await status('T-2')).toBe('pending');
  });
});

describe('R6: one freshness rule for aegis task release and H2', () => {
  it('a re-claim after a requested-changes review has no fresh report: release refuses and H2 blocks', async () => {
    await claimAs('a1', 'T-1');
    await submitWorkReport(t.root, runId, json('wr.json', workReport(UI, 'T-1')), UI);
    expect(freshAttempt(t.root, runId, UI, 'T-1')).toBe(1);
    await releaseTask(t.root, runId, 'T-1', 'done', UI);
    await submitReview(t.root, runId, json('rv.json', review(SPV, UI, 'T-1', 'requested-changes')), SPV);
    expect(await status('T-1')).toBe('pending');
    await claimAs('a3', 'T-1');
    expect(freshAttempt(t.root, runId, UI, 'T-1')).toBeNull();
    await expect(releaseTask(t.root, runId, 'T-1', 'done', UI)).rejects.toThrow(/no work report in this claim/);
    expect((await stop('a3', UI)).block).toBe(true);
  });

  it('stop-check reuses the exported helper instead of its own copy', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'packages', '@qa', 'run-state', 'src', 'stop-check.ts'), 'utf-8');
    expect(src).toMatch(/\bfreshAttempt\b/);
    expect(src).not.toMatch(/supersededAttempt|attemptsIn\(/);
  });
});

describe('H2 for SPVs', () => {
  it('blocks an SPV that stops while a released paired report awaits its review, until it submits one', async () => {
    ledger('s1', SPV, 'start', undefined, new Date(Date.now() - 5_000).toISOString());
    await claimAs('a1', 'T-1');
    await submitWorkReport(t.root, runId, json('wr.json', workReport(UI, 'T-1')), UI);
    await releaseTask(t.root, runId, 'T-1', 'done', UI);
    expect((await stop('s1', SPV)).reason).toMatch(/qa-ui-specialist\.T-1 await your verdict: .*review submit/);
    await submitReview(t.root, runId, json('rv.json', review(SPV, UI, 'T-1', 'passed')), SPV);
    expect((await stop('s1', SPV)).block).toBe(false);
  });

  it('lets an SPV with nothing to review stop', async () => {
    expect((await stop('s2', SPV)).block).toBe(false);
  });
});

describe('token.used from the session transcript, attributed by agentId (AUD-042b)', () => {
  const usage = (input: number, output: number, creation = 0, read = 0) => ({
    input_tokens: input, output_tokens: output, cache_creation_input_tokens: creation, cache_read_input_tokens: read,
  });
  const entry = (agentId: string | undefined, id: string, model: string, u: object, timestamp = '2026-10-03T10:00:00.000Z') =>
    JSON.stringify({ type: 'assistant', ...(agentId !== undefined ? { agentId, isSidechain: true } : {}), timestamp, message: { id, model, usage: u } });
  const session = [
    entry('p', 'msg_1', 'claude-sonnet-5', usage(100, 50, 20, 300)),
    entry('p', 'msg_1', 'claude-sonnet-5', usage(100, 50, 20, 300)), // a streamed message repeats its usage
    entry('p', 'msg_2', 'claude-sonnet-5', usage(10, 5)),
    entry('p', 'msg_3', '<synthetic>', usage(0, 0)),
    entry('q', 'msg_4', 'claude-sonnet-5', usage(9999, 9999)), // another subagent
    entry(undefined, 'msg_5', 'claude-opus-5-5', usage(7777, 7777)), // the main thread
    JSON.stringify({ type: 'user', agentId: 'p', message: { role: 'user', content: 'hello' } }),
    '{torn',
  ].join('\n');
  const write = (name: string, text: string) => {
    const file = path.join(t.root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };

  it('sums only the stopping agent\'s entries per model, each message id once', () => {
    expect(transcriptUsage(write('s.jsonl', session), 'p')).toEqual({
      usage: [{ model: 'claude-sonnet-5', input: 130, output: 55, cached: 300 }],
      attributed: 5,
      through: '2026-10-03T10:00:00.000Z',
    });
    expect(transcriptUsage(write('s.jsonl', session), 'nobody')).toEqual({ usage: [], attributed: 0, through: null });
  });

  it('also reads the per-agent sidechain file next to the session transcript, still only lines marked with the agent id', () => {
    const file = write('sess.jsonl', entry(undefined, 'msg_9', 'claude-opus-5-5', usage(1, 1)));
    write(path.join('sess', 'subagents', 'agent-p.jsonl'), [entry('p', 'msg_1', 'claude-sonnet-5', usage(10, 5)), entry(undefined, 'msg_2', 'claude-sonnet-5', usage(999, 999))].join('\n'));
    expect(transcriptUsage(file, 'p').usage).toEqual([{ model: 'claude-sonnet-5', input: 10, output: 5, cached: 0 }]);
    // An agent id that is not a plain token never builds a sidechain path.
    expect(transcriptUsage(file, '../sess/subagents/agent-p')).toEqual({ usage: [], attributed: 0, through: null });
  });

  it('records one token.used per model on an allowed stop, emitted as the agent, and never counts a message twice', async () => {
    const file = write('s.jsonl', session);
    expect((await stop('p', 'qa-test-planner', file)).block).toBe(false);
    expect(tokenEvents()).toEqual([expect.objectContaining({ agent: 'qa-test-planner', model: 'claude-sonnet-5', input: 130, output: 55, cached: 300, emittedBy: 'qa-test-planner' })]);
    // A continued agent (same agent_id) stops again: only the entries after the last recorded one count.
    fs.appendFileSync(file, '\n' + entry('p', 'msg_6', 'claude-sonnet-5', usage(1, 2, 0, 3), '2026-10-03T11:00:00.000Z'));
    await stop('p', 'qa-test-planner', file);
    expect(tokenEvents().map((e) => [e.input, e.output, e.cached])).toEqual([[130, 55, 300], [1, 2, 3]]);
    expect(readLedger(t.root, runId, 'p').map((e) => e.kind)).toEqual(['tokens-recorded', 'tokens-recorded']);
  });

  it('records no token.used and a ledger note when no entry is attributable to the agent; never blocks', async () => {
    const file = write('s.jsonl', entry(undefined, 'msg_1', 'claude-sonnet-5', usage(100, 50)));
    const v = await stop('p', 'qa-test-planner', file);
    expect(v).toMatchObject({ block: false, warnings: [] });
    expect(tokenEvents()).toEqual([]);
    expect(readLedger(t.root, runId, 'p')).toEqual([expect.objectContaining({ kind: 'token-unattributed', note: expect.stringMatching(/no transcript entry carries agentId p/) })]);
  });

  it('records nothing without a transcript path, and only warns on an unreadable one', async () => {
    expect((await stop('p', 'qa-test-planner')).warnings).toEqual([]);
    const v = await stop('p', 'qa-test-planner', path.join(t.root, 'missing.jsonl'));
    expect(v.block).toBe(false);
    expect(v.warnings.join('\n')).toMatch(/token\.used not recorded/);
    expect(tokenEvents()).toEqual([]);
    expect(readLedger(t.root, runId, 'p').map((e) => e.kind)).toEqual(['token-unattributed']);
  });
});
