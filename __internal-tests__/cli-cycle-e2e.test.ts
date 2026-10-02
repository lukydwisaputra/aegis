import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';
import { DEV_TEST_REVIEW, ENV_AUTH_REPORT, STORY } from './helpers/p0a2-fixtures';
import { PROFILE } from './helpers/pipeline';

// Drives the built aegis CLI through whole cycles with fake agents (the P0a-1 final review's scratch scripts).
// Every step is a real CLI call; the "agents" only claim, submit, release and review.

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');
// Locally the test needs a fresh `pnpm build`; skip with a reason rather than fail. CI always runs it.
const stale = process.env.CI ? null : staleBuild(ROOT);
if (stale) console.warn(`cli-cycle-e2e skipped: ${stale} (run pnpm build)`);
const e2e = stale ? it.skip : it;

const O = 'qa-orchestrator';
const TS = '2026-09-30T08:00:00.000Z';
const SPV_NONE = /^(qa-context-scanner|qa-compliance-.*|qa-curator)$/;

interface Result { status: number | null; out: unknown; err: { error?: string; message?: string } | null; stderr: string }

/** One throwaway target + aegis root, as in the review's lib.sh: target/{package.json,docs/prd.md}, aegis/{config,thresholds}. */
class Sim {
  readonly base = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-e2e-'));
  readonly root = path.join(this.base, 'aegis');
  private n = 0;

