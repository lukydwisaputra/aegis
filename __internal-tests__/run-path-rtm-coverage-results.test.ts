import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { roleWritable } from '@qa/path-guard';

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

  it('states the append to the requirement row, and its role row allows the file', () => {
    expect(dm).toContain("append the defect id to that row's `defectIds`");
    expect(paths(contractOf(dm).writes)).toContain('{run}/rtm.json');
    expect(roleWritable('qa-defect-manager', '/r/aegis/runs/RUN-1/rtm.json', P)).toBe(true);
  });

  it('its SPV checks the RTM row, not an append-link event', () => {
    const spv = read(DM_SPV);
    expect(spv).not.toMatch(/append-link/);
    expect(spv).toContain('`defectIds` of the `rtm.json` row');
    expect(paths(contractOf(spv).reads)).toContain('{run}/rtm.json');
  });

  it('no agent file still emits or awaits rtm.append-link', () => {
    for (const dir of ['tier1-phase', 'tier2-specialist', 'spv', 'crosscutting', 'orchestrator']) {
      for (const f of fs.readdirSync(path.join(ROOT, '.claude/agents', dir))) {
        expect(read(`.claude/agents/${dir}/${f}`)).not.toMatch(/rtm\.append-link/);
      }
    }
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
    expect(roleWritable('qa-metrics-collector', '/r/aegis/runs/RUN-1/reports/metrics/coverage.json', P)).toBe(true);
  });

  it('the collector reads unit-coverage.json (optional), not the unit work reports', () => {
    const c = read(COLLECTOR);
    expect(read(COLLECTOR)).toContain('`runs/{runId}/reports/unit-coverage.json`');
    expect(JSON.stringify(contractOf(c).reads)).toContain('{run}/reports/unit-coverage.json');
    expect(c).not.toMatch(/reports\/work\/qa-unit-specialist/);
  });
});

describe('result files are read in both layouts', () => {
  it('the responsive specialist writes the per-viewport file and its role row allows it', () => {
    expect(paths(contractOf(read('.claude/agents/tier2-specialist/qa-responsive-specialist.md')).writes)).toContain('{run}/cases/{TC-ID}-{viewport}-result.json');
    expect(roleWritable('qa-responsive-specialist', '/r/aegis/runs/RUN-1/cases/TC-AUTH-001-mobile-result.json', P)).toBe(true);
    expect(roleWritable('qa-responsive-specialist', '/r/aegis/runs/RUN-1/cases/TC-AUTH-001-result.json', P)).toBe(true);
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
