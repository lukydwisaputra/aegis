import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { proposeLesson, pruneAgedEntries, loadLessons } from '@qa/agent-memory';

let tmpDir: string;
let lessonsPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mem-test-'));
  lessonsPath = path.join(tmpDir, 'lessons.json');
  fs.writeFileSync(lessonsPath, JSON.stringify({
    agent: 'qa-test-agent',
    schemaVersion: '1.0',
    lastUpdatedAt: new Date().toISOString(),
    entries: [],
  }));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('@qa/agent-memory', () => {
  it('proposeLesson() appends a lesson entry to lessons.json', async () => {
    await proposeLesson(lessonsPath, {
      rootCause: 'Form submission fails when field is empty',
      correctiveRule: 'Always validate required fields before submission',
      context: 'login-form',
    });
    const data = loadLessons(lessonsPath);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].rootCause).toBe('Form submission fails when field is empty');
  });

  it('deduplicates entries with Jaccard similarity >= 0.7 by incrementing hitCount', async () => {
    await proposeLesson(lessonsPath, {
      rootCause: 'Form fails when field is empty and blank',
      correctiveRule: 'Validate required fields before submission',
      context: 'login-form',
    });
    await proposeLesson(lessonsPath, {
      rootCause: 'Form fails when field is empty and null',
      correctiveRule: 'Validate required fields before submission',
      context: 'login-form',
    });
    const data = loadLessons(lessonsPath);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].hitCount).toBeGreaterThanOrEqual(2);
  });

  it('returns outcome: conflict for conflicting never/always rules', async () => {
    const result = await proposeLesson(lessonsPath, {
      rootCause: 'Skip smoke tests in CI',
      correctiveRule: 'Never skip smoke tests',
      context: 'ci',
      conflictsWith: 'Always skip smoke tests when time-constrained',
    });
    expect(result.outcome).toBe('conflict');
  });

  it('caps at 50 entries and evicts lowest-hitCount oldest entry', async () => {
    // Pre-fill 50 entries
    const base: any = loadLessons(lessonsPath);
    base.entries = Array.from({ length: 50 }, (_, i) => ({
      id: `LESSON-${String(i + 1).padStart(3, '0')}`,
      rootCause: `Unique root cause number ${i + 1}`,
      correctiveRule: `Fix number ${i + 1}`,
      hitCount: i + 1,
      createdAt: new Date(Date.now() - (50 - i) * 1000).toISOString(),
      lastHitAt: new Date().toISOString(),
    }));
    fs.writeFileSync(lessonsPath, JSON.stringify(base));

    await proposeLesson(lessonsPath, {
      rootCause: 'Brand new unique lesson that has never appeared before',
      correctiveRule: 'Always add a brand new corrective action step here',
      context: 'overflow-test',
    });

    const data = loadLessons(lessonsPath);
    expect(data.entries).toHaveLength(50);
    // The new entry should be present
    const newEntry = data.entries.find((e: any) =>
      e.rootCause.includes('Brand new unique lesson')
    );
    expect(newEntry).toBeDefined();
  });

  it('pruneAgedEntries() archives entries older than 90 days with hitCount < 2', async () => {
    const base: any = loadLessons(lessonsPath);
    const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    base.entries = [
      { id: 'L-001', rootCause: 'Old stale lesson', correctiveRule: 'Fix old', hitCount: 1, createdAt: oldDate, lastHitAt: oldDate },
      { id: 'L-002', rootCause: 'Old but popular lesson', correctiveRule: 'Fix popular', hitCount: 5, createdAt: oldDate, lastHitAt: oldDate },
      { id: 'L-003', rootCause: 'Recent lesson', correctiveRule: 'Fix recent', hitCount: 1, createdAt: new Date().toISOString(), lastHitAt: new Date().toISOString() },
    ];
    fs.writeFileSync(lessonsPath, JSON.stringify(base));
    const archivePath = path.join(tmpDir, 'archive');

    await pruneAgedEntries(lessonsPath, archivePath);

    const data = loadLessons(lessonsPath);
    const ids = data.entries.map((e: any) => e.id);
    expect(ids).not.toContain('L-001'); // pruned: old + low hitCount
    expect(ids).toContain('L-002');     // kept: old but high hitCount
    expect(ids).toContain('L-003');     // kept: recent
  });
});
