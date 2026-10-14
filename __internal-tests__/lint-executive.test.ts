import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AegisEventSchema, findPlainLanguage } from '@qa/contracts';
import { appendChained, readLines } from '@qa/event-bus';
import { staleBuild } from '@qa/alignment';
import { busPath, createRun, executiveFindings, lintFindings, lintRun, runDir, sentenceCount, verifyRunIntegrity, type Finding } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { ORCH } from './helpers/pipeline';

// Task 1b: the executive stage of the lint (aegis lint run --stage executive), over the inputs of the three deliverables after G3.

let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
beforeEach(async () => {
  t = makeAegisRoot();
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});

const put = (rel: string, v: string | object) => {
  const f = path.join(runDir(t.root, runId), rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2));
};
/** Rewrites reportRules; the fixture's env-probe exception is kept (these runs have no environment to probe). */
const setRules = (rules: { disable?: string[]; [k: string]: unknown }) => {
  const cfg = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), reportRules: { ...rules, disable: [...(rules.disable ?? []), 'env-probe'] } }));
};
const events = () => readLines(busPath(t.root, runId)).map((l) => JSON.parse(l) as Record<string, any>);
const append = (e: Record<string, unknown>, by = 'qa-executive-reporter') =>
  appendChained({ ts: new Date().toISOString(), ...e } as never, busPath(t.root, runId), { emittedBy: by, runId });
const phaseStarted = () => append({ type: 'run.phase.started', runId, phase: 'executive' }, ORCH);
const produced = (deliverable: string, p: string) => append({ type: 'report.produced', runId, deliverable, path: p });
const allProduced = async () => {
  await produced('technical', `runs/${runId}/reports/executive/technical-report.pdf`);
  await produced('signoff', 'reports/executive/signoff.pdf');
  await produced('slides', `runs/${runId}/reports/executive/executive-deck.pdf`);
};

const DECK = 'reports/executive/executive-deck.json';
const RISKS = 'reports/executive/residual-risks.json';
const CLOSURE = 'reports/closure/closure.json';
const TIER = new Set(['tooling-tier1', 'tooling-tier2', 'brand-name']);
const EXEC = new Set(['exec-residual-risk-ids', 'exec-risk-one-sentence', 'exec-report-event-missing']);
const of = (fs_: Finding[], file: string, rules = TIER) => fs_.filter((f) => f.file === file && rules.has(f.rule));
/** The phrase each finding names (between the first pair of double quotes of its message). */
const phrase = (f: Finding) => /"([^"]+)"/.exec(f.message)?.[1] ?? '';

// The phrases the reviewer quoted in the three R12 executive rejections (attempts 1, 4 and 6), as the reporter wrote them: in double
// quotes and backticks, which the G3 lint blanks and the executive documents print.
const R12_PHRASES = [
  'Admin pages were "denied with 403" for every staff role.',
  'The lockout `answers 423 or 429` after five wrong codes.',
  'Recommendation 4 asks for "full oracles" on the pass checks.',
  'The "declaration-questions endpoint" has no "rate limiting" and does not "fail closed".',
  'The badge page was checked on the server at :3011 against `coverage.json`.',
];
const EXPECTED = ['denied with 403', 'answers 423', 'oracles', 'endpoint', 'rate limiting', 'fail closed', ':3011', 'coverage.json'];

const closureWith = (riskIds: string[], extra: object = {}) => ({ residualRiskSummary: riskIds.map((riskId) => ({ riskId, title: `Title of ${riskId}` })), ...extra });

