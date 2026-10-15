import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildClosureView } from '@qa/contracts';
import { createRun, runDir as runDirOf, startPhase } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { hookStale, runHook } from './helpers/hooks';
import { GATE3, RUN, ROOT, SCRIPT, fixture, flat, pdfText, run, temps } from './helpers/exec-pdf';

afterAll(() => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

// Round 10: the closure's statement that the false passes are our own mistakes, and the conditions checker that finds the gaps before a dispatch.

const CLOSURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'closure-real-shape.json'), 'utf-8')) as Record<string, any>;
const CHECKER = path.join(ROOT, 'scripts', 'check-executive-conditions.mjs');
const COVERAGE = { requirementsCoverage: 87.5, testExecutionCoverage: 98.1, codeCoverage: null, partialRequirements: 4, counts: { designed: 105, attempted: 105, passed: 87, failed: 15, partial: 1, blocked: 2, skipped: 0, unknown: 0, notAttempted: 0, outOfScope: 11 } };
// A deck that states what the closure carries, in business words and with no case ids.
const DECK = {
  keyFinding: 'Most checks passed; five defects remain open.',
  supportingInsights: [
    { what: 'Of 105 designed checks, 87 passed, 1 passed in part, 15 failed and 2 were blocked and gave no verdict (82.9% passed); 11 further checks are out of scope and counted nowhere. 5 defects remain open: 1 Major, 4 Minor. Stated apart and not open: 14 fixed, 8 reframed and 2 reports withdrawn.', soWhat: 'The results describe the scope the owner defined.', nowWhat: 'Quote the figures with the out of scope checks stated apart.' },
    { what: 'These are our own mistakes, stated plainly: seven passes of the first report did not hold. One check had a wrong step. Five earlier results were also our own errors, corrected.', soWhat: 'The first report is not restated.', nowWhat: 'Decide whether the first report is restated.' },
    { what: '45 open questions wait for their audience. Exit criteria: 7 of 9 are met, criterion 5 with a qualification; criteria 8 and 9 are not met. The six coverage assessments list 102 coverage gaps, 13 of them rated High, and there is no compliance verdict.', soWhat: 'What remains is mostly decisions.', nowWhat: 'Ask each audience for its answers in one round.' },
  ],
  recommendations: [{ action: 'Answer the open questions in one round', owner: 'Product manager', deadline: 'Before the next retest round', impact: 'HIGH' }],
  residualRisks: [{ plain: 'A defect can be called fixed on only a partial fix.' }],
};
const files = (closure: unknown, deck: unknown = DECK) => ({ 'reports/closure/closure.json': closure, 'reports/metrics/coverage.json': COVERAGE, 'gates/gate-3-decision.json': GATE3, 'reports/executive/executive-deck.json': deck });
const without = (...keys: string[]) => { const c = JSON.parse(JSON.stringify(CLOSURE)); for (const k of keys) { const parts = k.split('.'); let o = c; for (const p of parts.slice(0, -1)) o = o[p]; delete o[parts[parts.length - 1]!]; } return c; };

/** Render the three documents of a fixture run with the three scripts; returns the root and the folder with the PDFs. */
function render(closure: unknown, deck: unknown = DECK) {
  const { root, runDir } = fixture(files(closure, deck));
  const results = [SCRIPT.technical, SCRIPT.signoff, SCRIPT.slides].map((s) => run(s, root));
  return { root, runDir, dir: path.join(runDir, 'reports', 'executive'), results };
}
const checker = (root: string, extra: string[] = []) => spawnSync(process.execPath, [CHECKER, `--run=${RUN}`, ...extra], { env: { ...process.env, AEGIS_ROOT: root }, encoding: 'utf-8', timeout: 120000 });

