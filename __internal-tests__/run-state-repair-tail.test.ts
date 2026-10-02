import * as fs from 'fs';
import * as path from 'path';
import { readLines, repairTornTail } from '@qa/event-bus';
import { assertCallerAllowed, busPath, createRun, repairTail, requestStop, runDir, verifyRunIntegrity } from '@qa/run-state';
import { createRequire } from 'module';
import { last, makeAegisRoot, thrownCode, type TmpAegis } from './helpers/aegis-root';

// proper-lockfile is a dependency of event-bus/run-state, not of the tests: resolve the same instance they use
const lockfile = createRequire(path.join(__dirname, '..', 'packages', '@qa', 'run-state', 'package.json'))('proper-lockfile') as typeof import('proper-lockfile');

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
  const cleanBytes = fs.statSync(busPath(t.root, runId)).size;
  tear();
  await expect(requestStop(t.root, runId, 'pause', 'owner')).rejects.toThrow(/torn tail.*integrity repair-tail.*--run <runId>/);
  const res = await repairTail(t.root, runId, 'owner');
  expect(res).toMatchObject({ runId, removedBytes: 15 });
  expect(fs.readFileSync(path.join(runDir(t.root, runId), res.savedTo), 'utf-8')).toBe('{"seq":2,"prevH');
  expect(JSON.parse(last(readLines(busPath(t.root, runId))))).toMatchObject({
    type: 'integrity.tail-repaired', seq: 2, removedBytes: 15, removedSha256: res.removedSha256, savedTo: res.savedTo, emittedBy: 'owner', keptBytes: cleanBytes, atSeq: 1,
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
  const res = await repairTornTail(busPath(t.root, runId), ({ bytes }) => {
    seen.push(bytes.toString('utf-8'));
    expect(fs.readFileSync(busPath(t.root, runId), 'utf-8').endsWith('{"broken')).toBe(true);
  });
  expect(res!.tail.bytes.toString('utf-8')).toBe('{"broken');
  expect(res!.record).toBeNull();
  expect(seen).toEqual(['{"broken']);
  expect(fs.readFileSync(busPath(t.root, runId), 'utf-8').endsWith('\n')).toBe(true);
});

it('cuts a tail split inside a UTF-8 sequence, and a lone CR; removedBytes is the byte length', async () => {
  const split = Buffer.from('{"a":"\u00e9').subarray(0, -1);
  fs.appendFileSync(busPath(t.root, runId), split);
  expect((await repairTail(t.root, runId, 'owner')).removedBytes).toBe(split.length);
  fs.appendFileSync(busPath(t.root, runId), '\r');
  expect((await repairTail(t.root, runId, 'owner')).removedBytes).toBe(1);
});

it('refuses a whole JSON line that ends in CR (CRLF waiting for its LF)', async () => {
  tear('{"type":"x"}\r');
  await expect(repairTail(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input' });
});

it('refuses with invalid-input when run.json exists but the event log is missing', async () => {
  fs.rmSync(busPath(t.root, runId));
  await expect(repairTail(t.root, runId, 'owner')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/event log missing/) });
});

it('saves under a unique name: two repairs at the same instant do not collide; savedTo is posix', async () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  tear('{"a');
  const a = await repairTail(t.root, runId, 'owner', now);
  tear('{"a');
  const b = await repairTail(t.root, runId, 'owner', now);
  expect(a.savedTo).toMatch(/^integrity\/torn-tail\.[\w-]+-\d+-[0-9a-f]{6}\.bin$/);
  expect(b.savedTo).not.toBe(a.savedTo);
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

  it('never truncates when keep is asynchronous (a thenable)', async () => {
    tear('{"broken');
    const before = fs.readFileSync(busPath(t.root, runId));
    await expect(repairTornTail(busPath(t.root, runId), (() => Promise.resolve()) as never)).rejects.toThrow(/synchronous/);
    expect(fs.readFileSync(busPath(t.root, runId)).equals(before)).toBe(true);
  });

  it('never truncates when the saved file is short (a partial write), and removes the partial file', async () => {
    tear('{"seq":2,"prevH');
    const before = fs.readFileSync(busPath(t.root, runId));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rawFs = require('fs') as typeof fs;
    const real = rawFs.writeFileSync;
    jest.spyOn(rawFs, 'writeFileSync').mockImplementation(((target: never, data: Buffer, ...rest: never[]) =>
      typeof target === 'number' ? real(target, data.subarray(0, 3)) : real(target, data, ...rest)) as never);
    await expect(repairTail(t.root, runId, 'owner')).rejects.toThrow(/short|size/);
    jest.restoreAllMocks();
    expect(fs.readFileSync(busPath(t.root, runId)).equals(before)).toBe(true);
    expect(fs.readdirSync(path.join(runDir(t.root, runId), 'integrity'))).toEqual([]);
  });

  it('never truncates when the log changed since it was read', async () => {
    tear('{"broken');
    const before = fs.readFileSync(busPath(t.root, runId));
    await expect(repairTornTail(busPath(t.root, runId), () => fs.appendFileSync(busPath(t.root, runId), 'more'))).rejects.toThrow(/changed/);
    expect(fs.readFileSync(busPath(t.root, runId)).equals(Buffer.concat([before, Buffer.from('more')]))).toBe(true);
  });
});

