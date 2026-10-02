import { decide, roleWritable, type GuardContext, type HookToolInput } from '@qa/path-guard';

// Task 8 review fix round 1: the reviewer's probe forms, as test strings only (never run through a shell).
const ROOT = '/repo/aegis';
const RUN = 'RUN-20261002-001';
const RUN_DIR = `${ROOT}/runs/${RUN}`;
const OUTSIDE = '/scratch/wt/p0c';
const ctx: GuardContext = {
  aegisRoot: ROOT, targetRoot: '/repo', testsDir: '/repo/tests/qa', runDir: RUN_DIR, activeRunId: RUN,
  environment: 'development', currentPhase: 'execution', envPolicy: { mutating: true, allowedSpecialists: ['*'] }, tempDirs: ['/tmp', '/private/tmp'],
};
// Stand-in for run-state's caller tables: owner-only and orchestrator-only commands are refused to anyone else.
const OWNER_ONLY = new Set(['gate.decide', 'escalation.decide', 'integrity.repair-tail', 'run.status']);
const deps = {
  cliAllowed: (who: string, cmd: string) =>
    who === 'owner' && cmd === 'task.claim' ? 'agent-only'
      : OWNER_ONLY.has(cmd) && who !== 'owner' ? `${cmd} is owner-only`
        : cmd === 'phase.start' && who !== 'qa-orchestrator' ? 'phase.start is run only by qa-orchestrator' : null,
};
const AGENT = 'qa-ui-specialist';
const bash = (command: string, agent: string | null = AGENT, cwd = ROOT): HookToolInput =>
  ({ tool_name: 'Bash', tool_input: { command }, cwd, ...(agent !== null ? { agent_type: agent, agent_id: 'a1' } : {}) });
const write = (file_path: string, agent: string | null = AGENT, content = 'x'): HookToolInput =>
  ({ tool_name: 'Write', tool_input: { file_path, content }, cwd: ROOT, ...(agent !== null ? { agent_type: agent, agent_id: 'a1' } : {}) });

