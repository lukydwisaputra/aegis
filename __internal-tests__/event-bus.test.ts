import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { append, readAll } from '@qa/event-bus';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-eb-test-'));
  process.env.AEGIS_EVENT_LOG = path.join(tmpDir, 'events.jsonl');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.AEGIS_EVENT_LOG;
});

describe('@qa/event-bus', () => {
  it('append() writes a valid JSONL event to disk', async () => {
    await append({
      type: 'TEST_STARTED',
      runId: 'RUN-001',
      payload: { testId: 'TC-AUTH-001' },
    });
    const raw = fs.readFileSync(process.env.AEGIS_EVENT_LOG!, 'utf8').trim();
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe('TEST_STARTED');
    expect(parsed.runId).toBe('RUN-001');
  });

  it('readAll() returns previously appended events', async () => {
    await append({ type: 'EVT_A', runId: 'RUN-002', payload: {} });
    await append({ type: 'EVT_B', runId: 'RUN-002', payload: {} });
    const events = await readAll();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('EVT_A');
    expect(events[1].type).toBe('EVT_B');
  });

  it('concurrent appends (10 writers) produce 10 lines with no corruption', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        append({ type: 'PARALLEL_EVT', runId: `RUN-CONC-${i}`, payload: { index: i } })
      )
    );
    const raw = fs.readFileSync(process.env.AEGIS_EVENT_LOG!, 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(10);
    // Each line must be valid JSON
    lines.forEach((line) => {
      expect(() => JSON.parse(line)).not.toThrow();
    });
  });

  it('throws on invalid event schema (missing type)', async () => {
    await expect(
      append({ runId: 'RUN-003', payload: {} } as any)
    ).rejects.toThrow();
  });

  it('throws on invalid event schema (missing runId)', async () => {
    await expect(
      append({ type: 'EVT_NOID', payload: {} } as any)
    ).rejects.toThrow();
  });
});
