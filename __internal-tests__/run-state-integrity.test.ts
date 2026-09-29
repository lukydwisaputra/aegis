import * as fs from 'fs';
import { readLines } from '@qa/event-bus';
import { busPath, createRun, readRun, requestStop, resumeRun, runJsonPath, verifyRunIntegrity } from '@qa/run-state';
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
  expect(readRun(t.root, runId).blockedReason).toMatch(/^integrity violation/);
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
  expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(false);
});

it('reports an invalid run.json without throwing', async () => {
  fs.writeFileSync(runJsonPath(t.root, runId), '{"runId":"broken"}');
  const report = await verifyRunIntegrity(t.root, runId, 'owner');
  expect(report).toMatchObject({ ok: false, runJsonValid: false });
  expect(report.errors.join('\n')).toMatch(/run.json/);
});
