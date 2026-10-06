import * as fs from 'fs';
import * as path from 'path';
import { decide, LEGACY_MAIN_THREAD_RUN_WRITES, type GuardContext, type HookToolInput } from '@qa/path-guard';

const ROOT = '/repo/aegis';
const RUN = 'RUN-20261002-001';
const RUN_DIR = `${ROOT}/runs/${RUN}`;
const OUTSIDE = '/scratch/wt/p0c';
const ctx: GuardContext = {
  aegisRoot: ROOT, targetRoot: '/repo', testsDir: '/repo/tests/qa', runDir: RUN_DIR, activeRunId: RUN,
  environment: 'development', currentPhase: 'execution', envPolicy: { mutating: true, allowedSpecialists: ['*'] }, tempDirs: ['/tmp'],
};
// Stand-in for run-state's assertCallerAllowed: the owner may not claim; only the orchestrator starts phases.
const deps = {
  cliAllowed: (who: string, cmd: string) =>
    who === 'owner' && cmd === 'task.claim' ? '"task.claim" is agent-only; the main thread cannot run it'
      : cmd === 'phase.start' && who !== 'qa-orchestrator' ? 'phase.start is run only by qa-orchestrator' : null,
};

const write = (file_path: string, content = '{}', agent?: string): HookToolInput =>
  ({ tool_name: 'Write', tool_input: { file_path, content }, cwd: ROOT, ...(agent !== undefined ? { agent_type: agent, agent_id: 'a1' } : {}) });
const bash = (command: string, agent?: string, cwd = ROOT): HookToolInput =>
  ({ tool_name: 'Bash', tool_input: { command }, cwd, ...(agent !== undefined ? { agent_type: agent, agent_id: 'a1' } : {}) });
const dispatch = (subagent_type: string, agent?: string): HookToolInput =>
  ({ tool_name: 'Agent', tool_input: { subagent_type, prompt: 'x' }, ...(agent !== undefined ? { agent_type: agent, agent_id: 'a1' } : {}) });

