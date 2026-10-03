import * as fs from 'fs';
import * as path from 'path';
import * as eventBus from '@qa/event-bus';
import { busPath, createRun, readActiveRun, runJsonPath, runsDir, verifyRunIntegrity } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

// A6 (T3): createRun's ordering, pinned deterministically. appendChained is wrapped so a test can act at the exact
// moment run.created is appended (the old test raced a verify loop against createRun and passed either way).
type Append = typeof eventBus.appendChained;
let before: ((args: Parameters<Append>) => Promise<void>) | null = null;
jest.mock('@qa/event-bus', () => {
  const actual = jest.requireActual('@qa/event-bus');
  return {
    ...actual,
    appendChained: jest.fn(async (...args: Parameters<Append>) => {
      const hook = before;
      before = null; // one shot: the hook's own calls (and later appends) run through
      if (hook !== null) await hook(args);
      return actual.appendChained(...args);
    }),
  };
});

let t: TmpAegis;
beforeEach(() => { t = makeAegisRoot(); before = null; });
afterEach(() => t.cleanup());

const create = () => createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner');
const runDirs = () => (fs.existsSync(runsDir(t.root)) ? fs.readdirSync(runsDir(t.root)).filter((d) => d.startsWith('RUN-')).sort() : []);

it('run.created is appended while run.json does not exist yet, and a verify then finds no run and appends nothing', async () => {
  const seen: Array<{ type: unknown; runJson: boolean; verify: unknown; logLines: number }> = [];
  before = async ([event, bus]) => {
    const runId = path.basename(path.dirname(bus));
    const report = await verifyRunIntegrity(t.root, runId, 'owner');
    const verify = { ok: report.ok, errors: report.errors, runJsonValid: report.runJsonValid };
    seen.push({
      type: (event as { type?: unknown }).type,
      runJson: fs.existsSync(runJsonPath(t.root, runId)),
      verify,
      logLines: fs.existsSync(bus) ? fs.readFileSync(bus, 'utf-8').split('\n').filter(Boolean).length : 0,
    });
  };
  const { runId } = await create();
  expect(seen).toEqual([{ type: 'run.created', runJson: false, verify: { ok: false, errors: [`run ${runId} not found`], runJsonValid: false }, logLines: 0 }]);
  expect(fs.readFileSync(busPath(t.root, runId), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l).type)).toEqual(['run.created']);
});

it('a createRun that fails at run.created leaves .active alone; the next createRun takes a new id; the orphan stays inert', async () => {
  const first = await create();
  expect(readActiveRun(t.root)).toBe(first.runId);
  before = async () => {
    throw new Error('disk full');
  };
  await expect(create()).rejects.toThrow('disk full');
  const orphan = runDirs().find((d) => d !== first.runId)!;
  expect(orphan).toBeDefined();
  expect(fs.existsSync(runJsonPath(t.root, orphan))).toBe(false);
  expect(readActiveRun(t.root)).toBe(first.runId);
  const second = await create();
  expect(second.runId).not.toBe(orphan);
  expect(second.runId).not.toBe(first.runId);
  expect(readActiveRun(t.root)).toBe(second.runId);
  // Inert: no run.json, so no command treats it as a run; verify reports it not found and writes nothing into it.
  await expect(verifyRunIntegrity(t.root, orphan, 'owner')).resolves.toMatchObject({ ok: false, errors: [`run ${orphan} not found`] });
  expect(fs.existsSync(runJsonPath(t.root, orphan))).toBe(false);
  expect(fs.existsSync(busPath(t.root, orphan))).toBe(false);
});
