import * as fs from 'fs';
import { readLines } from '@qa/event-bus';
import { blockRun, busPath, createRun, readRun, requestStop, resumeRun, runJsonPath, verifyRunIntegrity } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
let runId: string;

beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  await requestStop(t.root, runId, 'first', 'owner');
  await resumeRun(t.root, runId, 'owner');
});

afterEach(() => t.cleanup());

function tamperFirstLine() {
  const lines = readLines(busPath(t.root, runId));
  lines[0] = lines[0]!.replace('"environment":"development"', '"environment":"production"');
  fs.writeFileSync(busPath(t.root, runId), lines.join('\n') + '\n');
}

const count = (type: string) =>
  readLines(busPath(t.root, runId)).filter((l) => {
    try {
      return JSON.parse(l).type === type; // a torn pending tail is not valid JSON
    } catch {
      return false;
    }
  }).length;

it('reports a clean run as ok and leaves it running', async () => {
  const report = await verifyRunIntegrity(t.root, runId, 'owner');
  expect(report).toMatchObject({ ok: true, runJsonValid: true, legacyLines: 0, pendingTail: false });
  expect(readRun(t.root, runId).status).toBe('running');
});

it('blocks the run once and records integrity.violation', async () => {
  tamperFirstLine();
  const report = await verifyRunIntegrity(t.root, runId, 'owner');
  expect(report.ok).toBe(false);
  expect(report.errors.join('\n')).toMatch(/line 2: prevHash mismatch/);
  expect(readRun(t.root, runId)).toMatchObject({ status: 'blocked' });
  expect(readRun(t.root, runId).blockedBy).toEqual([expect.objectContaining({ kind: 'integrity', reason: expect.stringMatching(/^integrity violation/) })]);
  await verifyRunIntegrity(t.root, runId, 'owner');
  expect(count('integrity.violation')).toBe(1);
});

it('records exactly one violation under concurrent verifies', async () => {
  tamperFirstLine();
  const reports = await Promise.all([1, 2, 3].map(() => verifyRunIntegrity(t.root, runId, 'owner')));
  expect(reports.every((r) => !r.ok)).toBe(true);
  expect(count('integrity.violation')).toBe(1);
  expect(readRun(t.root, runId).status).toBe('blocked');
});

it('treats an unterminated tail as pending, not a violation', async () => {
  fs.appendFileSync(busPath(t.root, runId), '{"seq":');
  const report = await verifyRunIntegrity(t.root, runId, 'owner');
  expect(report).toMatchObject({ ok: true, pendingTail: true });
  expect(readRun(t.root, runId).status).toBe('running');
  expect(count('integrity.violation')).toBe(0);
});

it('requires an acknowledgement to resume, then ignores the acknowledged incident', async () => {
  tamperFirstLine();
  await verifyRunIntegrity(t.root, runId, 'owner');
  await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
  await resumeRun(t.root, runId, 'owner', { acknowledgeIntegrity: { reason: 'reviewed: manual edit of line 1' } });
  expect(count('integrity.acknowledged')).toBe(1);
  expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(true);
  expect(readRun(t.root, runId).status).toBe('running');
});

it('still catches tampering that happens after an acknowledgement', async () => {
  tamperFirstLine();
  await verifyRunIntegrity(t.root, runId, 'owner');
  await resumeRun(t.root, runId, 'owner', { acknowledgeIntegrity: { reason: 'reviewed' } });
  await requestStop(t.root, runId, 'later', 'owner');
  const lines = readLines(busPath(t.root, runId));
  lines[lines.length - 1] = lines[lines.length - 1]!.replace('"reason":"later"', '"reason":"edited"');
  lines.push(lines[lines.length - 1]!); // duplicate the tampered line
  fs.writeFileSync(busPath(t.root, runId), lines.join('\n') + '\n');
  const report = await verifyRunIntegrity(t.root, runId, 'owner');
  const through = readRun(t.root, runId).integrityAcknowledged?.throughLine ?? 0;
  expect(report.ok).toBe(false);
  expect(report.errors.join('\n')).not.toMatch(/line 2:/);
  for (const e of report.errors) expect(Number(/^line (\d+):/.exec(e)?.[1])).toBeGreaterThan(through);
  // The run was stopped first: it stays stopped, with the integrity cause recorded (M1).
  expect(readRun(t.root, runId)).toMatchObject({ status: 'stopped', blockedBy: [expect.objectContaining({ kind: 'integrity' })] });
});