describe('decide: H1 rules (spec §4.2)', () => {
  it.each<[string, HookToolInput, boolean, RegExp?]>([
    // (a) main thread
    ['main writes framework source', write(`${ROOT}/packages/@qa/x/src/a.ts`), true],
    ['main writes a run file', write(`${RUN_DIR}/plan.json`), false, /main thread never writes QA artefacts/],
    ['main writes target tests', write('/repo/tests/unit/a.test.ts'), false, /main thread never writes QA artefacts/],
    ['main writes through Bash into runs/', bash(`echo x > runs/${RUN}/notes.md`), false, /main thread never writes QA artefacts/],
    // (c) CLI-only, any caller
    ['agent writes events.jsonl', write(`${RUN_DIR}/events.jsonl`, '{}', 'qa-ui-specialist'), false, /written only by the aegis CLI/],
    ['main removes events.jsonl', bash(`rm runs/${RUN}/events.jsonl`), false, /written only by the aegis CLI/],
    ['agent writes a work report file', write(`${RUN_DIR}/reports/work/qa-ui-specialist.T-1.1.json`, '{}', 'qa-ui-specialist'), false, /written only by the aegis CLI/],
    ['agent writes the hook ledger', write(`${RUN_DIR}/hooks/agents.jsonl`, '{}', 'qa-ui-specialist'), false, /written only by the aegis CLI/],
    ['agent writes the active pointer', write(`${ROOT}/runs/.active`, RUN, 'qa-orchestrator'), false, /written only by the aegis CLI/],
    // carry (f): integrity/** is CLI-only
    ['agent writes integrity/ (carry f)', write(`${RUN_DIR}/integrity/torn-tail.1.bin`, 'x', 'qa-orchestrator'), false, /written only by the aegis CLI/],
    ['main removes integrity/ (carry f)', bash(`rm -rf runs/${RUN}/integrity`), false, /written only by the aegis CLI/],
    // NEW-07: messaging/** (contract.json, plan.json) is CLI-only
    ['agent writes messaging/contract.json (NEW-07)', write(`${RUN_DIR}/messaging/contract.json`, '{}', 'qa-messaging-specialist'), false, /written only by the aegis CLI/],
    ['agent writes messaging/plan.json (NEW-07)', write(`${RUN_DIR}/messaging/plan.json`, '{}', 'qa-orchestrator'), false, /written only by the aegis CLI/],
    ['main writes messaging/contract.json (NEW-07)', write(`${RUN_DIR}/messaging/contract.json`), false, /written only by the aegis CLI/],
    ['main removes messaging/ (NEW-07)', bash(`rm -rf runs/${RUN}/messaging`), false, /written only by the aegis CLI/],
    ['agent redirects into messaging/contract.json (NEW-07)', bash(`echo '{}' > runs/${RUN}/messaging/contract.json`, 'qa-messaging-specialist'), false, /written only by the aegis CLI/],
    // carry (b): CLI-only runs before the role check, and *.lock matches at any depth
    ['nested lock inside an evidence tree the role covers (carry b)', write(`${RUN_DIR}/evidence/TC-x1/a/b.lock`, '', 'qa-ui-specialist'), false, /written only by the aegis CLI/],
    ['a lock inside a proper-lockfile lock directory (carry b)', write(`${RUN_DIR}/run.lock.lock/x`, '', 'qa-ui-specialist'), false, /written only by the aegis CLI/],
    ['nested lock in the designer case dir (carry b)', write(`${RUN_DIR}/cases/x.lock`, '', 'qa-test-designer'), false, /written only by the aegis CLI/],
    // (b) role table
    ['specialist writes its spec', write('/repo/tests/qa/specs/login/login.spec.ts', 'test()', 'qa-ui-specialist'), true],
    ['specialist writes its result', write(`${RUN_DIR}/cases/TC-AUTH-001-result.json`, '{"status":"pass"}', 'qa-ui-specialist'), true],
    ['planner writes the plan', write(`${RUN_DIR}/plan.json`, '{}', 'qa-test-planner'), true],
    ['planner writes a test', write('/repo/tests/qa/specs/x.spec.ts', 'x', 'qa-test-planner'), false, /not writable for qa-test-planner/],
    ['specialist writes another run (AUD-026)', write(`${ROOT}/runs/RUN-20261002-002/cases/TC-AUTH-001-result.json`, '{}', 'qa-ui-specialist'), false, /not writable/],
    ['.. into another run is normalized', write(`${RUN_DIR}/../RUN-20261002-002/plan.json`, '{}', 'qa-test-planner'), false, /not writable/],
    ['.. out of the tests dir into target source', write('/repo/tests/qa/../../src/app.ts', 'x', 'qa-ui-specialist'), false, /not writable/],
    ['.. onto a CLI-only file is normalized first (carry a)', write(`${RUN_DIR}/cases/../events.jsonl`, '{}', 'qa-test-designer'), false, /written only by the aegis CLI/],
    ['a doubled slash is normalized (carry a)', write(`${ROOT}//runs/${RUN}//run.json`, '{}', 'qa-orchestrator'), false, /written only by the aegis CLI/],
    ['a relative path resolves against cwd', write(`runs/${RUN}/plan.json`, '{}', 'qa-test-planner'), true],
    ['unknown qa agent', write(`${ROOT}/sandbox/x/a.ts`, 'x', 'qa-made-up'), false, /no row in the path-guard role table/],
    ['agent writes OS temp', write('/tmp/wr.json', '{}', 'qa-ui-specialist-spv'), true],
    // (d) framework and dependencies
    ['agent edits contracts (AUD-022)', write(`${ROOT}/packages/@qa/contracts/src/events.ts`, 'x', 'qa-ui-specialist'), false, /never modify the framework/],
    ['agent edits .claude', write(`${ROOT}/.claude/agents/x.md`, 'x', 'qa-orchestrator'), false, /never modify the framework/],
    ['agent writes a lockfile (AUD-022)', write('/repo/pnpm-lock.yaml', 'x', 'qa-ui-specialist'), false, /lockfiles/],
    ['agent writes package.json under tests', write('/repo/tests/qa/package.json', '{}', 'qa-ui-specialist'), false, /lockfiles/],
    ['sandbox package.json is scratch', write(`${ROOT}/sandbox/2026-10-02-x/package.json`, '{}', 'qa-ui-specialist'), true],
    // (e) non-qa subagents
    ['non-qa subagent writes inside aegis', write(`${ROOT}/HANDBOOK/x.md`, 'x', 'general-purpose'), false, /territory rule/],
    ['non-qa subagent writes QA tests', write('/repo/tests/qa/x.spec.ts', 'x', 'general-purpose'), false, /QA artefacts/],
    ['non-qa subagent writes elsewhere', write('/other/repo/file.ts', 'x', 'general-purpose'), true],
    // brand rule (AUD-020)
    ['brand-clean file with an agent name', write(`${RUN_DIR}/cases/TC-AUTH-001.json`, '{"author":"qa-test-designer"}', 'qa-test-designer'), false, /customer-facing/],
    ['brand-clean file with neutral text', write(`${RUN_DIR}/cases/TC-AUTH-001.json`, '{"author":"QA team"}', 'qa-test-designer'), true],
    ['brand rule on a heredoc', bash(`cat > runs/${RUN}/defects/DEF-001-AUTH-UI.md <<'EOF'\nFound by Aegis\nEOF`, 'qa-defect-manager'), false, /customer-facing/],
    // CLI identity (spec §4.1)
    ['owner runs an owner command', bash('AEGIS_AGENT=owner pnpm aegis run status'), true],
    ['main without a prefix', bash('pnpm aegis run status'), false, /prefix the command with AEGIS_AGENT=owner/],
    ['main impersonates the orchestrator', bash('AEGIS_AGENT=qa-orchestrator pnpm aegis phase start --phase scan'), false, /does not match the caller \(owner\)/],
    ['owner runs an agent-only command', bash('AEGIS_AGENT=owner pnpm aegis task claim --task T-1'), false, /agent-only/],
    ['main runs align without a prefix', bash('pnpm aegis align'), true],
    ['agent runs its own claim', bash('AEGIS_AGENT=qa-ui-specialist pnpm aegis task claim --task T-1', 'qa-ui-specialist'), true],
    ['agent impersonates another agent', bash('AEGIS_AGENT=qa-api-specialist pnpm aegis task claim --task T-1', 'qa-ui-specialist'), false, /does not match/],
    ['agent runs an orchestrator command', bash('AEGIS_AGENT=qa-ui-specialist pnpm aegis phase start --phase scan', 'qa-ui-specialist'), false, /run only by qa-orchestrator/],
    ['agent runs a framework command', bash('AEGIS_AGENT=qa-ui-specialist pnpm aegis align', 'qa-ui-specialist'), false, /framework command/],
    ['non-qa subagent runs the CLI', bash('AEGIS_AGENT=general-purpose pnpm aegis task list', 'general-purpose'), false, /not a qa-\* agent/],
    ['built CLI path is the CLI too', bash('AEGIS_AGENT=qa-ui-specialist node apps/cli/dist/index.js task claim --task T-1', 'qa-api-specialist'), false, /does not match/],
    ['built CLI dir behind node flags is the CLI too', bash('AEGIS_AGENT=qa-ui-specialist node --enable-source-maps apps/cli/dist task claim --task T-1', 'qa-api-specialist'), false, /does not match/],
    ['the aegis bin is the CLI too', bash('AEGIS_AGENT=qa-ui-specialist ./node_modules/.bin/aegis task claim --task T-1', 'qa-api-specialist'), false, /does not match/],
    ['pnpm --dir= before aegis is the CLI too', bash('pnpm --dir=. aegis run status'), false, /prefix the command/],
    // carry (e): a subagent spoofing the owner on an owner-only command
    ['agent spoofs the owner on integrity repair-tail (carry e)', bash(`AEGIS_AGENT=owner pnpm aegis integrity repair-tail --run ${RUN}`, 'qa-orchestrator'), false, /does not match the caller \(qa-orchestrator\)/],
    ['agent spoofs the owner on gate decide (carry e)', bash('AEGIS_AGENT=owner pnpm aegis gate decide --gate 1 --decision approved', 'qa-test-planner'), false, /does not match the caller \(qa-test-planner\)/],
    ['agent spoofs the owner through the built CLI (carry e)', bash(`AEGIS_AGENT=owner node ${ROOT}/apps/cli/dist/index.js integrity repair-tail --run ${RUN}`, 'qa-ui-specialist'), false, /does not match/],
    ['non-qa subagent spoofs the owner inside aegis (carry e)', bash(`AEGIS_AGENT=owner pnpm aegis integrity repair-tail --run ${RUN}`, 'general-purpose'), false, /not a qa-\* agent/],
    // R3: a non-qa subagent is refused the CLI only inside the aegis root (decision 4)
    ['R3: non-qa subagent runs align in an outside worktree', bash('pnpm aegis align', 'general-purpose', OUTSIDE), true],
    ['R3: non-qa subagent runs the built CLI in an outside worktree', bash('node apps/cli/dist/index.js align', 'general-purpose', OUTSIDE), true],
    ['R3: non-qa subagent runs align inside aegis', bash('pnpm aegis align', 'general-purpose'), false, /not a qa-\* agent/],
    ['R3: non-qa subagent cds into aegis first', bash(`cd ${ROOT} && pnpm aegis align`, 'general-purpose', OUTSIDE), false, /not a qa-\* agent/],
    ['R3: non-qa subagent points pnpm -C at aegis', bash(`pnpm -C ${ROOT} aegis align`, 'general-purpose', OUTSIDE), false, /not a qa-\* agent/],
    ['R3: attached -C<dir> points pnpm at aegis too', bash(`pnpm -C${ROOT} aegis align`, 'general-purpose', OUTSIDE), false, /not a qa-\* agent/],
    ['R3: attached --dir=<dir> points pnpm at aegis too', bash(`pnpm --dir=${ROOT} aegis align`, 'general-purpose', OUTSIDE), false, /not a qa-\* agent/],
    ['R3: non-qa subagent runs the aegis built CLI by path', bash(`node ${ROOT}/apps/cli/dist/index.js align`, 'general-purpose', OUTSIDE), false, /not a qa-\* agent/],
    // dynamic targets
    ['dynamic target naming the log', bash('echo x > "$RUN_DIR/events.jsonl"', 'qa-ui-specialist'), false, /not a literal path/],
    ['dynamic target naming intake/ (d8)', bash('echo x > "$RUN_DIR/intake/prd.md"', 'qa-ui-specialist'), false, /not a literal path/],
    ['dynamic target naming a lock (d8)', bash('touch "$RUN_DIR/run.lock"', 'qa-ui-specialist'), false, /not a literal path/],
    ['other dynamic target', bash('echo x > "$OUT"', 'qa-ui-specialist'), true],
    // dispatch (AUD-022)
    ['executor dispatches a specialist', dispatch('qa-ui-specialist', 'qa-test-executor'), true],
    ['nested orchestrator', dispatch('qa-orchestrator', 'qa-test-executor'), false, /nested orchestrator/],
    ['qa agent dispatches a non-qa agent', dispatch('general-purpose', 'qa-test-executor'), false, /only qa-\* agents/],
    ['non-qa subagent dispatches a qa agent', dispatch('qa-ui-specialist', 'general-purpose'), false, /may not dispatch/],
    ['main dispatches the orchestrator', dispatch('qa-orchestrator'), true],
    // other tools
    ['Read is not guarded', { tool_name: 'Read', tool_input: { file_path: `${RUN_DIR}/events.jsonl` }, agent_type: 'qa-ui-specialist' }, true],
    // A rest parameter keeps the callback's arity at 3: jest-each treats a 4th declared parameter on a 3-element row as done().
  ])('%s', (_label, input, allow, ...rest) => {
    const reason = rest[0];
    const r = decide(input, ctx, deps);
    expect(r.allow).toBe(allow);
    if (reason !== undefined && !r.allow) expect(r.reason).toMatch(reason);
  });

  it('MultiEdit checks every new_string against the brand rule', () => {
    const r = decide({ tool_name: 'MultiEdit', tool_input: { file_path: `${RUN_DIR}/rtm.json`, edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'by qa-test-designer' }] }, agent_type: 'qa-test-designer' }, ctx, deps);
    expect(r.allow).toBe(false);
  });

  it('returns the task ids an agent claims, for the hook ledger', () => {
    expect(decide(bash('AEGIS_AGENT=qa-ui-specialist pnpm aegis task claim --task=T-execution-3', 'qa-ui-specialist'), ctx, deps)).toEqual({ allow: true, claims: [{ taskId: 'T-execution-3', runId: null }], warnings: [] });
  });

  it('carry (a): refuses a write it cannot resolve to an absolute path', () => {
    const rel = (input: HookToolInput): HookToolInput => ({ ...input, cwd: 'relative/dir' });
    expect(decide(rel(write('plan.json', '{}', 'qa-test-planner')), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/not an absolute path/) });
    expect(decide(rel(bash('echo x > out.txt', 'qa-ui-specialist')), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/not an absolute path/) });
    // An absolute file_path needs no cwd.
    expect(decide(rel(write(`${RUN_DIR}/plan.json`, '{}', 'qa-test-planner')), ctx, deps).allow).toBe(true);
  });

  it('carry (b): rule (c) denies on its own, before the environment and role checks', () => {
    const prod: GuardContext = { ...ctx, environment: 'production', envPolicy: { readOnly: true, mutating: false, allowedSpecialists: ['ui'] } };
    expect(decide(write(`${RUN_DIR}/events.jsonl`, '{}', 'qa-database-specialist'), prod, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/written only by the aegis CLI/) });
    expect(decide(write(`${RUN_DIR}/gates/gate-1-decision.json`, '{}', 'qa-made-up'), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/written only by the aegis CLI/) });
  });
});

