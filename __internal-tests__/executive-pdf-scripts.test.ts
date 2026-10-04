import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { DefectSchema } from '@qa/contracts';

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

// ─── Final fix wave: real defect records, one open-defect resolver, coverage noData, refusals ───────────

/** A defect record shaped exactly like DefectSchema: severity and status are objects, not strings. */
function defectRecord(n: number, statusCode: string, sevCode: string, sevName: string): Record<string, unknown> {
  const id = `DEF-00${n}-AUTH-UI`;
  return {
    id,
    title: `Login form issue number ${n} on the sign-in page`,
    summary: 'Signing in with a plus-aliased email address shows an error.',
    reporter: 'QA team',
    reportedAt: '2026-10-04T01:00:00Z',
    assignee: null,
    status: { code: statusCode, transitionedAt: '2026-10-04T01:05:00Z' },
    severity: { code: sevCode, name: sevName },
    priority: { code: 'P1', name: 'Next release' },
    defectType: 'Logic',
    phaseIntroduced: 'Code',
    foundIn: 'System',
    regression: false,
    customerFacing: true,
    environment: { browser: 'chromium', backendEnv: 'development' },
    reproductionSteps: [{ step: 1, action: 'Sign in as user+alias@example.com' }],
    expectedResult: 'The user is signed in',
    actualResult: 'An error message is shown',
    rootCause: { status: 'unknown', summary: null, evidence: [], fiveWhys: [] },
    resolution: { status: null, fixCommit: null, fixPr: null, fixedInVersion: null, verifiedBy: null, verifiedAt: null, regressionTestId: null },
    compliance: [],
    evidence: { screenshots: [], videos: [], logs: [], har: [] },
    history: [],
  };
}

// Two open (Triaged Sev2, Reopened Sev3), two closed (Closed Sev1, Won't Fix Sev4); no defectMetrics in closure.
const SCHEMA_DEFECTS = {
  'defects/DEF-001-AUTH-UI.json': defectRecord(1, 'Triaged', 'Sev2', 'Critical'),
  'defects/DEF-002-AUTH-UI.json': defectRecord(2, 'Closed', 'Sev1', 'Blocker'),
  'defects/DEF-003-AUTH-UI.json': defectRecord(3, "Won't Fix", 'Sev4', 'Minor'),
  'defects/DEF-004-AUTH-UI.json': defectRecord(4, 'Reopened', 'Sev3', 'Major'),
};

