import * as fs from 'fs';
import * as path from 'path';
import { readLines } from '@qa/event-bus';
import { assertCallerAllowed, busPath, checkDescope, createRun, descopeRun, readRun, runDir, verifyRunIntegrity } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { writeRunFile } from './helpers/pipeline';

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});
afterEach(() => t.cleanup());
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as { type: string } & Record<string, unknown>);
const runFile = () => path.join(runDir(t.root, runId), 'run.json');
const REASON = 'Depends on Singpass login, out of scope for this release';

describe('descopeRun', () => {
  it('records the case, its trimmed reason and the time in run.json and one run.descoped event', async () => {
    const r = await descopeRun(t.root, runId, { caseId: 'TC-REG-012', reason: `  ${REASON}  ` }, 'owner');
    expect(r).toMatchObject({ caseId: 'TC-REG-012', recorded: true });
    expect(readRun(t.root, runId).descoped).toEqual([{ caseId: 'TC-REG-012', reason: REASON, at: r.state.updatedAt }]);
    expect(events().pop()).toMatchObject({ type: 'run.descoped', caseId: 'TC-REG-012', reason: REASON, emittedBy: 'owner' });
    expect(await verifyRunIntegrity(t.root, runId, 'owner')).toMatchObject({ ok: true });
  });

  it('is idempotent per case: a second call writes nothing and says so; another case is appended', async () => {
    await descopeRun(t.root, runId, { caseId: 'TC-REG-012', reason: REASON }, 'owner');
    const bytes = fs.readFileSync(runFile(), 'utf8');
    await expect(descopeRun(t.root, runId, { caseId: 'TC-REG-012', reason: 'A different reason' }, 'owner')).resolves.toMatchObject({ recorded: false });
    expect(fs.readFileSync(runFile(), 'utf8')).toBe(bytes);
    expect(events().filter((e) => e.type === 'run.descoped')).toHaveLength(1);
    await descopeRun(t.root, runId, { caseId: 'TC-REG-013', reason: REASON }, 'owner');
    expect(readRun(t.root, runId).descoped?.map((d) => d.caseId)).toEqual(['TC-REG-012', 'TC-REG-013']);
  });

  it('records on a completed run too, and leaves its status alone', async () => {
    fs.writeFileSync(runFile(), JSON.stringify({ ...readRun(t.root, runId), status: 'completed' }));
    await expect(descopeRun(t.root, runId, { caseId: 'TC-REG-012', reason: REASON }, 'owner')).resolves.toMatchObject({ recorded: true, state: { status: 'completed' } });
  });

  it.each<[string, string, { caseId: string; reason: string }, string]>([
    ['an agent caller', 'qa-orchestrator', { caseId: 'TC-REG-012', reason: REASON }, 'caller-forbidden'],
    ['an empty reason', 'owner', { caseId: 'TC-REG-012', reason: '  ' }, 'invalid-input'],
    ['a reason naming the framework', 'owner', { caseId: 'TC-REG-012', reason: 'Aegis cannot reach Singpass' }, 'invalid-input'],
    ['a reason naming an agent', 'owner', { caseId: 'TC-REG-012', reason: 'qa-ui-specialist has no Singpass fixture' }, 'invalid-input'],
    ['a malformed case id', 'owner', { caseId: 'REG-012', reason: REASON }, 'invalid-input'],
  ])('refuses %s and changes nothing', async (_why, caller, input, code) => {
    const bytes = fs.readFileSync(runFile(), 'utf8');
    const log = fs.readFileSync(busPath(t.root, runId), 'utf8');
    await expect(descopeRun(t.root, runId, input, caller)).rejects.toMatchObject({ code });
    expect(fs.readFileSync(runFile(), 'utf8')).toBe(bytes);
    expect(fs.readFileSync(busPath(t.root, runId), 'utf8')).toBe(log);
  });

  it('a brand refusal says the reason matches a forbidden term and never echoes the pattern', async () => {
    for (const reason of ['Aegis cannot reach Singpass', 'qa-ui-specialist has no Singpass fixture']) {
      const message = await descopeRun(t.root, runId, { caseId: 'TC-REG-012', reason }, 'owner').catch((e: Error) => e.message);
      expect(message).toBe('the reason is quoted in the reports and must not name the framework or an agent: the reason matches a forbidden term');
    }
  });

  it('a failed append restores run.json, and the retry records exactly one event', async () => {
    const bus = busPath(t.root, runId);
    const good = fs.readFileSync(bus, 'utf8');
    const before = fs.readFileSync(runFile(), 'utf8');
    fs.rmSync(bus);
    fs.mkdirSync(bus); // an events.jsonl the append cannot open: the commit fails after run.json was written
    await expect(descopeRun(t.root, runId, { caseId: 'TC-REG-012', reason: REASON }, 'owner')).rejects.toThrow();
    expect(fs.readFileSync(runFile(), 'utf8')).toBe(before);
    expect(readRun(t.root, runId)).not.toHaveProperty('descoped');
    fs.rmSync(bus, { recursive: true });
    fs.writeFileSync(bus, good);
    await expect(descopeRun(t.root, runId, { caseId: 'TC-REG-012', reason: REASON }, 'owner')).resolves.toMatchObject({ recorded: true });
    expect(events().filter((e) => e.type === 'run.descoped')).toHaveLength(1);
    expect(readRun(t.root, runId).descoped).toHaveLength(1);
    expect(await verifyRunIntegrity(t.root, runId, 'owner')).toMatchObject({ ok: true });
  });

  it('refuses a case with no design file once the run has a cases folder', async () => {
    writeRunFile(t.root, runId, 'cases/TC-REG-012.json', { id: 'TC-REG-012' });
    await expect(descopeRun(t.root, runId, { caseId: 'TC-REG-099', reason: REASON }, 'owner')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/TC-REG-099/) });
    await expect(descopeRun(t.root, runId, { caseId: 'TC-REG-012', reason: REASON }, 'owner')).resolves.toMatchObject({ recorded: true });
  });

  it('is owner-only', () => {
    expect(() => assertCallerAllowed('owner', 'run.descope')).not.toThrow();
    for (const agent of ['qa-orchestrator', 'qa-test-executor', 'qa-metrics-collector']) {
      expect(() => assertCallerAllowed(agent, 'run.descope')).toThrow(expect.objectContaining({ code: 'caller-forbidden' }));
    }
  });
});

