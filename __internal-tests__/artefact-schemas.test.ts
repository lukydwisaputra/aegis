import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { AegisEventSchema, CLOSURE_METRIC_KEYS, ClosureFileSchema, ComplianceTagSchema } from '@qa/contracts';
import { appendChained, readLines, verifyChain } from '@qa/event-bus';
import { addTask, assertEventConsistent, busPath, claimTask, completePhase, createRun, outputProblems, runDir, startPhase, submitWorkReport } from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, TS, workTask, writeRunFile } from './helpers/pipeline';

// Task 2a of the mechanical pre-checks: the closure file schema, compliance tags checked at append, dropped work-report keys reported.

const CLI = path.join(__dirname, '..', 'apps', 'cli', 'dist', 'index.js');
const stale = process.env.CI ? null : staleBuild(path.join(__dirname, '..'));
// Read-only copies of the metric fields of the final closure.json of three real runs (R12, R06, S05).
const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'real-closure-declarations.json'), 'utf8')) as Record<string, Record<string, unknown>>;
const real = (name: string): Record<string, unknown> => {
  const { _source: _s, ...fields } = REAL[name] as Record<string, unknown>;
  return fields;
};
const problems = (closure: unknown): string => {
  const r = ClosureFileSchema.safeParse(closure);
  return r.success ? '' : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
};

const ALL = { designed: 10, passed: 8, failed: 2, blocked: 0, passRate: 80, requirementsCoverage: 90, testExecutionCoverage: 100, automationCoverage: 100, defectDensity: 0.4, dre: 100, escapeRate: 0, reopenRate: 0, mttdHours: 1, mttrHours: 2 };
const without = (...keys: string[]) => Object.fromEntries(Object.entries(ALL).filter(([k]) => !keys.includes(k)));