describe('A1/A2: real DefectSchema records', () => {
  it('the fixture records validate against DefectSchema', () => {
    for (const rec of Object.values(SCHEMA_DEFECTS)) expect(DefectSchema.safeParse(rec).success).toBe(true);
  });

  const { root, runDir } = fixture({
    'reports/closure/closure.json': { metrics: { passed: 10, failed: 2, blocked: 0 } },
    'gates/gate-3-decision.json': FULL_RUN['gates/gate-3-decision.json'],
    ...SCHEMA_DEFECTS,
  });
  const tech = run(SCRIPT.technical, root);
  const sign = run(SCRIPT.signoff, root);

  it('the technical report renders and counts open/closed from status.code (closed = Closed, Verified, Resolved, Won\'t Fix, …)', () => {
    expect(tech.stderr).toBe('');
    expect(tech.status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'));
    expect(text).toContain('Open Defects\n2');
    expect(text).toContain('Closed Defects\n2');
    expect(text).toContain('Sev2');
    expect(text).toContain('Triaged');
    expect(text).not.toContain('[object Object]');
  });

  it('the sign-off counts the same open defects and names the highest open severity by its code', () => {
    expect(sign.stderr).toBe('');
    expect(sign.status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'));
    // The renderer breaks the line after the leading number into its own text run.
    expect(text).toMatch(/(^|\n)2[^a-z0-9]*open defects; highest severity: Sev2/);
    expect(text).not.toContain('[object Object]');
  });
});

describe('A2: the technical report and the sign-off agree on open defects', () => {
  it('on FULL_RUN both take closure.json#defectMetrics.confirmedOpen first (3), not the one record', () => {
    const { root, runDir } = fixture(FULL_RUN);
    expect(run(SCRIPT.technical, root).status).toBe(0);
    expect(run(SCRIPT.signoff, root).status).toBe(0);
    expect(pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'))).toContain('Open Defects\n3');
    expect(pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'))).toMatch(/(^|\n)3[^a-z0-9]*open defects; highest severity: Sev2/);
  });

  it('with no defects/ and no defectMetrics the sign-off says "Open defects: not available", never "No open defects"', () => {
    const { root, runDir } = fixture({
      'reports/closure/closure.json': { metrics: { passed: 1, failed: 0, blocked: 0 } },
      'gates/gate-3-decision.json': FULL_RUN['gates/gate-3-decision.json'],
    });
    const r = run(SCRIPT.signoff, root);
    expect(r.status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'));
    expect(text).toContain('Open defects: not available');
    expect(text).not.toContain('No open defects');
  });

  it('confirmedOpen 0 prints "No open defects at sign-off."', () => {
    const { root, runDir } = fixture({
      'reports/closure/closure.json': { metrics: { passed: 1, failed: 0, blocked: 0 }, defectMetrics: { totalLogged: 2, confirmedOpen: 0 } },
      'gates/gate-3-decision.json': FULL_RUN['gates/gate-3-decision.json'],
    });
    expect(run(SCRIPT.signoff, root).status).toBe(0);
    expect(pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'))).toContain('No open defects at sign-off.');
  });
});

// Fix round 2, I2: the Security Officer row follows the fields DefectSchema really has — a SEC defect id or a
// CWE-/WSTG- compliance tag — not a `tags` array no record carries.
describe('I2: the Security Officer signs when the run holds a security defect', () => {
  const secDefect = { ...defectRecord(1, 'Triaged', 'Sev2', 'Critical'), id: 'DEF-001-AUTH-SEC' };
  const cweDefect = { ...defectRecord(2, 'Triaged', 'Sev3', 'Major'), compliance: ['CWE-79', 'WSTG-v42-INPV-01'] };
  const signoff = (defects: Record<string, unknown>) => {
    const { root, runDir } = fixture({
      'reports/closure/closure.json': { metrics: { passed: 3, failed: 1, blocked: 0 } },
      'gates/gate-3-decision.json': FULL_RUN['gates/gate-3-decision.json'],
      ...defects,
    });
    const r = run(SCRIPT.signoff, root);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    return pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'));
  };

  it('the fixtures validate against DefectSchema', () => {
    expect(DefectSchema.safeParse(secDefect).success).toBe(true);
    expect(DefectSchema.safeParse(cweDefect).success).toBe(true);
  });

  it('a DEF-001-AUTH-SEC defect adds the Security Officer row', () => {
    expect(signoff({ 'defects/DEF-001-AUTH-SEC.json': secDefect })).toContain('Security Officer');
  });

  it('a defect carrying a CWE-/WSTG- compliance tag adds it too', () => {
    expect(signoff({ 'defects/DEF-002-AUTH-UI.json': cweDefect })).toContain('Security Officer');
  });

  it('a run with no security defect has no Security Officer row', () => {
    expect(signoff(SCHEMA_DEFECTS)).not.toContain('Security Officer');
  });

  it('the skill and the agents state the same rule', () => {
    expect(read('.claude/skills/_qa-report-signoff-pdf/SKILL.md')).toMatch(/`"Security Officer"` when a defect id ends in `-SEC` or a defect's `compliance` holds a `CWE-` or `WSTG-` tag/);
    expect(read('.claude/skills/_qa-report-signoff-pdf/SKILL.md')).not.toContain('has tag `security`');
    expect(read('.claude/agents/spv/qa-executive-reporter-spv.md')).toMatch(/Security Officer when a defect id ends in `-SEC` or a defect's `compliance` holds a `CWE-` or `WSTG-` tag/);
  });
});

// Fix round 2, I3: the closure reporter copies coverage.json#requirementsCoverage into
// closure.json#metrics.requirementsCoverage (number, or null when unavailable); the technical report prints it.
describe('I3: the pinned requirements coverage prints', () => {
  const coverage = { requirementsCoverage: 87.5, testExecutionCoverage: 95, codeCoverage: null };
  const tech = (requirementsCoverage: number | null) => {
    const { root, runDir } = fixture({
      'reports/closure/closure.json': { metrics: { passed: 7, failed: 1, blocked: 0, passRate: 87.5, requirementsCoverage }, unavailableMetrics: [] },
      'reports/metrics/coverage.json': { ...coverage, requirementsCoverage },
    });
    const r = run(SCRIPT.technical, root);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    return pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'));
  };

  it('a value copied from coverage.json prints as a percentage', () => {
    expect(tech(87.5)).toContain('Requirements Coverage\n87.5%');
  });

  it('null prints "not available", never 0', () => {
    expect(tech(null)).toContain('Requirements Coverage\nnot available');
  });
});

describe('A3: coverage.json noData', () => {
  it('coverage reads "not available" when reports/metrics/coverage.json holds noData, even though closure says 0', () => {
    const { root, runDir } = fixture({
      'reports/closure/closure.json': { metrics: { passed: 3, failed: 0, blocked: 0, requirementsCoverage: 0 }, unavailableMetrics: [] },
      'reports/metrics/coverage.json': { noData: true, requirementsCoverage: 0 },
    });
    expect(run(SCRIPT.technical, root).status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'));
    expect(text).toContain('Requirements Coverage\nnot available');
    expect(text).not.toMatch(/(^|\n)0\.0%/);
  });
});

describe('A4: a compliance report without regulation', () => {
  it('is listed under its file name', () => {
    const { root, runDir } = fixture({
      'reports/closure/closure.json': { metrics: { passed: 3, failed: 0, blocked: 0 } },
      'reports/compliance/istqb.json': { sectionsCovered: ['ISTQB-FL-1.4', 'ISTQB-FL-5.1', 'ISTQB-FL-5.3'], gaps: ['ISTQB-FL-4.2'] },
    });
    expect(run(SCRIPT.technical, root).status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'));
    expect(text).toContain('istqb\n3\n1');
    expect(text).not.toContain('Compliance reports: not available');
  });
});

describe('B1: cycle time and token usage shapes', () => {
  it('reads cycle-time.json#totalWallClockMs before the phase sum, and sums only {agent, model, ts} rows, never a rollup row', () => {
    const { root, runDir } = fixture({
      'reports/closure/closure.json': { metrics: { passed: 3, failed: 0, blocked: 0 } },
      'reports/metrics/cycle-time.json': {
        phases: [{ phase: 'scan', startedAt: '2026-10-04T00:00:00Z', completedAt: '2026-10-04T00:30:00Z', durationMs: 1800000, agentName: 'scanner' }],
        totalWallClockMs: 7200000,
        bottleneckPhase: 'scan',
      },
      'reports/metrics/token-usage.jsonl':
        [
          { agent: 'a', model: 'm', inputTokens: 1, outputTokens: 1, cachedTokens: 0, usdCost: 1.5, ts: '2026-10-04T00:00:00Z' },
          { model: 'm', scope: 'per-model', usdCost: 1.5 },
          { agent: 'a', usdCost: 1.5 },
        ]
          .map((r) => JSON.stringify(r))
          .join('\n') + '\n',
    });
    expect(run(SCRIPT.technical, root).status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'));
    expect(text).toContain('Cycle Time: 2 h 0 min');
    expect(text).toContain('Token Cost: $1.5000');
  });
});

describe('B3: exit criteria from closure.json#exitCriteria', () => {
  const base = { 'gates/gate-3-decision.json': FULL_RUN['gates/gate-3-decision.json'] };

  it('an empty list prints "Exit criteria: not defined in the test plan"', () => {
    const { root, runDir } = fixture({ ...base, 'reports/closure/closure.json': { metrics: {}, exitCriteria: [] } });
    expect(run(SCRIPT.signoff, root).status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'));
    expect(text).toContain('Exit criteria: not defined in the test plan');
    expect(text).not.toContain('Exit criteria: not available');
  });

  it('listed criteria are printed one per line', () => {
    const { root, runDir } = fixture({
      ...base,
      'reports/closure/closure.json': {
        metrics: {},
        exitCriteria: [
          { criterion: 'No open Sev1 defects', met: true, evidence: 'defectMetrics.confirmedOpen by severity' },
          { criterion: 'Requirements coverage at least 90%', met: false, evidence: 'coverage.json' },
        ],
      },
    });
    expect(run(SCRIPT.signoff, root).status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'));
    expect(text).toContain('No open Sev1 defects');
    expect(text).toContain('Requirements coverage at least 90%');
  });
});

describe('A5/A6: refusals', () => {
  const deck = FULL_RUN['reports/executive/executive-deck.json'];
  const slides = (d: unknown) => {
    const f = fixture({ 'reports/executive/executive-deck.json': d });
    return { ...run(SCRIPT.slides, f.root), pdf: path.join(f.runDir, 'reports', 'executive', 'executive-deck.pdf') };
  };

  it.each([
    ['recommendations is empty', { ...deck, recommendations: [] }],
    ['residualRisks is empty', { ...deck, residualRisks: [] }],
    ['residualRisks is not an array', { ...deck, residualRisks: 'Users may fail to sign in.' }],
    ['recommendations is not an array', { ...deck, recommendations: { action: 'Fix it' } }],
    ['an impact is not HIGH|MEDIUM|LOW', { ...deck, recommendations: [{ ...deck.recommendations[0], impact: 'CRITICAL' }] }],
  ])('slides exit 4 when %s', (_why, d) => {
    const r = slides(d);
    expect(r.status).toBe(4);
    expect(fs.existsSync(r.pdf)).toBe(false);
  });

  it.each([
    ['1 insight (4 slides)', deck.supportingInsights.slice(0, 1)],
    ['5 insights (8 slides)', [...deck.supportingInsights, ...deck.supportingInsights.slice(0, 2)]],
  ])('slides exit 6 for %s', (_why, insights) => {
    const r = slides({ ...deck, supportingInsights: insights });
    expect(r.status).toBe(6);
    expect(fs.existsSync(r.pdf)).toBe(false);
  });

  it.each([
    ['an agent name', 'Raised by qa-ui-specialist during the cycle.'],
    ['the framework name', 'The Aegis pipeline found one login issue.'],
  ])('slides exit 7 when the deck names %s', (_why, keyFinding) => {
    const r = slides({ ...deck, keyFinding });
    expect(r.status).toBe(7);
    expect(fs.existsSync(r.pdf)).toBe(false);
  });

  it('the sign-off exits 3 with no gates/gate-3-decision.json', () => {
    const { root, runDir } = fixture({ 'reports/closure/closure.json': FULL_RUN['reports/closure/closure.json'] });
    const r = run(SCRIPT.signoff, root);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('gate-3-decision.json');
    expect(fs.existsSync(path.join(runDir, 'reports', 'executive', 'signoff.pdf'))).toBe(false);
  });

  it('the sign-off exits 4 on a gate decision it cannot map', () => {
    const { root } = fixture({
      'reports/closure/closure.json': FULL_RUN['reports/closure/closure.json'],
      'gates/gate-3-decision.json': { ...FULL_RUN['gates/gate-3-decision.json'], decision: 'deferred' },
    });
    expect(run(SCRIPT.signoff, root).status).toBe(4);
  });
});

describe('A7: the executive reporter describes the deck the script renders', () => {
  const text = read('.claude/agents/tier1-phase/qa-executive-reporter.md');
  const d3 = text.slice(text.indexOf('### Deliverable 3'), text.indexOf('## Tone-Check Protocol'));

  it('Deliverable 3 says 2–4 supporting insights and has no appendix slide', () => {
    expect(d3).toContain('2–4 SUPPORTING INSIGHTS');
    expect(d3).not.toMatch(/appendix/i);
    expect(d3).not.toMatch(/\b3 SUPPORTING INSIGHTS/);
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