describe('1: the technical report and the sign-off print falsePasses.note and falsePasses.mechanism', () => {
  const { dir, results } = render(CLOSURE);
  const tech = flat(pdfText(path.join(dir, 'technical-report.pdf')));
  const sign = flat(pdfText(path.join(dir, 'signoff.pdf')));
  const note = CLOSURE['falsePasses'].note as string;
  const mech = CLOSURE['falsePasses'].mechanism as string;

  it('renders', () => { expect(results.map((r) => r.status)).toEqual([0, 0, 0]); });

  it('the technical report prints both in Passes That Did Not Hold, in the closure\'s words', () => {
    expect(tech).toContain(note);
    expect(tech).toContain(`Mechanism: ${mech}`);
    expect(tech.indexOf('Passes That Did Not Hold')).toBeLessThan(tech.indexOf(note));
  });

  it('the sign-off prints both in its own block and says plainly that they are our own mistakes', () => {
    expect(sign).toContain(note);
    expect(sign).toContain(`Mechanism: ${mech}`);
    expect(sign).toContain('Cases: TC-CCC-007; TC-DDD-007 (API angle)');
    expect(sign).toContain('PASSES THAT DID NOT HOLD');
    expect(sign).toMatch(/our own mistakes/);
  });

  it('without a note the sign-off says it itself; without any false pass the section is left out', () => {
    const t = render(without('falsePasses.note'));
    expect(flat(pdfText(path.join(t.dir, 'signoff.pdf')))).toContain('7 passes of the first report did not hold. They are our own mistakes.');
  });

  it('the sign-off holds the note and the mechanism to plain language and names the field', () => {
    const bad = JSON.parse(JSON.stringify(CLOSURE));
    bad.falsePasses.mechanism = 'The oracle was wrong and the stub returned status 403.';
    const r = run(SCRIPT.signoff, fixture(files(bad)).root);
    expect(r.status).toBe(9);
    expect(r.stderr).toContain('closure.json.falsePasses.mechanism');
  });
});