  constructor() {
    fs.mkdirSync(path.join(this.base, 'target', 'docs'), { recursive: true });
    fs.mkdirSync(this.root);
    fs.writeFileSync(path.join(this.base, 'target', 'package.json'), '{"name":"fake-target"}');
    fs.writeFileSync(path.join(this.base, 'target', 'docs', 'prd.md'), '# PRD');
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'aegis.config.json'), 'utf8'));
    Object.assign(cfg, { targetProjectRoot: '../target', compliance: ['iso25010'], intake: { sources: ['docs/**/*.md'] } });
    fs.writeFileSync(path.join(this.root, 'aegis.config.json'), JSON.stringify(cfg, null, 2));
    fs.copyFileSync(path.join(ROOT, 'thresholds.yaml'), path.join(this.root, 'thresholds.yaml'));
  }

  cleanup(): void {
    fs.rmSync(this.base, { recursive: true, force: true });
  }

  run(agent: string, ...args: string[]): Result {
    const env = { ...process.env, AEGIS_AGENT: agent, AEGIS_COUNTERS_PATH: path.join(this.root, '.aegis', '.counters.json') };
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: this.root, encoding: 'utf-8', env });
    const parse = (s: string) => { try { return s.trim() === '' ? null : JSON.parse(s); } catch { return s; } };
    return { status: r.status, out: parse(r.stdout), err: parse(r.stderr), stderr: r.stderr };
  }

  /** Expect exit 0. */
  ok(agent: string, ...args: string[]): any {
    const r = this.run(agent, ...args);
    if (r.status !== 0) throw new Error(`refused: ${agent} aegis ${args.join(' ')}\n${r.stderr}`);
    return r.out;
  }

  /** Expect a refusal (exit 2) with `code`. */
  no(code: string, agent: string, ...args: string[]): string {
    const r = this.run(agent, ...args);
    if (r.status !== 2 || r.err?.error !== code) throw new Error(`expected ${code}: ${agent} aegis ${args.join(' ')} -> ${r.status} ${r.stderr}`);
    return r.err.message ?? '';
  }

  next(): { kind: string; phase?: string; gate?: string } {
    return this.ok(O, 'run', 'status').next;
  }

  get runDir(): string {
    return path.join(this.root, 'runs', fs.readFileSync(path.join(this.root, 'runs', '.active'), 'utf8').trim());
  }

  put(rel: string, value: unknown): void {
    const file = path.join(this.runDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  }

  private tmp(value: unknown): string {
    const file = path.join(this.base, `tmp-${++this.n}.json`);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  }

  /** Claim, submit a work report, release; then the paired SPV reviews (agents without an SPV are not reviewed). */
  attempt(task: string, agent: string, verdict: 'passed' | 'requested-changes' = 'passed', spv = `${agent}-spv`): void {
    this.ok(agent, 'task', 'claim', '--task', task);
    this.report(task, agent);
    this.ok(agent, 'task', 'release', '--task', task, '--result', 'done');
    if (!SPV_NONE.test(agent)) this.review(task, agent, verdict, spv);
  }

  report(task: string, agent: string): void {
    const wr = { id: 'WR-T-1', taskId: task, agent, startedAt: TS, completedAt: TS, summary: `Completed ${task} for the pipeline simulation.`, approach: 'Fixture-driven pipeline simulation.' };
    this.ok(agent, 'work-report', 'submit', '--file', this.tmp(wr));
  }

  review(task: string, agent: string, verdict: 'passed' | 'requested-changes', spv = `${agent}-spv`): void {
    const rejected = verdict === 'requested-changes';
    this.ok(spv, 'review', 'submit', '--file', this.tmp({
      id: 'RV-pipeline-spv-T-1', reviewer: spv, target: { agent, taskId: task }, verdict, summary: `Review verdict ${verdict}.`,
      findings: rejected ? [{ severity: 'medium', claim: 'Missing negative assertion' }] : [],
      correctiveInstructions: rejected ? [{ mistake: 'Asserted only the status code of the response.', rootCause: 'The checklist did not include the body schema.', correctiveRule: 'Assert status, schema and error message on every request.' }] : [],
      reviewedAt: TS, modelUsed: 'claude-opus-5-5',
    }));
  }

  /** The dispatcher adds a task for `agent`, which works it through one passing attempt. */
  work(dispatcher: string, task: string, agent: string): void {
    this.ok(dispatcher, 'task', 'add', '--id', task, '--title', `task ${task}`, '--agent', agent);
    this.attempt(task, agent);
  }

  /** A phase with one worker task and its outputs. */
  phase(phase: string, agent: string, outputs: Record<string, unknown> = {}, task = `T-${phase}-1`): void {
    this.ok(O, 'phase', 'start', '--phase', phase);
    this.work(O, task, agent);
    for (const [rel, value] of Object.entries(outputs)) this.put(rel, value);
    this.ok(O, 'phase', 'complete', '--phase', phase);
  }

  /** The orchestrator's gate-precondition task (added once; re-claimed after a rejection), reviewed by its SPV. */
  gateTask(n: number, add: boolean): void {
    if (add) this.ok(O, 'task', 'add', '--id', `T-GATE-G${n}`, '--title', `Gate ${n} preconditions`, '--agent', O);
    this.attempt(`T-GATE-G${n}`, O);
  }

  /** Intake and Scan (both cycles). */
  intakeAndScan(profile: unknown = PROFILE): void {
    this.ok(O, 'phase', 'start', '--phase', 'intake');
    this.ok(O, 'phase', 'complete', '--phase', 'intake');
    this.ok(O, 'phase', 'start', '--phase', 'scan');
    this.work(O, 'T-scan-1', 'qa-context-scanner');
    this.put('target-profile.json', profile);
    this.ok(O, 'phase', 'complete', '--phase', 'scan');
  }

  /** Execution through the executor, who dispatches the UI specialist (and, when given, one more specialist). */
  execution(passed: number, failed: number, extra?: (sim: Sim) => void): void {
    this.ok(O, 'phase', 'start', '--phase', 'execution');
    this.ok(O, 'task', 'add', '--id', 'T-execution-1', '--title', 'execute', '--agent', 'qa-test-executor');
    this.ok('qa-test-executor', 'task', 'claim', '--task', 'T-execution-1');
    this.ok('qa-test-executor', 'task', 'add', '--id', 'T-execution-ui-1', '--title', 'ui', '--agent', 'qa-ui-specialist');
    this.attempt('T-execution-ui-1', 'qa-ui-specialist');
    extra?.(this);
    this.put('execution-summary.json', { totals: { passed, failed, blocked: 0 } });
    this.report('T-execution-1', 'qa-test-executor');
    this.ok('qa-test-executor', 'task', 'release', '--task', 'T-execution-1', '--result', 'done');
    this.review('T-execution-1', 'qa-test-executor', 'passed');
    this.ok(O, 'phase', 'complete', '--phase', 'execution');
  }
}

