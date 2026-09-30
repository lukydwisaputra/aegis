import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appendChained, hashLine, readLines, verifyChain } from '@qa/event-bus';
import { GENESIS_HASH } from '@qa/contracts';

const TS = '2026-09-29T00:00:00.000Z';
const RUN = 'RUN-20260929-001';
const ctx = { emittedBy: 'qa-orchestrator', runId: RUN };

let dir: string;
let bus: string;

const blocked = (reason: string) => ({ type: 'run.blocked', ts: TS, runId: RUN, reason });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-chain-'));
  bus = path.join(dir, 'events.jsonl');
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('appendChained', () => {
  it('writes seq 1 with the genesis hash and the envelope', async () => {
    await appendChained(blocked('a'), bus, ctx);
    const [line] = readLines(bus);
    const rec = JSON.parse(line!);
    expect(rec).toMatchObject({ seq: 1, prevHash: GENESIS_HASH, emittedBy: 'qa-orchestrator', runId: RUN, type: 'run.blocked' });
  });

  it('links each line to the hash of the previous raw line', async () => {
    await appendChained(blocked('a'), bus, ctx);
    await appendChained(blocked('b'), bus, ctx);
    const lines = readLines(bus);
    const second = JSON.parse(lines[1]!);
    expect(second.seq).toBe(2);
    expect(second.prevHash).toBe(hashLine(lines[0]!));
  });

  it('adds runId to events that do not declare it', async () => {
    await appendChained({ type: 'task.claimed', ts: TS, taskId: 'T-1', agent: 'qa-ui-specialist' }, bus, ctx);
    expect(JSON.parse(readLines(bus)[0]!).runId).toBe(RUN);
  });

  it('rejects undeclared fields and leaves the log untouched', async () => {
    await appendChained(blocked('a'), bus, ctx);
    const before = fs.readFileSync(bus, 'utf8');
    await expect(appendChained({ ...blocked('b'), reasn: 'typo' }, bus, ctx)).rejects.toThrow(/undeclared field\(s\).*reasn/);
    expect(fs.readFileSync(bus, 'utf8')).toBe(before);
  });

  it('rejects an event whose runId conflicts with the caller context', async () => {
    await expect(appendChained({ ...blocked('a'), runId: 'RUN-20260929-002' }, bus, ctx)).rejects.toThrow(/conflicts/);
  });

  it('rejects an unknown event type', async () => {
    await expect(appendChained({ type: 'made.up', ts: TS }, bus, ctx)).rejects.toThrow(/schema validation failed/);
  });

  it('serialises concurrent appends into a valid chain', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => appendChained(blocked(`r${i}`), bus, ctx)));
    const result = verifyChain(bus);
    expect(result.ok).toBe(true);
    expect(result.chainedLines).toBe(10);
  });
});

