import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'yaml';
import { SPECIALISTS } from '@qa/contracts';
import { ROLES, envVerdict, isEnvSafe, matchGlob, roleOf, roleWritable } from '@qa/path-guard';
import { SPV_NONE, isSpecialist, pairedSpv } from '@qa/run-state';

const REPO = path.join(__dirname, '..');
// Retired to agent-graveyard/ by P2 (owner decision 2026-10-02): no role row, so H1 denies their writes until P2 deletes them.
const RETIRING = new Set([
  'qa-cicd-planner', 'qa-cicd-implementer', 'qa-cicd-evaluator', 'qa-cicd-spv', 'qa-github-planner', 'qa-github-implementer', 'qa-github-spv',
  'qa-knowledge-librarian', 'qa-event-bus', 'qa-ui-designer', 'qa-ui-designer-spv',
]);

function agentFiles(): Map<string, string> {
  const out = new Map<string, string>();
  const dir = path.join(REPO, '.claude', 'agents');
  for (const tier of fs.readdirSync(dir)) {
    for (const f of fs.readdirSync(path.join(dir, tier)).filter((x) => x.endsWith('.md'))) {
      const file = path.join(dir, tier, f);
      const name = /^name:\s*(\S+)/m.exec(fs.readFileSync(file, 'utf-8'))?.[1];
      if (name !== undefined) out.set(name, file);
    }
  }
  return out;
}

function contractWrites(file: string): string[] {
  const m = /## Contract \(machine-checked\)\s*```yaml\n([\s\S]*?)```/.exec(fs.readFileSync(file, 'utf-8'));
  if (m === null) throw new Error(`no machine-checked contract block in ${file}`);
  const c = parse(m[1]!) as { writes?: Array<string | { path: string }> };
  return (c.writes ?? []).map((w) => (typeof w === 'string' ? w : w.path));
}

function expandBraces(p: string): string[] {
  const m = /\{([^{}]*,[^{}]*)\}/.exec(p);
  if (m === null) return [p];
  return m[1]!.split(',').flatMap((alt) => expandBraces(p.slice(0, m.index) + alt + p.slice(m.index + m[0].length)));
}

/** A concrete sample of a contract path in role-glob tokens: {tests}/qa → {testsDir}, ID placeholders → x1, globs → x1[/x2]. */
function sample(p: string): string {
  return p
    .replace(/^\{tests\}\/qa\//, '{testsDir}/')
    .replace(/\{TC-ID\}/g, 'TC-x1')
    .replace(/\{DEF-ID\}/g, 'DEF-x1')
    .replace(/\{(?!run\}|testsDir\}|target\})[^{}/]+\}/g, 'x1')
    .replace(/\*\*/g, 'x1/x2')
    .replace(/\*/g, 'x1');
}

describe('role table (spec §4.2: one declarative table)', () => {
  it('every agent file has exactly one row, except the agents P2 retires; every row has an agent file', () => {
    const files = agentFiles();
    const rows = ROLES.map((r) => r.agent);
    expect(new Set(rows).size).toBe(rows.length);
    expect([...files.keys()].filter((a) => !RETIRING.has(a) && roleOf(a) === undefined)).toEqual([]);
    expect(rows.filter((a) => !files.has(a))).toEqual([]);
    expect(rows.filter((a) => RETIRING.has(a))).toEqual([]);
  });

  it('specialist rows are exactly the routed specialists, with their mutates flag', () => {
    const specialists = ROLES.filter((r) => r.kind === 'specialist').map((r) => r.agent).sort();
    expect(specialists).toEqual(Object.values(SPECIALISTS).map((s) => s.agent).sort());
    for (const r of ROLES) expect(r.kind === 'specialist').toBe(isSpecialist(r.agent));
    for (const s of Object.values(SPECIALISTS)) expect(roleOf(s.agent)!.mutatesEnvIn).toEqual(s.mutates ? 'any' : []);
  });

  it('every reviewed row names an SPV row, every SPV row reviews someone, and pairedSpv follows the table', () => {
    for (const r of ROLES.filter((x) => x.spv !== null)) {
      expect(roleOf(r.spv!)?.kind).toBe('spv');
      expect(pairedSpv(r.agent)).toBe(r.spv);
    }
    for (const s of ROLES.filter((x) => x.kind === 'spv')) {
      expect(s.writes).toEqual([]);
      expect(ROLES.some((w) => w.spv === s.agent)).toBe(true);
    }
  });

  it('every contract write of an agent lies inside its role globs', () => {
    const misses: string[] = [];
    for (const [agent, file] of agentFiles()) {
      if (RETIRING.has(agent)) continue;
      const globs = roleOf(agent)!.writes;
      for (const w of contractWrites(file)) {
        for (const s of expandBraces(w).map(sample)) if (!globs.some((g) => matchGlob(g, s))) misses.push(`${agent}: ${w}`);
      }
    }
    expect(misses).toEqual([]);
  });
});