// [label, spoof (as qa-ui-specialist), the same form with the caller's own identity and an agent command (null: no legitimate form)]
const SPOOFS: Array<[string, string, string | null]> = [
  ['npm run aegis', 'AEGIS_AGENT=owner npm run aegis -- gate decide --gate 1 --decision approved', `AEGIS_AGENT=${AGENT} npm run aegis -- task claim --task T-1`],
  ['yarn aegis', 'AEGIS_AGENT=owner yarn aegis gate decide --gate 1', `AEGIS_AGENT=${AGENT} yarn aegis task claim --task T-1`],
  ['timeout env', `timeout 60 env AEGIS_AGENT=owner pnpm aegis integrity repair-tail --run ${RUN}`, `timeout 60 env AEGIS_AGENT=${AGENT} pnpm aegis task claim --task T-1`],
  ['if/then', 'if true; then AEGIS_AGENT=owner pnpm aegis gate decide --gate 1; fi', `if true; then AEGIS_AGENT=${AGENT} pnpm aegis task claim --task T-1; fi`],
  // Fix round 2 R1: an earlier export is never trusted, so the export forms have no legitimate subagent form.
  ['export then pnpm', 'export AEGIS_AGENT=owner; pnpm aegis gate decide --gate 1', null],
  ['export then timeout pnpm', 'export AEGIS_AGENT=owner; timeout 9 pnpm aegis gate decide --gate 1', null],
  ['quoted export split', "export AEGIS_AGEN''T=owner; timeout 9 pnpm aegis gate decide --gate 1", null],
  ['env -i', 'env -i AEGIS_AGENT=owner pnpm aegis gate decide --gate 1', `env -i AEGIS_AGENT=${AGENT} pnpm aegis task claim --task T-1`],
  ['quoted value', "AEGIS_AGENT='owner' pnpm aegis gate decide --gate 1", `AEGIS_AGENT='${AGENT}' pnpm aegis task claim --task T-1`],
  ['env quoted', 'env "AEGIS_AGENT=owner" pnpm aegis gate decide --gate 1', `env "AEGIS_AGENT=${AGENT}" pnpm aegis task claim --task T-1`],
  // Fix round 2 R4: a preload on a CLI call is refused, so --require has no legitimate subagent form.
  ['node --require', 'AEGIS_AGENT=owner node --require ./x.js apps/cli/dist/index.js gate decide --gate 1', null],
  ['node doubled slash', 'AEGIS_AGENT=owner node apps/cli/dist//index.js gate decide --gate 1', `AEGIS_AGENT=${AGENT} node apps/cli/dist//index.js task claim --task T-1`],
  ['npx -p', 'AEGIS_AGENT=owner npx -p @aegis-qa/cli aegis gate decide --gate 1', `AEGIS_AGENT=${AGENT} npx -p @aegis-qa/cli aegis task claim --task T-1`],
  ['pnpm exec node', 'AEGIS_AGENT=owner pnpm exec node apps/cli/dist/index.js gate decide --gate 1', `AEGIS_AGENT=${AGENT} pnpm exec node apps/cli/dist/index.js task claim --task T-1`],
  ['brace group', '{ AEGIS_AGENT=owner pnpm aegis gate decide --gate 1; }', `{ AEGIS_AGENT=${AGENT} pnpm aegis task claim --task T-1; }`],
  ['bang', '! AEGIS_AGENT=owner pnpm aegis gate decide --gate 1', `! AEGIS_AGENT=${AGENT} pnpm aegis task claim --task T-1`],
  ['xargs', 'AEGIS_AGENT=owner xargs pnpm aegis gate decide --gate 1 < /dev/null', `AEGIS_AGENT=${AGENT} xargs pnpm aegis task claim --task T-1 < /dev/null`],
  ['bash -c --', "AEGIS_AGENT=owner bash -c -- 'pnpm aegis gate decide --gate 1'", `bash -c -- 'AEGIS_AGENT=${AGENT} pnpm aegis task claim --task T-1'`],
  ['herestring bash', "AEGIS_AGENT=owner bash <<< 'pnpm aegis gate decide --gate 1'", null],
  ['pipe into sh', "echo 'pnpm aegis gate decide --gate 1' | AEGIS_AGENT=owner sh", null],
  ['help value -h (C1)', 'AEGIS_AGENT=owner pnpm aegis gate decide --gate 1 --decision approved --note -h', `AEGIS_AGENT=${AGENT} pnpm aegis task claim --task T-1 --note -h`],
  ['help value --help (C1)', 'AEGIS_AGENT=owner pnpm aegis escalation decide --task T-1 --decision retry --reason --help', `AEGIS_AGENT=${AGENT} pnpm aegis task claim --task T-1 --reason --help`],
  ['sudo -E', 'AEGIS_AGENT=owner sudo -E pnpm aegis gate decide --gate 1', `AEGIS_AGENT=${AGENT} sudo -E pnpm aegis task claim --task T-1`],
  ['nice -n', 'AEGIS_AGENT=owner nice -n 5 pnpm aegis gate decide --gate 1', `AEGIS_AGENT=${AGENT} nice -n 5 pnpm aegis task claim --task T-1`],
  ['pnpm -w', 'AEGIS_AGENT=owner pnpm -w aegis gate decide --gate 1', `AEGIS_AGENT=${AGENT} pnpm -w aegis task claim --task T-1`],
  ['pnpm run', 'AEGIS_AGENT=owner pnpm run aegis gate decide --gate 1', `AEGIS_AGENT=${AGENT} pnpm run aegis task claim --task T-1`],
  ['bash -c', "bash -c 'AEGIS_AGENT=owner pnpm aegis gate decide --gate 1'", `bash -c 'AEGIS_AGENT=${AGENT} pnpm aegis task claim --task T-1'`],
  ['double assign', `AEGIS_AGENT=${AGENT} AEGIS_AGENT=owner pnpm aegis gate decide --gate 1`, `AEGIS_AGENT=${AGENT} AEGIS_AGENT=${AGENT} pnpm aegis task claim --task T-1`],
];

