import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { append, readAll } from '@qa/event-bus';

let tmpDir: string;
let busPath: string;

const TS = '2026-05-25T00:00:00.000Z';
const RUN_A = 'RUN-20260525-001';
const RUN_B = 'RUN-20260525-002';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-eb-test-'));
  busPath = path.join(tmpDir, 'events.jsonl');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('@qa/event-bus', () => {
  it('append() writes a valid JSONL event to disk', async () => {
    await append({ type: 'gate.requested', ts: TS, gate: 'plan-approval', runId: RUN_A }, busPath);
    const raw = fs.readFileSync(busPath, 'utf8').trim();
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe('gate.requested');
    expect(parsed.runId).toBe(RUN_A);
  });

  it('readAll() returns previously appended events in order', async () => {
    await append({ type: 'gate.requested', ts: TS, gate: 'plan-approval', runId: RUN_B }, busPath);
    await append({ type: 'gate.approved', ts: TS, gate: 'plan-approval', runId: RUN_B, approvedBy: 'ci-bot' }, busPath);
    const events = readAll(busPath);
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('gate.requested');
    expect(events[1]!.type).toBe('gate.approved');
  });

  it('sequential appends (10 writers) produce 10 valid JSONL lines', async () => {
    for (let i = 0; i < 10; i++) {
      await append(
        { type: 'gate.requested', ts: TS, gate: 'plan-approval', runId: `RUN-20260525-${String(i + 1).padStart(3, '0')}` },
        busPath
      );
    }
    const raw = fs.readFileSync(busPath, 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(10);
    lines.forEach((line: string) => {
      expect(() => JSON.parse(line)).not.toThrow();
    });
  });

  it('throws on invalid event schema (missing type)', async () => {
    await expect(
      append({ ts: TS, gate: 'plan-approval', runId: RUN_A } as any, busPath)
    ).rejects.toThrow();
  });

  it('throws on invalid event schema (missing runId)', async () => {
    await expect(
      append({ type: 'gate.requested', ts: TS, gate: 'plan-approval' } as any, busPath)
    ).rejects.toThrow();
  });
});
