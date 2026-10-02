import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appendChained, readAll } from '@qa/event-bus';
import { AegisEventSchema } from '@qa/contracts';

let tmpDir: string;
let busPath: string;

const TS = '2026-05-25T00:00:00.000Z';
const RUN_A = 'RUN-20260525-001';
const ctx = { emittedBy: 'qa-orchestrator', runId: RUN_A };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-eb-test-'));
  busPath = path.join(tmpDir, 'events.jsonl');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('@qa/event-bus', () => {
  it('appendChained() writes a valid JSONL event to disk', async () => {
    await appendChained({ type: 'gate.requested', ts: TS, gate: 'G1', runId: RUN_A }, busPath, ctx);
    const parsed = JSON.parse(fs.readFileSync(busPath, 'utf8').trim());
    expect(parsed).toMatchObject({ type: 'gate.requested', runId: RUN_A, seq: 1 });
  });

  it('readAll() returns previously appended events in order', async () => {
    await appendChained({ type: 'gate.requested', ts: TS, gate: 'G1', runId: RUN_A }, busPath, ctx);
    await appendChained({ type: 'gate.approved', ts: TS, gate: 'G1', runId: RUN_A, approvedBy: 'ci-bot' }, busPath, ctx);
    const events = readAll(busPath);
    expect(events.map((e) => e.type)).toEqual(['gate.requested', 'gate.approved']);
  });

  it('sequential appends (10 writers) produce 10 valid JSONL lines', async () => {
    for (let i = 0; i < 10; i++) {
      await appendChained({ type: 'gate.requested', ts: TS, gate: 'G1', runId: RUN_A }, busPath, ctx);
    }
    const lines = fs.readFileSync(busPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(10);
    lines.forEach((line: string) => expect(() => JSON.parse(line)).not.toThrow());
  });

  it('throws on invalid event schema (missing type)', async () => {
    await expect(appendChained({ ts: TS, gate: 'G1', runId: RUN_A }, busPath, ctx)).rejects.toThrow();
  });
});

describe('event field declarations (AUD-039)', () => {
  const lines = () => (fs.existsSync(busPath) ? fs.readFileSync(busPath, 'utf-8').split('\n').filter(Boolean) : []);
  const artifact = { type: 'artifact.created', ts: TS, kind: 'plan', path: 'runs/x/plan.json', schemaVersion: '1.0' } as const;
  const valid = (ev: object) => AegisEventSchema.safeParse(ev).success;
  it('appendChained() refuses undeclared fields instead of stripping them, but keeps runId', async () => {
    await expect(appendChained({ ...artifact, brief: 'x' }, busPath, ctx)).rejects.toThrow(/undeclared field\(s\).*brief/);
    expect(lines()).toHaveLength(0);
    await appendChained({ ...artifact, runId: RUN_A }, busPath, ctx);
    expect(JSON.parse(lines()[0]!)).toMatchObject({ type: 'artifact.created', runId: RUN_A });
  });
  it('specialist.dispatched declares a strict brief', () => {
    const ev = { type: 'specialist.dispatched', ts: TS, specialistName: 'qa-ui-specialist', tcIds: ['TC-AUTH-031'], environment: 'staging',
      brief: { missionGoal: 'Find SSO breakages', lessonsRef: 'agent-memory/qa-ui-specialist/lessons.md' } };
    const r = AegisEventSchema.safeParse(ev);
    expect(r.success && (r.data as any).brief.missionGoal).toBe('Find SSO breakages');
    expect(valid({ ...ev, brief: { ...ev.brief, extra: 1 } })).toBe(false);
  });
  it('target.profiled accepts bun and platform; discovery steps stay scan|explore', () => {
    expect(valid({ type: 'target.profiled', ts: TS, appCount: 1, framework: 'vite-react', packageManager: 'bun', platform: 'generic' })).toBe(true);
    expect(valid({ type: 'discovery.step-complete', ts: TS, step: 'explore-live', artifact: 'x' })).toBe(false);
  });
});