describe('verifyChain', () => {
  it('reports ok for an empty or missing file', () => {
    expect(verifyChain(bus)).toEqual({ ok: true, legacyLines: 0, chainedLines: 0, pendingTail: false, errors: [] });
  });

  it('detects an altered line through the next prevHash', async () => {
    for (const r of ['a', 'b', 'c']) await appendChained(blocked(r), bus, ctx);
    const lines = readLines(bus);
    lines[1] = lines[1]!.replace('"reason":"b"', '"reason":"B"');
    fs.writeFileSync(bus, lines.join('\n') + '\n');
    const result = verifyChain(bus);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/line 3: prevHash mismatch/);
  });

  it('detects a deleted line', async () => {
    for (const r of ['a', 'b', 'c']) await appendChained(blocked(r), bus, ctx);
    const lines = readLines(bus);
    fs.writeFileSync(bus, [lines[0], lines[2]].join('\n') + '\n');
    const result = verifyChain(bus);
    expect(result.errors.join('\n')).toMatch(/line 2: seq 3, expected 2/);
  });

  it('tolerates legacy lines before the chain and continues after them', async () => {
    fs.writeFileSync(bus, '{"type":"RunStarted"}\n{"type":"PhaseComplete"}\n');
    await appendChained(blocked('a'), bus, ctx);
    const lines = readLines(bus);
    expect(JSON.parse(lines[2]!).prevHash).toBe(hashLine(lines[1]!));
    expect(verifyChain(bus)).toEqual({ ok: true, legacyLines: 2, chainedLines: 1, pendingTail: false, errors: [] });
  });

  it('flags a legacy line that appears after the chain started', async () => {
    await appendChained(blocked('a'), bus, ctx);
    fs.appendFileSync(bus, '{"type":"HandWritten"}\n');
    expect(verifyChain(bus).errors.join('\n')).toMatch(/line 2: unchained event after chain start/);
  });

  it('repairs a missing trailing newline before appending', async () => {
    fs.writeFileSync(bus, '{"type":"RunStarted"}');
    await appendChained(blocked('a'), bus, ctx);
    expect(readLines(bus)).toHaveLength(2);
    expect(verifyChain(bus).ok).toBe(true);
  });

  it('has no option that hides errors (acknowledgement is run-state only)', async () => {
    for (const r of ['a', 'b', 'c']) await appendChained(blocked(r), bus, ctx);
    const lines = readLines(bus);
    lines[0] = lines[0]!.replace('"reason":"a"', '"reason":"A"');
    fs.writeFileSync(bus, lines.join('\n') + '\n');
    // @ts-expect-error verifyChain takes only the bus path
    expect(verifyChain(bus, { ignoreThroughLine: 2 }).ok).toBe(false);
  });

  it('treats an unterminated final segment as a pending tail, not an error', async () => {
    for (const r of ['a', 'b']) await appendChained(blocked(r), bus, ctx);
    fs.appendFileSync(bus, '{"seq":3,"prevH');
    expect(verifyChain(bus)).toEqual({ ok: true, legacyLines: 0, chainedLines: 2, pendingTail: true, errors: [] });
  });

  it('reports a null or non-object line without throwing', () => {
    fs.writeFileSync(bus, 'null\n42\n[]\n');
    const result = verifyChain(bus);
    expect(result.errors.join('\n')).toMatch(/line 1: not a JSON object/);
    expect(result.errors).toHaveLength(3);
  });
});

describe('appendChained hardening', () => {
  it('refuses to append after an unterminated garbage tail', async () => {
    await appendChained(blocked('a'), bus, ctx);
    fs.appendFileSync(bus, '{"seq":2,"prevH');
    const before = fs.readFileSync(bus);
    await expect(appendChained(blocked('b'), bus, ctx)).rejects.toThrow(/torn tail/);
    expect(fs.readFileSync(bus).equals(before)).toBe(true);
  });

  it('continues seq from the last chained line across an unchained line', async () => {
    await appendChained(blocked('a'), bus, ctx);
    fs.appendFileSync(bus, '{"type":"HandWritten"}\n');
    const rec = await appendChained(blocked('b'), bus, ctx);
    expect(rec['seq']).toBe(2);
    expect(verifyChain(bus).errors.join('\n')).toMatch(/line 2: unchained event after chain start/);
  });

  it.each([{ emittedBy: 'owner' }, { seq: 5 }, { prevHash: 'x' }])('rejects caller-supplied envelope field %j', async (extra) => {
    await appendChained(blocked('a'), bus, ctx);
    const before = fs.readFileSync(bus, 'utf8');
    await expect(appendChained({ ...blocked('b'), ...extra }, bus, ctx)).rejects.toThrow(/set by the bus/);
    expect(fs.readFileSync(bus, 'utf8')).toBe(before);
  });

  it('ignores a non-integer seq when computing the next seq', async () => {
    await appendChained(blocked('a'), bus, ctx);
    await appendChained(blocked('b'), bus, ctx);
    const lines = readLines(bus);
    lines[1] = lines[1]!.replace('"seq":2', '"seq":1.5');
    fs.writeFileSync(bus, lines.join('\n') + '\n');
    const rec = await appendChained(blocked('c'), bus, ctx);
    expect(rec['seq']).toBe(2);
    const errs = verifyChain(bus).errors;
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.every((e) => e.startsWith('line 2:'))).toBe(true);
  });
});
