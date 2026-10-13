import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { roleWritable } from '@qa/path-guard';
import { RtmRowSchema } from '@qa/contracts';

// Run-path fixes, Task 4 (AUD-027, AUD-091, AUD-087): defects reach the RTM, unit coverage has its own file, and both
// result-file layouts are read.
const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const DM = '.claude/agents/tier1-phase/qa-defect-manager.md';
const DM_SPV = '.claude/agents/spv/qa-defect-manager-spv.md';
const UNIT = '.claude/agents/tier2-specialist/qa-unit-specialist.md';
const COLLECTOR = '.claude/agents/crosscutting/qa-metrics-collector.md';
const CLOSURE = '.claude/agents/tier1-phase/qa-closure-reporter.md';

interface Contract { reads: Array<string | { path: string }>; writes: Array<string | { path: string }>; emits: Array<{ event: string }> }
const contractOf = (md: string): Contract => parse(/## Contract \(machine-checked\)\s*```yaml\n([\s\S]*?)```/.exec(md)![1]!) as Contract;
const paths = (xs: Array<string | { path: string }>): string[] => xs.map((x) => (typeof x === 'string' ? x : x.path));
const body = (md: string): string => md.slice(0, md.indexOf('## Contract (machine-checked)'));

const P = { aegisRoot: '/r/aegis', targetRoot: '/r', testsDir: '/r/tests/qa', runDir: '/r/aegis/runs/RUN-1' };

describe('the defect manager appends defects to rtm.json itself', () => {
  const dm = read(DM);

  it('no longer routes the link through an RTM updater or an rtm.append-link event', () => {
    expect(body(dm)).not.toMatch(/rtm\.append-link/);
    expect(body(dm)).not.toMatch(/RTM updater|RTM writer/);
    expect(contractOf(dm).emits.map((e) => e.event)).not.toContain('rtm.append-link');
  });

  it('states the concrete append: row shape, requirementId match, no duplicates, schema-valid, rtm.md untouched', () => {
    expect(dm).toContain('one row object per requirement (a top-level array of rows');
    expect(dm).toContain('Each row is an `RtmRowSchema` object with `requirementId` and a `defectIds` array');
    expect(dm).toContain('Find the row whose `requirementId` equals the requirement the defect traces to');
    expect(dm).toContain("append the defect id to that row's `defectIds` unless it is already there");
    expect(dm).toContain('so each row still parses with `RtmRowSchema`');
    expect(dm).toContain('You do not touch `rtm.md`');
    expect(paths(contractOf(dm).writes)).toContain('{run}/rtm.json');
  });

  it('its SPV pins requirementId and defectIds', () => {
    const spv = read(DM_SPV);
    expect(spv).not.toMatch(/append-link/);
    expect(spv).toContain('`defectIds` array of the `rtm.json` row whose `requirementId` is the requirement it traces to');
    expect(paths(contractOf(spv).reads)).toContain('{run}/rtm.json');
  });

  it('no agent file under .claude/agents (any depth) mentions rtm.append-link', () => {
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = walk(path.join(ROOT, '.claude/agents')).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThan(50);
    expect(files.filter((f) => /rtm\.append-link/.test(fs.readFileSync(f, 'utf-8')))).toEqual([]);
    expect(read('docs/D13-concurrency-and-locking.md')).not.toMatch(/rtm\.append-link/);
  });
});

describe('an RTM after the defect manager append still parses with RtmRowSchema', () => {
  const row = (requirementId: string, defectIds: string[]): unknown => ({
    requirementId, description: 'Login works', source: 'PRD', priority: { code: 'P2', name: 'This quarter' },
    testCaseIds: ['TC-AUTH-001'], testStatus: 'Covered', defectIds,
  });
  /** What the prose tells the defect manager to do. */
  const appendDefect = (rows: Array<{ requirementId: string; defectIds: string[] }>, req: string, def: string) =>
    rows.map((r) => (r.requirementId === req && !r.defectIds.includes(def) ? { ...r, defectIds: [...r.defectIds, def] } : r));

  it('appends once to the matching row and leaves the others alone', () => {
    const rtm = [row('REQ-AUTH-01', []), row('REQ-AUTH-02', [])] as Array<{ requirementId: string; defectIds: string[] }>;
    const after = appendDefect(appendDefect(rtm, 'REQ-AUTH-01', 'DEF-001-AUTH-UI'), 'REQ-AUTH-01', 'DEF-001-AUTH-UI');
    expect(after[0]!.defectIds).toEqual(['DEF-001-AUTH-UI']);
    expect(after[1]!.defectIds).toEqual([]);
    for (const r of after) expect(RtmRowSchema.safeParse(r).success).toBe(true);
  });

  it('rejects a malformed row: no requirementId, or defectIds not an array', () => {
    const good = row('REQ-AUTH-01', []) as Record<string, unknown>;
    const { requirementId: _omit, ...noReq } = good;
    expect(RtmRowSchema.safeParse(noReq).success).toBe(false);
    expect(RtmRowSchema.safeParse({ ...good, defectIds: 'DEF-001-AUTH-UI' }).success).toBe(false);
    expect(RtmRowSchema.safeParse({ ...good, defectIds: ['not-a-defect-id'] }).success).toBe(false);
  });
});

describe('unit coverage has its own file; the collector owns reports/metrics/coverage.json', () => {
  const unit = read(UNIT);
  const covFile = '{run}/reports/unit-coverage.json';

  it('the unit specialist writes reports/unit-coverage.json and not the rollup file', () => {
    const writes = paths(contractOf(unit).writes);
    expect(writes).toContain(covFile);
    expect(writes).not.toContain('{run}/reports/metrics/coverage.json');
    expect(unit).toContain('`runs/{runId}/reports/unit-coverage.json`');
    expect(unit).toContain('You never write `reports/metrics/coverage.json`');
  });

  it('the role row follows: unit may write unit-coverage.json, no longer metrics/coverage.json', () => {
    expect(roleWritable('qa-unit-specialist', '/r/aegis/runs/RUN-1/reports/unit-coverage.json', P)).toBe(true);
    expect(roleWritable('qa-unit-specialist', '/r/aegis/runs/RUN-1/reports/metrics/coverage.json', P)).toBe(false);
  });

  it('the file always reflects the whole tests/qa/unit run, recomputed per dispatch', () => {
    expect(unit).toContain('on every dispatch recompute the figures over the full scope');
    expect(unit).toContain('recomputed over the whole QA unit-test scope');
  });

  it('the collector reads unit-coverage.json (optional), not the unit work reports', () => {
    const c = read(COLLECTOR);
    expect(read(COLLECTOR)).toContain('`runs/{runId}/reports/unit-coverage.json`');
    expect(JSON.stringify(contractOf(c).reads)).toContain('{run}/reports/unit-coverage.json');
    expect(c).not.toMatch(/reports\/work\/qa-unit-specialist/);
  });
});

describe('result files are read in both layouts', () => {
  it('the responsive specialist writes the per-viewport file', () => {
    expect(paths(contractOf(read('.claude/agents/tier2-specialist/qa-responsive-specialist.md')).writes)).toContain('{run}/cases/{TC-ID}-{viewport}-result.json');
  });

  it('the collector counts a TC once, per-viewport files win, one flaky row, missing viewport = undeterminable (not passed)', () => {
    const c = read(COLLECTOR);
    expect(c).toContain('`^TC-[A-Z]{2,8}-\\d{3,}$`');
    expect(c).toContain('one of `desktop`, `tablet` or `mobile`');
    expect(c).toContain('A TC counts once, however many of its files exist');
    expect(c).toContain('the per-viewport files win and the plain file is ignored');
    expect(c).toContain('The outcome of a TC is its worst outcome, in this order, worst first: `fail`, `blocked`, `partial`, `skipped`, undeterminable (a result with no determinable status), `pass`, `no-op`');
    expect(c).toContain('plus one undeterminable outcome for every viewport in its `viewportScope`');
    expect(c).toContain('that has no result file, so a missing viewport is never dropped: it makes the TC not passed');
    expect(c).toContain('a TC yields ONE flaky row, with `retryCount` the maximum across its viewport results');
  });

  it('the closure reporter states the same rules', () => {
    const cl = read(CLOSURE);
    expect(cl).toContain('a TC counts once; when both layouts exist for it the per-viewport files win');
    expect(cl).toContain('a missing viewport result means it did not pass, never that the viewport is dropped');
    expect(cl).toContain('`desktop`, `tablet` or `mobile`');
  });

  it('the collector names both layouts and reads the glob that matches both', () => {
    const c = read(COLLECTOR);
    expect(c).toContain('`runs/{runId}/cases/{TC-ID}-result.json`');
    expect(c).toContain('`runs/{runId}/cases/{TC-ID}-{viewport}-result.json`');
    expect(paths(contractOf(c).reads)).toContain('{run}/cases/*-result.json');
  });

  it('the closure reporter names both layouts and reads the glob', () => {
    const cl = read(CLOSURE);
    expect(cl).toContain('`{TC-ID}-result.json` and the responsive specialist\'s per-viewport `{TC-ID}-{viewport}-result.json`');
    expect(paths(contractOf(cl).reads)).toContain('{run}/cases/*-result.json');
  });
});