describe('the closure file schema', () => {
  it('passes the real closures of all three runs, each by its own declaration', () => {
    // R12: every metric key present (null counts), the two null ones also declared by value; no covering file listed.
    expect(problems(real('R12'))).toBe('');
    // R06: mttd and mttr are absent from metrics and declared by the entries of the unavailableMetricValues ARRAY.
    const r06 = real('R06');
    expect(Object.keys(r06['metrics'] as object)).not.toEqual(expect.arrayContaining(['mttdHours']));
    expect(problems(r06)).toBe('');
    // S05: every key present under the alias mttdMs / mttrMs; declares nothing.
    expect(problems(real('S05'))).toBe('');
  });

  it('R06 passes only through its declaration: without it MTTD, MTTR are named', () => {
    const { unavailableMetricValues: _v, unavailableMetricsNote: _n, unavailableMetrics: _m, ...bare } = real('R06');
    const text = problems(bare);
    expect(text).toMatch(/closure-metrics-missing/);
    expect(text).toMatch(/mttdHours/);
    expect(text).toMatch(/mttrHours/);
  });

  it('refuses the R06/S05 rejection phrases with the keys named: defectDensity, dre and escapeRate absent and undeclared', () => {
    const text = problems({ metrics: without('defectDensity', 'dre', 'escapeRate'), unavailableMetrics: [] });
    expect(text).toMatch(/^metrics: closure-metrics-missing: defectDensity; dre \(or defectRemovalEfficiency\); escapeRate \(or defectEscapeRate\) absent/);
    expect(text).not.toMatch(/passRate/);
  });

  it('refuses MTTD and MTTR absent and undeclared, and takes either alias as present', () => {
    expect(problems({ metrics: without('mttdHours', 'mttrHours') })).toMatch(/mttdHours \(or mttdMs, mttd\); mttrHours \(or mttrMs, mttr\) absent/);
    expect(problems({ metrics: { ...without('mttdHours', 'mttrHours'), mttdMs: 5, mttrMs: null } })).toBe('');
    expect(problems({ metrics: { ...ALL, dre: undefined, defectRemovalEfficiency: null } })).toBe('');
  });

  it('a metric key with any value, null included, is present', () => {
    expect(problems({ metrics: { ...ALL, dre: null, escapeRate: null, mttdHours: null, mttrHours: null, reopenRate: null } })).toBe('');
  });

  it('an absent metric is declared by a label on the keys or the entries of unavailableMetricValues, or in unavailableMetricsNote', () => {
    const m = without('mttrHours', 'reopenRate');
    expect(problems({ metrics: m })).toMatch(/mttrHours/);
    expect(problems({ metrics: m, unavailableMetricValues: { 'repair time (MTTR)': 'n/a', 'reopen rate': 'n/a' } })).toBe('');
    expect(problems({ metrics: m, unavailableMetricValues: ['MTTR (defect-trend.json#mttrMs null)', 'Reopen rate: not recorded'] })).toBe('');
    expect(problems({ metrics: m, unavailableMetricsNote: 'MTTR and the reopen rate hold no value this cycle.' })).toBe('');
    expect(problems({ metrics: m, unavailableMetricsNote: { 'defect-trend.json#mttrMs': 'MTTR not available', reopenRate: 'not recorded' } })).toBe('');
    // an unrelated declaration does not cover it
    expect(problems({ metrics: m, unavailableMetricValues: { 'flaky rate': 'n/a' } })).toMatch(/reopenRate; mttrHours/);
  });

  it('an absent metric is covered by its rollup file in unavailableMetrics: defect-trend covers mttd, mttr and reopenRate; effectiveness covers dre and escapeRate', () => {
    expect(problems({ metrics: without('mttdHours', 'mttrHours', 'reopenRate'), unavailableMetrics: ['defect-trend.json'] })).toBe('');
    expect(problems({ metrics: without('dre', 'escapeRate'), unavailableMetrics: ['effectiveness.json'] })).toBe('');
    // the wrong file covers nothing; a file name is matched without regard to case
    expect(problems({ metrics: without('dre'), unavailableMetrics: ['flaky.json'] })).toMatch(/dre/);
    expect(problems({ metrics: without('dre'), unavailableMetrics: ['Effectiveness.json'] })).toBe('');
  });

  it('refuses a top-level uncoveredByCause with its rule id, and a missing or non-object metrics', () => {
    expect(problems({ metrics: ALL, uncoveredByCause: { environment: 2 } })).toMatch(/^uncoveredByCause: closure-forbidden-key: uncoveredByCause is not a closure field/);
    expect(problems({ metrics: ALL, results: { uncoveredByCause: {} } })).toBe('');
    expect(problems({})).toMatch(/closure-metrics-missing: metrics must be an object/);
    expect(problems({ metrics: [1] })).toMatch(/closure-metrics-missing/);
  });

  it('leaves every other field of the closure free', () => {
    expect(problems({ metrics: ALL, anything: { goes: [1, 2] }, summary: 'x' })).toBe('');
  });
});

