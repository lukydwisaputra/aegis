import * as fs from 'fs';
import * as path from 'path';
import { TOOLING_WORD_RULES, checkToolingWords, describeToolingHits, findToolingWords, findToolingWordsIn } from '@qa/contracts';
import { decide, type GuardContext, type HookToolInput } from '@qa/path-guard';
import { GATE3, SCRIPT, fixture, run, temps } from './helpers/exec-pdf';

afterAll(() => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

// Round 5: file names, paths and local ports are tooling wording; one list for the H1 hook, the report scripts and the deck script.

const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'closure-tooling-sentences.json'), 'utf8')) as string[];

const POSITIVE: Array<[string, string]> = [
  ['reports/metrics/coverage.json', 'the coverage summary'], ['reports/closure/closure.md', 'the closure report'], ['reports/compliance/gdpr.json', 'the compliance report'],
  ['reports/work/qa-x.json', 'nothing: work reports and reviews are internal'], ['runs/RUN-20261012-002/reports/mutation/stryker.json', 'the mutation test report'],
  ['reports/executive/signoff.pdf', 'the executive report'],  ['defects/*.json', 'the defect records'], ['defects/triage-summary.md', 'the triage summary'], ['cases/*-result.json', 'the case result files'],
  ['*-result.json', 'the case result files'], ['x-result-extra.json', 'the case result files'],
  ['coverage.json', 'the coverage summary'], ['rtm.json', 'the traceability matrix'], ['rtm.md', 'the traceability matrix'], ['closure.json', 'the closure report'], ['closure.md', 'the closure report'],
  ['events.jsonl', 'the run record'], ['run.json', 'the run record'], ['triage-summary.md', 'the triage summary'], ['execution-summary.md', 'the plain name of the document'],
  ['risk-register.json', 'the plain name of the document'], ['execution-summary.json', 'the plain name of the document'],
  ['localhost', 'the local test server'], ['http://127.0.0.1/login', 'the local test server'], ['localhost:3000', 'the local test server'], ['[::1]:3000', 'the local test server'],
  ['http://[::1]/login', 'the local test server'], ['0.0.0.0:8080', 'the local test server'],
  ['port 3011', 'the local test server (no port)'], ['ports 3998', 'the local test server (no port)'],
];
// A colon-prefixed port is tooling only when the project lists it (aegis.config.json#reportRules.localPorts): the defaults never flag it.
const LISTED_PORTS: Array<[string, number[]]> = [[':3002', [3002]], [':54422', [54421, 54422]], ['listener on :3998', [3998]], ['on :4010 only', [4010]]];
// Citing proof is how a defect record or a compliance report works: these are NOT tooling wording.
const ALLOWED_CITATIONS = [
  'evidence/TC-REG-013/shot.png', 'runs/RUN-20261012-002/evidence/DEF-003-REG-SEC/TC-REG-013_step5_20261012T104840Z.json', 'cases/TC-AUTH-001-result.json',
  'cases/TC-COMMS-007-result-messaging.json', 'cases/TC-VOL-009.json', 'cases/TC-VOL-009.md', 'defects/DEF-003-REG-SEC.json', 'defects/DEF-007-REG-UI.md',
  'TC-VOL-009-result.json', 'TC-REG-013-mobile-result.json', 'runs/RUN-20261012-002/cases/TC-ENG-005-result.json', 'runs/RUN-20261012-002/defects/DEF-001-VOL-EXP.json',
  '[proof](runs/RUN-20261012-002/evidence/DEF-003-REG-SEC/step5.json)', '[the case](cases/TC-REG-013-result.json)', 'runs/RUN-20261012-002/stories/STORY-REG-004.json',
  'runs/RUN-20261012-002/requirements/ambiguity-report.json', 'plan.json', 'runs/RUN-20261012-002/gates/gate-1-decision.json',
];
const NEGATIVE = [
  'The reports page offers XLSX only.', 'Cases are grouped by module and the reports of the cases are printed below.', 'Defects and cases reports/cases are discussed with the PM.',
  'The oracle expects 403; the stub answered 200; the mutation score was 57.7%.', 'HTTP 403 and 429 and 500 were returned; port-forwarding is not used.',
  'Retest on build ebf4b428 of TC-REG-013; see DEF-003-REG-SEC.', 'The evidence shows a screenshot of the plan page.', 'Run the plan before the closure and the run is complete.',
  'Wave 1 has 108 cases; wave 2 has 7 whole cases.', 'Reports are produced by the closure team. The coverage is 89.5%.', 'The first run failed at 11:51.',
];