describe('decide: H1 rollout for the legacy skills (decision 24)', () => {
  it('a main-thread write on a legacy skill path is warned and allowed', () => {
    const file = `${RUN_DIR}/reports/gate-check/staging.json`;
    expect(decide(write(file), ctx, deps)).toEqual({ allow: true, claims: [], warnings: [{ skills: ['qa-gate-check'], path: file, runId: RUN }] });
  });

  it('names every legacy skill that writes the path, in any run (R1: qa-run-phase writes {run}/execution/**)', () => {
    const file = `${ROOT}/runs/RUN-20261001-004/execution/results.json`;
    expect(decide(write(file), ctx, deps)).toMatchObject({ allow: true, warnings: [{ skills: ['qa-record-manual', 'qa-regression', 'qa-rerun-failed', 'qa-run-phase'], runId: 'RUN-20261001-004' }] });
  });

  it('covers qa-health --fix removing an orphan lock and _qa-init-project creating runs/', () => {
    expect(decide(bash(`rm -rf runs/${RUN}/run.lock`), ctx, deps)).toMatchObject({ allow: true, warnings: [{ skills: ['qa-health'] }] });
    expect(decide(bash(`rm -rf runs/${RUN}/reports/.locks`), ctx, deps)).toMatchObject({ allow: true, warnings: [{ skills: ['qa-health'] }] });
    expect(decide(bash('mkdir -p runs'), ctx, deps)).toMatchObject({ allow: true, warnings: [{ skills: ['_qa-init-project'], runId: null }] });
    expect(decide(bash('touch runs'), ctx, deps)).toMatchObject({ allow: true, warnings: [{ skills: ['_qa-init-project'] }] });
  });

  it('qa-health may only remove a lock, never write one (d9)', () => {
    expect(decide(bash(`echo 1 > runs/${RUN}/run.lock`), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/written only by the aegis CLI/) });
    expect(decide(write(`${RUN_DIR}/events.jsonl.lock`, ''), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/written only by the aegis CLI/) });
  });

  it('R5: qa-health --fix deduplicating ids rewrites cases and defects, warned and allowed', () => {
    const file = `${RUN_DIR}/cases/TC-AUTH-001.json`;
    expect(decide(write(file, '{"id":"TC-AUTH-002"}'), ctx, deps)).toEqual({ allow: true, claims: [], warnings: [{ skills: ['qa-health'], path: file, runId: RUN }] });
    expect(decide(write(`${RUN_DIR}/defects/DEF-001-AUTH-UI.json`, '{}'), ctx, deps)).toMatchObject({ allow: true, warnings: [{ skills: ['qa-health'] }] });
  });

  it('R2 (security): the main thread never removes or moves runs/ or a run directory, even for a legacy skill', () => {
    expect(decide(bash('rm -rf runs'), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/removes or moves runs\//), warnings: [] });
    expect(decide(bash(`rm -rf ${ROOT}/runs/`), ctx, deps).allow).toBe(false);
    expect(decide(bash('rmdir runs'), ctx, deps).allow).toBe(false);
    expect(decide(bash('mv runs /tmp/old-runs'), ctx, deps).allow).toBe(false);
    expect(decide(bash(`rm -rf runs/${RUN}`), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/removes or moves runs\//) });
    expect(decide(bash(`mv runs/${RUN} runs/RUN-20261002-009`), ctx, deps).allow).toBe(false);
    expect(decide(bash(`cd runs && rm -rf ${RUN}`), ctx, deps).allow).toBe(false);
    // Only creation is an _qa-init-project write: overwriting runs/ is not.
    expect(decide(bash('cp -r /tmp/backup runs'), ctx, deps).allow).toBe(false);
    expect(decide(write(`${ROOT}/runs`, 'x'), ctx, deps).allow).toBe(false);
  });

  it('a subagent writing a legacy skill path is denied', () => {
    expect(decide(write(`${RUN_DIR}/reports/gate-check/staging.json`, '{}', 'qa-test-executor'), ctx, deps)).toMatchObject({ allow: false, warnings: [] });
    expect(decide(write(`${RUN_DIR}/execution/results.json`, '{}', 'general-purpose'), ctx, deps).allow).toBe(false);
    expect(decide(bash(`rm -rf runs/${RUN}/run.lock`, 'qa-orchestrator'), ctx, deps).allow).toBe(false);
  });

  it('a main-thread run path outside the legacy list follows the normal rule', () => {
    expect(decide(write(`${RUN_DIR}/stories/US-AUTH-001.md`), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/main thread never writes QA artefacts/) });
    expect(decide(write(`${RUN_DIR}/events.jsonl`), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/written only by the aegis CLI/) });
    expect(decide(write(`${RUN_DIR}/intake/prd.md`), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/written only by the aegis CLI/) });
    expect(decide(write(`${RUN_DIR}/integrity/torn-tail.1.bin`), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/written only by the aegis CLI/) });
    expect(decide(write(`${RUN_DIR}/messaging/contract.json`), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/written only by the aegis CLI/) });
    // qa-record-manual's evidence/** does not reach a nested CLI-only lock (carry b).
    expect(decide(write(`${RUN_DIR}/evidence/TC-x1/a/b.lock`), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/written only by the aegis CLI/) });
  });

  it('the brand rule still denies a legacy write', () => {
    expect(decide(write(`${RUN_DIR}/reports/closure/closure.md`, 'Prepared by Aegis'), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/customer-facing/) });
  });

  it('the legacy list is one constant naming exactly the nine skills, each an existing skill', () => {
    const skills = Object.keys(LEGACY_MAIN_THREAD_RUN_WRITES).sort();
    expect(skills).toEqual(['_qa-init-project', 'qa-gate-check', 'qa-health', 'qa-promote-stage', 'qa-record-manual', 'qa-regenerate-report', 'qa-regression', 'qa-rerun-failed', 'qa-run-phase']);
    for (const s of skills) expect(fs.existsSync(path.join(__dirname, '..', '.claude', 'skills', s, 'SKILL.md'))).toBe(true);
  });
});

