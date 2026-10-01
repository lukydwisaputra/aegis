import { AegisEventSchema, EnvAuthReportSchema } from '@qa/contracts';
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