describe('TOOLING_WORD_RULES: paths, file names and local servers', () => {
  it.each(POSITIVE)('"%s" is a hit and says to write %s', (text, instead) => {
    const hits = findToolingWords(`Source: ${text} for this.`);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.instead)).toContain(instead);
    expect(checkToolingWords(`See ${text} here`)).toBeInstanceOf(RegExp);
  });

  it.each(ALLOWED_CITATIONS)('the citation "%s" is never flagged', (c) => {
    expect(findToolingWords(`Proof: ${c}.`)).toEqual([]);
    expect(findToolingWords(`See ${c}`)).toEqual([]);
  });

  it.each(NEGATIVE)('plain wording is clean: %s', (text) => {
    expect(findToolingWords(text)).toEqual([]);
    expect(checkToolingWords(text)).toBeNull();
  });

  it.each(LISTED_PORTS)('"%s" is a hit only with its port listed in localPorts, never by default and never as a bare number', (text, ports) => {
    expect(findToolingWords(`Source: ${text} for this.`)).toEqual([]);
    const hits = findToolingWords(`Source: ${text} for this.`, { localPorts: ports });
    expect(hits.map((h) => h.instead)).toEqual(['the local test server (no port)']);
    expect(checkToolingWords(`See ${text} here`, { localPorts: ports })).toBeInstanceOf(RegExp);
    const bare = text.replace(':', '');
    expect(findToolingWords(`Source: ${bare} for this.`, { localPorts: ports })).toEqual([]);
  });

  it('the old word rules still hit, and testing vocabulary stays allowed', () => {
    for (const w of ['the CLI refused', 'the defectMap', 'seq 784', 'the SPV', 'a record owner', '3 refusals']) expect([w, checkToolingWords(w) !== null]).toEqual([w, true]);
    for (const w of ['oracle', 'stub', 'mutation score', 'HTTP 404', 'blocker', 'Sev1', 'Sev1 (Blocker)']) expect([w, checkToolingWords(`The ${w} case`)]).toEqual([w, null]);
    expect(TOOLING_WORD_RULES.filter((r) => r.kind === 'path').length).toBeGreaterThanOrEqual(7);
  });

  it('every sentence of the RUN-20261012-002 closure that carried tooling is a hit', () => {
    for (const s of REAL) expect([s, findToolingWords(s).length > 0]).toEqual([s, true]);
  });

  it('a JSON data path is exempt, the same path in a sentence or under another key is not', () => {
    expect(findToolingWordsIn({ report: 'reports/compliance/iso25010.json', evidence: { logs: ['runs/RUN-1/evidence/DEF-1/a.json'] }, unavailableMetrics: ['defect-trend.json'] }, 'x')).toEqual([]);
    expect(findToolingWordsIn({ evidence: 'coverage.json' }, 'x')).toEqual([]);
    const hits = findToolingWordsIn({ exitCriteria: [{ criterion: 'ok', evidence: 'Source: defects/*.json.' }], note: 'coverage.json', metricSources: { a: 'rtm.json' } }, 'closure.json');
    expect(hits.map((h) => h.location)).toEqual(['closure.json.exitCriteria[0].evidence', 'closure.json.note', 'closure.json.metricSources.a']);
  });

  it('describeToolingHits names the first 5 with their location and what to write instead', () => {
    const hits = findToolingWordsIn({ a: ['rtm.json is here', 'coverage.json is here', 'localhost is here', 'port 3002 is here', 'defects/*.json is here', 'run.json is here', 'rtm.md is here'] }, 'closure.json');
    const msg = describeToolingHits(hits);
    expect(msg).toMatch(/^7 tooling phrases in customer-facing text \(first 5\):/);
    expect(msg.split('\n')).toHaveLength(6);
    expect(msg).toContain('closure.json.a[0]: "rtm.json" -> write the traceability matrix');
    expect(msg).toContain('closure.json.a[3]: "port 3002" -> write the local test server (no port)');
    expect(msg).not.toContain('a[5]');
    expect(describeToolingHits([])).toBe('');
  });
});