describe('role table, further invariants', () => {
  it('rows without an SPV are exactly SPV_NONE (minus the retiring qa-cicd-evaluator)', () => {
    const none = ROLES.filter((r) => r.kind !== 'spv' && r.spv === null).map((r) => r.agent).sort();
    expect(none).toEqual([...SPV_NONE].filter((a) => a !== 'qa-cicd-evaluator').sort());
  });

  it('contractWrites fails loudly when a contract block is missing', () => {
    const f = path.join(os.tmpdir(), `no-contract-${process.pid}.md`);
    fs.writeFileSync(f, '# agent without a contract\n');
    try {
      expect(() => contractWrites(f)).toThrow(/no machine-checked contract/);
    } finally {
      fs.rmSync(f, { force: true });
    }
  });

  it('no role glob covers a CLI-only path, at any depth', () => {
    const paths = { aegisRoot: '/r/aegis', targetRoot: '/r', testsDir: '/r/tests/qa', runDir: '/r/aegis/runs/RUN-20261002-001' };
    const RUN = paths.runDir;
    const cliOnly = [
      `${RUN}/events.jsonl`, `${RUN}/run.json`, `${RUN}/gates/x`, `${RUN}/reports/work/x`, `${RUN}/reports/review/x`,
      `${RUN}/taskmaster/x`, `${RUN}/intake/x`, `${RUN}/hooks/x`, `${RUN}/integrity/x`, '/r/aegis/runs/.active',
    ];
    const lock = `${RUN}/evidence/TC-x1/a/b.lock`;
    const covered: string[] = [];
    for (const r of ROLES) for (const p of cliOnly) if (roleWritable(r.agent, p, paths)) covered.push(`${r.agent}: ${p}`);
    expect(covered).toEqual([]);
    // Known gap: evidence trees take any file name. Task 8's CLI-only-first rule (c) must deny *.lock at any depth.
    const lockWriters = ROLES.filter((r) => roleWritable(r.agent, lock, paths)).map((r) => r.agent);
    expect(lockWriters.length).toBeGreaterThan(0);
  });
});

