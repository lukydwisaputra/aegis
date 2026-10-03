import * as fs from 'fs';
import { hashLine, readLines } from '@qa/event-bus';
import { busPath, createRun, readRun, requestStop, resumeRun, verifyRunIntegrity } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
beforeEach(() => { t = makeAegisRoot(); });
afterEach(() => t.cleanup());

const create = () => createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner');
const lines = (runId: string) => readLines(busPath(t.root, runId));
const write = (runId: string, ls: string[]) => fs.writeFileSync(busPath(t.root, runId), ls.join('\n') + '\n');

it('seeds the checkpoint from the run.created line (CO-03)', async () => {
  const { runId } = await create();
  const [first] = lines(runId);
  expect(readRun(t.root, runId).integrityCheckpoint).toEqual({ seq: 1, lineHash: hashLine(first!) });
  expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(true);
});

// The ordering of createRun (run.created before run.json) is pinned deterministically in run-state-createrun-order.test.ts (A6).

it('names the checkpointed line in the checkpoint error (CO-03)', async () => {
  const { runId } = await create();
  await requestStop(t.root, runId, 'pause', 'owner');
  await resumeRun(t.root, runId, 'owner');
  expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(true);
  const cp = readRun(t.root, runId).integrityCheckpoint!;
  write(runId, lines(runId).slice(0, 2));
  const report = await verifyRunIntegrity(t.root, runId, 'owner');
  expect(report.errors).toContain(`log truncated or rewritten before checkpoint seq ${cp.seq} (line ${cp.lineHash.slice(0, 12)})`);
});

it('an acknowledgement re-anchors the checkpoint, so cutting the acknowledgement away is caught (CO-03)', async () => {
  const { runId } = await create();
  await requestStop(t.root, runId, 'pause', 'owner');
  await resumeRun(t.root, runId, 'owner');
  await verifyRunIntegrity(t.root, runId, 'owner'); // checkpoint at seq 3
  write(runId, lines(runId).slice(0, 2)); // truncated behind the checkpoint
  expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(false);
  await resumeRun(t.root, runId, 'owner', { acknowledgeIntegrity: { reason: 'reviewed truncation' } });
  const ackLine = lines(runId).find((l) => JSON.parse(l).type === 'integrity.acknowledged')!;
  const ack = JSON.parse(ackLine);
  expect(readRun(t.root, runId).integrityCheckpoint).toEqual({ seq: ack.seq, lineHash: hashLine(ackLine) });
  // Keep the acknowledged prefix intact, cut the acknowledgement and everything after it.
  write(runId, lines(runId).slice(0, ack.throughLine));
  const report = await verifyRunIntegrity(t.root, runId, 'owner');
  expect(report.ok).toBe(false);
  expect(report.errors).toContain(`log truncated or rewritten before checkpoint seq ${ack.seq} (line ${hashLine(ackLine).slice(0, 12)})`);
});
