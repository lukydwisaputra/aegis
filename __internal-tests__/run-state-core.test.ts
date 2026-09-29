import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertAppendableByAgent,
  assertCallerAllowed,
  RESERVED_EVENT_TYPES,
  findAegisRoot,
  isSpecialist,
  readActiveRun,
  readSettings,
  resolveCaller,
  resolveRunId,
  runJsonPath,
  writeActiveRun,
} from '@qa/run-state';
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

  it('recognises Tier-2 specialists but not their SPVs', () => {
    expect(isSpecialist('qa-ui-specialist')).toBe(true);
    expect(isSpecialist('qa-ui-specialist-spv')).toBe(false);
    expect(isSpecialist('qa-test-executor')).toBe(false);
  });
});

describe('config', () => {
  it('reads the cap, profile and environments', () => {
    expect(readSettings(t.root)).toEqual({ profile: 'full', maxSpecialists: 2, environments: ['development', 'production'] });
  });

  it('rejects a non-positive cap', () => {
    const cfgPath = path.join(t.root, 'aegis.config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.parallelism.maxSpecialists = 0;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    expect(thrownCode(() => readSettings(t.root))).toBe('invalid-input');
  });
});

describe('reserved event types (F5)', () => {
  it.each([
    'run.created', 'run.blocked', 'run.resumed', 'run.stop.requested', 'run.completed',
    'task.claimed', 'task.released', 'task.escalated',
    'review.passed', 'review.passed-with-notes', 'review.requested-changes',
    'integrity.violation', 'integrity.acknowledged', 'artifact.created',
  ])('refuses a direct append of %s', (type) => {
    expect(RESERVED_EVENT_TYPES.has(type)).toBe(true);
    expect(() => assertAppendableByAgent(type)).toThrow(
      expect.objectContaining({ code: 'invalid-input', message: `event type ${type} is recorded by the CLI, not appended directly` }),
    );
  });

  it('allows event types agents own', () => {
    expect(() => assertAppendableByAgent('run.phase.started')).not.toThrow();
    expect(() => assertAppendableByAgent('sandbox.explored')).not.toThrow();
  });
});