describe('glob matching and path resolution', () => {
  const paths = { aegisRoot: '/r/aegis', targetRoot: '/r', testsDir: '/r/tests/qa', runDir: '/r/aegis/runs/RUN-20261002-001' };

  it('* stays inside one segment, ** spans segments', () => {
    expect(matchGlob('/a/*-result.json', '/a/TC-1-result.json')).toBe(true);
    expect(matchGlob('/a/*-result.json', '/a/b/TC-1-result.json')).toBe(false);
    expect(matchGlob('/a/**', '/a/b/c.json')).toBe(true);
    expect(matchGlob('/a/**', '/a')).toBe(true);
    expect(matchGlob('/a/plan.*', '/a/plan.json')).toBe(true);
    expect(matchGlob('/a/plan.*', '/a/planx.json')).toBe(false);
  });

  it('{run} resolves to the active run only, and to nothing without one (AUD-026)', () => {
    expect(roleWritable('qa-test-planner', '/r/aegis/runs/RUN-20261002-001/plan.json', paths)).toBe(true);
    expect(roleWritable('qa-test-planner', '/r/aegis/runs/RUN-20261002-002/plan.json', paths)).toBe(false);
    expect(roleWritable('qa-test-planner', '/r/aegis/runs/RUN-20261002-001/plan.json', { ...paths, runDir: null })).toBe(false);
    expect(roleWritable('qa-ui-specialist', '/r/tests/qa/specs/login/login.spec.ts', paths)).toBe(true);
    expect(roleWritable('qa-environment-engineer', '/r/playwright.config.ts', paths)).toBe(true);
    expect(roleWritable('qa-ui-specialist', '/r/playwright.config.ts', paths)).toBe(false);
    expect(roleWritable('qa-made-up', '/r/aegis/sandbox/x', paths)).toBe(false);
  });

  it('refuses relative, non-normalised and dot-dot paths before any glob (I1)', () => {
    const RUN = paths.runDir;
    expect(roleWritable('qa-test-executor', `${RUN}/evidence/TC-x1/a.png`, paths)).toBe(true);
    expect(roleWritable('qa-test-executor', `${RUN}/evidence/TC-x1/../../run.json`, paths)).toBe(false);
    expect(roleWritable('qa-test-executor', `${RUN}/evidence/../run.json`, paths)).toBe(false);
    expect(roleWritable('qa-ui-specialist', '/r/tests/qa/specs/../../src/app.ts', paths)).toBe(false);
    expect(roleWritable('qa-ui-specialist', 'tests/qa/specs/login.spec.ts', paths)).toBe(false);
    expect(roleWritable('qa-ui-specialist', '/r/tests/qa//specs/login.spec.ts', paths)).toBe(false);
    expect(roleWritable('qa-ui-specialist', '/r/tests/qa/specs/./login.spec.ts', paths)).toBe(false);
  });

  it('excludes beat writes, and evidence trees are per kind (I2)', () => {
    const RUN = paths.runDir;
    expect(roleWritable('qa-test-designer', `${RUN}/cases/TC-AUTH-001.json`, paths)).toBe(true);
    expect(roleWritable('qa-test-designer', `${RUN}/cases/TC-AUTH-001-result.json`, paths)).toBe(false);
    expect(roleWritable('qa-ui-specialist', `${RUN}/cases/TC-AUTH-001-result.json`, paths)).toBe(true);
    expect(roleWritable('qa-ui-specialist', `${RUN}/evidence/DEF-1-AUTH-UI/x.png`, paths)).toBe(false);
    expect(roleWritable('qa-ui-specialist', `${RUN}/evidence/run.json`, paths)).toBe(false);
    expect(roleWritable('qa-defect-manager', `${RUN}/evidence/DEF-1-AUTH-UI/x.png`, paths)).toBe(true);
    expect(roleWritable('qa-defect-manager', `${RUN}/evidence/TC-x1/x.png`, paths)).toBe(false);
    expect(roleWritable('qa-exploratory-specialist', `${RUN}/evidence/exploratory/S1/n.png`, paths)).toBe(true);
    expect(roleWritable('qa-web-explorer', `${RUN}/evidence/discovery/p.png`, paths)).toBe(true);
  });

  it('shared spec trees are filename-scoped (m4)', () => {
    expect(roleWritable('qa-accessibility-specialist', '/r/tests/qa/specs/login/a11y.spec.ts', paths)).toBe(true);
    expect(roleWritable('qa-accessibility-specialist', '/r/tests/qa/specs/login/login.spec.ts', paths)).toBe(false);
    expect(roleWritable('qa-feature-flag-specialist', '/r/tests/qa/specs/login/flags.spec.ts', paths)).toBe(true);
    expect(roleWritable('qa-feature-flag-specialist', '/r/tests/qa/specs/login/a11y.spec.ts', paths)).toBe(false);
    expect(roleWritable('qa-responsive-specialist', '/r/tests/qa/specs/login/responsive.spec.ts', paths)).toBe(true);
    expect(roleWritable('qa-realtime-specialist', '/r/tests/qa/api/chat.realtime.test.ts', paths)).toBe(true);
    expect(roleWritable('qa-realtime-specialist', '/r/tests/qa/api/users.test.ts', paths)).toBe(false);
  });
});

describe('envVerdict', () => {
  const config = JSON.parse(fs.readFileSync(path.join(REPO, 'aegis.config.json'), 'utf-8')) as { environments: Record<string, object> };

  it('agrees with assertEnvSafe for every specialist in every configured environment', () => {
    for (const env of Object.keys(config.environments)) {
      for (const { agent, mutates } of Object.values(SPECIALISTS)) {
        expect(`${env}/${agent}: ${envVerdict(agent, 'execution', env, config.environments[env]).allowed}`)
          .toBe(`${env}/${agent}: ${isEnvSafe(env, { mutates, specialist: agent }, REPO)}`);
      }
    }
  });

  it('blocks the environment engineer only in env-data on a read-only environment', () => {
    const readOnly = { readOnly: true, mutating: false };
    expect(envVerdict('qa-environment-engineer', 'env-data', 'production', readOnly)).toMatchObject({ allowed: false, reason: expect.stringMatching(/read-only/) });
    expect(envVerdict('qa-environment-engineer', 'env-auth', 'production', readOnly)).toEqual({ allowed: true });
    expect(envVerdict('qa-environment-engineer', 'env-data', 'staging', { mutating: true })).toEqual({ allowed: true });
    expect(envVerdict('qa-test-planner', 'planning', 'production', readOnly)).toEqual({ allowed: true });
  });

  it('an unknown phase counts as mutating for a role that mutates somewhere (m3)', () => {
    const readOnly = { readOnly: true };
    expect(envVerdict('qa-environment-engineer', null, 'production', readOnly)).toMatchObject({ allowed: false });
    expect(envVerdict('qa-test-planner', null, 'production', readOnly)).toEqual({ allowed: true });
  });

  it('an unknown qa-*-specialist is treated as mutating (m6)', () => {
    expect(envVerdict('qa-made-up-specialist', 'execution', 'production', { readOnly: true })).toMatchObject({ allowed: false });
    expect(envVerdict('qa-made-up-specialist', 'execution', 'staging', { mutating: true })).toEqual({ allowed: true });
  });
});
