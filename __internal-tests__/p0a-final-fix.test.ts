import { AegisEventSchema, DefectCandidateSchema, EnvAuthReportSchema } from '@qa/contracts';
import { spawnSync } from 'child_process';
import { copyIntake, PHASE_OUTPUT_SETS, SPV_NONE } from '@qa/run-state';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'yaml';
import { CANDIDATE, ENV_AUTH_REPORT } from './helpers/p0a2-fixtures';

// P0a final fix wave: the prose facts of the final whole-branch review (I1-I5, M1-M9) pinned against the schemas,
// barriers and CLI behaviour they describe.

const TS = '2026-10-01T08:00:00.000Z';
const AGENTS = path.join(__dirname, '..', '.claude', 'agents');
const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) => schema.safeParse(v).success;
const prose = (rel: string) => fs.readFileSync(path.join(AGENTS, rel), 'utf8');

interface Read { path: string; optional?: boolean }
/** The agent's `## Contract (machine-checked)` YAML block. */
function contract(rel: string): { reads: Array<string | Read> } {
  const m = /## Contract \(machine-checked\)\n+```yaml\n([\s\S]*?)```/.exec(prose(rel));
  if (m === null) throw new Error(`${rel} has no contract block`);
  return parse(m[1]!) as { reads: Array<string | Read> };
}
const read = (rel: string, p: string): Read | undefined =>
  contract(rel).reads.map((r) => (typeof r === 'string' ? { path: r } : r)).find((r) => r.path === p);

const EXECUTOR = 'tier1-phase/qa-test-executor.md';
const ENV_ENGINEER = 'tier1-phase/qa-environment-engineer.md';

describe('I1: the executor on a read-only environment (no env-setup report)', () => {
  it('reads env-setup-report.json as optional and env-auth-report.json as its fallback', () => {
    expect(read(EXECUTOR, '{run}/env-setup-report.json')).toEqual({ path: '{run}/env-setup-report.json', optional: true });
    expect(read(EXECUTOR, '{run}/env-auth-report.json')).toEqual({ path: '{run}/env-auth-report.json' });
  });

  it('names the field the reports carry (health), not status', () => {
    const text = prose(EXECUTOR);
    expect(text).toContain('`env-setup-report.json#health`');
    expect(text).toContain('`env-auth-report.json#health`');
    expect(text).not.toMatch(/If status is FAILED/);
    expect(ok(EnvAuthReportSchema, ENV_AUTH_REPORT)).toBe(true);
    expect(ok(EnvAuthReportSchema, { ...ENV_AUTH_REPORT, health: undefined })).toBe(false);
  });
});

describe('M1: env.ready carries rolesToTest, browserProjects and factoriesCreated on both scopes', () => {
  const auth = { type: 'env.ready', ts: TS, rolesToTest: ['admin'], browserProjects: ['qa-e2e'] };
  it('accepts scope=auth with factoriesCreated 0 and refuses it without the field', () => {
    expect(ok(AegisEventSchema, { ...auth, factoriesCreated: 0 })).toBe(true);
    expect(ok(AegisEventSchema, auth)).toBe(false);
  });
  it('the prose names all three fields for both scopes', () => {
    expect(prose(ENV_ENGINEER)).toMatch(/`env\.ready`.*both scopes send exactly rolesToTest, browserProjects and factoriesCreated \(0 for scope=auth\)/);
  });
});

