import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { SPECIALISTS } from '@qa/contracts';
import { ROLES, envVerdict, isEnvSafe, matchGlob, roleOf, roleWritable } from '@qa/path-guard';
import { isSpecialist, pairedSpv } from '@qa/run-state';

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
  if (m === null) return [];
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
});
