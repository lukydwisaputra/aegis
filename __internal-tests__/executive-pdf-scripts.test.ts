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

const flat = (s: string): string => s.replace(/\s+/g, ' ');

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
    expect(text).toContain('Closed Defects\n0'); // the run holds one record, not closed: closed is read from the records, not total minus open
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

  it('prints the owner\'s Gate 3 decision under its own label, never a release verdict', () => {
    const text = flat(pdfText(pdf));
    expect(text).toContain('GATE 3 DECISION (owner)');
    expect(text).toContain('APPROVED WITH CONDITIONS');
    expect(text).not.toMatch(/RELEASE VERDICT|CONDITIONAL|NO-GO|\bGO\b/);
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

describe('--max-jargon-survivors must be an integer', () => {
  const { root } = fixture(FULL_RUN);
  it.each([
    ['sign-off', SCRIPT.signoff],
    ['executive deck', SCRIPT.slides],
  ])('the %s script exits 2 with a clear error on a value that is not an integer', (_name, script) => {
    for (const bad of ['abc', '1.5', '', '2x', '-']) {
      const r = run(script, root, [`--max-jargon-survivors=${bad}`]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`--max-jargon-survivors must be an integer, got "${bad}"`);
    }
  });

  it.each([
    ['sign-off', SCRIPT.signoff],
    ['executive deck', SCRIPT.slides],
  ])('the %s script still accepts 0 and a larger integer', (_name, script) => {
    for (const ok of ['0', '3']) expect(run(script, root, [`--max-jargon-survivors=${ok}`]).status).toBe(0);
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

  it('the sign-off counts the same open defects and names them by severity name', () => {
    expect(sign.stderr).toBe('');
    expect(sign.status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'));
    expect(flat(text)).toContain('2 open defects: 1 Critical, 1 Major');
    expect(text).not.toContain('[object Object]');
  });
});

describe('A2: the technical report and the sign-off agree on open defects', () => {
  it('on FULL_RUN both take confirmedOpen first (3); the sign-off cannot break 3 down by severity from one record', () => {
    const { root, runDir } = fixture(FULL_RUN);
    expect(run(SCRIPT.technical, root).status).toBe(0);
    expect(run(SCRIPT.signoff, root).status).toBe(0);
    expect(pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'))).toContain('Open Defects\n3');
    expect(flat(pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf')))).toContain('3 open defects; severity breakdown: not available');
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

  // Fix round 2, M1: the standard Helvetica font is WinAnsi-encoded and has no check-mark glyphs, so the
  // checklist prints words.
  it('each criterion prints "Met" or "Not met", never a check-mark glyph', () => {
    const { root, runDir } = fixture({
      ...base,
      'reports/closure/closure.json': {
        metrics: {},
        exitCriteria: [
          { criterion: 'No open Sev1 defects', met: true, evidence: 'defectMetrics' },
          { criterion: 'Requirements coverage at least 90%', met: false, evidence: 'coverage.json' },
        ],
      },
    });
    expect(run(SCRIPT.signoff, root).status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'));
    expect(text).toMatch(/(^|\n)Met\nNo open Sev1 defects/);
    expect(text).toMatch(/(^|\n)Not met\nRequirements coverage at least 90%/);
    const src = read('packages/@qa/pdf-renderer/src/index.ts');
    expect(src).not.toMatch(/[✓✗▸]/);
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
    // Fix round 2, M5: each item's shape is checked, not only the list.
    ['a recommendation is a string', { ...deck, recommendations: ['Fix the login issue'] }],
    ['a recommendation has no owner', { ...deck, recommendations: [{ action: 'Fix it', deadline: '2026-10-11', impact: 'HIGH' }] }],
    ['a recommendation has an empty action', { ...deck, recommendations: [{ ...deck.recommendations[0], action: '  ' }] }],
    ['a recommendation deadline is not a string', { ...deck, recommendations: [{ ...deck.recommendations[0], deadline: 20261011 }] }],
    ['a residual risk is a string', { ...deck, residualRisks: ['Users may fail to sign in.'] }],
    ['a residual risk has no plain text', { ...deck, residualRisks: [{ risk: 'Users may fail to sign in.' }] }],
    ['a residual risk is null', { ...deck, residualRisks: [null] }],
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

describe('the sign-off decision banner', () => {
  const gate = (decision: string) => ({ ...FULL_RUN['gates/gate-3-decision.json'], decision });
  const signoff = (decision: string) => {
    const { root, runDir } = fixture({ 'reports/closure/closure.json': FULL_RUN['reports/closure/closure.json'], 'gates/gate-3-decision.json': gate(decision) });
    const r = run(SCRIPT.signoff, root);
    return { r, text: r.status === 0 ? flat(pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'))) : '' };
  };

  it.each([
    ['approved', 'APPROVED'],
    ['approved-with-conditions', 'APPROVED WITH CONDITIONS'],
    ['rejected', 'REJECTED'],
  ])('prints %s as %s and records it in the script output', (decision, shown) => {
    const { r, text } = signoff(decision);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ decision });
    expect(JSON.parse(r.stdout)).not.toHaveProperty('verdict');
    expect(text).toContain(`GATE 3 DECISION (owner) ${shown}`);
    if (decision === 'approved') expect(text).not.toContain('WITH CONDITIONS'); // 'APPROVED' is a prefix of the other text
  });

  it('accepts the recorded decision in any letter case and refuses a value outside the three', () => {
    expect(signoff('APPROVED').r.status).toBe(0);
    expect(signoff('GO').r.status).toBe(4);
    expect(signoff('deferred').r.status).toBe(4);
  });
});

describe('the sign-off tone-check (the deck\'s rule)', () => {
  const tonal = (scope: string, residual: string, criterion: string) => {
    const { root, runDir } = fixture({
      'reports/closure/closure.json': { metrics: {}, exitCriteria: [{ criterion, met: false }] },
      'gates/gate-3-decision.json': FULL_RUN['gates/gate-3-decision.json'],
      'plan.json': { scope },
      'risk-register.json': { residualSummary: residual },
    });
    const r = run(SCRIPT.signoff, root);
    return { r, text: r.status === 0 ? flat(pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'))) : '' };
  };

  it('the sign-off rewrites jargon and leaves address and INPUT intact', () => {
    const { r, text } = tonal('Address book and INPUT validation', 'Search is slow: p95 latency 900ms for most users', 'Address the INPUT validation gaps');
    expect(r.status).toBe(0);
    expect(text).toContain('the slowest 5% of requests take 900ms');
    expect(text).not.toContain('p95');
    expect(text).toContain('Address book and INPUT validation');
    expect(text).toContain('Address the INPUT validation gaps');
    expect(JSON.parse(r.stdout).jargonRewriteCount).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ jargonSurvivors: 0 });
  });

  it('fails closed with exit 8 and no PDF when more jargon survives than --max-jargon-survivors allows', () => {
    // A rewrite that itself contains jargon cannot be produced by the shipped rules, so the threshold is exercised with -1.
    const { root, runDir } = fixture({ 'reports/closure/closure.json': { metrics: {} }, 'gates/gate-3-decision.json': FULL_RUN['gates/gate-3-decision.json'] });
    const r = run(SCRIPT.signoff, root, ['--max-jargon-survivors=-1']);
    expect(r.status).toBe(8);
    expect(fs.existsSync(path.join(runDir, 'reports', 'executive', 'signoff.pdf'))).toBe(false);
  });

  it('the executive deck fails closed with exit 5 and no PDF when more jargon survives than --max-jargon-survivors allows', () => {
    const { root, runDir } = fixture(FULL_RUN);
    const r = run(SCRIPT.slides, root, ['--max-jargon-survivors=-1']);
    expect(r.status).toBe(5);
    expect(fs.existsSync(path.join(runDir, 'reports', 'executive', 'executive-deck.pdf'))).toBe(false);
  });
});

describe('the technical report after a reissue', () => {
  it('prefers the collector\'s coverage.json over a stale closure.json (a reissued run)', () => {
    const { root, runDir } = fixture({
      'reports/closure/closure.json': { metrics: { passed: 5, failed: 0, blocked: 0, requirementsCoverage: 0 }, unavailableMetrics: [] },
      'reports/metrics/coverage.json': { requirementsCoverage: 92.1, testExecutionCoverage: 67, codeCoverage: null, partialRequirements: 3 },
    });
    expect(run(SCRIPT.technical, root).status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'));
    expect(text).toContain('Requirements Coverage\n92.1%');
    expect(text).not.toMatch(/(^|\n)0\.0%/);
  });

  it('a noData coverage.json still reads not available, and a closure that lists coverage as unavailable yields to a computed figure', () => {
    const noData = fixture({ 'reports/closure/closure.json': { metrics: { passed: 1, failed: 0, blocked: 0, requirementsCoverage: 50 } }, 'reports/metrics/coverage.json': { noData: true, requirementsCoverage: 0 } });
    expect(run(SCRIPT.technical, noData.root).status).toBe(0);
    expect(pdfText(path.join(noData.runDir, 'reports', 'executive', 'technical-report.pdf'))).toContain('Requirements Coverage\nnot available');
    const listed = fixture({
      'reports/closure/closure.json': { metrics: { passed: 1, failed: 0, blocked: 0, requirementsCoverage: 0 }, unavailableMetrics: ['coverage.json'] },
      'reports/metrics/coverage.json': { requirementsCoverage: 80, testExecutionCoverage: 90, codeCoverage: null, partialRequirements: 0 },
    });
    expect(run(SCRIPT.technical, listed.root).status).toBe(0);
    expect(pdfText(path.join(listed.runDir, 'reports', 'executive', 'technical-report.pdf'))).toContain('Requirements Coverage\n80.0%');
  });
});

describe('the technical report takes check counts from coverage.json and closed defects from the records', () => {
  const COUNTS = { designed: 100, attempted: 98, passed: 61, failed: 5, partial: 1, blocked: 31, skipped: 0, unknown: 0, notAttempted: 2 };
  const defectRec = (id: string, status: string) => [`defects/${id}.json`, { id, title: 't', severity: { code: 'Sev3', name: 'Major' }, status: { code: status } }] as const;
  const records = Object.fromEntries([
    ...Array.from({ length: 3 }, (_, i) => defectRec(`DEF-00${i + 1}-AUTH-UI`, 'Triaged')),
    ...Array.from({ length: 2 }, (_, i) => defectRec(`DEF-00${i + 4}-AUTH-UI`, 'Closed')),
    defectRec('DEF-006-AUTH-UI', 'Flagged-for-owner'),
  ]);
  const base = {
    // closure.json carries the executor's roll-up, which counts the partial case as a pass and drops it from the total
    'reports/closure/closure.json': { metrics: { passed: 62, failed: 5, blocked: 31 }, defectMetrics: { totalLogged: 6, confirmedOpen: 3 } },
    ...records,
  };

  it('Total Tests is the attempted count (98, partial included) and passed, failed, blocked come from counts, not closure.json', () => {
    const { root, runDir } = fixture({ ...base, 'reports/metrics/coverage.json': { requirementsCoverage: 90, testExecutionCoverage: 98, codeCoverage: null, partialRequirements: 0, counts: COUNTS } });
    expect(run(SCRIPT.technical, root).status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'));
    expect(text).toContain('Total Tests\n98');
    expect(text).toContain('Passed\n61');
    expect(text).toContain('Failed\n5');
    expect(text).toContain('Partial\n1');
    expect(text).toContain('Blocked\n31');
    expect(text).toContain('Skipped\n0');
  });

  it('the cells read 98 / 61 / 5 / 1 / 31 in that order and the parts sum to the total; the pass rate is passed over attempted', () => {
    const { root, runDir } = fixture({
      ...base,
      'reports/closure/closure.json': { metrics: { passed: 62, failed: 5, blocked: 31, passRate: 63.3 }, defectMetrics: { totalLogged: 6, confirmedOpen: 3 } }, // the executor's roll-up counts the partial as a pass: 62 of 98
      'reports/metrics/coverage.json': { requirementsCoverage: 90, testExecutionCoverage: 98, codeCoverage: null, partialRequirements: 0, counts: COUNTS },
    });
    expect(run(SCRIPT.technical, root).status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'));
    const cell = (label: string): number => Number(new RegExp(`${label}\\n(\\d+)`).exec(text)?.[1]);
    expect(['Total Tests', 'Passed', 'Failed', 'Partial', 'Blocked'].map(cell)).toEqual([98, 61, 5, 1, 31]);
    expect(cell('Passed') + cell('Failed') + cell('Partial') + cell('Blocked') + cell('Skipped')).toBe(cell('Total Tests'));
    expect(text.indexOf('Failed\n5')).toBeLessThan(text.indexOf('Partial\n1'));
    expect(text.indexOf('Partial\n1')).toBeLessThan(text.indexOf('Blocked\n31'));
    expect(text).toContain('Pass Rate\n62.2%');
    expect(text).not.toContain('63.3%');
    expect(Math.round((1000 * cell('Passed')) / cell('Total Tests')) / 10).toBe(62.2);
  });

  it('falls back to closure.json when coverage.json has no counts or is noData', () => {
    for (const cov of [{ requirementsCoverage: 90, testExecutionCoverage: 98, codeCoverage: null, partialRequirements: 0 }, { noData: true, requirementsCoverage: 0, counts: { ...COUNTS, designed: 0, attempted: 0, passed: 0, failed: 0, partial: 0, blocked: 0, notAttempted: 0 } }]) {
      const { root, runDir } = fixture({ ...base, 'reports/metrics/coverage.json': cov });
      expect(run(SCRIPT.technical, root).status).toBe(0);
      const text = pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'));
      expect(text).toContain('Total Tests\n98');
      expect(text).toContain('Passed\n62');
      expect(text).toContain('Partial\nnot available');
      expect(text).toContain('Undetermined\nnot available');
    }
  });

  it('an undetermined check has its own cell, so the cells still add up to the total', () => {
    const counts = { ...COUNTS, attempted: 99, unknown: 1 };
    const { root, runDir } = fixture({ ...base, 'reports/metrics/coverage.json': { requirementsCoverage: 90, testExecutionCoverage: 98, codeCoverage: null, partialRequirements: 0, counts } });
    expect(run(SCRIPT.technical, root).status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'));
    const cell = (label: string): number => Number(new RegExp(`${label}\\n(\\d+)`).exec(text)?.[1]);
    expect(cell('Undetermined')).toBe(1);
    expect(['Passed', 'Failed', 'Partial', 'Blocked', 'Skipped', 'Undetermined'].map(cell).reduce((a, b) => a + b, 0)).toBe(cell('Total Tests'));
  });

  // Case files: 001 pass, 002 pass, 003 fail, 004 partial, 005 blocked, 006 designed with no result. attempted 5.
  const caseFiles = {
    'rtm.json': { rows: [{ requirementId: 'REQ-AUTH-01', testStatus: 'Covered' }] },
    ...Object.fromEntries(['001', '002', '003', '004', '005', '006'].map((n) => [`cases/TC-AUTH-${n}.json`, { id: `TC-AUTH-${n}` }])),
    'cases/TC-AUTH-001-result.json': { status: 'pass' }, 'cases/TC-AUTH-002-result.json': { status: 'pass' }, 'cases/TC-AUTH-003-result.json': { status: 'fail' },
    'cases/TC-AUTH-004-result.json': { status: 'partial' }, 'cases/TC-AUTH-005-result.json': { status: 'blocked' },
  };
  const staleClosure = { 'reports/closure/closure.json': { metrics: { passed: 2, failed: 1, blocked: 1, passRate: 50 } } }; // no partial: closure total would be 4

  it('a stale coverage.json with no counts key is recomputed from the case files, not read as closure passed + failed + blocked', () => {
    const { root, runDir } = fixture({ ...caseFiles, ...staleClosure, 'reports/metrics/coverage.json': { requirementsCoverage: 100, testExecutionCoverage: 83.3, codeCoverage: null, partialRequirements: 0 } });
    expect(run(SCRIPT.technical, root).status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'));
    expect(text).toContain('Total Tests\n5');
    expect(text).toContain('Passed\n2');
    expect(text).toContain('Partial\n1');
    expect(text).toContain('Blocked\n1');
    expect(text).toContain('Pass Rate\n40.0%');
  });

  it('with coverage.json absent or stale the requirements coverage is the recomputed figure, not a closure copy of 0', () => {
    const rtmRows = [...Array.from({ length: 35 }, (_, i) => ({ requirementId: `REQ-AUTH-${i + 1}`, testStatus: 'Covered' })), ...Array.from({ length: 3 }, (_, i) => ({ requirementId: `REQ-AUTH-${i + 40}`, testStatus: 'Partial' }))];
    const closure = { 'reports/closure/closure.json': { metrics: { passed: 2, failed: 1, blocked: 1, requirementsCoverage: 0 } } };
    const absent = fixture({ ...caseFiles, 'rtm.json': { rows: rtmRows }, ...closure });
    expect(run(SCRIPT.technical, absent.root).status).toBe(0);
    expect(pdfText(path.join(absent.runDir, 'reports', 'executive', 'technical-report.pdf'))).toContain('Requirements Coverage\n92.1%');
    const stale = fixture({ ...caseFiles, 'rtm.json': { rows: rtmRows }, ...closure, 'reports/metrics/coverage.json': { requirementsCoverage: 50, testExecutionCoverage: 83.3, codeCoverage: null, partialRequirements: 3 } });
    expect(run(SCRIPT.technical, stale.root).status).toBe(0);
    expect(pdfText(path.join(stale.runDir, 'reports', 'executive', 'technical-report.pdf'))).toContain('Requirements Coverage\n92.1%');
  });

  it('with no coverage.json at all the counts are recomputed too; with no case files the closure figures stand, never zeros', () => {
    const noFile = fixture({ ...caseFiles, ...staleClosure });
    expect(run(SCRIPT.technical, noFile.root).status).toBe(0);
    expect(pdfText(path.join(noFile.runDir, 'reports', 'executive', 'technical-report.pdf'))).toContain('Total Tests\n5');
    const noCases = fixture({ ...staleClosure });
    expect(run(SCRIPT.technical, noCases.root).status).toBe(0);
    const text = pdfText(path.join(noCases.runDir, 'reports', 'executive', 'technical-report.pdf'));
    expect(text).toContain('Total Tests\n4');
    expect(text).toContain('Pass Rate\n50.0%');
    expect(text).toContain('Partial\nnot available');
  });

  it('Closed Defects counts only closed records: a flagged-for-owner record is neither open nor closed', () => {
    const { root, runDir } = fixture({ ...base, 'reports/metrics/coverage.json': { requirementsCoverage: 90, testExecutionCoverage: 98, codeCoverage: null, partialRequirements: 0, counts: COUNTS } });
    expect(run(SCRIPT.technical, root).status).toBe(0);
    const text = pdfText(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'));
    expect(text).toContain('Open Defects\n3');
    expect(text).toContain('Closed Defects\n2');
  });
});

describe('the sign-off version names the tested build', () => {
  const SHA = 'f1c171552e86702b1eebc562b1ed051add4773de';
  const discovery = { 'discovery-report.json': { target: { baseUrl: 'http://127.0.0.1:3002', commit: SHA, branch: 'development' } } };
  const versionOf = (files: Record<string, unknown>, extra: string[] = []): string => {
    const { root, runDir } = fixture({ ...FULL_RUN, ...files });
    expect(run(SCRIPT.signoff, root, extra).status).toBe(0);
    return pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'));
  };

  it('derives dev-<short commit> from the explorer\'s recorded target commit and the run environment', () => {
    expect(versionOf({ ...discovery, 'run.json': { runId: RUN, environment: 'development' } })).toContain('Version:\ndev-f1c1715');
  });

  it('prints the short commit alone when the run records no environment, and a non-hex commit is not a version', () => {
    expect(versionOf(discovery)).toContain('Version:\nf1c1715');
    expect(versionOf({ 'discovery-report.json': { target: { commit: 'not-a-sha' } } })).toContain('Version:\nunversioned');
  });

  it('an explicit --version wins, then plan.json version, then closure.json version, all before the commit', () => {
    const withRun = { ...discovery, 'run.json': { runId: RUN, environment: 'development' } };
    expect(versionOf(withRun, ['--version=2.4.0'])).toContain('Version:\n2.4.0');
    expect(versionOf({ ...withRun, 'plan.json': { scope: 's', version: '3.0.1' } })).toContain('Version:\n3.0.1');
    expect(versionOf({ ...withRun, 'reports/closure/closure.json': { ...FULL_RUN['reports/closure/closure.json'], version: '1.2.3' } })).toContain('Version:\n1.2.3');
  });

  // Set AEGIS_REAL_RUN_DIR to a completed run's directory to run this against real data; unset or absent, it skips.
  const REAL = process.env.AEGIS_REAL_RUN_DIR ?? '';
  (REAL !== '' && fs.existsSync(path.join(REAL, 'discovery-report.json')) ? it : it.skip)('the real run derives dev-f1c1715 (first 7 characters of its full commit)', () => {
    const real = (rel: string): unknown => JSON.parse(fs.readFileSync(path.join(REAL, rel), 'utf-8'));
    const { root, runDir } = fixture({ ...FULL_RUN, 'plan.json': { scope: 's' }, 'discovery-report.json': real('discovery-report.json'), 'run.json': real('run.json') });
    expect(run(SCRIPT.signoff, root).status).toBe(0);
    expect(pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'))).toContain('Version:\ndev-f1c1715');
  });

  it('an environment name that is an Object property never prints a function', () => {
    expect(versionOf({ ...discovery, 'run.json': { runId: RUN, environment: 'constructor' } })).toContain('Version:\nconstructor-f1c1715');
    expect(versionOf({ ...discovery, 'run.json': { runId: RUN, environment: 'toString' } })).toContain('Version:\ntoString-f1c1715');
  });

  it('reads unversioned only when nothing records the build', () => {
    expect(versionOf({})).toContain('Version:\nunversioned');
  });
});

describe('the sign-off residual risk source order', () => {
  const GATE = FULL_RUN['gates/gate-3-decision.json'];
  const risk = (riskId: string, title: string, score: string, extra: Record<string, unknown> = {}) => ({
    riskId, title, originalLikelihoodImpactScore: score, mitigationStatus: 'Partially tested', residualExposure: 'Some exposure remains.', ...extra,
  });
  const THREE = [
    risk('RISK-A-001', 'Login can be bypassed by a stale session', '5 x 5 = 25 (Critical)'),
    risk('RISK-B-002', 'Booking confirmations may arrive late', '3 x 4 = 12 (High)'),
    risk('RISK-C-003', 'Several optional settings are unset after migration', 'Not scored this cycle, surfaced by the compliance review'),
  ];
  const signoff = (files: Record<string, unknown>, extra: string[] = []) => {
    const { root, runDir } = fixture({ 'gates/gate-3-decision.json': GATE, ...files });
    const r = run(SCRIPT.signoff, root, extra);
    // The PDF text layer splits a bracket from the word after it ("[ Critical]"): close it up before comparing.
    return { r, text: r.status === 0 ? flat(pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf'))).replace(/\[ /g, '[') : '' };
  };

  it('prints closure.json residualRiskSummary when the risk register holds no residual data: count, the acknowledge sentence and each risk with its severity', () => {
    const { r, text } = signoff({ 'reports/closure/closure.json': { metrics: {}, residualRiskSummary: THREE }, 'risk-register.json': { risks: [] } });
    expect(r.status).toBe(0);
    expect(text).toContain('3 residual risks remain after testing and are recorded here for the product owner to acknowledge before closure, 1 of them originally rated Critical.');
    expect(text).toContain('- [Originally Critical] Login can be bypassed by a stale session');
    expect(text).toContain('- [Originally High] Booking confirmations may arrive late');
    expect(text).toContain('- Several optional settings are unset after migration');
    expect(text).not.toContain('No residual risk recorded');
    expect(text.indexOf('Login can be bypassed')).toBeLessThan(text.indexOf('Booking confirmations'));
  });

  it('uses the same path with no risk register at all, and states a singular count and no Critical clause when none is rated Critical', () => {
    const { text } = signoff({ 'reports/closure/closure.json': { metrics: {}, residualRiskSummary: [THREE[1]] } });
    expect(text).toContain('1 residual risk remains after testing and is recorded here for the product owner to acknowledge before closure.');
    expect(text).not.toContain('rated Critical');
    expect(text).not.toContain('originally rated');
    expect(text).not.toContain('not available (no risk register');
  });

  it('prints the reporter\'s plain sentence from residual-risks.json for a risk, the closure title for a risk with no entry, and the rating from the closure', () => {
    const { text } = signoff({
      'reports/closure/closure.json': { metrics: {}, residualRiskSummary: [risk('RISK-A-001', 'RLS gap', '5 x 5 = 25 (Critical)'), risk('RISK-B-002', 'Booking confirmations may arrive late', '3 x 4 = 12 (High)')] },
      'reports/executive/residual-risks.json': [{ riskId: 'RISK-A-001', plain: 'People may see records of another group.', rating: 'Low' }, { riskId: 'RISK-ZZZ', plain: 'Not in the closure.' }],
    });
    expect(text).toContain('- [Originally Critical] People may see records of another group.');
    expect(text).toContain('- [Originally High] Booking confirmations may arrive late');
    expect(text).toContain('2 residual risks remain after testing and are recorded here for the product owner to acknowledge before closure, 1 of them originally rated Critical.');
    expect(text).not.toContain('RLS gap');
    expect(text).not.toContain('Not in the closure');
  });

  it('ignores an unreadable or malformed residual-risks.json and a closure plain field, and prints the titles', () => {
    for (const body of ['{not json', JSON.stringify({ riskId: 'RISK-A-001', plain: 'x' }), JSON.stringify([{ riskId: 'RISK-A-001', plain: '  ' }, null, 'x'])]) {
      const { r, text } = signoff({
        'reports/closure/closure.json': { metrics: {}, residualRiskSummary: [risk('RISK-A-001', 'Login can be bypassed by a stale session', '5 x 5 = 25 (Critical)', { plain: 'closure plain is not read' })] },
        'reports/executive/residual-risks.json': body,
      });
      expect(r.status).toBe(0);
      expect(text).toContain('- [Originally Critical] Login can be bypassed by a stale session');
    }
  });

  it('takes the rating from the rating field, else severity, else the score', () => {
    const { text } = signoff({
      'reports/closure/closure.json': {
        metrics: {},
        residualRiskSummary: [
          risk('R-1', 'First risk title', '5 x 5 = 25 (Critical)', { rating: 'Low', severity: 'High' }),
          risk('R-2', 'Second risk title', '5 x 5 = 25 (Critical)', { severity: 'Medium' }),
          risk('R-3', 'Third risk title', '5 x 5 = 25 (Critical)'),
        ],
      },
    });
    expect(text).toContain('- [Originally Low] First risk title');
    expect(text).toContain('- [Originally Medium] Second risk title');
    expect(text).toContain('- [Originally Critical] Third risk title');
    expect(text).toContain('1 of them originally rated Critical');
  });

  it('keeps the risk register first: its residualSummary string, then its residual array, both before the closure', () => {
    const closure = { 'reports/closure/closure.json': { metrics: {}, residualRiskSummary: THREE } };
    const a = signoff({ ...closure, 'risk-register.json': { residualSummary: 'Two risks were accepted by the owner.' } });
    expect(a.text).toContain('Two risks were accepted by the owner.');
    expect(a.text).not.toContain('3 residual risks remain');
    const b = signoff({ ...closure, 'risk-register.json': { residual: [{}, {}] } });
    expect(b.text).toContain('2 residual risks accepted by the product owner');
    expect(b.text).not.toContain('3 residual risks remain');
  });

  it('an empty residualSummary or an empty residual array falls through to the closure, never printing 0 residual risks', () => {
    const closure = { 'reports/closure/closure.json': { metrics: {}, residualRiskSummary: THREE } };
    for (const reg of [{ residualSummary: '' }, { residualSummary: '   ' }, { residual: [] }]) {
      const { text } = signoff({ ...closure, 'risk-register.json': reg });
      expect(text).toContain('3 residual risks remain after testing');
      expect(text).not.toContain('0 residual risks');
    }
    expect(signoff({ 'reports/closure/closure.json': { metrics: {} }, 'risk-register.json': { residual: [] } }).text).toContain('No residual risk recorded');
  });

  it('prints No residual risk recorded only when no source holds a risk, and the no-register note when there is nothing at all', () => {
    expect(signoff({ 'reports/closure/closure.json': { metrics: {}, residualRiskSummary: [] }, 'risk-register.json': { risks: [] } }).text).toContain('No residual risk recorded');
    expect(signoff({ 'reports/closure/closure.json': { metrics: {} }, 'risk-register.json': { risks: [] } }).text).toContain('No residual risk recorded');
    expect(signoff({ 'reports/closure/closure.json': { metrics: {}, residualRiskSummary: 'none' } }).text).toContain('Residual risk: not available (no risk register in this run)');
    expect(signoff({ 'reports/closure/closure.json': { metrics: {} } }).text).toContain('Residual risk: not available (no risk register in this run)');
  });

  it('skips a row that is not an object or has no title, and counts only the rows it prints', () => {
    const { text } = signoff({ 'reports/closure/closure.json': { metrics: {}, residualRiskSummary: [THREE[0], null, 'x', { riskId: 'RISK-Z' }] } });
    expect(text).toContain('1 residual risk remains');
  });

  it('still runs the tone-check on the closure risks: jargon is rewritten, and the decision is still validated', () => {
    const jargon = { 'reports/closure/closure.json': { metrics: {}, residualRiskSummary: [risk('RISK-A-001', 'Search is slow: p95 latency 900ms for most users', '3 x 3 = 9 (Medium)')] } };
    const ok = signoff(jargon);
    expect(ok.r.status).toBe(0);
    expect(ok.text).toContain('the slowest 5% of requests take 900ms');
    expect(ok.text).not.toContain('p95');
    expect(JSON.parse(ok.r.stdout).jargonRewriteCount).toBeGreaterThanOrEqual(1);
    expect(signoff(jargon, ['--max-jargon-survivors=-1']).r.status).toBe(8);
    const { root } = fixture({ ...jargon, 'gates/gate-3-decision.json': { ...GATE, decision: 'GO' } });
    expect(run(SCRIPT.signoff, root).status).toBe(4);
  });

  it('labels every rating as the original one: "[Originally High]", never a bare bracketed rating', () => {
    const { text } = signoff({ 'reports/closure/closure.json': { metrics: {}, residualRiskSummary: THREE } });
    expect(text).toContain('- [Originally Critical] Login can be bypassed by a stale session');
    expect(text).toContain('- [Originally High] Booking confirmations may arrive late');
    expect(text).not.toMatch(/- \[(Critical|High|Medium|Low)\]/);
  });

  it('the header counts the originally Critical risks: no clause for 0, "1 of them" for 1, "2 of them" for 2, and a singular risk count', () => {
    const crit = (id: string) => risk(id, `Critical risk ${id}`, '5 x 5 = 25 (Critical)');
    const high = (id: string) => risk(id, `High risk ${id}`, '3 x 4 = 12 (High)');
    const head = (list: unknown[]) => signoff({ 'reports/closure/closure.json': { metrics: {}, residualRiskSummary: list } }).text;
    const zero = head([high('R-1'), high('R-2')]);
    expect(zero).toContain('2 residual risks remain after testing and are recorded here for the product owner to acknowledge before closure.');
    expect(zero).not.toContain('originally rated');
    expect(head([crit('R-1'), high('R-2')])).toContain('2 residual risks remain after testing and are recorded here for the product owner to acknowledge before closure, 1 of them originally rated Critical.');
    expect(head([crit('R-1'), crit('R-2'), high('R-3')])).toContain('3 residual risks remain after testing and are recorded here for the product owner to acknowledge before closure, 2 of them originally rated Critical.');
    expect(head([crit('R-1')])).toContain('1 residual risk remains after testing and is recorded here for the product owner to acknowledge before closure, 1 of them originally rated Critical.');
  });

  it('a risk without a rating prints no bracket and no "Originally"', () => {
    const { text } = signoff({ 'reports/closure/closure.json': { metrics: {}, residualRiskSummary: [THREE[2]] } });
    expect(text).toContain('- Several optional settings are unset after migration');
    expect(text).not.toContain('[Originally');
    expect(text).not.toContain('originally rated');
  });

  it('an explicit rating field is the original rating too', () => {
    const { text } = signoff({ 'reports/closure/closure.json': { metrics: {}, residualRiskSummary: [risk('R-1', 'Explicit rating risk', 'Not scored', { rating: 'critical' })] } });
    expect(text).toContain('- [Originally Critical] Explicit rating risk');
    expect(text).toContain('1 of them originally rated Critical');
  });

  it('a duplicate riskId in residual-risks.json: the first entry wins, later ones are ignored, and one warning on stderr names the id', () => {
    const { r, text } = signoff({
      'reports/closure/closure.json': { metrics: {}, residualRiskSummary: [risk('RISK-A-001', 'Closure title', '3 x 4 = 12 (High)')] },
      'reports/executive/residual-risks.json': [{ riskId: 'RISK-A-001', plain: 'First sentence wins.' }, { riskId: 'RISK-A-001', plain: 'Second sentence is ignored.' }],
    });
    expect(r.status).toBe(0);
    expect(text).toContain('- [Originally High] First sentence wins.');
    expect(text).not.toContain('Second sentence is ignored');
    const warnings = r.stderr.split('\n').filter((l: string) => l.includes('RISK-A-001'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/duplicate/i);
    const clean = signoff({
      'reports/closure/closure.json': { metrics: {}, residualRiskSummary: [risk('RISK-A-001', 'Closure title', '3 x 4 = 12 (High)')] },
      'reports/executive/residual-risks.json': [{ riskId: 'RISK-A-001', plain: 'Only sentence.' }],
    });
    expect(clean.r.stderr).not.toMatch(/duplicate/i);
  });

  it('the sign-off skill explains the original-rating bracket and lists residual-risks.json in its contract reads', () => {
    const skill = read('.claude/skills/_qa-report-signoff-pdf/SKILL.md');
    expect(skill).toContain('the bracket is the rating the risk had before testing, and the sentence beside it describes what remains');
    expect(skill).toContain('`- [Originally Rating] text`');
    expect(skill).toContain('first entry wins');
    const contract = skill.slice(skill.indexOf('## Contract (machine-checked)'));
    expect(contract).toContain('{run}/reports/executive/residual-risks.json');
  });

  it('the skill and the reporter say where residual risk comes from and forbid bypassing the skill', () => {
    const skill = read('.claude/skills/_qa-report-signoff-pdf/SKILL.md');
    expect(skill).toContain('`reports/closure/closure.json#residualRiskSummary`');
    expect(skill).toContain('Only when no source holds a risk does it print "No residual risk recorded"');
    expect(skill).toContain('`reports/executive/residual-risks.json`');
    expect(skill).toContain('A rating is the closure\'s rating of a residual risk, not a defect severity.');
    expect(read('.claude/agents/tier1-phase/qa-executive-reporter.md')).toContain('never call the renderer directly to get around it, because that skips the tone-check and the decision validation');
    expect(read('.claude/agents/tier1-phase/qa-closure-reporter.md')).toContain('`residualRiskSummary`, an array with one object per risk');
  });

  const REAL = process.env.AEGIS_REAL_RUN_DIR;
  const realClosure = REAL !== undefined && REAL !== '' ? path.join(REAL, 'reports', 'closure', 'closure.json') : '';
  (realClosure !== '' && fs.existsSync(realClosure) ? it : it.skip)('renders the real closure shape (AEGIS_REAL_RUN_DIR) with exit 0 once the reporter wrote a plain sentence per risk', () => {
    const closure = JSON.parse(fs.readFileSync(realClosure, 'utf-8')) as { residualRiskSummary: Array<{ riskId: string; originalLikelihoodImpactScore?: string }> };
    const n = closure.residualRiskSummary.length;
    const critical = closure.residualRiskSummary.filter((x) => /\(Critical\)/.test(x.originalLikelihoodImpactScore ?? '')).length;
    const plain = closure.residualRiskSummary.map((x, i) => ({ riskId: x.riskId, plain: `Plain customer wording number ${i + 1}.` }));
    const { r, text } = signoff({
      'reports/closure/closure.json': { metrics: {}, residualRiskSummary: closure.residualRiskSummary }, 'risk-register.json': { risks: [] },
      'reports/executive/residual-risks.json': plain,
    });
    expect(r.status).toBe(0);
    const head = `${n} residual ${n === 1 ? 'risk remains' : 'risks remain'} after testing and ${n === 1 ? 'is' : 'are'} recorded here for the product owner to acknowledge before closure${critical > 0 ? `, ${critical} of them originally rated Critical` : ''}.`;
    expect(text).toContain(head);
    expect(text).not.toContain('No residual risk recorded');
    for (const p of plain) expect(text).toContain(p.plain);
    for (const [id, word] of [['RISK-ENG-005', 'High'], ['RISK-PLAT-010', 'Medium']] as const) {
      const i = closure.residualRiskSummary.findIndex((x) => x.riskId === id);
      if (i >= 0) expect(text).toContain(`- [Originally ${word}] ${plain[i]?.plain}`);
    }
    console.log(text.slice(text.indexOf('RESIDUAL RISK'), text.indexOf('Signatories')));
  });
});

describe('the sign-off exit criteria stay inside the page', () => {
  // Helvetica 10 pt: "W" is 9.44 pt wide, a space 2.78 pt, so a word of five W's plus its space is about 50 pt. The text cell is
  // about 465 pt wide beside the 44 pt status column and its margin (content width 515 pt): 9 such words fit a line. A text cell
  // with no flex width is laid out at the full 515 pt and prints 10 words per line, running past the right page edge.
  it('a long criterion wraps inside the space beside the status column, with its full text present', () => {
    const word = 'WWWWW';
    const criterion = Array.from({ length: 60 }, () => word).join(' ');
    const { root, runDir } = fixture({
      'gates/gate-3-decision.json': FULL_RUN['gates/gate-3-decision.json'],
      'reports/closure/closure.json': { metrics: {}, exitCriteria: [{ criterion, met: false }] },
    });
    expect(run(SCRIPT.signoff, root).status).toBe(0);
    const lines = pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf')).split('\n').filter((l) => l.startsWith(word));
    expect(lines.join(' ').split(' ').filter((w) => w === word)).toHaveLength(60);
    expect(Math.max(...lines.map((l) => l.split(' ').length))).toBeLessThanOrEqual(9);
  });

  it('the renderer gives the criterion text a flexible width', () => {
    const src = read('packages/@qa/pdf-renderer/src/index.ts');
    const rows = src.slice(src.indexOf('...spec.exitCriteria.map('), src.indexOf('// Open defects summary'));
    expect(rows).toContain('flex: 1');
  });
});