describe('C2: identity spoofing by a subagent, whatever the CLI form (the reviewer\'s 28 forms)', () => {
  it('lists all 28 forms', () => expect(SPOOFS).toHaveLength(28));

  it.each(SPOOFS)('%s: the spoof is denied', (_label, spoof) => {
    expect(decide(bash(spoof), ctx, deps).allow).toBe(false);
  });

  it.each(SPOOFS.filter((s): s is [string, string, string] => s[2] !== null))('%s: the same form with the caller\'s identity is allowed', (_label, _spoof, legit) => {
    expect(decide(bash(legit), ctx, deps)).toMatchObject({ allow: true });
  });

  it('the export, preload, shell-stdin and quote-split forms have no legitimate subagent form', () => {
    expect(SPOOFS.filter((s) => s[2] === null).map((s) => s[0])).toEqual(['export then pnpm', 'export then timeout pnpm', 'quoted export split', 'node --require', 'herestring bash', 'pipe into sh']);
  });

  it.each<[string, string, RegExp]>([
    ['a dynamic identity', 'AEGIS_AGENT=$WHO pnpm aegis task claim --task T-1', /AEGIS_AGENT/],
    ['an identity named in eval', "eval 'AEGIS_AGENT=owner pnpm aegis gate decide --gate 1'", /AEGIS_AGENT|eval/],
    ['eval naming the CLI', 'eval "pnpm aegis gate decide --gate 1"', /eval/],
    ['a heredoc into bash', 'bash <<EOF\npnpm aegis gate decide --gate 1\nEOF', /shell/],
    ['a pipe into bash -s', 'cat cmds.txt | bash -s', /shell/],
    ['an unassigned mention of the variable', 'unset AEGIS_AGENT; pnpm aegis gate decide --gate 1', /AEGIS_AGENT/],
  ])('%s is denied', (_label, command, reason) => {
    expect(decide(bash(command), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(reason) });
  });

  it('C1: the main thread cannot hide another identity behind a help value', () => {
    expect(decide(bash('AEGIS_AGENT=qa-orchestrator pnpm aegis phase start --phase scan --note -h', null), ctx, deps).allow).toBe(false);
    // Help with no identity at all is still free.
    expect(decide(bash('pnpm aegis gate decide --help', null), ctx, deps).allow).toBe(true);
    expect(decide(bash('pnpm aegis gate decide --help'), ctx, deps).allow).toBe(true);
  });
});

describe('R3 widened: a non-qa subagent is refused the aegis CLI wherever it points at the aegis root', () => {
  it.each<[string, string, string, boolean]>([
    ['npm run aegis inside', 'npm run aegis -- task list', ROOT, false],
    ['pushd into aegis', `pushd ${ROOT} && pnpm aegis align`, OUTSIDE, false],
    ['npm --prefix aegis', `AEGIS_AGENT=owner npm --prefix ${ROOT} run aegis -- gate decide --gate 1`, OUTSIDE, false],
    ['pnpm -C attached', `pnpm -C${ROOT} aegis align`, OUTSIDE, false],
    ['subshell cd', `(cd ${ROOT}; pnpm aegis align)`, OUTSIDE, false],
    ['bun run aegis inside', 'bun run aegis align', ROOT, false],
    ['xargs pnpm aegis inside', 'xargs pnpm aegis align < /dev/null', ROOT, false],
    // m8: a dynamic cd leaves the CLI location unknown, so it counts as inside aegis.
    ['dynamic cd (m8)', 'cd "$AEGIS" && pnpm aegis align', OUTSIDE, false],
    ['outside worktree, any identity', 'AEGIS_AGENT=owner pnpm aegis run status', OUTSIDE, true],
    ['outside worktree, grep for the variable', 'grep -rn AEGIS_AGENT packages/@qa', OUTSIDE, true],
  ])('%s', (_label, command, cwd, allow) => {
    expect(decide(bash(command, 'general-purpose', cwd), ctx, deps).allow).toBe(allow);
  });
});