describe('closure file schema: rollup files, declaration shapes, non-object root (review of Task 2a)', () => {
  it('coverage.json covers the counts and both coverage percentages, never the automation coverage', () => {
    const m = without('designed', 'passed', 'failed', 'blocked', 'passRate', 'requirementsCoverage', 'testExecutionCoverage');
    expect(problems({ metrics: m })).toMatch(/closure-metrics-missing/);
    expect(problems({ metrics: m, unavailableMetrics: ['coverage.json'] })).toBe('');
    expect(problems({ metrics: without('automationCoverage'), unavailableMetrics: ['coverage.json'] })).toMatch(/automationCoverage/);
  });

  it('defect-trend.json also covers defectDensity and escapeRate; the remedy names only files that cover the missing metric', () => {
    expect(problems({ metrics: without('defectDensity', 'escapeRate'), unavailableMetrics: ['defect-trend.json'] })).toBe('');
    const text = problems({ metrics: without('defectDensity', 'dre') });
    expect(text).toMatch(/list that file in unavailableMetrics \(defect-trend\.json covers defectDensity; effectiveness\.json covers dre\)/);
    expect(text).not.toMatch(/coverage\.json covers|cycle-time/);
    // a metric no rollup computes has no file remedy at all
    const auto = problems({ metrics: without('automationCoverage') });
    expect(auto).toMatch(/automationCoverage \(?.*absent/);
    expect(auto).not.toMatch(/rollup file/);
    expect(problems({ metrics: without('designed') })).toMatch(/\(coverage\.json covers designed\)/);
  });

  it('an array of objects in unavailableMetricValues declares by the metric, label or name string of each entry', () => {
    const m = without('mttdHours', 'mttrHours');
    expect(problems({ metrics: m, unavailableMetricValues: [{ metric: 'MTTD', reason: 'no detection timestamps' }, { label: 'repair time (MTTR)', value: null }] })).toBe('');
    expect(problems({ metrics: m, unavailableMetricValues: [{ name: 'MTTD' }, { name: 'flaky rate' }] })).toMatch(/mttrHours/);
    expect(problems({ metrics: m, unavailableMetricValues: [{ name: 'MTTD' }, { name: 'flaky rate' }] })).not.toMatch(/mttdHours/);
  });

  it('a path in unavailableMetrics covers by its file name', () => {
    expect(problems({ metrics: without('dre', 'escapeRate'), unavailableMetrics: ['reports/metrics/effectiveness.json'] })).toBe('');
    expect(problems({ metrics: without('dre'), unavailableMetrics: ['runs\\x\\Effectiveness.JSON'] })).toBe('');
    expect(problems({ metrics: without('dre'), unavailableMetrics: ['reports/metrics/flaky.json'] })).toMatch(/dre/);
  });

  it('a root that is not an object is refused with the rule id and the remedy, not bare schema text', () => {
    for (const root of [[], null, 'closure', 7]) {
      expect(problems(root)).toMatch(/closure-metrics-missing: closure\.json must be a JSON object with a metrics object/);
    }
  });

  it('the barrier lifts a non-object root with closure-schema or its rule id', () => {
    const t = makeAegisRoot();
    return (async () => {
      try {
        const runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full', health: 'passed' }, 'owner')).runId;
        writeRunFile(t.root, runId, 'reports/closure/closure.json', []);
        expect(outputProblems(t.root, runId, 'closure-draft')).toEqual([expect.stringMatching(/closure-metrics-missing: closure\.json must be a JSON object/)]);
        fs.writeFileSync(path.join(t.root, 'aegis.config.json'), JSON.stringify({ parallelism: { maxSpecialists: 2 }, reportRules: { disable: ['env-probe', 'closure-metrics-missing'] } }));
        expect(outputProblems(t.root, runId, 'closure-draft')).toEqual([]);
      } finally {
        t.cleanup();
      }
    })();
  });
});

describe('agent contracts state what the closure barrier and the append check enforce', () => {
  const agent = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '.claude', 'agents', rel), 'utf8');

  it('the closure reporter names every required metric key, the undeclared-metric rule and the rollup file coverage', () => {
    const text = agent('tier1-phase/qa-closure-reporter.md');
    for (const keys of Object.values(CLOSURE_METRIC_KEYS)) expect(text).toContain(keys[0] as string);
    expect(text).toMatch(/all fourteen figures/);
    expect(text).toMatch(/unavailableMetricValues/);
    expect(text).toMatch(/`coverage\.json`: the counts, pass rate and both coverage percentages; `defect-trend\.json`: density, escape rate, reopen rate, MTTD, MTTR; `effectiveness\.json`: DRE/);
    expect(Object.keys(CLOSURE_METRIC_KEYS)).toHaveLength(14);
  });

  it('the ISTQB and CMMI agents give a tag example the tag schema accepts, and say it is checked at append', () => {
    const istqb = agent('compliance/qa-compliance-istqb.md');
    const cmmi = agent('compliance/qa-compliance-cmmi.md');
    for (const [text, good, bad] of [[istqb, 'ISTQB-Foundation-4.2', 'ISTQB-Foundation-4'], [cmmi, 'CMMI-VV-SP2.1', 'CMMI-VV-SP2']] as const) {
      expect(text).toContain(good);
      expect(text).toContain(bad);
      expect(ComplianceTagSchema.safeParse(good).success).toBe(true);
      expect(ComplianceTagSchema.safeParse(bad).success).toBe(false);
      expect(text).toMatch(/every gap tag is checked when the review event is appended/);
    }
  });
});