describe('H1 refuses paths, file names and ports in customer-facing files', () => {
  const RUN = 'RUN-20261002-001';
  const ROOT = path.join(__dirname, '..');
  const RUN_DIR = `${ROOT}/runs/${RUN}`;
  const ctx: GuardContext = {
    aegisRoot: ROOT, targetRoot: path.join(ROOT, '..'), testsDir: path.join(ROOT, '..', 'tests', 'qa'), runDir: RUN_DIR, activeRunId: RUN,
    environment: 'development', currentPhase: 'closure-draft', envPolicy: { mutating: true, allowedSpecialists: ['*'] }, tempDirs: ['/tmp'],
  };
  const deps = { cliAllowed: () => null };
  const write = (file: string, content: string, who: string): HookToolInput => ({ tool_name: 'Write', tool_input: { file_path: `${RUN_DIR}/${file}`, content }, cwd: ROOT, agent_type: who, agent_id: 'a1' });

  it.each([
    ['reports/closure/closure.md', 'qa-closure-reporter', 'Source: reports/metrics/coverage.json.', /write the coverage summary instead/],
    ['reports/closure/closure.json', 'qa-closure-reporter', JSON.stringify({ openQuestions: [{ question: 'Is rtm.json right?' }] }), /write the traceability matrix instead/],
    ['reports/compliance/cmmi.md', 'qa-compliance-cmmi', 'The app ran on localhost:3002.', /write the local test server/],
    ['defects/triage-summary.md', 'qa-defect-manager', 'See defects/*.json for each record.', /write the defect records instead/],
    // A defect record's reproduction data may cite a port (word rules only there); its title, which the reports print, may not.
    ['defects/DEF-001-AUTH-UI.json', 'qa-defect-manager', JSON.stringify({ id: 'DEF-001-AUTH-UI', title: 'Served on port 3011 and answered 500', actualResult: 'Served on port 3011 and answered 500.' }), /at \.title\); write the local test server \(no port\) instead/],
  ])('refuses %s with a path, name or port, and says what to write', (file, who, content, hint) => {
    const r = decide(write(file, content, who), ctx, deps);
    expect(r.allow).toBe(false);
    expect(!r.allow && r.reason).toMatch(hint);
  });

  it('allows data paths in a defect record and a closure report field, and plain wording in markdown', () => {
    const rec = JSON.stringify({ id: 'DEF-001-AUTH-UI', evidence: { logs: ['runs/RUN-1/evidence/DEF-001-AUTH-UI/a.json'] }, retestVerdict: { verdict: 'FIXED', evidence: 'evidence/DEF-001-AUTH-UI/a.json' }, actualResult: 'The page answered 500.' });
    expect(decide(write('defects/DEF-001-AUTH-UI.json', rec, 'qa-defect-manager'), ctx, deps).allow).toBe(true);
    expect(decide(write('reports/closure/closure.json', JSON.stringify({ complianceFindings: [{ report: 'reports/compliance/iso25010.json', gapCount: 3 }] }), 'qa-closure-reporter'), ctx, deps).allow).toBe(true);
    expect(decide(write('reports/closure/closure.md', 'The coverage summary shows 89.5% of requirements covered; the local test server was healthy.', 'qa-closure-reporter'), ctx, deps).allow).toBe(true);
  });
});