describe('R2 and removal probes', () => {
  it.each<[string, string, string | null, string, boolean]>([
    ['main rm scratch under a run', `rm -rf runs/${RUN}/scratch`, null, ROOT, false],
    ['main rerun dir cleanup (qa-rerun-failed)', `rm -rf runs/${RUN}/rerun-1`, null, ROOT, true],
    ['main execution dir reset (qa-run-phase)', `rm -rf runs/${RUN}/execution`, null, ROOT, true],
    ['main lock dir removal (qa-health)', `rm -rf runs/${RUN}/events.jsonl.lock`, null, ROOT, true],
    ['main taskmaster lock (qa-health)', `rm -rf runs/${RUN}/taskmaster/tasks.json.lock`, null, ROOT, true],
    ['m1: main glob run?', 'rm -rf run?', null, ROOT, false],
    ['m1: main glob ./*', 'rm -rf ./*', null, ROOT, false],
    ['m1: main glob runs/*', 'rm -rf runs/*', null, ROOT, false],
    ['m1: main glob [r]uns', 'rm -rf [r]uns', null, ROOT, false],
    ['m1: main glob over a run\'s CLI-only files', `rm -f runs/${RUN}/ev*`, null, ROOT, false],
    ['m1: other glob aeg* above aegis', 'rm -rf aeg*', 'general-purpose', '/repo', false],
    ['m1: qa glob inside the sandbox is fine', 'rm -rf sandbox/2026-*', AGENT, ROOT, true],
    ['main sandbox cleanup', 'rm -rf sandbox/2026-10-02-x', null, ROOT, true],
    ['qa sandbox cleanup', 'rm -rf sandbox/2026-10-02-x', AGENT, ROOT, true],
    ['qa tmp cleanup', 'rm -rf /tmp/qa-x', AGENT, ROOT, true],
    ['m3: qa dynamic tmp RUN cleanup', 'rm -rf "$TMPDIR/RUN-old"', AGENT, ROOT, true],
    ['m3: dynamic text naming runs', 'rm -rf "$BASE/runs"', AGENT, ROOT, false],
    ['m3: dynamic text naming the aegis root', `rm -rf "${ROOT}/$X"`, AGENT, ROOT, false],
    ['other in an outside worktree removes its own runs', `rm -rf ${OUTSIDE}/runs/${RUN}`, 'general-purpose', OUTSIDE, true],
    ['other rm -rf /', 'rm -rf /', 'general-purpose', '/scratch', false],
    ['main rm .active', 'rm runs/.active', null, ROOT, false],
    ['main rm the reports dir above CLI-only files', `rm -rf runs/${RUN}/reports`, null, ROOT, false],
    ['unlink events.jsonl', `unlink runs/${RUN}/events.jsonl`, AGENT, ROOT, false],
    ['addendum 1: main unlink .active', 'unlink runs/.active', null, ROOT, false],
    ['git clean in aegis', 'git clean -fdx', null, ROOT, false],
    ['m8: removal after a dynamic cd', 'cd "$X" && rm -rf old', AGENT, ROOT, false],
    ['m8: main removal after a dynamic cd', 'cd "$X" && rm -rf old', null, ROOT, false],
    ['m8: git clean after a dynamic cd', 'cd "$X" && git clean -fd', null, ROOT, false],
    ['cp content into a case (brand-clean text)', `cp /tmp/x.md runs/${RUN}/cases/TC-AUTH-001.md`, 'qa-test-designer', ROOT, true],
  ])('%s', (_label, command, agent, cwd, allow) => {
    expect(decide(bash(command, agent, cwd), ctx, deps).allow).toBe(allow);
  });

  it('a claim followed by || true is still recorded', () => {
    expect(decide(bash(`AEGIS_AGENT=${AGENT} pnpm aegis task claim --task T-1 || true`), ctx, deps)).toEqual({ allow: true, claims: ['T-1'], warnings: [] });
  });
});

describe('I1: every brace expansion of a pattern target is checked', () => {
  it.each<[string, string, string | null, string, boolean]>([
    ['designer jumps from scenarios to gates', `rm -rf runs/${RUN}/scenarios/{x,../gates}`, 'qa-test-designer', ROOT, false],
    ['triple {x,..} tee into target source', 'echo pwn | tee tests/qa/specs/{x,..}/{y,..}/{z,..}/src/app.ts', AGENT, '/repo', false],
    ['.. hidden inside one brace alternative', 'touch tests/qa/specs/{a/../../../..,b}/src/app.ts', AGENT, '/repo', false],
    ['a harmless expansion inside the role', 'touch tests/qa/specs/{a,b}.spec.ts', AGENT, '/repo', true],
    ['overflow is denied for a subagent', 'touch sandbox/{1..300}', AGENT, ROOT, false],
    ['nested overflow is denied for a subagent', 'touch sandbox/{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}', AGENT, ROOT, false],
    ['main brace into runs is still a QA artefact', `touch runs/${RUN}/{plan,rtm}.json`, null, ROOT, false],
  ])('%s', (_label, command, agent, cwd, allow) => {
    expect(decide(bash(command, agent, cwd), ctx, deps).allow).toBe(allow);
  });
});