describe('decide: environment, missing run and speed', () => {
  it('denies every write of an agent the environment forbids, but not its CLI calls (H4/H1)', () => {
    const prod: GuardContext = { ...ctx, environment: 'production', envPolicy: { readOnly: true, mutating: false, allowedSpecialists: ['ui', 'api'] } };
    expect(decide(write('/repo/tests/qa/integration/db/x.db.test.ts', 'x', 'qa-database-specialist'), prod, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/read-only/) });
    expect(decide(write('/tmp/x', 'x', 'qa-database-specialist'), prod, deps).allow).toBe(false);
    expect(decide(bash('AEGIS_AGENT=qa-database-specialist pnpm aegis task claim --task T-1', 'qa-database-specialist'), prod, deps).allow).toBe(true);
    expect(decide(write('/repo/tests/qa/specs/a.spec.ts', 'x', 'qa-ui-specialist'), prod, deps).allow).toBe(true);
  });

  it('without an active run a qa agent cannot write {run} paths, and is told why', () => {
    const none: GuardContext = { ...ctx, activeRunId: null, runDir: null, environment: null, currentPhase: null, envPolicy: undefined };
    expect(decide(write(`${RUN_DIR}/plan.json`, '{}', 'qa-test-planner'), none, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/no active run/) });
    expect(decide(write(`${ROOT}/packages/x.ts`), none, deps).allow).toBe(true);
  });

  it('decides in well under 2 ms per call', () => {
    const input = bash(`cd sandbox && cat > a.txt <<'EOF'\nx\nEOF\nAEGIS_AGENT=qa-ui-specialist pnpm aegis task claim --task T-1`, 'qa-ui-specialist');
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) decide(input, ctx, deps);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