it('reports an invalid run.json without throwing', async () => {
  fs.writeFileSync(runJsonPath(t.root, runId), '{"runId":"broken"}');
  const report = await verifyRunIntegrity(t.root, runId, 'owner');
  expect(report).toMatchObject({ ok: false, runJsonValid: false });
  expect(report.errors.join('\n')).toMatch(/run.json/);
});

it('stays total when the log has a torn tail on top of tampering', async () => {
  tamperFirstLine();
  fs.appendFileSync(busPath(t.root, runId), '{"seq":');
  const report = await verifyRunIntegrity(t.root, runId, 'owner');
  expect(report.ok).toBe(false);
  expect(report.errors.join('\n')).toMatch(/cannot record integrity.violation/);
  expect(readRun(t.root, runId).status).toBe('blocked');
});

it('reports on a completed run but never blocks or reopens it', async () => {
  const state = readRun(t.root, runId);
  fs.writeFileSync(runJsonPath(t.root, runId), JSON.stringify({ ...state, status: 'completed' }, null, 2));
  tamperFirstLine();
  const report = await verifyRunIntegrity(t.root, runId, 'owner');
  expect(report.ok).toBe(false);
  expect(readRun(t.root, runId).status).toBe('completed');
  expect(count('integrity.violation')).toBe(0);
});

it('reports a missing run without throwing or creating lock files', async () => {
  const missing = 'RUN-20260929-099';
  const report = await verifyRunIntegrity(t.root, missing, 'owner');
  expect(report).toMatchObject({ ok: false, runJsonValid: false });
  expect(report.errors.join('\n')).toMatch(/not found/);
  expect(fs.existsSync(runJsonPath(t.root, missing).replace('run.json', 'integrity.lock'))).toBe(false);
});

const writeLines = (lines: string[]) => fs.writeFileSync(busPath(t.root, runId), lines.map((l) => l + '\n').join(''));
const ack = (reason = 'reviewed') => resumeRun(t.root, runId, 'owner', { acknowledgeIntegrity: { reason } });

describe('overwrite, emptying and truncation (F1)', () => {
  it('flags a log replaced wholesale with hand-written lines and blocks the run', async () => {
    writeLines([
      JSON.stringify({ type: 'run.created', ts: '2026-09-29T00:00:00.000Z', runId, profile: 'full', environment: 'development', modules: ['AUTH'] }),
      JSON.stringify({ type: 'run.resumed', ts: '2026-09-29T00:00:01.000Z', runId, phase: 'intake' }),
    ]);
    const report = await verifyRunIntegrity(t.root, runId, 'owner');
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/legacy or hand-written lines in a chained run/);
    expect(report.errors.join('\n')).toMatch(/log does not start with run.created/);
    expect(readRun(t.root, runId).status).toBe('blocked');
  });

  it('flags an emptied log', async () => {
    fs.writeFileSync(busPath(t.root, runId), '');
    const report = await verifyRunIntegrity(t.root, runId, 'owner');
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/no chained events/);
    expect(readRun(t.root, runId).status).toBe('blocked');
  });

  it('records a checkpoint after an ok verify and flags truncation behind it', async () => {
    expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(true);
    expect(readRun(t.root, runId).integrityCheckpoint).toMatchObject({ seq: 3 });
    writeLines(readLines(busPath(t.root, runId)).slice(0, 1));
    const report = await verifyRunIntegrity(t.root, runId, 'owner');
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('log truncated or rewritten before checkpoint seq 3');
    expect(readRun(t.root, runId).status).toBe('blocked');
  });

  it('flags a rewrite of the checkpointed last line', async () => {
    await verifyRunIntegrity(t.root, runId, 'owner');
    const lines = readLines(busPath(t.root, runId));
    lines[2] = lines[2]!.replace('"phase":"intake"', '"phase":"scan"');
    writeLines(lines);
    const report = await verifyRunIntegrity(t.root, runId, 'owner');
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('log truncated or rewritten before checkpoint seq 3');
  });
});