it('the cut and its record are one bus-lock hold', async () => {
  tear();
  const calls: string[] = [];
  const real = lockfile.lock;
  jest.spyOn(lockfile, 'lock').mockImplementation(((p: string, o: never) => { calls.push(path.basename(p)); return real(p, o); }) as never);
  await repairTail(t.root, runId, 'owner');
  expect(calls).toEqual(['integrity.lock', 'events.jsonl']);
});

it('saves the cut bytes and fsyncs them before the log is truncated', async () => {
  tear('{"seq":2,"prevH');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rawFs = require('fs') as typeof fs; // the ES namespace import is read-only; the module object is spy-able
  const order: string[] = [];
  const realFsync = rawFs.fsyncSync;
  const realTruncate = rawFs.ftruncateSync;
  let savedAtFsync = '';
  let dirFsyncs = 0;
  jest.spyOn(rawFs, 'fsyncSync').mockImplementation((fd: number) => {
    const dir = path.join(runDir(t.root, runId), 'integrity');
    if (fs.existsSync(dir) && order.every((o) => o !== 'fsync')) {
      order.push('fsync');
      savedAtFsync = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf-8')).join('|');
    }
    if (rawFs.fstatSync(fd).isDirectory()) dirFsyncs++;
    return realFsync(fd);
  });
  jest.spyOn(rawFs, 'ftruncateSync').mockImplementation((p, len) => {
    order.push('truncate');
    return realTruncate(p, len);
  });
  await repairTail(t.root, runId, 'owner');
  expect(order.slice(0, 2)).toEqual(['fsync', 'truncate']);
  expect(dirFsyncs).toBeGreaterThanOrEqual(2); // integrity/ and the run dir it was created in
  expect(savedAtFsync).toBe('{"seq":2,"prevH');
});

describe('locks: integrity.lock, then the bus lock', () => {
  it('waits for a held bus lock and cuts nothing until it is released', async () => {
    tear();
    const before = fs.readFileSync(busPath(t.root, runId));
    const releaseBus = await lockfile.lock(busPath(t.root, runId), { stale: 10_000, update: 2_000 });
    const p = repairTail(t.root, runId, 'owner');
    const integrityLock = path.join(runDir(t.root, runId), 'integrity.lock.lock');
    for (let i = 0; i < 100 && !fs.existsSync(integrityLock); i++) await sleep(20);
    expect(fs.existsSync(integrityLock)).toBe(true); // integrity.lock is held while it waits for the bus
    expect(fs.readFileSync(busPath(t.root, runId)).equals(before)).toBe(true);
    await releaseBus();
    await expect(p).resolves.toMatchObject({ removedBytes: 15 });
  });
});

describe('the cut is never clean without its record', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rawFs = require('fs') as typeof fs;
  const recorded = () => readLines(busPath(t.root, runId)).some((l) => l.includes('"integrity.tail-repaired"'));
  const endsClean = () => fs.readFileSync(busPath(t.root, runId), 'utf-8').endsWith('\n');

  it('when the truncate throws after the record was written: the record is there, or the tail is still torn', async () => {
    tear('{"seq":2,"prevHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    jest.spyOn(rawFs, 'ftruncateSync').mockImplementation(() => { throw new Error('EIO'); });
    await expect(repairTail(t.root, runId, 'owner')).rejects.toThrow('EIO');
    jest.restoreAllMocks();
    expect(recorded() || !endsClean()).toBe(true);
    expect(!endsClean() && !recorded()).toBe(false);
  });

  it('when the record write throws: the log is byte-identical, and a retry succeeds and is recorded', async () => {
    tear();
    const before = fs.readFileSync(busPath(t.root, runId));
    jest.spyOn(rawFs, 'writeSync').mockImplementation(() => { throw new Error('ENOSPC'); });
    await expect(repairTail(t.root, runId, 'owner')).rejects.toThrow('ENOSPC');
    jest.restoreAllMocks();
    expect(fs.readFileSync(busPath(t.root, runId)).equals(before)).toBe(true);
    await expect(repairTail(t.root, runId, 'owner')).resolves.toMatchObject({ removedBytes: 15 });
    expect(recorded()).toBe(true);
    expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(true);
  });

  it('an invalid record cuts nothing and leaves no saved file', async () => {
    tear();
    const before = fs.readFileSync(busPath(t.root, runId));
    await expect(
      repairTornTail(busPath(t.root, runId), () => { throw new Error('keep must not run'); }, {
        ctx: { emittedBy: 'owner', runId },
        event: () => ({ type: 'integrity.tail-repaired', runId, bogus: true }),
      }),
    ).rejects.toThrow(/schema|undeclared/);
    expect(fs.readFileSync(busPath(t.root, runId)).equals(before)).toBe(true);
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'integrity'))).toBe(false);
  });

  it('a record shorter than the torn tail leaves no remnant of the tail', async () => {
    tear('{"seq":2,"prevHash":"' + 'a'.repeat(400));
    await repairTail(t.root, runId, 'owner');
    expect(endsClean()).toBe(true);
    expect((await verifyRunIntegrity(t.root, runId, 'owner')).ok).toBe(true);
  });
});