describe('the schema is the barrier of closure-draft and closure-final, and reportRules.disable lifts it', () => {
  let t: TmpAegis;
  let runId: string;
  beforeEach(async () => {
    t = makeAegisRoot();
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full', health: 'passed' }, 'owner')).runId;
  });
  afterEach(() => t.cleanup());
  const setDisable = (disable: string[]) => fs.writeFileSync(path.join(t.root, 'aegis.config.json'), JSON.stringify({ parallelism: { maxSpecialists: 2 }, reportRules: { disable: ['env-probe', ...disable] } }));
  const refusal = (re: RegExp) => ({ code: 'barrier', message: expect.stringMatching(re) });
  const GATES = { G1: { status: 'approved', decisions: 1 }, G2: { status: 'approved', decisions: 1 } };

  it.each(['closure-draft', 'closure-final'])('%s refuses an invalid closure.json naming the keys and passes a valid one', async (phase) => {
    fastForward(t.root, runId, phase, GATES);
    await startPhase(t.root, runId, phase, ORCH);
    await workTask(t.root, runId, `T-${phase}-1`, 'qa-closure-reporter', 'qa-closure-reporter-spv');
    if (phase === 'closure-final') await workTask(t.root, runId, 'T-GATE-G3', ORCH, 'qa-orchestrator-spv');
    writeRunFile(t.root, runId, 'reports/closure/closure.json', { metrics: without('defectDensity', 'dre'), uncoveredByCause: {} });
    await expect(completePhase(t.root, runId, phase, ORCH)).rejects.toMatchObject(refusal(/reports\/closure\/closure\.json is invalid: .*closure-forbidden-key.*closure-metrics-missing: defectDensity; dre/));
    writeRunFile(t.root, runId, 'reports/closure/closure.json', { metrics: ALL });
    expect((await completePhase(t.root, runId, phase, ORCH)).phases[phase as 'closure-draft']).toMatchObject({ status: 'completed' });
  });

  it.each(['closure-draft', 'closure-final'])('%s: the closure refusal names the closure-schema exception; Closure-final does not tell the reporter to add metric keys', async (phase) => {
    fastForward(t.root, runId, phase, GATES);
    await startPhase(t.root, runId, phase, ORCH);
    await workTask(t.root, runId, `T-${phase}-1`, 'qa-closure-reporter', 'qa-closure-reporter-spv');
    if (phase === 'closure-final') await workTask(t.root, runId, 'T-GATE-G3', ORCH, 'qa-orchestrator-spv');
    writeRunFile(t.root, runId, 'reports/closure/closure.json', { metrics: without('defectDensity', 'dre') });
    const message = await completePhase(t.root, runId, phase, ORCH).then(() => '', (e: Error) => e.message);
    expect(message).toContain("reportRules.disable with closure-schema is the owner's recorded exception for a closure that predates this check");
    if (phase === 'closure-final') {
      expect(message).toContain('name each in unavailableMetricValues (the metrics stay as drafted at Closure-final)');
      expect(message).not.toContain('state each');
    } else {
      expect(message).toContain('state each (null when it cannot be computed) or name it in unavailableMetricValues');
    }
  });

  it('reportRules.disable with closure-schema lifts the whole check; a rule id lifts only that rule', async () => {
    fastForward(t.root, runId, 'closure-draft', GATES);
    writeRunFile(t.root, runId, 'reports/closure/closure.json', { metrics: without('dre'), uncoveredByCause: {} });
    expect(outputProblems(t.root, runId, 'closure-draft')).toEqual([expect.stringMatching(/closure-forbidden-key.*closure-metrics-missing/)]);
    setDisable(['closure-forbidden-key']);
    expect(outputProblems(t.root, runId, 'closure-draft')).toEqual([expect.stringMatching(/closure-metrics-missing: dre/)]);
    expect(outputProblems(t.root, runId, 'closure-draft')[0]).not.toMatch(/closure-forbidden-key/);
    setDisable(['closure-metrics-missing']);
    expect(outputProblems(t.root, runId, 'closure-draft')).toEqual([expect.stringMatching(/closure-forbidden-key/)]);
    setDisable(['closure-schema']);
    expect(outputProblems(t.root, runId, 'closure-draft')).toEqual([]);
    expect(outputProblems(t.root, runId, 'closure-final')).toEqual([]);
  });

  it('a file that is not JSON is still refused with the escape hatch on', () => {
    setDisable(['closure-schema']);
    fs.mkdirSync(path.join(runDir(t.root, runId), 'reports', 'closure'), { recursive: true });
    fs.writeFileSync(path.join(runDir(t.root, runId), 'reports', 'closure', 'closure.json'), '{ nope');
    expect(outputProblems(t.root, runId, 'closure-draft')).toEqual([expect.stringMatching(/not valid JSON/)]);
  });
});