describe('acknowledged prefix is pinned (F2)', () => {
  beforeEach(async () => {
    tamperFirstLine();
    await verifyRunIntegrity(t.root, runId, 'owner');
    await ack('reviewed: manual edit of line 1');
  });

  it('stores exactly what was acknowledged in run.json and the event', () => {
    const state = readRun(t.root, runId);
    const lines = readLines(busPath(t.root, runId));
    const stored = state.integrityAcknowledged!;
    expect(stored.throughLine).toBe(5);
    expect(stored.errors).toEqual(['line 2: prevHash mismatch (previous line altered, removed or inserted)']);
    const event = lines.map((l) => JSON.parse(l)).find((e) => e.type === 'integrity.acknowledged');
    expect(event).toMatchObject({ throughLine: 5, lineHash: stored.lineHash, errors: stored.errors });
  });

  it('the acknowledged incident alone verifies ok', async () => {
    expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(true);
  });

  it('flags deleted lines inside the acknowledged prefix', async () => {
    const lines = readLines(busPath(t.root, runId));
    writeLines([lines[0]!, ...lines.slice(3)]);
    const report = await verifyRunIntegrity(t.root, runId, 'owner');
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('acknowledged prefix altered');
  });

  it('flags a rewrite of another line inside the acknowledged prefix', async () => {
    const lines = readLines(busPath(t.root, runId));
    lines[2] = lines[2]!.replace('"phase":"intake"', '"phase":"scan"');
    writeLines(lines);
    expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(false);
  });

  it('flags a second rewrite of the already-acknowledged line', async () => {
    const lines = readLines(busPath(t.root, runId));
    lines[0] = lines[0]!.replace('"environment":"production"', '"environment":"staging"');
    writeLines(lines);
    const report = await verifyRunIntegrity(t.root, runId, 'owner');
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('acknowledged prefix altered');
  });
});

describe('acknowledgement rules (F3, F4)', () => {
  it('only the owner may acknowledge an integrity violation', async () => {
    tamperFirstLine();
    await verifyRunIntegrity(t.root, runId, 'owner');
    await expect(
      resumeRun(t.root, runId, 'qa-orchestrator', { acknowledgeIntegrity: { reason: 'looks fine' } }),
    ).rejects.toMatchObject({ code: 'caller-forbidden' });
    expect(readRun(t.root, runId).status).toBe('blocked');
    expect(count('integrity.acknowledged')).toBe(0);
  });

  it('refuses an acknowledgement when no violation was recorded', async () => {
    tamperFirstLine();
    await requestStop(t.root, runId, 'pause', 'owner');
    await expect(ack()).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/no recorded integrity violation to acknowledge/) });
    expect(count('integrity.acknowledged')).toBe(0);
    expect(readRun(t.root, runId).status).toBe('stopped');
  });
});

describe('block interplay (F6, C7)', () => {
  it('a stopped integrity-blocked run verified again records no second violation', async () => {
    tamperFirstLine();
    await verifyRunIntegrity(t.root, runId, 'owner');
    await requestStop(t.root, runId, 'pause', 'owner');
    expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(false);
    expect(count('integrity.violation')).toBe(1);
    expect(count('run.blocked')).toBe(1);
    await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('an integrity cause joins a preflight cause and requires an acknowledgement', async () => {
    await blockRun(t.root, runId, { kind: 'preflight', reason: 'preflight: health check failed' }, 'qa-orchestrator');
    tamperFirstLine();
    expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(false);
    expect(readRun(t.root, runId).blockedBy.map((c) => c.kind)).toEqual(['preflight', 'integrity']);
    await expect(resumeRun(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
    expect((await ack()).status).toBe('running');
  });
});