let sim: Sim;
afterEach(() => sim?.cleanup());

e2e('full cycle: gates G1-G3, an escalation retry, a G2 rejection and its recovery, then run complete', () => {
  sim = new Sim();
  sim.ok('owner', 'run', 'create', '--env', 'staging', '--module', 'AUTH', '--cycle', 'full', '--health', 'passed');
  expect(fs.readdirSync(path.join(sim.runDir, 'intake', 'docs'))).toEqual(['prd.md']);
  sim.no('caller-forbidden', 'owner', 'phase', 'start', '--phase', 'intake');
  sim.intakeAndScan();
  sim.ok(O, 'phase', 'complete', '--phase', 'dev-test-review', '--not-applicable');
  sim.phase('requirements', 'qa-requirements-analyst', { 'requirements/ambiguity-report.json': {}, 'requirements/testability-scores.json': {}, [`stories/${STORY.id}.json`]: STORY });
  sim.phase('env-auth', 'qa-environment-engineer', { 'env-auth-report.json': ENV_AUTH_REPORT });
  sim.phase('explore', 'qa-web-explorer', { 'discovery-report.json': {} });

  // Planning: the barrier needs the gate task (C1); only the owner decides the gate.
  sim.ok(O, 'phase', 'start', '--phase', 'planning');
  sim.work(O, 'T-planning-1', 'qa-test-planner');
  sim.put('plan.json', {});
  sim.put('risk-register.json', {});
  expect(sim.no('barrier', O, 'phase', 'complete', '--phase', 'planning')).toMatch(/T-GATE-G1/);
  sim.gateTask(1, true);
  sim.ok(O, 'phase', 'complete', '--phase', 'planning');
  sim.no('out-of-order', O, 'phase', 'start', '--phase', 'design');
  sim.ok(O, 'gate', 'open', '--gate', 'G1');
  expect(sim.next()).toEqual({ kind: 'await-gate', gate: 'G1' });
  sim.no('caller-forbidden', O, 'gate', 'decide', '--gate', 'G1', '--decision', 'approved', '--note', 'x');
  sim.ok('owner', 'gate', 'decide', '--gate', '1', '--decision', 'approved-with-conditions', '--note', 'add WSTG-AUTH-01');

  // Design: three rejections escalate; the owner retries; the next attempt passes.
  sim.ok(O, 'phase', 'start', '--phase', 'design');
  sim.ok(O, 'task', 'add', '--id', 'T-design-1', '--title', 'design', '--agent', 'qa-test-designer');
  sim.no('not-assignee', 'qa-test-planner', 'task', 'claim', '--task', 'T-design-1');
  for (let i = 0; i < 3; i++) sim.attempt('T-design-1', 'qa-test-designer', 'requested-changes');
  expect(sim.next()).toMatchObject({ kind: 'blocked' });
  sim.no('run-not-active', 'qa-test-designer', 'task', 'claim', '--task', 'T-design-1');
  sim.no('escalation-pending', 'owner', 'run', 'resume');
  sim.ok('owner', 'escalation', 'decide', '--task', 'T-design-1', '--decision', 'retry', '--reason', 'fix AC coverage');
  sim.attempt('T-design-1', 'qa-test-designer');
  sim.put('rtm.json', {});
  sim.ok(O, 'phase', 'complete', '--phase', 'design');

  sim.phase('env-data', 'qa-environment-engineer', { 'env-setup-report.json': {} });
  sim.execution(5, 0);

  // Triage and G2: a rejection reopens execution; its tasks are pending again and need new work.
  sim.ok(O, 'phase', 'start', '--phase', 'triage');
  sim.work(O, 'T-triage-1', 'qa-defect-manager');
  sim.gateTask(2, true);
  sim.ok(O, 'phase', 'complete', '--phase', 'triage');
  sim.ok(O, 'gate', 'open', '--gate', 'G2');
  sim.no('invalid-input', 'owner', 'gate', 'decide', '--gate', '2', '--decision', 'rejected', '--note', 'no', '--reopen-phase', 'planning');
  sim.ok('owner', 'gate', 'decide', '--gate', '2', '--decision', 'rejected', '--note', 'retest login', '--reopen-phase', 'execution');
  expect(sim.next()).toEqual({ kind: 'start-phase', phase: 'execution' });
  sim.ok(O, 'phase', 'start', '--phase', 'execution');
  sim.no('invalid-input', O, 'task', 'add', '--id', 'T-execution-1', '--title', 'again', '--agent', 'qa-test-executor');
  expect(sim.no('barrier', O, 'phase', 'complete', '--phase', 'execution')).toMatch(/T-execution-1 is pending/);
  sim.ok('qa-test-executor', 'task', 'claim', '--task', 'T-execution-1');
  sim.attempt('T-execution-ui-1', 'qa-ui-specialist');
  sim.report('T-execution-1', 'qa-test-executor');
  sim.ok('qa-test-executor', 'task', 'release', '--task', 'T-execution-1', '--result', 'done');
  sim.review('T-execution-1', 'qa-test-executor', 'passed');
  sim.ok(O, 'phase', 'complete', '--phase', 'execution');
  sim.ok(O, 'phase', 'start', '--phase', 'triage');
  sim.attempt('T-triage-1', 'qa-defect-manager');
  expect(sim.no('barrier', O, 'phase', 'complete', '--phase', 'triage')).toMatch(/T-GATE-G2/);
  sim.gateTask(2, false);
  sim.ok(O, 'phase', 'complete', '--phase', 'triage');
  sim.ok(O, 'gate', 'open', '--gate', 'G2');
  sim.ok('owner', 'gate', 'decide', '--gate', 'G2', '--decision', 'approved', '--note', 'ok now');
  expect(fs.readdirSync(path.join(sim.runDir, 'gates')).sort()).toEqual(['gate-1-decision.json', 'gate-2-decision.1.json', 'gate-2-decision.json']);

  sim.phase('closure-draft', 'qa-closure-reporter', { 'reports/closure/closure.json': {} });
  sim.phase('compliance', 'qa-compliance-iso25010', {}, 'T-compliance-iso25010-1');
  sim.ok(O, 'phase', 'start', '--phase', 'closure-final');
  sim.work(O, 'T-closure-final-1', 'qa-closure-reporter');
  sim.gateTask(3, true);
  sim.ok(O, 'phase', 'complete', '--phase', 'closure-final');
  sim.no('out-of-order', O, 'run', 'complete');
  sim.ok(O, 'gate', 'open', '--gate', 'G3');
  sim.ok('owner', 'gate', 'decide', '--gate', 'G3', '--decision', 'approved', '--note', 'ok');
  sim.phase('executive', 'qa-executive-reporter');
  sim.phase('curator', 'qa-curator');
  expect(sim.next()).toEqual({ kind: 'complete-run' });
  sim.no('caller-forbidden', 'owner', 'run', 'complete');
  sim.ok(O, 'run', 'complete');
  expect(sim.next()).toEqual({ kind: 'completed' });
  expect(sim.ok('owner', 'integrity', 'verify')).toMatchObject({ ok: true });
}, 240_000);