describe('I2: the orchestrator SPV exempts the SPV-less agents the barrier exempts', () => {
  it('check 3 cites SPV_NONE instead of a hard-coded list', () => {
    const check3 = prose('spv/qa-orchestrator-spv.md').split('\n').find((l) => l.startsWith('3. **SPV coverage.**'))!;
    expect(check3).toContain('`SPV_NONE` (`@qa/run-state`)');
    expect(check3).toMatch(/released work report is enough/);
  });
  it("the orchestrator's SPV-less row names only SPV_NONE agents", () => {
    const row = prose('orchestrator/qa-orchestrator.md').split('\n').find((l) => l.includes('none yet — the barrier'))!;
    expect(row).toContain('`SPV_NONE` in `@qa/run-state`');
    const names = [...row.matchAll(/`(qa-[a-z0-9*-]+)`/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      const re = new RegExp(`^${n.replace('*', '.+')}$`);
      expect([...SPV_NONE].some((a) => re.test(a))).toBe(true);
    }
  });
});

describe('I3: a BLOCKed requirement is planned out of scope and resolved at G1', () => {
  it('the planner always writes the plan and names the reopen option the CLI offers', () => {
    const text = prose('tier1-phase/qa-test-planner.md');
    expect(text).toMatch(/A BLOCK never stops the plan/);
    expect(text).toContain('`--reopen-phase requirements`');
    expect(text).toMatch(/Never release `done` without a plan/);
    expect(text).not.toMatch(/do not produce a plan/);
    // The option exists on `aegis gate decide` (behaviour pinned in run-state-gates.test.ts: G1 rejected → requirements).
    const gate = fs.readFileSync(path.join(__dirname, '..', 'apps', 'cli', 'src', 'commands', 'gate.ts'), 'utf8');
    expect(gate).toContain('.option("--reopen-phase <id>"');
  });
  it('planning.blocked still validates with the BLOCKed requirement ids', () => {
    expect(ok(AegisEventSchema, { type: 'planning.blocked', ts: TS, reason: 'REQ-AUTH-04 planned out of scope', blockingRequirementIds: ['REQ-AUTH-04'] })).toBe(true);
  });
  it('the orchestrator lists the BLOCKed requirements at G1', () => {
    expect(prose('orchestrator/qa-orchestrator.md')).toMatch(/one entry per BLOCKed requirement the planner listed out of scope/);
    expect(prose('spv/qa-orchestrator-spv.md')).toMatch(/every BLOCKed requirement the planner listed out of scope/);
  });
});

describe('M3, M4: orchestrator re-dispatch rules', () => {
  const text = prose('orchestrator/qa-orchestrator.md');
  it('Explore exception: a cap-reached exploratory task is re-dispatched under the same id', () => {
    const line = text.split('\n').find((l) => l.includes('**Explore exception.**'))!;
    expect(line).toMatch(/refused with `cap-reached`.*re-dispatch it for the same task id/);
  });
  it('continue-phase re-dispatches in-progress assignees', () => {
    const line = text.split('\n').find((l) => l.includes('`continue-phase` →'))!;
    expect(line).toMatch(/re-dispatch every assignee whose task is still `in-progress`/);
  });
});

describe('I4: a developer-covered TC has an execution path', () => {
  const RUNNERS = ['tier2-specialist/qa-unit-specialist.md', 'tier2-specialist/qa-api-specialist.md', 'tier2-specialist/qa-ui-specialist.md'];
  it('the executor routes it to one specialist, unit when the developer test is a unit test', () => {
    const para = prose(EXECUTOR).split('\n').find((l) => l.includes('**Developer-covered TCs.** A TC with `coveredBy`'))!;
    expect(para).toMatch(/exactly one specialist for it and no technique overlay/);
    expect(para).toMatch(/qa-unit-specialist when that test's `kind` .* is `unit`, otherwise the TC's primary `testType` specialist/);
    expect(read(EXECUTOR, '{run}/dev-test-review.json')).toEqual({ path: '{run}/dev-test-review.json', optional: true });
  });
  it('unit, api and ui carry the same one-sentence run rule: read-only, no script, result cites the ref', () => {
    const sentences = RUNNERS.map((f) => prose(f).split('\n').find((l) => /^\d+\. \*\*Developer-covered TCs\.\*\*/.test(l))!.replace(/^\d+\. /, ''));
    expect(new Set(sentences).size).toBe(1);
    expect(sentences[0]).toMatch(/read-only with the target's own test command/);
    expect(sentences[0]).toMatch(/never edit, copy or re-implement that test, and write no QA script/);
    expect(sentences[0]).toMatch(/`runs\/\{runId\}\/cases\/\{TC-ID\}-result\.json` with the `coveredBy` ref as its evidence/);
  });
  it('the executor SPV and the unit SPV check it', () => {
    expect(prose('spv/qa-test-executor-spv.md')).toMatch(/10\. \*\*Developer-covered TCs\.\*\*.*no QA script was written.*cites the `coveredBy` ref/);
    expect(prose('spv/qa-unit-specialist-spv.md')).toMatch(/9\. \*\*Developer-covered TCs\.\*\*.*no QA script was written.*cites the `coveredBy` ref/);
  });
  it('A4: the designer exempts a developer-covered TC from the 13-criteria check', () => {
    expect(prose('tier1-phase/qa-test-designer.md')).toMatch(/developer-covered TC \(`coveredBy` set, `automationStatus: Automated`\) is exempt from this check/);
  });
});

describe('M7: the unit specialist reads the developer-test review only when it exists', () => {
  it('marks the read optional like its peers', () => {
    expect(read('tier2-specialist/qa-unit-specialist.md', '{run}/dev-test-review.json')).toEqual({ path: '{run}/dev-test-review.json', optional: true });
  });
});

describe('I5: the intake readers use the layout copyIntake produces', () => {
  it('copyIntake keeps target-relative paths: docs/prd.md lands at intake/docs/prd.md', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'p0a-intake-'));
    try {
      const target = path.join(base, 'target');
      const root = path.join(target, 'aegis');
      fs.mkdirSync(path.join(target, 'docs'), { recursive: true });
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(target, 'docs', 'prd.md'), '# PRD\n');
      const intake = path.join(root, 'runs', 'RUN-X', 'intake');
      expect(copyIntake(root, '..', ['docs/**/*.md'], intake)).toEqual(['docs/prd.md']);
      expect(fs.existsSync(path.join(intake, 'docs', 'prd.md'))).toBe(true);
      expect(fs.existsSync(path.join(intake, 'requirements'))).toBe(false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
  it.each(['tier1-phase/qa-requirements-analyst.md', 'spv/qa-requirements-analyst-spv.md', 'tier2-specialist/qa-web-explorer.md'])(
    '%s reads {run}/intake/** and no fixed intake sub-layout',
    (rel) => {
      expect(read(rel, '{run}/intake/**')).toEqual({ path: '{run}/intake/**' });
      expect(prose(rel)).not.toMatch(/intake\/requirements|intake\/prd\.md/);
    },
  );
});

describe('A5, M2: the shared defect-candidate field text matches DefectCandidateSchema and the Explore barrier', () => {
  const PRODUCERS = ['tier2-specialist/qa-web-explorer.md', 'tier2-specialist/qa-exploratory-specialist.md', 'tier2-specialist/qa-responsive-specialist.md'];
  const SHARED = /`source` \(your agent name\), `taskId`.*?the Explore barrier refuses any other name\)/;
  const texts = PRODUCERS.map((f) => SHARED.exec(prose(f))?.[0]);
  it('all three producers carry the same text', () => {
    expect(texts.every((t) => t !== undefined)).toBe(true);
    expect(new Set(texts).size).toBe(1);
  });
  it('states the file-name rule the barrier enforces', () => {
    const set = PHASE_OUTPUT_SETS.explore!.find((s) => s.dir === 'defect-candidates')!;
    expect(texts[0]).toContain('`' + set.file.source + '`');
    expect(set.file.test('web-explorer-broken-logo.json')).toBe(true);
    for (const bad of ['Broken.json', 'a_b.json', 'a.b.json', '-a.json']) expect(set.file.test(bad)).toBe(false);
  });
  it('states the field rules the schema enforces', () => {
    const t = texts[0]!;
    expect(t).toMatch(/`proposedType` \(`UI`, `A11Y` or `EXP`\)/);
    expect(t).toMatch(/`observed` and `expected` \(each at least 10 characters\)/);
    expect(t).toMatch(/`severityHint` \(`Sev1` to `Sev5`\)/);
    expect(t).toMatch(/`TaskRefSchema`/);
    expect(t).toMatch(/at least one `\{step, action\}`, `step` a positive integer/);
    expect(t).toMatch(/no other key is allowed \(the object is strict\)/);
    expect(ok(DefectCandidateSchema, CANDIDATE)).toBe(true);
    for (const bad of [
      { proposedType: 'SEC' }, { observed: 'too short' }, { expected: 'too short' }, { severityHint: 'Sev6' }, { taskId: 'explore-1' },
      { reproductionSteps: [] }, { reproductionSteps: [{ step: 0, action: 'open' }] }, { reproductionSteps: [{ step: 1.5, action: 'open' }] }, { extra: 1 },
    ]) expect(ok(DefectCandidateSchema, { ...CANDIDATE, ...bad })).toBe(false);
  });
});

describe('M6, A3: the dev-test sandbox copy keeps no dotenv file, secret or QA file', () => {
  const REVIEWER = 'tier1-phase/qa-dev-test-reviewer.md';
  it('shows the multi-segment repo-dir derivation (../.. -> QA/aegis)', () => {
    expect(prose(REVIEWER)).toMatch(/with `\.\.\/\.\.`, the last two directory names of the repo's path, such as `QA\/aegis`/);
  });
  it('SPV check 6 verifies the dotenv excludes', () => {
    expect(prose('spv/qa-dev-test-reviewer-spv.md')).toMatch(/6\. \*\*Read-only target, clean copy\.\*\*.*`--exclude \.env --exclude '\.env\.\*'`/);
  });
  const hasRsync = spawnSync('rsync', ['--version']).status === 0;
  (hasRsync ? it : it.skip)("the prose's rsync command, run as written, copies only what it should", () => {
    const cmd = /`(rsync -a [^`]+)`/.exec(prose(REVIEWER))![1]!;
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'p0a-rsync-'));
    try {
      const target = path.join(base, 't');
      const files = ['.env', '.env.local', '.env.example', 'src/a.ts', 'src/sub/.env', 'src/sub/.env.test', 'QA/aegis/secrets/.env.staging', 'QA/aegis/runs/x.json',
        'tests/qa/a.spec.ts', 'tests/unit.test.ts', '.git/HEAD', 'node_modules/x/i.js', 'node_modules/.cache/c'];
      for (const f of files) { fs.mkdirSync(path.dirname(path.join(target, f)), { recursive: true }); fs.writeFileSync(path.join(target, f), 'x'); }
      const out = path.join(base, 'out');
      const run = cmd.replace('/<repo dir>/', '/QA/aegis/').replace('/<QA tests dir>/', '/tests/qa/').replace('<target>/', `${target}/`)
        .replace('sandbox/{date}-dev-test-review/target/', `${out}/`);
      expect(spawnSync('sh', ['-c', run]).status).toBe(0);
      const copied = (fs.readdirSync(out, { recursive: true }) as string[]).filter((f) => fs.statSync(path.join(out, f)).isFile()).sort();
      expect(copied).toEqual(['.env.example', 'node_modules/x/i.js', 'src/a.ts', 'tests/unit.test.ts']);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('M9: a defect never carries the candidate file or an agent name in evidenceRef', () => {
  it('the defect manager uses a neutral reference and its SPV checks it', () => {
    expect(prose('tier1-phase/qa-defect-manager.md')).toMatch(/`evidenceRef` in its `originConfirmation`: for a defect opened from a candidate it is a neutral reference.*never the candidate's file path/);
    expect(prose('spv/qa-defect-manager-spv.md')).toMatch(/`evidenceRef` names the candidate's file, its path or an agent name .* = requested-changes/);
  });
});

describe('A1, A2, A6: parked prose', () => {
  it('A1: production forbids writes to the target, not run-side writes', () => {
    expect(prose('tier2-specialist/qa-api-specialist.md')).toMatch(/or any write to the target — only read-only smoke/);
    expect(prose('tier2-specialist/qa-ui-specialist.md')).toMatch(/or any write to the target — only read-only smoke/);
    expect(prose('spv/qa-ui-specialist-spv.md')).toMatch(/18\. \*\*Production is read-only smoke\.\*\*.*no write to the target/);
  });
  it('A2: /qa-regenerate-report offers only the reports it writes', () => {
    const skill = fs.readFileSync(path.join(__dirname, '..', '.claude', 'skills', 'qa-regenerate-report', 'SKILL.md'), 'utf8');
    expect(skill).not.toMatch(/token-usage,|`token-usage`|CLI owns the work reports, the reviews and the metrics/);
    expect(skill).toMatch(/qa-metrics-collector owns the metrics files/);
  });
  it('A6: the curator runs before run completion; CMMI and curator skip escalation decisions', () => {
    expect(prose('crosscutting/qa-curator.md')).not.toMatch(/after `run\.completed` is emitted/);
    for (const f of ['crosscutting/qa-curator.md', 'compliance/qa-compliance-cmmi.md']) expect(prose(f)).toMatch(/skip the owner's `\*\.escalation\.json` decision files/);
  });
});