describe('I2: the role table itself refuses CLI-only files', () => {
  it('roleWritable denies a nested lock even where an evidence glob covers it', () => {
    expect(roleWritable(AGENT, `${RUN_DIR}/evidence/TC-x1/a/b.lock`, ctx)).toBe(false);
    expect(roleWritable(AGENT, `${RUN_DIR}/evidence/TC-x1/a/b.png`, ctx)).toBe(true);
  });
});

describe('minor items', () => {
  it('m2: a tests dir outside target/tests is a QA artefact for the main thread', () => {
    const e2e: GuardContext = { ...ctx, testsDir: '/repo/e2e/qa' };
    expect(decide(write('/repo/e2e/qa/specs/a.spec.ts', null), e2e, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/main thread never writes QA artefacts/) });
    expect(decide(write('/repo/e2e/qa/specs/a.spec.ts', 'general-purpose'), e2e, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/QA artefacts/) });
  });

  it('m6: an active run whose run.json is unreadable denies every qa-* write, not its CLI calls', () => {
    const broken: GuardContext = { ...ctx, environment: null, currentPhase: null, envPolicy: undefined, runStateUnreadable: true };
    expect(decide(write('/repo/tests/qa/specs/a.spec.ts'), broken, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/run\.json/) });
    expect(decide(write('/tmp/x'), broken, deps).allow).toBe(false);
    expect(decide(bash(`AEGIS_AGENT=${AGENT} pnpm aegis task list`), broken, deps).allow).toBe(true);
    expect(decide(write(`${ROOT}/packages/@qa/x/src/a.ts`, null), broken, deps).allow).toBe(true);
  });

  it.each<[string, string]>([
    ['packages/@qa under a temp worktree', '/private/tmp/wt/p0b2/packages/@qa/path-guard/src/guard.ts'],
    ['.claude under temp', '/tmp/wt/.claude/settings.json'],
    ['.claude in the sandbox', `${ROOT}/sandbox/x/.claude/agents/a.md`],
  ])('m9: a qa-* write to %s is denied', (_label, file) => {
    expect(decide(write(file), ctx, deps)).toMatchObject({ allow: false, reason: expect.stringMatching(/never modify the framework/) });
  });
});

describe('addendum: git targets', () => {
  it.each<[string, string, string | null, string, boolean]>([
    // 1: git rm / git mv are removals for R2
    ['main git rm -r of a run', `git rm -r runs/${RUN}`, null, ROOT, false],
    ['main git rm -r runs', 'git rm -r runs', null, ROOT, false],
    ['main git mv runs', 'git mv runs old-runs', null, ROOT, false],
    ['qa git rm in the sandbox', 'git rm -q sandbox/x/a.ts', AGENT, ROOT, true],
    // 2: a directory target counts for the whole subtree
    ['main git checkout -- . at the target root (holds target source)', 'git checkout -- .', null, '/repo', false],
    ['main git restore of target source', 'git restore src', null, '/repo', false],
    ['main git checkout -- of a target source file', 'git checkout -- src/app.ts', null, '/repo', false],
    ['main dynamic git checkout . in target source', 'git checkout .', null, '/repo/src', false],
    ['qa git checkout -- . in the aegis root (framework)', 'git checkout -- .', AGENT, ROOT, false],
    ['qa git stash in the aegis root (framework)', 'git stash', AGENT, ROOT, false],
    ['main git checkout -- . in the aegis root (framework dev; no removal)', 'git checkout -- .', null, ROOT, true],
    ['main git restore . inside runs', 'git restore .', null, RUN_DIR, false],
    ['main git reset --hard in the aegis root (R2: holds runs)', 'git reset --hard', null, ROOT, false],
    ['qa git checkout -- . in its sandbox', 'git checkout -- .', AGENT, `${ROOT}/sandbox/x`, true],
    ['other git checkout . in aegis', 'git checkout .', 'general-purpose', `${ROOT}/HANDBOOK`, false],
    ['other git checkout -- . at the target root', 'git checkout -- .', 'general-purpose', '/repo', false],
    ['other git checkout -- . in an outside worktree', 'git checkout -- .', 'general-purpose', OUTSIDE, true],
  ])('%s', (_label, command, agent, cwd, allow) => {
    expect(decide(bash(command, agent, cwd), ctx, deps).allow).toBe(allow);
  });
});
