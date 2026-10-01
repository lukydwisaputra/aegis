import { AegisEventSchema, EnvAuthReportSchema } from '@qa/contracts';
import { SPV_NONE } from '@qa/run-state';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { ENV_AUTH_REPORT } from './helpers/p0a2-fixtures';

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
