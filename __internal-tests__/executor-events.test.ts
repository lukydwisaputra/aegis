import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { AegisEventSchema, SpecialistCompletedEventSchema, SpecialistDispatchedEventSchema } from '@qa/contracts';
import { appendChained, readLines } from '@qa/event-bus';
import { busPath } from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';

// P0a-2 T5 fix 2: the specialist.dispatched / specialist.completed events qa-test-executor appends, exactly as its
// prose describes them (Process steps 5 and 6, "Events You Emit"), are accepted by the strict event bus.

const TS = '2026-10-01T08:00:00.000Z';
const EXEC = 'qa-test-executor';
const EXECUTOR_MD = path.join(__dirname, '..', '.claude', 'agents', 'tier1-phase', 'qa-test-executor.md');

/** Step 5: exactly specialistName, taskId, tcIds, environment and brief (only DispatchBriefSchema fields). */
const DISPATCHED = {
  specialistName: 'qa-ui-specialist',
  taskId: 'T-execution-2',
  tcIds: ['TC-AUTH-031', 'TC-AUTH-032'],
  environment: 'development',
  brief: {
    missionGoal: 'Find SSO callback breakages before release',
    lessonsRef: 'agent-memory/qa-ui-specialist/lessons.md',
    riskContext: 'RISK-AUTH-007 (Critical)',
    environmentNotes: 'Mailpit on 8025',
    exploratoryFindings: ['A plus-sign email returned 500 during exploration'],
  },
};
/** Step 6: exactly specialistName, taskId, passCount, failCount and optionally durationMs. */
const COMPLETED = { specialistName: 'qa-ui-specialist', taskId: 'T-execution-2', passCount: 1, failCount: 1, durationMs: 93000 };

describe('specialist event schemas', () => {
  it('declare an optional task ref on both events', () => {
    expect(SpecialistDispatchedEventSchema.safeParse({ type: 'specialist.dispatched', ts: TS, ...DISPATCHED }).success).toBe(true);
    expect(SpecialistCompletedEventSchema.safeParse({ type: 'specialist.completed', ts: TS, ...COMPLETED }).success).toBe(true);
    const { taskId: _d, ...dispatchedNoTask } = DISPATCHED;
    const { taskId: _c, ...completedNoTask } = COMPLETED;
    expect(AegisEventSchema.safeParse({ type: 'specialist.dispatched', ts: TS, ...dispatchedNoTask }).success).toBe(true);
    expect(AegisEventSchema.safeParse({ type: 'specialist.completed', ts: TS, ...completedNoTask }).success).toBe(true);
  });

  it('refuse a task id that is not a task ref', () => {
    expect(SpecialistDispatchedEventSchema.safeParse({ type: 'specialist.dispatched', ts: TS, ...DISPATCHED, taskId: 'execution-2' }).success).toBe(false);
    expect(SpecialistCompletedEventSchema.safeParse({ type: 'specialist.completed', ts: TS, ...COMPLETED, taskId: 'T-GATE-execution' }).success).toBe(false);
  });

  it('keep the prose in step with the schema: durationMs, the brief fields, no bare duration', () => {
    const prose = fs.readFileSync(EXECUTOR_MD, 'utf8');
    expect(prose).toMatch(/specialist\.completed`.*durationMs/);
    expect(prose).not.toMatch(/failCount, duration\b/);
    for (const field of ['missionGoal', 'lessonsRef', 'riskContext', 'environmentNotes', 'exploratoryFindings']) expect(prose).toContain(field);
  });
});

describe('the executor appends its specialist events', () => {
  let t: TmpAegis;
  let runId: string;
  beforeEach(async () => {
    t = makeAegisRoot();
    runId = await startedRun(t.root);
  });
  afterEach(() => t.cleanup());

  it('appendChained accepts both events exactly as described, and refuses the old duration field', async () => {
    const bus = busPath(t.root, runId);
    const ctx = { emittedBy: EXEC, runId };
    await appendChained({ type: 'specialist.dispatched', ts: TS, runId, ...DISPATCHED }, bus, ctx);
    await appendChained({ type: 'specialist.completed', ts: TS, runId, ...COMPLETED }, bus, ctx);
    const [d, c] = readLines(bus).slice(-2).map((l) => JSON.parse(l));
    expect(d).toMatchObject({ type: 'specialist.dispatched', taskId: 'T-execution-2', brief: DISPATCHED.brief, emittedBy: EXEC });
    expect(c).toMatchObject({ type: 'specialist.completed', taskId: 'T-execution-2', durationMs: 93000 });
    const { durationMs: _ms, ...rest } = COMPLETED;
    await expect(appendChained({ type: 'specialist.completed', ts: TS, runId, ...rest, duration: 93000 } as never, bus, ctx)).rejects.toThrow(/undeclared field\(s\).*duration/);
    await expect(
      appendChained({ type: 'specialist.dispatched', ts: TS, runId, ...DISPATCHED, brief: { ...DISPATCHED.brief, tcList: ['TC-AUTH-031'] } } as never, bus, ctx),
    ).rejects.toThrow();
  });

  const ROOT = path.join(__dirname, '..');
  const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
  const stale = process.env.CI ? null : staleBuild(ROOT);
  if (stale) console.warn(`executor-events CLI test skipped: ${stale} (run pnpm build)`);

  (stale ? it.skip : it)('aegis event append records both events for qa-test-executor', () => {
    const aegis = (type: string, fields: object) => {
      const env = { ...process.env, AEGIS_AGENT: EXEC, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
      return spawnSync(process.execPath, [CLI, 'event', 'append', '--type', type, '--json', JSON.stringify(fields)], { cwd: t.root, encoding: 'utf-8', env });
    };
    expect(aegis('specialist.dispatched', DISPATCHED)).toMatchObject({ status: 0 });
    expect(aegis('specialist.completed', COMPLETED)).toMatchObject({ status: 0 });
    expect(readLines(busPath(t.root, runId)).slice(-2).map((l) => JSON.parse(l).type)).toEqual(['specialist.dispatched', 'specialist.completed']);
  }, 60_000);
});