describe('compliance gap tags are checked at append only', () => {
  const event = (gaps: unknown) => ({ regulation: 'ISTQB', sectionsCovered: ['1'], gaps });
  const refused = /compliance-tag-invalid: gaps carry/;

  it('refuses ISTQB-Foundation-1, PDPA-DNC and PDPA-DataPortability, naming them and the tag forms', () => {
    expect(() => assertEventConsistent('compliance.review-complete', event(['ISTQB-Foundation-1', 'ISTQB-Foundation-1.2']))).toThrow(/1 tag\(s\) that match no tag format: ISTQB-Foundation-1\./);
    expect(() => assertEventConsistent('compliance.review-complete', event(['PDPA-DNC']))).toThrow(refused);
    expect(() => assertEventConsistent('compliance.review-complete', event(['PDPA-Sec24', 'PDPA-DataPortability']))).toThrow(/PDPA-DataPortability\. Tag forms: .*PDPA-Part\{Roman\}/);
    expect(() => assertEventConsistent('compliance.review-complete', event(['PDPA-Sec26-RPT']))).toThrow(refused);
  });

  it('passes every valid form, an empty list and an event with no gaps; other types are not touched', () => {
    const valid = ['ISTQB-Foundation-1.2', 'ISTQB-Foundation-4.1.3', 'PDPA-Sec26C', 'PDPA-PartIX', 'GDPR-Art32', 'CMMI-VV-SP2.1', 'ISO25010-Security-Confidentiality', 'ISO5055-Security-CWE-79', 'CWE-79', 'WCAG-2.2-1.4.3'];
    expect(() => assertEventConsistent('compliance.review-complete', event(valid))).not.toThrow();
    expect(() => assertEventConsistent('compliance.review-complete', event([]))).not.toThrow();
    expect(() => assertEventConsistent('compliance.review-complete', { regulation: 'GDPR', articlesCovered: [] })).not.toThrow();
    expect(() => assertEventConsistent('compliance.gap-flagged', { gaps: ['PDPA-DNC'] })).not.toThrow();
  });

  it('reportRules.disable with compliance-tag-invalid lifts the refusal', () => {
    expect(() => assertEventConsistent('compliance.review-complete', event(['PDPA-DNC']), new Set(['compliance-tag-invalid']))).not.toThrow();
  });

  it('the stored event schema stays plain strings, and a log that already holds an old tag reads and verifies', async () => {
    const t = makeAegisRoot();
    try {
      const runId = await startedRun(t.root);
      expect(AegisEventSchema.safeParse({ type: 'compliance.review-complete', ts: TS, runId, ...event(['ISTQB-Foundation-1', 'PDPA-DNC', 'PDPA-DataPortability']) }).success).toBe(true);
      await appendChained({ type: 'compliance.review-complete', ts: TS, runId, ...event(['ISTQB-Foundation-1', 'PDPA-DNC', 'PDPA-DataPortability']) }, busPath(t.root, runId), { emittedBy: 'qa-compliance-istqb', runId });
      const lines = readLines(busPath(t.root, runId));
      expect(lines.some((l) => l.includes('PDPA-DataPortability'))).toBe(true);
      expect(verifyChain(busPath(t.root, runId))).toMatchObject({ ok: true });
    } finally {
      t.cleanup();
    }
  });

  it('the built CLI refuses the invalid tags at event append and appends the corrected event; the chain stays valid', async () => {
    if (stale) return;
    const t = makeAegisRoot();
    try {
      const runId = await startedRun(t.root);
      const run = (json: object) => {
        const env = { ...process.env, AEGIS_AGENT: 'qa-compliance-istqb', AEGIS_COUNTERS_PATH: path.join(t.root, '.aegis', '.counters.json') };
        const r = spawnSync(process.execPath, [CLI, 'event', 'append', '--type', 'compliance.review-complete', '--json', JSON.stringify(json), '--run', runId], { cwd: t.root, encoding: 'utf-8', env });
        return { status: r.status, err: r.stderr ? JSON.parse(r.stderr) : null };
      };
      for (const tag of ['ISTQB-Foundation-1', 'PDPA-DNC', 'PDPA-DataPortability']) {
        expect(run(event([tag]))).toMatchObject({ status: 2, err: { error: 'invalid-input', message: expect.stringMatching(new RegExp(`compliance-tag-invalid: .*${tag}`)) } });
      }
      expect(run(event(['ISTQB-Foundation-1.2'])).status).toBe(0);
      // the owner's recorded exception lifts it
      fs.writeFileSync(path.join(t.root, 'aegis.config.json'), JSON.stringify({ parallelism: { maxSpecialists: 2 }, reportRules: { disable: ['env-probe', 'compliance-tag-invalid'] } }));
      expect(run(event(['PDPA-DNC'])).status).toBe(0);
      expect(verifyChain(busPath(t.root, runId))).toMatchObject({ ok: true });
    } finally {
      t.cleanup();
    }
  });
});

