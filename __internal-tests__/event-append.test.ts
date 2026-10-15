import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { appendChained, EventBusRefusal } from '@qa/event-bus';
import { busPath } from '@qa/run-state';
import { readBoundedFile, readJsonFile, type JsonFileIo } from '../apps/cli/src/commands/json-file';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';

// `event append`: schema refusals read like the submit refusals (field path and limit), and the fields come from --json or --json-file.

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);
const AGENT = 'qa-ui-specialist';
let t: TmpAegis;
let runId: string;
beforeEach(async () => {
  t = makeAegisRoot();
  runId = await startedRun(t.root);
});
afterEach(() => t.cleanup());

const aegis = (args: string[], input?: string) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: t.root, encoding: 'utf-8', input, env: { ...process.env, AEGIS_AGENT: AGENT, AEGIS_ROOT: t.root } });
  const parse = (s: string) => { try { return JSON.parse(s); } catch { return s; } };
  return { status: r.status, out: parse(r.stdout), err: parse(r.stderr) as { error?: string; message?: string } };
};
const events = (type: string): Array<Record<string, unknown>> =>
  fs.readFileSync(busPath(t.root, runId), 'utf-8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e['type'] === type);
const ctest = stale ? it.skip : it;
const FRAMEWORK = ['event', 'append', '--type', 'framework.defect-suspected'];
const fields = (over: Record<string, unknown> = {}) => ({ component: 'cli', symptom: 'the command answered nothing at all', evidence: ['reports/x.json'], ...over });

describe('the bus formats schema issues with the field path and the limit', () => {
  const bus = () => path.join(t.root, 'bus.jsonl');
  const ctx = () => ({ emittedBy: AGENT, runId });
  const ts = '2026-10-15T00:00:00.000Z';
  const refusal = async (event: Record<string, unknown>): Promise<string> => {
    try {
      await appendChained({ ts, runId, ...event }, bus(), ctx());
    } catch (e) {
      expect(e).toBeInstanceOf(EventBusRefusal);
      return (e as Error).message;
    }
    throw new Error('not refused');
  };

  it('an over-long string names the field, the limit and the length', async () => {
    const m = await refusal({ type: 'framework.defect-suspected', ...fields({ component: 'c'.repeat(250) }) });
    expect(m).toContain('component: longer than 200 characters (got 250)');
    expect(m.startsWith('EventBus schema validation failed: ')).toBe(true);
    expect(m).not.toContain('"code"');
    expect(m).not.toContain('ccccccccc');
  });

  it('a short string, an enum, a type and a missing field read the same way, one issue after the other', async () => {
    const m = await refusal({ type: 'framework.defect-suspected', component: '', symptom: 'short', evidence: [] });
    expect(m).toContain('component: shorter than 1 characters (got 0)');
    expect(m).toContain('symptom: shorter than 10 characters (got 5)');
    expect(m).toContain('evidence: fewer than 1 items (got 0)');
    expect(await refusal({ type: 'discovery.step-complete', step: 'x', artifact: 'a' })).toContain('step: must be one of scan, explore');
    expect(await refusal({ type: 'discovery.step-complete', step: 'scan', artifact: 7 })).toContain('artifact: expected string, got number');
    expect(await refusal({ type: 'discovery.step-complete', step: 'scan' })).toContain('artifact: required');
    expect(await refusal({ type: 'made.up' })).toMatch(/type: not a registered event type; copy the type exactly as your instructions name it/);
  });
});

(stale ? describe.skip : describe)('event append over the CLI', () => {
  ctest('an over-long exact field (component) is refused with its path and limit; nothing is recorded', () => {
    const r = aegis([...FRAMEWORK, '--json', JSON.stringify(fields({ component: 'c'.repeat(250) }))]);
    expect(r.status).toBe(2);
    expect(r.err.message).toContain('component: longer than 200 characters (got 250)');
    expect(events('framework.defect-suspected')).toHaveLength(0);
  }, 60_000);

  ctest('an over-long narrative field is still cut, as before', () => {
    const r = aegis([...FRAMEWORK, '--json', JSON.stringify(fields({ symptom: 's'.repeat(340) }))]);
    expect(r.status).toBe(0);
    expect(r.out.trimmed).toEqual([expect.objectContaining({ field: 'symptom', from: 340 })]);
  }, 60_000);

  ctest('--json that is not JSON names the fix, and the event type enum refusal does too', () => {
    const bad = aegis([...FRAMEWORK, '--json', '{nope']);
    expect(bad.err.message).toMatch(/^--json is not valid JSON: give one JSON object/);
    expect(bad.err.message).toContain('--json-file <path>');
    const type = aegis(['event', 'append', '--type', 'made.up', '--json', '{}']);
    expect(type.err.message).toContain('type: not a registered event type; copy the type exactly as your instructions name it');
  }, 60_000);
});

(stale ? describe.skip : describe)('event append --json-file', () => {
  const write = (name: string, body: string | Buffer) => {
    const f = path.join(t.root, name);
    fs.writeFileSync(f, body);
    return f;
  };

  ctest('reads the fields from a file, with the same validation as --json', () => {
    const f = write('fields.json', JSON.stringify(fields()));
    const ok = aegis([...FRAMEWORK, '--json-file', f]);
    expect(ok.status).toBe(0);
    expect(events('framework.defect-suspected')).toEqual([expect.objectContaining({ component: 'cli', emittedBy: AGENT })]);
    const over = aegis([...FRAMEWORK, '--json-file', write('over.json', JSON.stringify(fields({ component: 'c'.repeat(250) })))]);
    expect(over.status).toBe(2);
    expect(over.err.message).toContain('component: longer than 200 characters (got 250)');
    const cut = aegis([...FRAMEWORK, '--json-file', write('cut.json', JSON.stringify(fields({ symptom: 's'.repeat(340) })))]);
    expect(cut.out.trimmed).toEqual([expect.objectContaining({ field: 'symptom' })]);
    const undeclared = aegis([...FRAMEWORK, '--json-file', write('extra.json', JSON.stringify(fields({ bogus: 1 })))]);
    expect(undeclared.err.message).toMatch(/undeclared field/);
  }, 60_000);

  ctest('reads /dev/stdin', () => {
    const r = aegis([...FRAMEWORK, '--json-file', '/dev/stdin'], JSON.stringify(fields({ component: 'from stdin' })));
    expect(r.status).toBe(0);
    expect(events('framework.defect-suspected')).toEqual([expect.objectContaining({ component: 'from stdin' })]);
    const bad = aegis([...FRAMEWORK, '--json-file', '/dev/stdin'], '{nope');
    expect(bad.status).toBe(2);
    expect(bad.err.message).toContain('--json-file /dev/stdin does not hold valid JSON');
  }, 60_000);

  ctest('both options, or neither with no default, are refused', () => {
    const f = write('fields.json', JSON.stringify(fields()));
    const both = aegis([...FRAMEWORK, '--json', JSON.stringify(fields()), '--json-file', f]);
    expect(both.status).toBe(2);
    expect(both.err.message).toBe('give the event fields with --json or with --json-file, not both');
    const none = aegis([...FRAMEWORK]);
    expect(none.status).toBe(2);
    expect(none.err.message).toBe('give the event fields with --json <object> or --json-file <path> (an event with no fields: --json {})');
    expect(events('framework.defect-suspected')).toHaveLength(0);
  }, 60_000);

  ctest('a file over 1 MB, and a stream with no end (/dev/zero), are refused after reading at most 1 MB + 1 byte', () => {
    const big = write('big.json', JSON.stringify(fields({ symptom: 'x'.repeat(1024 * 1024) })));
    const r = aegis([...FRAMEWORK, '--json-file', big]);
    expect(r.status).toBe(2);
    expect(r.err.message).toBe(`--json-file ${big} is larger than 1048576 bytes: an event holds its fields only`);
    const zero = aegis([...FRAMEWORK, '--json-file', '/dev/zero']);
    expect(zero.status).toBe(2);
    expect(zero.err.message).toBe('--json-file /dev/zero is larger than 1048576 bytes: an event holds its fields only');
    const piped = aegis([...FRAMEWORK, '--json-file', '/dev/stdin'], 'a'.repeat(1024 * 1024 + 10));
    expect(piped.err.message).toBe('--json-file /dev/stdin is larger than 1048576 bytes: an event holds its fields only');
    expect(events('framework.defect-suspected')).toHaveLength(0);
  }, 60_000);

  ctest('a missing file names its path; a directory and a file that is not UTF-8 text are refused', () => {
    const missing = path.join(t.root, 'nowhere', 'fields.json');
    const r = aegis([...FRAMEWORK, '--json-file', missing]);
    expect(r.status).toBe(2);
    expect(r.err.message).toBe(`--json-file ${missing} cannot be read: no such file`);
    const dir = aegis([...FRAMEWORK, '--json-file', t.root]);
    expect(dir.err.message).toBe(`--json-file ${t.root} cannot be read: not a file`);
    const bin = write('bin.json', Buffer.from([0x7b, 0xff, 0xfe, 0x7d]));
    expect(aegis([...FRAMEWORK, '--json-file', bin]).err.message).toBe(`--json-file ${bin} is not UTF-8 text`);
    const array = write('array.json', '[1]');
    expect(aegis([...FRAMEWORK, '--json-file', array]).err.message).toBe(`--json-file ${array} must hold a JSON object`);
  }, 60_000);
});

describe('the --json-file reader takes standard input from fd 0, never by opening its path', () => {
  // On Linux, opening /dev/stdin (/proc/self/fd/0) fails with ENXIO when stdin is a socket (a harness or spawn pipe): the reader must not open it.
  const enxio = Object.assign(new Error('ENXIO: no such device or address'), { code: 'ENXIO' });
  const io = (chunks: Array<Buffer | string>, opened: string[], closed: number[], reads: number[] = []): JsonFileIo => {
    const queue = [...chunks];
    return {
      open: (file) => { opened.push(file); throw enxio; },
      isDirectory: () => false,
      read: (fd, buf) => {
        reads.push(fd);
        const next = queue.shift();
        if (next === undefined) return 0;
        if (typeof next === 'string') throw Object.assign(new Error(next), { code: next });
        return next.copy(buf);
      },
      close: (fd) => { closed.push(fd); },
    };
  };

  it.each(['/dev/stdin', '/proc/self/fd/0', '/dev/fd/0'])('%s is read through fd 0 even where opening the path fails with ENXIO', (p) => {
    const opened: string[] = [];
    const closed: number[] = [];
    const reads: number[] = [];
    expect(readJsonFile(p, io([Buffer.from('{"a":'), Buffer.from('1}')], opened, closed, reads))).toBe('{"a":1}');
    expect(opened).toEqual([]);
    expect(closed).toEqual([]);
    expect(new Set(reads)).toEqual(new Set([0]));
  });

  it('a stdin with no data yet (EAGAIN) is retried, and an EOF code ends the input', () => {
    expect(readJsonFile('/dev/stdin', io(['EAGAIN', Buffer.from('{}'), 'EOF'], [], []))).toBe('{}');
  });

  it('stdin over the limit is refused after 1 MB + 1 byte', () => {
    let given = 0;
    const endless: JsonFileIo = { open: () => { throw enxio; }, isDirectory: () => false, read: (_fd, buf, length) => { given += length; buf.fill(97, 0, length); return length; }, close: () => undefined };
    expect(() => readJsonFile('/dev/stdin', endless)).toThrow('--json-file /dev/stdin is larger than 1048576 bytes');
    expect(given).toBe(1024 * 1024 + 1);
  });

  it('readBoundedFile names its own option and limit, and reads no more than that limit + 1 byte', () => {
    let given = 0;
    const endless: JsonFileIo = { open: () => { throw enxio; }, isDirectory: () => false, read: (_fd, buf, length) => { given += length; buf.fill(97, 0, length); return length; }, close: () => undefined };
    expect(() => readBoundedFile('/dev/stdin', { flag: '--file', maxBytes: 100, tooBigWhy: 'a report holds its fields only' }, endless)).toThrow('--file /dev/stdin is larger than 100 bytes: a report holds its fields only');
    expect(given).toBe(101);
    expect(() => readBoundedFile('/some/file.json', { flag: '--file' }, io([], [], []))).toThrow('--file /some/file.json cannot be read: ENXIO');
  });

  it('any other path is still opened (and closed), and a failed open names the path', () => {
    const opened: string[] = [];
    const closed: number[] = [];
    expect(() => readJsonFile('/some/file.json', io([], opened, closed))).toThrow('--json-file /some/file.json cannot be read: ENXIO');
    expect(opened).toEqual(['/some/file.json']);
    const ok: JsonFileIo = { open: () => 7, isDirectory: () => false, read: (() => { let first = true; return (_fd: number, buf: Buffer) => (first ? ((first = false), Buffer.from('{}').copy(buf)) : 0); })(), close: (fd) => { closed.push(fd); } };
    expect(readJsonFile('/some/file.json', ok)).toBe('{}');
    expect(closed).toEqual([7]);
  });
});