describe('checkDescope', () => {
  it('returns the trimmed reason and the cleaned, de-duplicated ids, reading and writing nothing else', () => {
    const bytes = fs.readFileSync(runFile(), 'utf8');
    expect(checkDescope(t.root, runId, [' TC-REG-012 ', 'TC-REG-013', 'TC-REG-012', ' '], `  ${REASON}  `, 'owner')).toEqual({ caseIds: ['TC-REG-012', 'TC-REG-013'], reason: REASON });
    expect(fs.readFileSync(runFile(), 'utf8')).toBe(bytes);
  });

  it.each<[string, string[], string, string, string]>([
    ['an agent caller', ['TC-REG-012'], REASON, 'qa-orchestrator', 'caller-forbidden'],
    ['an empty reason', ['TC-REG-012'], ' ', 'owner', 'invalid-input'],
    ['a branded reason', ['TC-REG-012'], 'Aegis cannot reach it', 'owner', 'invalid-input'],
    ['no ids', [' '], REASON, 'owner', 'invalid-input'],
    ['a malformed id among valid ones', ['TC-REG-012', 'REG-1'], REASON, 'owner', 'invalid-input'],
  ])('refuses %s', (_why, ids, reason, caller, code) => {
    expect(() => checkDescope(t.root, runId, ids, reason, caller)).toThrow(expect.objectContaining({ code }));
  });

  it('refuses an id with no design file once the run has a cases folder, naming it', () => {
    writeRunFile(t.root, runId, 'cases/TC-REG-012.json', { id: 'TC-REG-012' });
    expect(() => checkDescope(t.root, runId, ['TC-REG-012', 'TC-REG-099'], REASON, 'owner')).toThrow(expect.objectContaining({ code: 'invalid-input', message: expect.stringMatching(/TC-REG-099/) }));
  });
});
