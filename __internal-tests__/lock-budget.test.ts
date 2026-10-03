import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as lockfile from 'proper-lockfile';
import { proposeLesson, pruneAgedEntries } from '@qa/agent-memory';
import { nextId } from '@qa/ids';

// A4 (T2 F5): agent-memory and ids wait on a held lock with the shared run-state budget (50 retries, 20-250 ms,
// about 11 s), not 5-6 retries of 50 ms doubling (1.5-3 s), so a busy lock is waited out instead of leaking ELOCKED.
const AGENT = 'qa-test-agent';
const HOLD_MS = 4_000;
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-lockbudget-'));
  fs.mkdirSync(path.join(root, 'agent-memory', AGENT), { recursive: true });
  process.env['AEGIS_COUNTERS_PATH'] = path.join(root, '.counters.json');
});
afterEach(() => {
  delete process.env['AEGIS_COUNTERS_PATH'];
  fs.rmSync(root, { recursive: true, force: true });
});

/** Take `file`'s lock now and hold it for HOLD_MS (refreshed, so it never goes stale); `done` settles on release. */
async function holdFor(file: string): Promise<{ done: Promise<void> }> {
  const release = await lockfile.lock(file, { stale: 10_000 });
  return { done: new Promise<void>((r) => setTimeout(r, HOLD_MS)).then(() => release()) };
}

const candidate = {
  polarity: 'negative' as const,
  trigger: 'spv-rejection' as const,
  mistake: 'Skipped asserting response headers in API tests causing missed regressions',
  rootCause: 'Test focused on status code only and missed header validation entirely',
  correctiveRule: 'Always assert Content-Type and Cache-Control headers in API tests',
};

it('ids: nextId waits out a counters lock held for 4 s', async () => {
  const counters = path.join(root, '.counters.json');
  fs.writeFileSync(counters, '{}\n');
  const held = await holdFor(counters);
  const t0 = Date.now();
  await expect(nextId('TC', 'AUTH')).resolves.toBe('TC-AUTH-001');
  // It waited for the release, not for a stale lock or a lucky retry.
  expect(Date.now() - t0).toBeGreaterThanOrEqual(HOLD_MS - 500);
  await held.done;
}, 30_000);

const lessonsFile = async (): Promise<string> => {
  await proposeLesson(AGENT, { ...candidate, correctiveRule: 'Assert the Location header on every 201 response' }, root);
  return path.join(root, 'agent-memory', AGENT, 'lessons.json');
};

it('agent-memory: proposeLesson waits out a lessons lock held for 4 s', async () => {
  const held = await holdFor(await lessonsFile());
  const t0 = Date.now();
  await expect(proposeLesson(AGENT, candidate, root)).resolves.toMatchObject({ outcome: expect.any(String) });
  expect(Date.now() - t0).toBeGreaterThanOrEqual(HOLD_MS - 500);
  await held.done;
}, 30_000);

it('agent-memory: pruneAgedEntries waits out a lessons lock held for 4 s', async () => {
  const held = await holdFor(await lessonsFile());
  const t0 = Date.now();
  await expect(pruneAgedEntries(AGENT, root)).resolves.toEqual({ pruned: 0 });
  expect(Date.now() - t0).toBeGreaterThanOrEqual(HOLD_MS - 500);
  await held.done;
}, 30_000);