describe('the new tier-2 patterns (contracts)', () => {
  it.each([
    ['access was denied with 403', 'denied with 403'], ['refused by a 429', 'refused by a 429'], ['the page failed with HTTP 500', 'failed with HTTP 500'],
    ['a 403 Forbidden page', '403 Forbidden'], ['429 Too Many Requests', '429 Too Many Requests'], ['the declaration endpoint', 'endpoint'],
    ['three end-points', 'end-points'], ['no rate limiting', 'rate limiting'], ['it is rate-limited', 'rate-limited'], ['the check fails closed', 'fails closed'],
    ['the guard must fail closed', 'fail closed'], ['a fail-open default', 'fail-open'],
  ])('"%s" is refused (%s)', (text, hit) => {
    expect(findPlainLanguage(text).map((h) => h.phrase)).toContain(hit);
  });
  it.each([
    'Access was refused for every staff role.', 'The end point of the review was the retest.', 'The request was blocked by the firewall.',
    '403 of 450 checks passed.', 'Repeated attempts are limited.', 'Three checks failed; the gate closed on time.', 'The rate of failures fell.',
  ])('plain wording passes: %s', (text) => {
    expect(findPlainLanguage(text)).toEqual([]);
  });
});

describe('(a) the executive inputs are read as written: errors; the closure fields the sign-off prints: warnings', () => {
  beforeEach(() => setRules({ localPorts: [3011] }));

  it('the R12 rejection phrases are errors in executive-deck.json, quoted and backticked runs included', () => {
    put(DECK, { keyFinding: R12_PHRASES[0], supportingInsights: [{ what: R12_PHRASES[1], soWhat: R12_PHRASES[2], nowWhat: R12_PHRASES[3] }], recommendations: [{ action: R12_PHRASES[4], owner: 'Developers', deadline: 'Next retest', impact: 'HIGH' }], residualRisks: [] });
    const found = of(executiveFindings(t.root, runId), DECK);
    expect(found.every((f) => f.severity === 'error')).toBe(true);
    expect(found.map(phrase).sort()).toEqual([...EXPECTED].sort());
    expect(found.find((f) => phrase(f) === 'denied with 403')).toMatchObject({ rule: 'tooling-tier2', line: 2 });
    expect(found.find((f) => phrase(f) === ':3011')).toMatchObject({ rule: 'tooling-tier1' });
  });

  it('the same phrases are errors in residual-risks.json', () => {
    const ids = R12_PHRASES.map((_, i) => `RISK-AUTH-00${i + 1}`);
    put(CLOSURE, closureWith(ids));
    put(RISKS, R12_PHRASES.map((plain, i) => ({ riskId: ids[i], plain })));
    const found = of(executiveFindings(t.root, runId), RISKS);
    expect(found.every((f) => f.severity === 'error')).toBe(true);
    expect(found.map(phrase).sort()).toEqual([...EXPECTED].sort());
  });

  it('the same phrases in the closure fields the sign-off prints are warnings at this stage (errors at G3, where the closure reporter fixes them)', () => {
    put(CLOSURE, {
      exitCriteria: [{ criterion: R12_PHRASES[0], met: false, evidence: R12_PHRASES[1] }],
      variancesFromPlan: [{ variance: R12_PHRASES[2], reason: R12_PHRASES[3] }],
      resultsSummary: { caseOfRecord: { basis: R12_PHRASES[4] } },
    });
    const stage = of(executiveFindings(t.root, runId), CLOSURE);
    expect(stage.map(phrase).sort()).toEqual([...EXPECTED].sort());
    expect(stage.every((f) => f.severity === 'warning' && /the sign-off prints this field/.test(f.message))).toBe(true);
    const g3 = lintFindings(t.root, runId, 'G3').findings.filter((f) => f.file === CLOSURE && f.rule === 'tooling-tier2');
    expect(g3.map(phrase).sort()).toEqual(['answers 423', 'denied with 403', 'endpoint', 'fail closed', 'oracles', 'rate limiting']);
    expect(g3.every((f) => f.severity === 'error')).toBe(true);
  });

  it('an open-defect line the sign-off takes from the defect log is a warning at this stage', () => {
    put(CLOSURE, { defectMetrics: { openItems: [] } });
    put('defects/DEF-003-AUTH-SEC.json', { id: 'DEF-003-AUTH-SEC', title: 'No rate limiting on the declaration endpoint', severity: 'Sev3', status: 'open' });
    const found = of(executiveFindings(t.root, runId), CLOSURE);
    expect(found.map(phrase).sort()).toEqual(['endpoint', 'rate limiting']);
    expect(found.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('the phrases are NOT tier-2 findings in the technical report (never read) or in a compliance report', () => {
    put('reports/executive/technical-report.pdf', R12_PHRASES.join('\n'));
    put('reports/compliance/iso25010.json', { gaps: [{ note: 'The endpoint answers 423 or 429 and was denied with 403; the oracle has no rate limiting and does not fail closed.' }] });
    const found = executiveFindings(t.root, runId);
    expect(found.filter((f) => f.file.startsWith('reports/compliance/'))).toEqual([]);
    // The only finding on the technical report is its missing deliverable event: the PDF itself is never read.
    expect(found.filter((f) => f.file === 'reports/executive/technical-report.pdf').map((f) => f.rule)).toEqual(['exec-report-event-missing']);
    expect(lintFindings(t.root, runId, 'G3').findings.filter((f) => f.rule === 'tooling-tier2')).toEqual([]);
  });

  it('the brand rule and the wording rules are errors in the executive inputs; a key is read by the brand rule', () => {
    put(DECK, { keyFinding: 'Prepared by qa-executive-reporter.', residualRisks: [{ plain: 'This cycle left one open item.' }], 'qa-orchestrator': 'x' });
    const found = executiveFindings(t.root, runId).filter((f) => f.file === DECK);
    expect(found.filter((f) => f.rule === 'brand-name').map((f) => f.severity)).toEqual(['error', 'error']);
    expect(found.find((f) => f.rule === 'qa-cycle')).toMatchObject({ severity: 'error' });
  });

  it('a whitespace-free path under a data key is exempt from tier 1, as in the gate lint', () => {
    put(DECK, { keyFinding: 'Plain.', evidence: ['reports/metrics/coverage.json'], note: 'see reports/metrics/coverage.json' });
    expect(of(executiveFindings(t.root, runId), DECK).map(phrase)).toEqual(['reports/metrics/coverage.json', 'coverage.json']); // one occurrence, two path rules (as H1 and the scripts count it)
  });
});

describe('(b) and (c): residual-risks.json against the closure', () => {
  it('raises exec-residual-risk-ids for a missing, an extra and a repeated id, on residual-risks.json only', () => {
    put(CLOSURE, closureWith(['RISK-A-001', 'RISK-B-001']));
    put(RISKS, [{ riskId: 'RISK-A-001', plain: 'One plain sentence.' }, { riskId: 'RISK-C-001', plain: 'Another plain sentence.' }, { riskId: 'RISK-A-001', plain: 'A second sentence for A.' }]);
    put(DECK, { keyFinding: 'Plain.', residualRisks: [{ plain: 'A deck risk with no id.' }] });
    const found = executiveFindings(t.root, runId).filter((f) => f.rule === 'exec-residual-risk-ids');
    expect(found.map((f) => [f.file, f.context, f.severity])).toEqual([
      [RISKS, 'RISK-B-001', 'error'], [RISKS, 'RISK-C-001', 'error'], [RISKS, 'RISK-A-001', 'error'],
    ]);
    expect(found.map((f) => f.line)).toEqual([1, 7, 11]);
  });

  it('a missing residual-risks.json names every closure risk; equal ids raise nothing', () => {
    put(CLOSURE, closureWith(['RISK-A-001', 'RISK-B-001']));
    expect(executiveFindings(t.root, runId).filter((f) => f.rule === 'exec-residual-risk-ids').map((f) => f.context)).toEqual(['RISK-A-001', 'RISK-B-001']);
    put(RISKS, [{ riskId: 'RISK-A-001', plain: 'One.' }, { riskId: 'RISK-B-001', plain: 'Two.' }]);
    expect(executiveFindings(t.root, runId).filter((f) => EXEC.has(f.rule) && f.rule !== 'exec-report-event-missing')).toEqual([]);
  });

  it('raises exec-risk-one-sentence for a two-sentence entry of residual-risks.json, never for the deck', () => {
    put(CLOSURE, closureWith(['RISK-A-001', 'RISK-B-001']));
    put(RISKS, [
      { riskId: 'RISK-A-001', plain: 'The export is untested. The owner decides whether to accept it.' },
      { riskId: 'RISK-B-001', plain: 'Uploads up to 4.5 MB work, e.g. The PDF reports of version 2.3 (see No. 4) pass on the build ebf4b428.' },
    ]);
    // S05's passed deck carries three-sentence residual risks: the deck is never checked for this.
    put(DECK, { keyFinding: 'Plain.', residualRisks: [{ plain: 'One. Two. Three.' }] });
    const found = executiveFindings(t.root, runId).filter((f) => f.rule === 'exec-risk-one-sentence');
    expect(found.map((f) => [f.file, f.context, f.severity])).toEqual([[RISKS, 'RISK-A-001', 'error']]);
    expect(found[0]!.message).toContain('has 2 sentences');
  });

  it('sentenceCount is lenient: abbreviations, initials, decimals and versions do not split', () => {
    expect(sentenceCount('One. Two! Three? "Four."')).toBe(4);
    expect(sentenceCount('Read e.g. The guide and i.e. The rest; see No. 4 and J. Tan at 4.5 MB on v2.3.1.')).toBe(1);
    expect(sentenceCount('  ')).toBe(0);
  });
});

describe('(d) a produced or fallback event per deliverable after the latest executive phase start', () => {
  const missing = () => executiveFindings(t.root, runId).filter((f) => f.rule === 'exec-report-event-missing').map((f) => f.context);

  it('events from before the latest start do not count; events after it do, whatever the path form', async () => {
    await phaseStarted();
    await allProduced();
    expect(missing()).toEqual([]);
    await phaseStarted(); // a reissue: the previous phase's events no longer count
    expect(missing()).toEqual(['slides', 'signoff', 'technical']);
    await allProduced();
    expect(missing()).toEqual([]);
  });

  it('an attempt that re-renders only the slides is fine within a phase once all three exist after the start', async () => {
    await phaseStarted();
    await allProduced();
    await produced('slides', 'reports/executive/executive-deck.pdf');
    expect(missing()).toEqual([]);
    await phaseStarted();
    await produced('slides', 'reports/executive/executive-deck.pdf');
    expect(missing()).toEqual(['signoff', 'technical']);
  });

  it('report.fallback satisfies its deliverable; with no event every deliverable is missing', async () => {
    expect(missing()).toEqual(['slides', 'signoff', 'technical']);
    await phaseStarted();
    await produced('technical', 'reports/executive/technical-report.pdf');
    await append({ type: 'report.fallback', deliverable: 'signoff', reason: 'the renderer exited 9' });
    expect(missing()).toEqual(['slides']);
    expect(executiveFindings(t.root, runId).find((f) => f.rule === 'exec-report-event-missing')).toMatchObject({ file: 'reports/executive/executive-deck.pdf', severity: 'error' });
  });
});

describe('lintRun at the executive stage and the lint.completed event', () => {
  it('writes reports/lint/stage-executive.json and records lint.completed with the stage', async () => {
    put(CLOSURE, closureWith(['RISK-A-001']));
    put(RISKS, [{ riskId: 'RISK-A-001', plain: 'The export endpoint stays untested.' }]);
    const r = await lintRun(t.root, runId, { stage: 'executive' }, ORCH);
    expect(r).toMatchObject({ stage: 'executive', ok: false, filesScanned: 1 });
    expect(r.gate).toBeUndefined();
    expect(r.findings.filter((f) => f.severity === 'error').map((f) => f.rule).sort()).toEqual([...Array(3).fill('exec-report-event-missing'), 'tooling-tier2']);
    const stored = JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), 'reports/lint/stage-executive.json'), 'utf8'));
    expect(stored).toMatchObject({ stage: 'executive', errors: 4 });
    const ev = events().filter((e) => e.type === 'lint.completed').pop()!;
    expect(ev).toMatchObject({ agent: ORCH, stage: 'executive', errors: 4, report: 'reports/lint/stage-executive.json' });
    expect('gate' in ev).toBe(false);
    expect(AegisEventSchema.safeParse(ev).success).toBe(true);
  });

  it('an OLD lint.completed event (gate, no stage) still validates on append, on read and in the integrity check', async () => {
    const old = { type: 'lint.completed', ts: '2026-10-14T01:00:00.000Z', agent: ORCH, gate: 'G3', errors: 0, warnings: 2, report: 'reports/lint/gate-G3.json' };
    expect(AegisEventSchema.safeParse(old).success).toBe(true);
    await appendChained(old as never, busPath(t.root, runId), { emittedBy: ORCH, runId });
    await lintRun(t.root, runId, 'G3', ORCH);
    expect(events().filter((e) => e.type === 'lint.completed').map((e) => e.gate)).toEqual(['G3', 'G3']);
    expect(await verifyRunIntegrity(t.root, runId, ORCH)).toMatchObject({ ok: true, errors: [] });
  });

  it('accepts exactly one of gate and stage, a known stage only, and the same callers as the gate lint', async () => {
    await expect(lintRun(t.root, runId, {}, ORCH)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringContaining('exactly one of --gate') });
    await expect(lintRun(t.root, runId, { gate: 'G3', stage: 'executive' }, ORCH)).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(lintRun(t.root, runId, { stage: 'closure' }, ORCH)).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringContaining('not closure') });
    await expect(lintRun(t.root, runId, { gate: 'G1' }, ORCH)).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(lintRun(t.root, runId, { stage: 'executive' }, 'qa-executive-reporter')).rejects.toMatchObject({ code: 'caller-forbidden' });
    await expect(lintRun(t.root, runId, { stage: 'executive' }, 'owner')).resolves.toMatchObject({ stage: 'executive' });
    expect(events().filter((e) => e.type === 'lint.completed')).toHaveLength(1);
  });

  it('reportRules.disable silences each rule by its id', async () => {
    setRules({ disable: ['tooling-tier2', 'exec-risk-one-sentence', 'exec-residual-risk-ids', 'exec-report-event-missing', 'brand-name'] });
    put(CLOSURE, closureWith(['RISK-A-001', 'RISK-B-001']));
    put(RISKS, [{ riskId: 'RISK-A-001', plain: 'The endpoint is open. The owner decides.' }, { riskId: 'RISK-C-001', plain: 'Aegis wrote coverage.json here.' }]);
    const found = executiveFindings(t.root, runId).filter((f) => f.severity === 'error');
    expect(found.map((f) => `${f.rule} ${phrase(f)}`)).toEqual(['tooling-tier1 coverage.json']);
    setRules({ disable: ['tooling-tier1', 'tooling-tier2', 'exec-risk-one-sentence', 'exec-residual-risk-ids', 'exec-report-event-missing', 'brand-name'] });
    expect(executiveFindings(t.root, runId)).toEqual([]);
  });
});