describe('2: the conditions checker', () => {
  const good = render(CLOSURE);

  it('passes for the three documents rendered from the real-shape closure, with a table per document', () => {
    const r = checker(good.root);
    expect(r.stdout.slice(-600)).toContain('OK: every check passes for every document');
    expect(r.status).toBe(0);
    for (const label of ['technical report (technical-report.pdf)', 'sign-off (signoff.pdf)', 'deck (executive-deck.pdf)']) expect(r.stdout).toContain(`== ${label} ==`);
    expect(r.stdout.match(/ PASS /g)!.length).toBeGreaterThanOrEqual(30);
    expect(r.stdout).not.toMatch(/ FAIL /);
    for (const id of 'abcdefghijklm'.split('')) expect(r.stdout).toContain(`(${id}) `);
  });

  it('writes nothing: the run folder is unchanged', () => {
    const list = (d: string): string[] => fs.readdirSync(d, { recursive: true }).map(String).sort();
    const before = list(good.root);
    checker(good.root);
    expect(list(good.root)).toEqual(before);
  });

  it('is data-driven: another closure, other figures, same pass', () => {
    const other = JSON.parse(JSON.stringify(CLOSURE));
    other.complianceFindings[0].coverageGaps = 24; // 103 in total
    const o = render(other, JSON.parse(JSON.stringify(DECK).replace('102 coverage gaps', '103 coverage gaps')));
    expect(o.results.map((r) => r.status)).toEqual([0, 0, 0]);
    expect(checker(o.root).status).toBe(0);
    // the documents of the first closure fail against the second closure's figures
    const mixed = fixture(files(other));
    fs.mkdirSync(path.join(mixed.runDir, 'reports', 'executive'), { recursive: true });
    const r = checker(mixed.root, [`--dir=${good.dir}`]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('103 coverage gaps');
  });

  it('fails with the right messages for a deliberately broken variant', () => {
    // technical report from a closure without falsePasses.note and with one blanked compliance field
    const brokenClosure = without('falsePasses.note');
    brokenClosure.complianceFindings[0].highRatedGaps = [];
    const t = render(brokenClosure);
    expect(t.results[0]!.status).toBe(0);
    // sign-off with a port in it (the script refuses a port, so the PDF is built straight from the renderer)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-broken-'));
    temps.push(dir);
    fs.copyFileSync(path.join(t.dir, 'technical-report.pdf'), path.join(dir, 'technical-report.pdf'));
    fs.copyFileSync(path.join(good.dir, 'executive-deck.pdf'), path.join(dir, 'executive-deck.pdf'));
    const spec = { projectName: 'Northwind Portal', version: 'v1', signoffDate: '2026-10-04', documentId: 'SIGNOFF-X', scope: 'Full cycle', decision: 'approved', exitCriteria: [], openDefectsSummary: 'Open defects: see http://localhost:3002/admin', residualRisk: 'none', signatoryRoles: ['QA Lead'] };
    const code = `import { renderSignoffDocument } from ${JSON.stringify(path.join(ROOT, 'packages/@qa/pdf-renderer/dist/index.js'))}; import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(path.join(dir, 'signoff.pdf'))}, await renderSignoffDocument(${JSON.stringify(spec)}));`;
    const built = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf-8' });
    expect(built.status).toBe(0);
    const r = checker(good.root, [`--dir=${dir}`]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('FAILED:');
    expect(r.stdout).toMatch(/technical report: \(f\) false passes: our own mistakes, cases, wrong step: falsePasses\.note: expected falsePasses\.note "/);
    expect(r.stdout).toMatch(/technical report: \(h\) compliance totals and no verdict: rated high: expected 13 rated high/);
    expect(r.stdout).toMatch(/sign-off: \(k\) wording classes: .*"localhost:3002"|sign-off: \(k\) wording classes: .*"localhost"/);
    expect(r.stdout).toMatch(/sign-off: \(c\) open application defects: DEF-001-KKK-EXP: expected .*id not found/);
    expect(r.stdout).not.toMatch(/deck: \(.\)[^\n]*FAIL/);
  });

  it('reads the project\'s local ports for the tier 1 check: a listed :N is a hit, an unlisted one is not', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-ports-'));
    temps.push(dir);
    fs.copyFileSync(path.join(good.dir, 'technical-report.pdf'), path.join(dir, 'technical-report.pdf'));
    fs.copyFileSync(path.join(good.dir, 'executive-deck.pdf'), path.join(dir, 'executive-deck.pdf'));
    const spec = { projectName: 'Northwind Portal', version: 'v1', signoffDate: '2026-10-04', documentId: 'SIGNOFF-X', scope: 'Full cycle', decision: 'approved', exitCriteria: [], openDefectsSummary: 'Open defects were retested against the stand-in feed on :4010 only.', residualRisk: 'none', signatoryRoles: ['QA Lead'] };
    const code = `import { renderSignoffDocument } from ${JSON.stringify(path.join(ROOT, 'packages/@qa/pdf-renderer/dist/index.js'))}; import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(path.join(dir, 'signoff.pdf'))}, await renderSignoffDocument(${JSON.stringify(spec)}));`;
    expect(spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf-8' }).status).toBe(0);
    const plain = fixture(files(CLOSURE));
    expect(checker(plain.root, [`--dir=${dir}`]).stdout).not.toContain('":4010"');
    const listed = fixture(files(CLOSURE));
    fs.writeFileSync(path.join(listed.root, 'aegis.config.json'), JSON.stringify({ dashboard: { projectName: 'Northwind Portal' }, reportRules: { localPorts: [4010] } }));
    const r = checker(listed.root, [`--dir=${dir}`]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/sign-off: \(k\) wording classes: .*tier 1[^\n]*":4010"/);
    fs.writeFileSync(path.join(listed.root, 'aegis.config.json'), '{"reportRules": ');
    const corrupt = checker(listed.root, [`--dir=${dir}`]);
    expect(corrupt.status).toBe(2);
    expect(corrupt.stderr).toMatch(/aegis\.config\.json cannot be read \(.*\); the owner repairs it/);
    fs.writeFileSync(path.join(listed.root, 'aegis.config.json'), JSON.stringify({ reportRules: { localPorts: 4010 } }));
    const bad = checker(listed.root, [`--dir=${dir}`]);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/reportRules\.localPorts must be a list of port numbers/);
  });

  it('fails a deck that states other compliance figures and no verdict, and a placeholder figure', () => {
    const deck = JSON.parse(JSON.stringify(DECK));
    deck.supportingInsights[2].what = '45 open questions wait. Exit criteria: 7 of 9 are met, criterion 5 with a qualification; criteria 8 and 9 are not met. The assessments list 90 coverage gaps, 9 of them rated High. Open defects: not available.';
    const d = render(CLOSURE, deck);
    expect(d.results[2]!.status).toBe(0);
    const r = checker(d.root);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/deck: \(h\) compliance totals and no verdict: no compliance verdict/);
    expect(r.stdout).toMatch(/deck: \(h\) compliance totals and no verdict: gaps: expected 102 coverage gaps/);
    expect(r.stdout).toMatch(/deck: \(j\) no placeholder used as a number: placeholders: .*not available/);
  });

  it('names a missing PDF and exits 2; missing pdftotext exits 3 with a clear message', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-empty-'));
    temps.push(empty);
    const a = checker(good.root, [`--dir=${empty}`]);
    expect(a.status).toBe(2);
    expect(a.stderr).toContain('technical-report.pdf');
    const b = spawnSync(process.execPath, [CHECKER, `--run=${RUN}`], { env: { ...process.env, AEGIS_ROOT: good.root, PATH: '/nonexistent' }, encoding: 'utf-8' });
    expect(b.status).toBe(3);
    expect(b.stderr).toMatch(/pdftotext is not installed/);
  });
});