describe('a work report key the schema drops is reported in droppedKeys', () => {
  let t: TmpAegis;
  let runId: string;
  beforeEach(async () => {
    t = makeAegisRoot();
    runId = await startedRun(t.root);
  });
  afterEach(() => t.cleanup());
  const agent = 'qa-messaging-specialist';
  const report = (taskId: string, extra: Record<string, unknown> = {}) => {
    const f = path.join(t.root, `${taskId}.json`);
    fs.writeFileSync(f, JSON.stringify({ taskId, agent, startedAt: TS, completedAt: TS, summary: `Completed ${taskId} for the dropped keys test.`, approach: 'Fixture-driven test.', ...extra }));
    return f;
  };

  it('lists the findings key of a messaging worker, and nothing for a clean report', async () => {
    await addTask(t.root, runId, { id: 'T-a-1', title: 'a', agent }, ORCH);
    await claimTask(t.root, runId, 'T-a-1', agent);
    const dirty = await submitWorkReport(t.root, runId, report('T-a-1', { findings: [{ id: 'F-1' }], notes: 'x' }), agent);
    expect(dirty.droppedKeys).toEqual(['findings', 'notes']);
    // the key is dropped from the stored report, as before
    expect(JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), dirty.path), 'utf8'))).not.toHaveProperty('findings');
    const clean = await submitWorkReport(t.root, runId, report('T-a-1', { evidence: ['a.json'], lessonsApplied: [] }), agent);
    expect(clean).not.toHaveProperty('droppedKeys');
  });

  it('does not count the CLI-stamped lintErrors as dropped (it has its own notice)', async () => {
    await addTask(t.root, runId, { id: 'T-b-1', title: 'b', agent }, ORCH);
    await claimTask(t.root, runId, 'T-b-1', agent);
    const res = await submitWorkReport(t.root, runId, report('T-b-1', { lintErrors: ['made-up x:1'] }), agent);
    expect(res).not.toHaveProperty('droppedKeys');
    expect(res.adjusted).toContainEqual(expect.stringMatching(/^lintErrors: removed/));
  });
});
