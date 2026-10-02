import * as fs from 'fs';
import * as path from 'path';
import { readLines, repairTornTail } from '@qa/event-bus';
import { assertCallerAllowed, busPath, createRun, repairTail, requestStop, runDir, verifyRunIntegrity } from '@qa/run-state';
import { last, makeAegisRoot, thrownCode, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});
afterEach(() => {
  jest.restoreAllMocks();
  t.cleanup();
});

const tear = (s = '{"seq":2,"prevH') => fs.appendFileSync(busPath(t.root, runId), s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

it('a torn tail refuses every append; the owner repairs it and appends work again (CO-02)', async () => {
  tear();
  await expect(requestStop(t.root, runId, 'pause', 'owner')).rejects.toThrow(/torn tail.*integrity repair-tail/);
  const res = await repairTail(t.root, runId, 'owner');
  expect(res).toMatchObject({ runId, removedBytes: 15 });
  expect(fs.readFileSync(path.join(runDir(t.root, runId), res.savedTo), 'utf-8')).toBe('{"seq":2,"prevH');
  expect(JSON.parse(last(readLines(busPath(t.root, runId))))).toMatchObject({
    type: 'integrity.tail-repaired', seq: 2, removedBytes: 15, removedSha256: res.removedSha256, savedTo: res.savedTo, emittedBy: 'owner',
  });
  await requestStop(t.root, runId, 'pause', 'owner');
  expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(true);
});

it('refuses when nothing is torn: a clean log, or a complete line still waiting for its newline', async () => {
  await expect(repairTail(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
  tear(JSON.stringify({ type: 'x' }));
  await expect(repairTail(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
});

it('is owner-only', async () => {
  expect(thrownCode(() => assertCallerAllowed('qa-orchestrator', 'integrity.repair-tail'))).toBe('caller-forbidden');
  expect(thrownCode(() => assertCallerAllowed('owner', 'integrity.repair-tail'))).toBeUndefined();
  tear();
  const before = fs.readFileSync(busPath(t.root, runId));
  await expect(repairTail(t.root, runId, 'qa-orchestrator')).rejects.toMatchObject({ code: 'caller-forbidden' });
  expect(fs.readFileSync(busPath(t.root, runId)).equals(before)).toBe(true);
});

it('repairTornTail hands over the bytes before it truncates', async () => {
  tear('{"broken');
  const seen: string[] = [];
  const tail = await repairTornTail(busPath(t.root, runId), ({ bytes }) => {
    seen.push(bytes.toString('utf-8'));
    expect(fs.readFileSync(busPath(t.root, runId), 'utf-8').endsWith('{"broken')).toBe(true);
  });
  expect(tail!.bytes.toString('utf-8')).toBe('{"broken');
  expect(seen).toEqual(['{"broken']);
  expect(fs.readFileSync(busPath(t.root, runId), 'utf-8').endsWith('\n')).toBe(true);
});

describe('safety: it only ever cuts an unterminated, non-JSON tail', () => {
  it('keeps every byte up to and including the last newline', async () => {
    const prefix = fs.readFileSync(busPath(t.root, runId));
    tear('{"seq":2,"type":"half');
    await repairTail(t.root, runId, 'owner');
    expect(fs.readFileSync(busPath(t.root, runId)).subarray(0, prefix.length).equals(prefix)).toBe(true);
  });

  it.each([['a clean log', ''], ['a whole JSON line without its newline', '{"type":"x"}'], ['a bare JSON value', '123']])(
    'leaves %s byte for byte untouched and writes nothing',
    async (_n, extra) => {
      tear(extra);
      const before = fs.readFileSync(busPath(t.root, runId));
      expect(await repairTornTail(busPath(t.root, runId), () => { throw new Error('keep must not run'); })).toBeNull();
      await expect(repairTail(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
      expect(fs.readFileSync(busPath(t.root, runId)).equals(before)).toBe(true);
      expect(fs.existsSync(path.join(runDir(t.root, runId), 'integrity'))).toBe(false);
    },
  );

  it('never truncates when the save fails', async () => {
    tear('{"broken');
    const before = fs.readFileSync(busPath(t.root, runId));
    const keepFails = () => repairTornTail(busPath(t.root, runId), () => { throw new Error('disk full'); });
    await expect(keepFails()).rejects.toThrow('disk full');
    expect(fs.readFileSync(busPath(t.root, runId)).equals(before)).toBe(true);
  });
});

it('saves the cut bytes and fsyncs them before the log is truncated', async () => {
  tear('{"seq":2,"prevH');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rawFs = require('fs') as typeof fs; // the ES namespace import is read-only; the module object is spy-able
  const order: string[] = [];
  const realFsync = rawFs.fsyncSync;
  const realTruncate = rawFs.truncateSync;
  let savedAtFsync = '';
  jest.spyOn(rawFs, 'fsyncSync').mockImplementation((fd: number) => {
    const dir = path.join(runDir(t.root, runId), 'integrity');
    if (fs.existsSync(dir) && order.every((o) => o !== 'fsync')) {
      order.push('fsync');
      savedAtFsync = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf-8')).join('|');
    }
    return realFsync(fd);
  });
  jest.spyOn(rawFs, 'truncateSync').mockImplementation((p, len) => {
    order.push('truncate');
    return realTruncate(p, len);
  });
  await repairTail(t.root, runId, 'owner');
  expect(order.slice(0, 2)).toEqual(['fsync', 'truncate']);
  expect(savedAtFsync).toBe('{"seq":2,"prevH');
});

describe('locks: integrity.lock, then the bus lock', () => {
  it('waits for the bus lock and holds integrity.lock while it waits', async () => {
    tear();
    const before = fs.readFileSync(busPath(t.root, runId));
    const busLock = `${busPath(t.root, runId)}.lock`;
    const integrityLock = path.join(runDir(t.root, runId), 'integrity.lock.lock');
    fs.mkdirSync(busLock);
    let done = false;
    const p = repairTail(t.root, runId, 'owner').finally(() => { done = true; });
    await sleep(500);
    expect(done).toBe(false);
    expect(fs.existsSync(integrityLock)).toBe(true);
    expect(fs.readFileSync(busPath(t.root, runId)).equals(before)).toBe(true);
    fs.rmdirSync(busLock);
    await expect(p).resolves.toMatchObject({ removedBytes: 15 });
    expect(fs.existsSync(integrityLock)).toBe(false);
  });

  it('waits for integrity.lock before it touches the bus', async () => {
    tear();
    const before = fs.readFileSync(busPath(t.root, runId));
    const integrityLock = path.join(runDir(t.root, runId), 'integrity.lock.lock');
    fs.writeFileSync(path.join(runDir(t.root, runId), 'integrity.lock'), '');
    fs.mkdirSync(integrityLock);
    let done = false;
    const p = repairTail(t.root, runId, 'owner').finally(() => { done = true; });
    await sleep(500);
    expect(done).toBe(false);
    expect(fs.readFileSync(busPath(t.root, runId)).equals(before)).toBe(true);
    fs.rmdirSync(integrityLock);
    await expect(p).resolves.toMatchObject({ removedBytes: 15 });
  });
});