e2e('smoke on testing: env-data seeds, G2 is auto-decided from thresholds.yaml#smoke, the run completes', () => {
  sim = new Sim();
  sim.ok('owner', 'run', 'create', '--env', 'testing', '--module', 'AUTH', '--cycle', 'smoke', '--health', 'passed');
  sim.intakeAndScan();
  expect(sim.next()).toEqual({ kind: 'start-phase', phase: 'env-auth' });
  sim.phase('env-auth', 'qa-environment-engineer', { 'env-auth-report.json': ENV_AUTH_REPORT });
  sim.phase('env-data', 'qa-environment-engineer', { 'env-setup-report.json': {} });
  sim.execution(4, 1, (s) => {
    s.ok('qa-test-executor', 'task', 'add', '--id', 'T-execution-db-1', '--title', 'db', '--agent', 'qa-database-specialist');
    s.attempt('T-execution-db-1', 'qa-database-specialist');
  });
  sim.phase('triage', 'qa-defect-manager');
  expect(sim.next()).toEqual({ kind: 'auto-decide', gate: 'G2' });
  sim.no('out-of-order', O, 'gate', 'open', '--gate', 'G2');
  expect(sim.ok(O, 'gate', 'auto-decide', '--gate', 'G2')).toMatchObject({ decision: 'rejected', decidedBy: 'auto' });
  sim.ok(O, 'run', 'complete');
  expect(sim.next()).toEqual({ kind: 'completed' });
}, 120_000);

