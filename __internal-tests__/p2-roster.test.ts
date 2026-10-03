import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { AegisEventSchema } from '@qa/contracts';
import { SPV_NONE } from '@qa/run-state';

// P2a — roster and review coverage (docs/superpowers/specs/2026-10-02-p2-roster-design.md §7).
const ROOT = path.join(__dirname, '..');

/** Git-tracked files that exist in the working tree. */
function tracked(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' })
    .split('\0')
    .filter((f) => f !== '' && fs.existsSync(path.join(ROOT, f)));
}
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
/** The alignment checker's DOC-REF scope (packages/@qa/alignment/src/load.ts). */
const inDocScope = (f: string): boolean =>
  f.startsWith('HANDBOOK/') || ['HANDBOOK.md', 'CLAUDE.md', 'README.md'].includes(f) || /^docs\/[^/]+\.md$/.test(f);

describe('Lite profile docs (AUD-053, docs half)', () => {
  it('no doc in the DOC-REF scope describes a Lite mode or profile', () => {
    expect(tracked().filter(inDocScope).filter((f) => /\blite\b/i.test(read(f)))).toEqual([]);
  });
});

/** `name` as a whole agent name, not part of a longer one (qa-ui-designer vs qa-ui-designer-spv). */
const names = (text: string, name: string): boolean => new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(text);

const DEVOPS = ['qa-github-planner', 'qa-github-implementer', 'qa-cicd-planner', 'qa-cicd-implementer', 'qa-cicd-evaluator', 'qa-cicd-spv', 'qa-github-spv'];

describe('DevOps docs (AUD-046)', () => {
  it('no doc in the DOC-REF scope names a DevOps agent', () => {
    const hits = tracked().filter(inDocScope).flatMap((f) => DEVOPS.filter((n) => names(read(f), n)).map((n) => `${f}: ${n}`));
    expect(hits).toEqual([]);
  });

  it('the D11 DevOps docs are gone and no Markdown file links them', () => {
    const files = tracked();
    expect(files.filter((f) => f.startsWith('docs/D11-'))).toEqual([]);
    const linking = files.filter(
      (f) => f.endsWith('.md') && !/^(docs\/superpowers|knowledge|plan-validation|agent-graveyard)\//.test(f) && /D11-[a-z-]+\.md/.test(read(f)),
    );
    expect(linking).toEqual([]);
  });
});

// Retired by owner decision 2026-10-02 (spec §4.1); each retirement task appends its agents.
const RETIRED: Array<{ name: string; aud: string }> = [
  ...DEVOPS.map((name) => ({ name, aud: 'AUD-046' })),
  { name: 'qa-knowledge-librarian', aud: 'AUD-047' },
  { name: 'qa-event-bus', aud: 'AUD-048' },
  { name: 'qa-ui-designer', aud: 'AUD-050' },
  { name: 'qa-ui-designer-spv', aud: 'AUD-050' },
];

/** Frontmatter names of every agent file under .claude/agents/. */
function agentNames(): string[] {
  const dir = path.join(ROOT, '.claude', 'agents');
  return fs.readdirSync(dir).flatMap((tier) =>
    fs
      .readdirSync(path.join(dir, tier))
      .filter((f) => f.endsWith('.md') && f !== 'README.md')
      .map((f) => /^name:\s*(\S+)/m.exec(fs.readFileSync(path.join(dir, tier, f), 'utf-8'))?.[1] ?? f),
  );
}

