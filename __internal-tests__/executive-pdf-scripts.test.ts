import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';

// Run-path fixes, task 3 (AUD-060): the three executive PDF scripts render from the files the run
// really holds and print real PDFs under reports/executive/. The renderer is @react-pdf (no browser),
// so every test prints a real PDF and reads its text back.
const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const SKILLS = path.join(ROOT, '.claude', 'skills');
const SCRIPT = {
  technical: path.join(SKILLS, '_qa-report-technical-pdf', 'run.mjs'),
  signoff: path.join(SKILLS, '_qa-report-signoff-pdf', 'run.mjs'),
  slides: path.join(SKILLS, '_qa-report-executive-slides', 'run.mjs'),
};
const RUN = 'RUN-20261004-001';
const PROJECT = 'Northwind Portal';

const temps: string[] = [];
afterAll(() => {
  for (const t of temps) fs.rmSync(t, { recursive: true, force: true });
});

/** A fixture repo root holding aegis.config.json and runs/RUN/... built from `files` (run-relative). */
function fixture(files: Record<string, unknown>): { root: string; runDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-pdf-'));
  temps.push(root);
  fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify({ dashboard: { projectName: PROJECT } }));
  const runDir = path.join(root, 'runs', RUN);
  fs.mkdirSync(runDir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(runDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body));
  }
  return { root, runDir };
}

function run(script: string, root: string, extra: string[] = []) {
  return spawnSync(process.execPath, [script, `--run=${RUN}`, ...extra], {
    env: { ...process.env, AEGIS_ROOT: root },
    encoding: 'utf-8',
    timeout: 120000,
  });
}