e2e('smoke on production: env-data is not applicable, a refused mutating specialist task is cancelled, the run completes', () => {
  sim = new Sim();
  sim.ok('owner', 'run', 'create', '--env', 'production', '--module', 'AUTH', '--cycle', 'smoke', '--health', 'passed');
  sim.intakeAndScan();
  sim.phase('env-auth', 'qa-environment-engineer', { 'env-auth-report.json': ENV_AUTH_REPORT });
  expect(sim.ok(O, 'phase', 'complete', '--phase', 'env-data', '--not-applicable')).toMatchObject({
    phases: { 'env-data': { status: 'not-applicable', reason: 'environment production is read-only; no data seeding' } },
  });
  sim.execution(5, 0, (s) => {
    s.ok('qa-test-executor', 'task', 'add', '--id', 'T-execution-db-1', '--title', 'db', '--agent', 'qa-database-specialist');
    s.no('env-blocked', 'qa-database-specialist', 'task', 'claim', '--task', 'T-execution-db-1');
    s.no('caller-forbidden', O, 'task', 'cancel', '--task', 'T-execution-db-1', '--reason', 'not mine');
    s.ok('qa-test-executor', 'task', 'cancel', '--task', 'T-execution-db-1', '--reason', 'production is read-only');
  });
  sim.phase('triage', 'qa-defect-manager');
  expect(sim.ok(O, 'gate', 'auto-decide', '--gate', 'G2')).toMatchObject({ decision: 'approved' });
  sim.ok(O, 'run', 'complete');
  expect(sim.next()).toEqual({ kind: 'completed' });
}, 120_000);

e2e('full cycle with developer tests: Dev-test-review runs the reviewer and its SPV before Requirements', () => {
  sim = new Sim();
  sim.ok('owner', 'run', 'create', '--env', 'staging', '--module', 'AUTH', '--cycle', 'full', '--health', 'passed');
  const files = ['src/auth/reset.test.ts'];
  sim.intakeAndScan({ ...PROFILE, existingTests: { files, frameworks: ['vitest'], locations: ['src'], count: files.length, unitTestStyle: 'colocated' } });
  expect(sim.no('barrier', O, 'phase', 'complete', '--phase', 'dev-test-review', '--not-applicable')).toMatch(/applicable to this run/);
  expect(sim.next()).toEqual({ kind: 'start-phase', phase: 'dev-test-review' });
  sim.ok(O, 'phase', 'start', '--phase', 'dev-test-review');
  sim.ok(O, 'task', 'add', '--id', 'T-dev-test-review-1', '--title', 'review developer tests', '--agent', 'qa-dev-test-reviewer');
  sim.attempt('T-dev-test-review-1', 'qa-dev-test-reviewer', 'requested-changes');
  sim.attempt('T-dev-test-review-1', 'qa-dev-test-reviewer');
  expect(sim.no('barrier', O, 'phase', 'complete', '--phase', 'dev-test-review')).toMatch(/dev-test-review.json is missing/);
  // The review carries the configured threshold (thresholds.yaml#devTestReview.mutationScoreMin).
  const min = Number(/mutationScoreMin:\s*(\d+)/.exec(fs.readFileSync(path.join(sim.root, 'thresholds.yaml'), 'utf8'))?.[1]);
  sim.put('dev-test-review.json', { ...DEV_TEST_REVIEW, mutation: { ...DEV_TEST_REVIEW.mutation, threshold: min } });
  sim.ok(O, 'phase', 'complete', '--phase', 'dev-test-review');
  expect(sim.next()).toEqual({ kind: 'start-phase', phase: 'requirements' });
  expect(sim.ok('owner', 'integrity', 'verify')).toMatchObject({ ok: true });
}, 120_000);