describe('replay over the final passed executive inputs (excerpts copied from the real runs)', () => {
  it('R12: the deck and residual-risks.json sentences raise no tier, brand or executive error; its "this cycle" is the listed wording-rule hit', async () => {
    const ids = ['RISK-PROC-012', 'RISK-VOL-001', 'RISK-ENV-004'];
    put(CLOSURE, closureWith(ids));
    put(RISKS, [
      { riskId: ids[0], plain: 'Of the 24 earlier defects retested, 14 are fixed and 2 are only partly fixed and stay open, and 5 of the 14 fixed verdicts carry a stated limit because one fix condition was shown only in part, so the owner still has to decide whether those limits are accepted.' },
      { riskId: ids[1], plain: "Admin-only data interfaces refused access in 25 of 25 checked, but all 48 denied pages show a normal response with an on-screen denial notice instead of a refusal (none showed a table, row, form or entry field), 49 admin interfaces that change data were read from the source and not tested, and the product manager's reading of the requirement is still open." },
      { riskId: ids[2], plain: 'The second wave of checks ran on a locally built stand-in for the Schedule App feed holding 24 sessions written by the QA team (the application served 23), so one attendance check stays blocked, the withdrawal success path could not be reached and the stand-in is not a production feed.' },
    ]);
    put(DECK, {
      keyFinding: 'Of 105 designed checks, all 105 were attempted: 87 passed, 1 partly passed, 15 failed and 2 were blocked.',
      supportingInsights: [{ what: 'The account-lock check had a wrong step: step 5 as first written expected a different refusal status than the application gives. Five earlier results of this cycle were also our own errors, corrected.', soWhat: 'Admin-only pages show an on-screen denial notice instead of a refusal response.', nowWhat: 'Limit repeated requests on the declaration questions and confirm the locked-account and too-many-attempts status.' }],
      recommendations: [{ action: 'Answer the product questions in one round: whether access denied needs a refusal response.', owner: 'Product manager, with the security officer', deadline: 'Before the next retest round', impact: 'HIGH' }],
      residualRisks: [{ plain: 'Admin-only pages (originally rated Critical) still show an on-screen denial notice instead of a refusal response on 48 of 48 denied pages.' }],
    });
    await phaseStarted();
    await allProduced();
    const found = executiveFindings(t.root, runId).filter((f) => f.severity === 'error');
    expect(found.filter((f) => TIER.has(f.rule) || EXEC.has(f.rule))).toEqual([]);
    expect(found.map((f) => `${f.file}:${f.rule}`)).toEqual([`${DECK}:qa-cycle`]);
  });

  it('R06 (predates the rules): the listed hits are errors: "endpoint(s)" in RISK-CMP-ERRPATH, "Blocker" in RISK-CMP-PROCESS-ML1 and in the deck', () => {
    put(CLOSURE, closureWith(['RISK-CMP-ERRPATH', 'RISK-CMP-PROCESS-ML1']));
    put(RISKS, [
      { riskId: 'RISK-CMP-ERRPATH', plain: 'One attendance endpoint returns a server error instead of a clear client error for unknown IDs, and other endpoints were not checked, so how many behave the same way is unknown.' },
      { riskId: 'RISK-CMP-PROCESS-ML1', plain: 'Five of eleven process-maturity practices are fully in place, while preconditions are not recorded per case, no aggregated review or flaky-test data exist, no production-like validation environment was available and no stakeholder acceptance of the open Blocker and Critical defects is recorded at defect level, which describes test-process evidence and not the product.' },
    ]);
    put(DECK, { supportingInsights: [{ what: '24 application defects are open: 1 Blocker, 3 Critical, 9 Major, 8 Minor, 3 Trivial. The Blocker defect is that scanning in a genuine group member on their behalf is refused.' }] });
    const found = executiveFindings(t.root, runId).filter((f) => f.severity === 'error' && TIER.has(f.rule));
    expect(found.map((f) => `${f.file} ${phrase(f)}`)).toEqual([`${DECK} Blocker`, `${RISKS} endpoint`, `${RISKS} endpoints`, `${RISKS} Blocker`]);
  });
});