describe('2: nothing in the role table or the hook stops the checker running', () => {
  const stale = hookStale();
  const test = stale ? it.skip : it;
  let t: TmpAegis;
  let runId: string;
  beforeEach(async () => {
    t = makeAegisRoot();
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    await startPhase(t.root, runId, 'intake', 'qa-orchestrator');
  });
  afterEach(() => t.cleanup());
  const cmd = (extra = '') => `node scripts/check-executive-conditions.mjs --run=${runId}${extra}`;
  test('the executive reporter, its reviewer, the orchestrator and the owner (main thread) may run it, with or without --dir', () => {
    for (const agent of ['qa-executive-reporter', 'qa-executive-reporter-spv', 'qa-orchestrator', undefined]) {
      for (const extra of ['', ` --dir=${path.join(runDirOf(t.root, runId), 'reports', 'executive')}`, ' --dir=/tmp/exec-copy']) {
        const r = runHook('guard-writes', { cwd: t.root, tool_name: 'Bash', tool_input: { command: cmd(extra) }, ...(agent ? { agent_type: agent, agent_id: 'a1' } : {}) }, t.root);
        expect(r.status).toBe(0);
      }
    }
  });
});

describe('2: the checker is documented where the reporter, its reviewer and the handbook look', () => {
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
  it('HANDBOOK/13 describes the checker, its checks and its exit codes', () => {
    const h = read('HANDBOOK/13-mechanics.md');
    expect(h).toContain('node scripts/check-executive-conditions.mjs --run=<RUN-id> [--dir=<folder>]');
    expect(h).toMatch(/pass\/fail table[^\n]*for each of the three documents/);
    expect(h).toMatch(/Exit 0 only when every check passes for every document, 1 when a check fails[^,]*, 2 for a missing input, 3 when `pdftotext` is missing/);
    expect(h).toMatch(/read-only/);
    expect(h).toMatch(/no role-table or hook rule is needed/);
  });
  it('the executive reporter runs it after rendering and lists its output in evidence[]; a failing check means failed', () => {
    const d = read('.claude/agents/tier1-phase/qa-executive-reporter.md');
    expect(d).toMatch(/node scripts\/check-executive-conditions\.mjs --run=<runId>/);
    expect(d).toMatch(/lists? its output in `evidence\[\]`/);
    expect(d).toMatch(/A failing check means you release `failed`/);
  });
  it('the reviewer runs it itself, and a passing checker does not replace its own reading', () => {
    const d = read('.claude/agents/spv/qa-executive-reporter-spv.md');
    expect(d).toMatch(/node scripts\/check-executive-conditions\.mjs --run=<runId>/);
    expect(d).toMatch(/runs the checker itself/);
    expect(d).toMatch(/A passing checker does not replace your own reading of the documents/);
  });
});

describe('after the merge with origin/main: the pass rate base is named in the sign-off sentence', () => {
  it('the view carries the base: attempted less the ruled checks', () => {
    const counts = { passed: 2, failed: 1, partial: 0, blocked: 0, skipped: 0, unknown: 0, attempted: 6, ruledOutOfScope: 1, deferred: 1, notVerified: 1 };
    expect(buildClosureView({ closure: {}, defects: null, rollupCounts: counts, executionSummary: null }).cases).toMatchObject({ passRate: 66.7, passRateBase: 3 });
    expect(buildClosureView({ closure: {}, defects: null, rollupCounts: { ...counts, ruledOutOfScope: 0, deferred: 0, notVerified: 0 }, executionSummary: null }).cases).toMatchObject({ passRate: 33.3, passRateBase: 6 });
  });
  it('the sign-off says which checks the rate leaves out when ruled checks exist', () => {
    const coverage = { ...COVERAGE, counts: { ...COVERAGE.counts, attempted: 108, deferred: 2, ruledOutOfScope: 1, designed: 108 } };
    const { root, runDir } = fixture({ ...files(CLOSURE), 'reports/metrics/coverage.json': coverage });
    expect(run(SCRIPT.signoff, root).status).toBe(0);
    const text = flat(pdfText(path.join(runDir, 'reports', 'executive', 'signoff.pdf')));
    expect(text).toContain('of the 105 checks attempted passed, not counting the checks recorded as out of scope, deferred or not verified');
  });
});