describe('the report scripts and the deck refuse the same list before rendering', () => {
  const closureWith = (text: string, extra: Record<string, unknown> = {}) => ({ metrics: { passed: 5, failed: 0, blocked: 0 }, variancesFromPlan: [{ variance: text, reason: 'Owner decision.' }], ...extra });
  const files = (closure: unknown) => ({ 'reports/closure/closure.json': closure, 'gates/gate-3-decision.json': GATE3 });

  it.each(POSITIVE.map(([t]) => t))('a closure containing "%s" makes the technical report (7) and the sign-off (9) refuse, naming the field', (phrase) => {
    const { root, runDir } = fixture(files(closureWith(`The note says ${phrase} here.`)));
    const tech = run(SCRIPT.technical, root);
    const sign = run(SCRIPT.signoff, root);
    expect([tech.status, sign.status]).toEqual([7, 9]);
    for (const r of [tech, sign]) {
      expect(r.stderr).toMatch(/tooling phrases? in customer-facing text/);
      expect(r.stderr).toContain('closure.json.variancesFromPlan[0].variance');
    }
    expect(fs.existsSync(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, 'reports', 'executive', 'signoff.pdf'))).toBe(false);
  });

  it('the sentences copied from the RUN-20261012-002 closure make both scripts refuse and list at most 5', () => {
    const { root } = fixture(files({ metrics: { passed: 5, failed: 0, blocked: 0 }, evaluation: REAL, openQuestionsNote: REAL[4] }));
    for (const [script, code] of [[SCRIPT.technical, 7], [SCRIPT.signoff, 9]] as const) {
      const r = run(script, root);
      expect(r.status).toBe(code);
      expect(r.stderr).toMatch(/tooling phrases in customer-facing text \(first 5\):/);
      expect(r.stderr.split('\n').filter((l) => l.startsWith('  closure.json.'))).toHaveLength(5);
      expect(r.stderr).toContain('closure.json.evaluation[0]: "reports/metrics/coverage.json" -> write the coverage summary');
    }
  });

  it('a clean closure still renders, with a bare metric file name under unavailableMetrics and a report path field as data', () => {
    const { root } = fixture(files({ metrics: { passed: 5, failed: 0, blocked: 0 }, unavailableMetrics: ['defect-trend.json'], complianceFindings: [{ regulation: 'GDPR', report: 'reports/compliance/gdpr.json', gapCount: 1, highSeverityGapCount: 0 }] }));
    expect(run(SCRIPT.technical, root).status).toBe(0);
    expect(run(SCRIPT.signoff, root).status).toBe(0);
  });

  it('a printed defect title with a file name is refused', () => {
    const { root } = fixture({ ...files({ metrics: { passed: 5, failed: 0, blocked: 0 } }), 'defects/DEF-001-AUTH-UI.json': { id: 'DEF-001-AUTH-UI', title: 'Fails while reading coverage.json', severity: 'Sev3', status: 'open' } });
    expect(run(SCRIPT.technical, root).status).toBe(7);
    expect(run(SCRIPT.signoff, root).stderr).toContain('defects/DEF-001-AUTH-UI.json.title');
  });

  const DECK = {
    keyFinding: 'All critical customer journeys were tested; one login issue remains open.',
    supportingInsights: [
      { what: 'Forty of forty-five checks passed', soWhat: 'Core flows work', nowWhat: 'Fix the login issue' },
      { what: 'Three issues are open', soWhat: 'Some users retry login', nowWhat: 'Fix before launch' },
    ],
    recommendations: [{ action: 'Fix the login issue', owner: 'Engineering', deadline: '2026-10-11', impact: 'HIGH' }],
    residualRisks: [{ plain: 'Login may fail for some users.' }],
  };
  it('the deck refuses a file name, a path or a port in executive-deck.json (exit 10) and renders clean content', () => {
    const clean = fixture({ 'reports/closure/closure.json': { metrics: {} }, 'reports/executive/executive-deck.json': DECK });
    expect(run(SCRIPT.slides, clean.root).status).toBe(0);
    for (const bad of ['Source: reports/metrics/coverage.json', 'The app ran on port 3002', 'See rtm.md']) {
      const { root, runDir } = fixture({ 'reports/closure/closure.json': { metrics: {} }, 'reports/executive/executive-deck.json': { ...DECK, supportingInsights: [{ ...DECK.supportingInsights[0]!, what: bad }, DECK.supportingInsights[1]] } });
      const r = run(SCRIPT.slides, root);
      expect(r.status).toBe(10);
      expect(r.stderr).toMatch(/executive-deck\.json\.supportingInsights\[0\]\.what/);
      expect(fs.existsSync(path.join(runDir, 'reports', 'executive', 'executive-deck.pdf'))).toBe(false);
    }
  });

  it('the skills say the guard is the same list as the hook and name the exit codes', () => {
    const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '.claude', 'skills', rel, 'SKILL.md'), 'utf8');
    expect(read('_qa-report-technical-pdf')).toMatch(/the same list as the H1 hook.*exits 7 with the first 5 offending phrases, each with its closure\.json field/s);
    expect(read('_qa-report-signoff-pdf')).toMatch(/the same list as the H1 hook.*exits 9 with the first 5 offending phrases/s);
    expect(read('_qa-report-executive-slides')).toMatch(/same customer-facing wording guard as the H1 hook.*exits 10 with the first 5 offending phrases/s);
  });
});