// ─── CLI ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`lint-executive CLI tests skipped: ${stale} (run pnpm build)`);
const withCli = stale ? it.skip : it;
const cli = (...args: string[]) => {
  const env = { ...process.env, AEGIS_AGENT: ORCH, AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
  return spawnSync(process.execPath, [CLI, 'lint', 'run', ...args, '--run', runId], { cwd: t.root, encoding: 'utf-8', env });
};

describe('aegis lint run --gate | --stage', () => {
  withCli('refuses neither and both; --stage executive writes the stage report and exits 3 on errors', () => {
    const neither = cli();
    expect(neither.status).toBe(2);
    expect(neither.stdout + neither.stderr).toContain('exactly one of --gate');
    expect(cli('--gate', 'G3', '--stage', 'executive').status).toBe(2);
    expect(cli('--stage', 'final').status).toBe(2);
    const r = cli('--stage', 'executive');
    expect(r.status).toBe(3); // no deliverable event yet
    expect(JSON.parse(r.stdout)).toMatchObject({ stage: 'executive', errors: 3 });
    expect(fs.existsSync(path.join(runDir(t.root, runId), 'reports/lint/stage-executive.json'))).toBe(true);
    expect(cli('--gate', 'G3').status).toBe(0);
  }, 60_000);
});
