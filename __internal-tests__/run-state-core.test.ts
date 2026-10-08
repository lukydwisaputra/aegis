import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AGENT_ID,
  MODULE_CODE,
  assertAppendableByAgent,
  assertCallerAllowed,
  findAegisRoot,
  isCliRecordedEventType,
  isSpecialist,
  pairedSpv,
  readActiveRun,
  readSettings,
  resolveCaller,
  resolveRunId,
  runJsonPath,
  writeActiveRun,
} from '@qa/run-state';
import { appendChained } from '@qa/event-bus';
import { ROLES } from '@qa/path-guard';
import { makeAegisRoot, thrownCode, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
beforeEach(() => { t = makeAegisRoot(); });
afterEach(() => t.cleanup());

describe('paths', () => {
  it('finds the aegis root from a nested directory', () => {
    const nested = path.join(t.root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    expect(findAegisRoot(nested)).toBe(t.root);
  });

  it('refuses outside an aegis root', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'no-aegis-'));
    expect(thrownCode(() => findAegisRoot(outside))).toBe('not-in-aegis');
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('has no active run until one is written', () => {
    expect(readActiveRun(t.root)).toBeNull();
    expect(thrownCode(() => resolveRunId(t.root, undefined))).toBe('no-active-run');
  });

  it('ignores a pointer that holds garbage', () => {
    fs.mkdirSync(path.join(t.root, 'runs'), { recursive: true });
    fs.writeFileSync(path.join(t.root, 'runs', '.active'), 'not-a-run-id\n');
    expect(readActiveRun(t.root)).toBeNull();
  });

  it('ignores a pointer to a run whose directory was deleted', () => {
    writeActiveRun(t.root, 'RUN-20260929-001');
    expect(readActiveRun(t.root)).toBeNull();
    expect(thrownCode(() => resolveRunId(t.root, undefined))).toBe('no-active-run');
  });

  it('returns a valid active run and honours an explicit id', () => {
    fs.mkdirSync(path.dirname(runJsonPath(t.root, 'RUN-20260929-001')), { recursive: true });
    fs.writeFileSync(runJsonPath(t.root, 'RUN-20260929-001'), '{}');
    writeActiveRun(t.root, 'RUN-20260929-001');
    expect(resolveRunId(t.root, undefined)).toBe('RUN-20260929-001');
    expect(thrownCode(() => resolveRunId(t.root, 'RUN-20260929-009'))).toBe('run-not-found');
  });
});

describe('active pointer races', () => {
  it('leaves no temp files behind after writeActiveRun', () => {
    writeActiveRun(t.root, 'RUN-20260929-001');
    writeActiveRun(t.root, 'RUN-20260929-002');
    const leftovers = fs.readdirSync(path.join(t.root, 'runs')).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
    expect(fs.readFileSync(path.join(t.root, 'runs', '.active'), 'utf8').trim()).toBe('RUN-20260929-002');
  });

  it('readActiveRun returns null when the pointer vanishes', () => {
    writeActiveRun(t.root, 'RUN-20260929-001');
    fs.rmSync(path.join(t.root, 'runs', '.active'));
    expect(() => readActiveRun(t.root)).not.toThrow();
    expect(readActiveRun(t.root)).toBeNull();
  });
});

describe('caller', () => {
  it('requires AEGIS_AGENT', () => {
    expect(thrownCode(() => resolveCaller({}))).toBe('caller-unknown');
  });

  it('accepts owner and qa-* agents only', () => {
    expect(resolveCaller({ AEGIS_AGENT: 'owner' })).toBe('owner');
    expect(resolveCaller({ AEGIS_AGENT: 'qa-ui-specialist' })).toBe('qa-ui-specialist');
    expect(thrownCode(() => resolveCaller({ AEGIS_AGENT: 'general-purpose' }))).toBe('caller-unknown');
  });

  it('forbids agent-only commands for the owner', () => {
    expect(thrownCode(() => assertCallerAllowed('owner', 'task.claim'))).toBe('caller-forbidden');
    expect(thrownCode(() => assertCallerAllowed('owner', 'event.append'))).toBe('caller-forbidden');
    expect(thrownCode(() => assertCallerAllowed('owner', 'run.status'))).toBeUndefined();
    expect(thrownCode(() => assertCallerAllowed('qa-ui-specialist', 'task.claim'))).toBeUndefined();
  });

  it.each(['run.create', 'run.stop', 'run.resume'] as const)('forbids owner-only %s for an agent', (cmd) => {
    expect(() => assertCallerAllowed('qa-ui-specialist', cmd)).toThrow(
      expect.objectContaining({ code: 'caller-forbidden', message: `${cmd} is owner-only; run it through its /qa-* command` }),
    );
    expect(thrownCode(() => assertCallerAllowed('owner', cmd))).toBeUndefined();
  });

  it.each(['run.status', 'integrity.verify'] as const)('lets both owner and agents run %s', (cmd) => {
    expect(thrownCode(() => assertCallerAllowed('owner', cmd))).toBeUndefined();
    expect(thrownCode(() => assertCallerAllowed('qa-ui-specialist', cmd))).toBeUndefined();
  });

  it.each([
    ['qa-ui-specialist', 'qa-ui-specialist-spv'],
    ['qa-test-planner', 'qa-test-planner-spv'],
    ...(['iso25010', 'iso5055', 'istqb', 'cmmi', 'gdpr', 'pdpa'] as const).map((c): [string, string] => [`qa-compliance-${c}`, 'qa-compliance-spv']),
  ])('pairs %s with %s', (agent, spv) => {
    expect(pairedSpv(agent)).toBe(spv);
  });

  it('every other reviewed role pairs with <agent>-spv, and SHARED_SPV is gone (P2 T11)', () => {
    for (const r of ROLES.filter((x) => x.spv !== null && x.kind !== 'compliance')) expect(pairedSpv(r.agent)).toBe(`${r.agent}-spv`);
    const src = fs.readFileSync(path.join(__dirname, '..', 'packages', '@qa', 'run-state', 'src', 'caller.ts'), 'utf-8');
    expect(src).not.toMatch(/SHARED_SPV/);
  });

  it('recognises Tier-2 specialists but not their SPVs', () => {
    expect(isSpecialist('qa-ui-specialist')).toBe(true);
    expect(isSpecialist('qa-ui-specialist-spv')).toBe(false);
    expect(isSpecialist('qa-test-executor')).toBe(false);
  });
});

describe('shared id patterns (R8)', () => {
  it('MODULE_CODE accepts 2-8 uppercase letters only', () => {
    expect(['AUTH', 'AB', 'ABCDEFGH'].every((m) => MODULE_CODE.test(m))).toBe(true);
    expect(['au-th', 'A', 'ABCDEFGHI', 'AUTH1'].some((m) => MODULE_CODE.test(m))).toBe(false);
  });

  it('AGENT_ID accepts qa-* names only and is what resolveCaller enforces', () => {
    expect(AGENT_ID.test('qa-ui-specialist')).toBe(true);
    expect(['../evil', 'owner', 'qa-UI', 'general-purpose'].some((a) => AGENT_ID.test(a))).toBe(false);
    expect(thrownCode(() => resolveCaller({ AEGIS_AGENT: 'qa-UI' }))).toBe('caller-unknown');
  });
});

describe('config', () => {
  it('reads the cap and environments; there is no profile setting (AUD-053)', () => {
    expect(readSettings(t.root)).toEqual({ maxSpecialists: 2, environments: ['development', 'production'], readOnlyEnvironments: ['production'] });
  });

  it('rejects a non-positive cap', () => {
    const cfgPath = path.join(t.root, 'aegis.config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.parallelism.maxSpecialists = 0;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    expect(thrownCode(() => readSettings(t.root))).toBe('invalid-input');
  });
});

describe('reserved event types (F5, R2)', () => {
  it.each([
    'run.created', 'run.blocked', 'run.resumed', 'run.stop.requested', 'run.completed',
    'run.phase.started', 'run.phase.completed', 'run.aborted', 'run.reissued',
    'task.claimed', 'task.released', 'task.escalated', 'task.failed',
    'gate.approved', 'gate.opened',
    'review.passed', 'review.passed-with-notes', 'review.requested-changes',
    'integrity.violation', 'integrity.acknowledged', 'artifact.created',
  ])('refuses a direct append of %s', (type) => {
    expect(isCliRecordedEventType(type)).toBe(true);
    expect(() => assertAppendableByAgent(type)).toThrow(
      expect.objectContaining({ code: 'invalid-input', message: `event type ${type} is recorded by the CLI, not appended directly` }),
    );
  });

  it.each(['discovery.step-complete', 'test.passed', 'sandbox.explored', 'artifact.captured', 'runner.x', 'tasks.x'])(
    'allows agent-owned type %s',
    (type) => {
      expect(isCliRecordedEventType(type)).toBe(false);
      expect(() => assertAppendableByAgent(type)).not.toThrow();
    },
  );

  it('a normal agent event is accepted by the chained bus', async () => {
    const bus = path.join(t.root, 'events.jsonl');
    const event = { type: 'discovery.step-complete', ts: '2026-09-29T00:00:00.000Z', step: 'scan', artifact: 'discovery/scan.json' };
    assertAppendableByAgent(event.type);
    await expect(appendChained(event, bus, { emittedBy: 'qa-web-explorer', runId: 'RUN-20260929-001' })).resolves.toMatchObject({ seq: 1, type: 'discovery.step-complete' });
  });
});