describe('retired agents (spec §4.1)', () => {
  it.each(RETIRED)('$name lives only in agent-graveyard/, with retiredAt and reason', ({ name, aud }) => {
    expect(agentNames()).not.toContain(name);
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(read(`agent-graveyard/${name}.md`))![1]!;
    expect(fm).toMatch(new RegExp(`^name: ${name}$`, 'm'));
    expect(fm).toMatch(/^retiredAt: 2026-10-02$/m);
    expect(fm).toMatch(new RegExp(`^reason: "${aud}, owner decision 2026-10-02: .+"$`, 'm'));
  });

  it('no doc in the DOC-REF scope and no .claude/** file names a retired agent', () => {
    const hits = tracked()
      .filter((f) => inDocScope(f) || f.startsWith('.claude/'))
      .flatMap((f) => RETIRED.filter(({ name }) => names(read(f), name)).map(({ name }) => `${f}: ${name}`));
    expect(hits).toEqual([]);
  });

  it('model-policy.yaml assigns exactly the agent files', () => {
    const policy = parse(read('.claude/model-policy.yaml')) as { assignments: Record<string, string[]> };
    expect(Object.values(policy.assignments).flat().sort()).toEqual(agentNames().sort());
  });

  it('aegis.config.json has no github block and no environment secretsRef (spec §4.2.2)', () => {
    const config = JSON.parse(read('aegis.config.json')) as { github?: unknown; environments: Record<string, Record<string, unknown>> };
    expect(config.github).toBeUndefined();
    expect(Object.entries(config.environments).filter(([, e]) => 'secretsRef' in e).map(([env]) => env)).toEqual([]);
  });

  it('historical devops.* events still parse (T8)', () => {
    expect(AegisEventSchema.safeParse({ type: 'devops.flake-detected', ts: '2026-06-28T08:00:00.000Z', testRef: 'TC-AUTH-031', flakeRate: 0.2 }).success).toBe(true);
  });
});

describe('review coverage (spec §4.6.4)', () => {
  it('SPV_NONE holds only agents with a task and a stated reason', () => {
    expect([...SPV_NONE].sort()).toEqual(['qa-context-scanner', 'qa-curator']);
  });
});

describe('roster counts (spec §4.7)', () => {
  it('the CLAUDE.md tier table counts equal the agent directories, and the DevOps tier is gone', () => {
    const dir = path.join(ROOT, '.claude', 'agents');
    const count = (tier: string): number => fs.readdirSync(path.join(dir, tier)).filter((f) => f.endsWith('.md') && f !== 'README.md').length;
    const TIERS: Array<[string, string]> = [
      ['0 — Orchestrator', 'orchestrator'], ['1 — Phase managers', 'tier1-phase'], ['2 — Specialists', 'tier2-specialist'],
      ['3 — SPVs', 'spv'], ['Compliance', 'compliance'], ['Cross-cutting', 'crosscutting'],
    ];
    const rows = read('CLAUDE.md').split('\n').filter((l) => l.startsWith('| ')).map((l) => l.split('|').map((c) => c.trim()));
    expect(TIERS.map(([tier]) => `${tier}=${rows.find((c) => c[1] === tier)?.[2]}`)).toEqual(TIERS.map(([tier, d]) => `${tier}=${count(d)}`));
    expect(rows.filter((c) => /DevOps/.test(c[1] ?? ''))).toEqual([]);
    const devops = path.join(dir, 'tier2-5-devops');
    expect(fs.existsSync(devops) ? fs.readdirSync(devops) : []).toEqual([]);
  });
});

describe('compliance review docs (AUD-052)', () => {
  it('docs name the one shared compliance reviewer and no per-regulation compliance SPV', () => {
    const hits = tracked().filter(inDocScope).filter((f) => /qa-compliance-(iso25010|iso5055|istqb|cmmi|gdpr|pdpa)-spv/.test(read(f)));
    expect(hits).toEqual([]);
    expect(read('HANDBOOK/08-compliance.md')).toContain('`qa-compliance-spv`');
  });

  it('no file outside plans and specs names SHARED_SPV except the test that asserts its absence', () => {
    const hits = tracked().filter((f) => !f.startsWith('docs/superpowers/') && !f.startsWith('.superpowers/') && /\.(md|ts|yaml|json)$/.test(f) && f !== '__internal-tests__/p2-roster.test.ts' && f !== '__internal-tests__/run-state-core.test.ts')
      .filter((f) => /SHARED_SPV/.test(read(f)));
    expect(hits).toEqual([]);
  });
});
