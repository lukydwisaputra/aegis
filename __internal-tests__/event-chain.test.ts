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
    expect(verifyChain(bus)).toEqual({ ok: true, legacyLines: 0, chainedLines: 0, errors: [] });
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
    expect(verifyChain(bus)).toEqual({ ok: true, legacyLines: 2, chainedLines: 1, errors: [] });
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

  it('ignores errors at or before ignoreThroughLine', async () => {
    for (const r of ['a', 'b', 'c']) await appendChained(blocked(r), bus, ctx);
    const lines = readLines(bus);
    lines[0] = lines[0]!.replace('"reason":"a"', '"reason":"A"');
    fs.writeFileSync(bus, lines.join('\n') + '\n');
    expect(verifyChain(bus).ok).toBe(false);
    expect(verifyChain(bus, { ignoreThroughLine: 2 }).ok).toBe(true);
  });
});