/** The text runs of a PDF: every Tj/TJ string of every inflated content stream, one run per line. */
function pdfText(file: string): string {
  const raw = fs.readFileSync(file).toString('latin1');
  const runs: string[] = [];
  const streams = /stream\r?\n([\s\S]*?)endstream/g;
  let s: RegExpExecArray | null;
  while ((s = streams.exec(raw))) {
    let body: string;
    try {
      body = zlib.inflateSync(Buffer.from(s[1] ?? '', 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    const ops = /\[((?:[^\]])*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g;
    let o: RegExpExecArray | null;
    while ((o = ops.exec(body))) {
      const hex = o[1] !== undefined ? [...o[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join('') : o[2];
      runs.push(Buffer.from(hex ?? '', 'hex').toString('latin1'));
    }
  }
  return runs.join('\n');
}

const FULL_RUN = {
  'plan.json': { scope: 'Authentication module' },
  'reports/closure/closure.json': {
    cycleDate: '2026-10-04',
    metrics: { passed: 40, failed: 3, blocked: 2, passRate: 88.9, requirementsCoverage: 92.5 },
    defectMetrics: { totalLogged: 5, confirmedOpen: 3 },
  },
  'reports/metrics/token-usage.jsonl':
    [
      { agent: 'a', model: 'm', inputTokens: 1, outputTokens: 1, cachedTokens: 0, usdCost: 1.25, ts: '2026-10-04T00:00:00Z' },
      { agent: 'b', model: 'm', inputTokens: 1, outputTokens: 1, cachedTokens: 0, usdCost: 0.5, ts: '2026-10-04T00:01:00Z' },
      { agent: 'c', model: 'm', inputTokens: 1, outputTokens: 1, cachedTokens: 0, usdCost: 0.0123, ts: '2026-10-04T00:02:00Z' },
    ]
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n',
  'reports/metrics/cycle-time.json': {
    phases: [
      { phase: 'scan', startedAt: '2026-10-04T00:00:00Z', completedAt: '2026-10-04T00:30:00Z', durationMs: 1800000 },
      { phase: 'execution', startedAt: '2026-10-04T00:30:00Z', completedAt: '2026-10-04T01:30:00Z', durationMs: 3600000 },
    ],
  },
  'reports/compliance/iso25010.json': {
    regulation: 'iso25010',
    characteristicsCovered: ['FunctionalSuitability', 'Security', 'Usability', 'Reliability', 'Compatibility', 'Portability'],
    gaps: ['ISO25010-PerformanceEfficiency-TimeBehaviour', 'ISO25010-Maintainability-Testability'],
    highSeverityGapCount: 1,
  },
  'reports/compliance/gdpr.json': {
    regulation: 'gdpr',
    articlesCovered: ['GDPR-Art5', 'GDPR-Art25', 'GDPR-Art32', 'GDPR-Art35'],
    gaps: ['GDPR-Art17', 'GDPR-Art20', 'GDPR-Art15'],
    highSeverityGapCount: 0,
  },
  'defects/DEF-001-AUTH-UI.json': { id: 'DEF-001-AUTH-UI', title: 'Login rejects plus-aliased email', severity: 'Sev2', status: 'open' },
  'gates/gate-3-decision.json': {
    runId: RUN, gate: 3, label: 'Closure', sequence: 1, decision: 'approved-with-conditions',
    note: 'Ship after the login fix', decidedBy: 'owner', decidedAt: '2026-10-04T02:00:00Z',
  },
  'reports/executive/executive-deck.json': {
    keyFinding: 'All critical customer journeys were tested; one login issue remains open.',
    supportingInsights: [
      { what: 'Search answers with p95 latency 900ms', soWhat: 'Customers wait under a second', nowWhat: 'Keep monitoring' },
      { what: 'Forty of forty-five checks passed', soWhat: 'Core flows work', nowWhat: 'Fix the login issue' },
      { what: 'Three issues are open', soWhat: 'Some users may retry login', nowWhat: 'Fix before launch' },
    ],
    recommendations: [{ action: 'Fix the login issue', owner: 'Engineering', deadline: '2026-10-11', impact: 'HIGH' }],
    residualRisks: [{ plain: 'Users with plus-aliased email addresses may fail to sign in.' }],
  },
};

describe('technical report (Deliverable 1)', () => {
  const { root, runDir } = fixture(FULL_RUN);
  const res = run(SCRIPT.technical, root);
  const pdf = path.join(runDir, 'reports', 'executive', 'technical-report.pdf');

  it('exits 0 and writes a real PDF under reports/executive/, not the reports/ root', () => {
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(fs.readFileSync(pdf).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(fs.existsSync(path.join(runDir, 'reports', 'technical-report.pdf'))).toBe(false);
  });

  it('maps the closure totals: total = passed + failed + blocked, pass rate, requirements coverage', () => {
    const text = pdfText(pdf);
    expect(text).toContain(PROJECT);
    expect(text).toContain('Total Tests\n45');
    expect(text).toContain('Passed\n40');
    expect(text).toContain('Failed\n3');
    expect(text).toContain('Blocked\n2');
    expect(text).toContain('Pass Rate\n88.9%');
    expect(text).toContain('Requirements Coverage\n92.5%');
    expect(text).toContain('Open Defects\n3');
    expect(text).toContain('Closed Defects\n2');
  });

  it('sums the cost from token-usage.jsonl and the cycle time from cycle-time.json', () => {
    const text = pdfText(pdf);
    expect(text).toContain('Token Cost: $1.7623');
    expect(text).toContain('Cycle Time: 1 h 30 min');
  });

  it('reads compliance coverage from each report\'s own covered key and gaps[]', () => {
    const text = pdfText(pdf);
    expect(text).toContain('iso25010\n6\n2');
    expect(text).toContain('gdpr\n4\n3');
  });

  it('prints no framework or agent name', () => {
    expect(pdfText(pdf)).not.toMatch(/aegis|qa-[a-z]+-/i);
  });
});

describe('technical report with absent inputs', () => {
  const { root, runDir } = fixture({ 'reports/closure/closure.json': { metrics: { passed: 10, failed: 1 } } });
  const res = run(SCRIPT.technical, root);
  const pdf = path.join(runDir, 'reports', 'executive', 'technical-report.pdf');

  it('still renders, and every absent figure reads "not available", never 0', () => {
    expect(res.status).toBe(0);
    const text = pdfText(pdf);
    expect(text).toContain('Passed\n10');
    expect(text).toContain('Total Tests\nnot available');
    expect(text).toContain('Blocked\nnot available');
    expect(text).toContain('Pass Rate\nnot available');
    expect(text).toContain('Requirements Coverage\nnot available');
    expect(text).toContain('Open Defects\nnot available');
    expect(text).toContain('Token Cost: not available');
    expect(text).toContain('Cycle Time: not available');
    expect(text).toContain('Compliance reports: not available');
    expect(text).not.toContain('$0.0000');
  });

  it('renders the collector\'s noData files, an empty token log and closure.json#unavailableMetrics as "not available", never 0', () => {
    const noData = fixture({
      'reports/closure/closure.json': {
        metrics: { passed: 7, failed: 0, blocked: 0, passRate: 100, requirementsCoverage: 0 },
        unavailableMetrics: ['coverage.json', 'cycle-time.json', 'flaky.json'],
      },
      'reports/metrics/cycle-time.json': { noData: true, totalWallClockMs: 0 },
      'reports/metrics/coverage.json': { noData: true },
      'reports/metrics/flaky.json': [],
      'reports/metrics/token-usage.jsonl': '',
    });
    const r = run(SCRIPT.technical, noData.root);
    expect(r.status).toBe(0);
    const text = pdfText(path.join(noData.runDir, 'reports', 'executive', 'technical-report.pdf'));
    expect(text).toContain('Total Tests\n7');
    expect(text).toContain('Pass Rate\n100.0%');
    expect(text).toContain('Requirements Coverage\nnot available');
    expect(text).toContain('Cycle Time: not available');
    expect(text).toContain('Token Cost: not available');
    expect(text).not.toMatch(/(^|\n)0\.0%/);
    expect(text).not.toMatch(/Cycle Time: 0/);
  });

  it('fails with exit 3 when reports/closure/closure.json is missing', () => {
    const empty = fixture({});
    const r = run(SCRIPT.technical, empty.root);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('reports/closure/closure.json');
  });

  it('refuses report data that names an agent (brand rule)', () => {
    const leak = fixture({
      'reports/closure/closure.json': FULL_RUN['reports/closure/closure.json'],
      'defects/DEF-002-AUTH-UI.json': { id: 'DEF-002-AUTH-UI', title: 'Raised by qa-ui-specialist', severity: 'Sev3', status: 'open' },
    });
    const r = run(SCRIPT.technical, leak.root);
    expect(r.status).toBe(4);
    expect(fs.existsSync(path.join(leak.runDir, 'reports', 'executive', 'technical-report.pdf'))).toBe(false);
  });
});

describe('sign-off document (Deliverable 2)', () => {
  const { root, runDir } = fixture(FULL_RUN);
  const res = run(SCRIPT.signoff, root);
  const pdf = path.join(runDir, 'reports', 'executive', 'signoff.pdf');

  it('exits 0 and writes a real PDF under reports/executive/', () => {
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(fs.readFileSync(pdf).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(fs.existsSync(path.join(runDir, 'reports', 'signoff.pdf'))).toBe(false);
  });

  it('records the Gate 3 decision and the project name, with the absent exit criteria stated', () => {
    const text = pdfText(pdf);
    expect(text).toContain('CONDITIONAL');
    expect(text).toContain(PROJECT);
    expect(text).toContain('Exit criteria: not available');
    expect(text).not.toMatch(/aegis|qa-[a-z]+-/i);
  });
});

describe('executive deck (Deliverable 3)', () => {
  const { root, runDir } = fixture(FULL_RUN);
  const res = run(SCRIPT.slides, root);
  const pdf = path.join(runDir, 'reports', 'executive', 'executive-deck.pdf');

  it('renders from reports/executive/executive-deck.json to reports/executive/executive-deck.pdf', () => {
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(fs.readFileSync(pdf).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(JSON.parse(res.stdout).slideCount).toBe(6);
  });

  it('prints the key finding and the tone-checked rewrite, not the jargon', () => {
    const text = pdfText(pdf);
    expect(text).toContain('one login issue remains open');
    expect(text).toContain('slowest 5% of requests');
    expect(text).not.toContain('p95');
  });

  it('fails with exit 3 naming the deck file when the reporter has not written it', () => {
    const noDeck = fixture({ 'reports/closure/closure.json': FULL_RUN['reports/closure/closure.json'] });
    const r = run(SCRIPT.slides, noDeck.root);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('executive-deck.json');
  });
});

describe('scripts, skills and agents name the real paths', () => {
  it('no script imports the unresolvable @qa/pdf-renderer specifier; each loads the built renderer by a skill-relative URL', () => {
    for (const f of Object.values(SCRIPT)) {
      const src = fs.readFileSync(f, 'utf-8');
      expect(src).not.toMatch(/from\s+["']@qa\/pdf-renderer["']/);
      expect(src).toContain('new URL("../../../packages/@qa/pdf-renderer/dist/index.js", import.meta.url)');
      expect(src).not.toMatch(/["']reports["'],\s*["']closure\.json["']/);
      expect(src).not.toContain('executiveDeck');
    }
  });

  it('the SKILL.md files read reports/closure/closure.json (or the deck file) and write under reports/executive/', () => {
    for (const s of ['_qa-report-technical-pdf', '_qa-report-signoff-pdf', '_qa-report-executive-slides']) {
      const text = read(`.claude/skills/${s}/SKILL.md`);
      expect(text).not.toMatch(/reports\/closure\.json/);
      expect(text).not.toMatch(/reports\/(technical-report|signoff|executive-deck)\.pdf/);
      expect(text).not.toContain('reports/metrics/cycle.json');
      expect(text).toContain('reports/executive/');
    }
    expect(read('.claude/skills/_qa-report-executive-slides/SKILL.md')).toContain('reports/executive/executive-deck.json');
  });

  it('the executive reporter names the _qa-report-* skills and writes the deck file at step 4', () => {
    const text = read('.claude/agents/tier1-phase/qa-executive-reporter.md');
    expect(text).not.toMatch(/`qa-report-/);
    for (const s of ['_qa-report-technical-pdf', '_qa-report-signoff-pdf', '_qa-report-executive-slides']) {
      expect(text).toContain(`Skill to invoke: \`${s}\``);
    }
    expect(text).toMatch(/4\. \*\*Draft slide content\.\*\*[^\n]*reports\/executive\/executive-deck\.json/);
  });

  it('the SPV treats a PDF that failed to render as requested-changes, never accepting an .md in its place', () => {
    const text = read('.claude/agents/spv/qa-executive-reporter-spv.md');
    expect(text).not.toMatch(/\.md` fallback/);
    expect(text).not.toMatch(/acceptable ONLY if/);
    expect(text).toMatch(/failed to render[^\n]*requested-changes/);
  });
});
