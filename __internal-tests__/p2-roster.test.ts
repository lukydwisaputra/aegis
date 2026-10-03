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
    expect(fm.match(/^retiredAt: /gm)).toEqual(['retiredAt: ']);
    expect(fm.match(/^reason: /gm)).toEqual(['reason: ']);
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
    const hits = tracked().filter((f) => !/^docs\/superpowers\/(plans|specs)\//.test(f) && /\.(md|ts|yaml|json)$/.test(f) && f !== '__internal-tests__/p2-roster.test.ts' && f !== '__internal-tests__/run-state-core.test.ts')
      .filter((f) => /SHARED_SPV/.test(read(f)));
    expect(hits).toEqual([]);
  });

  it('the Compliance phase closes per reviewed task, and the shared reviewer has no score threshold (parked T12)', () => {
    const ch8 = read('HANDBOOK/08-compliance.md');
    expect(ch8).toMatch(/Dispatch is parallel, review is per task: the Compliance phase closes only after `qa-compliance-spv` has reviewed each compliance task/);
    expect(ch8).not.toMatch(/run \*\*in parallel\*\* with other phases/);
    expect(read('HANDBOOK/06-agents.md')).toMatch(/\| `qa-compliance-spv` \| [^|]+\| n\/a \(categorical verdict\) \|/);
    expect(read('HANDBOOK.md')).toMatch(/\| 6 \| [^\n]*the six compliance agents share `qa-compliance-spv`/);
    expect(read('HANDBOOK/14-extending.md')).toMatch(/3\. Add the agent to `qa-compliance-spv`[^\n]*`reads`[^\n]*`knowledge_refs`/);
  });

  it('compliance runs only in a full cycle\'s Compliance phase, for the configured regulations (final-review Minor 3)', () => {
    const CADENCE = 'during the Compliance phase of a full cycle, for the regulations listed in `aegis.config.json#compliance`';
    for (const f of ['HANDBOOK/01-what-is-this.md', 'HANDBOOK/06-agents.md', 'HANDBOOK.md']) expect(read(f)).toContain(CADENCE);
    const unconditional = tracked().filter(inDocScope).flatMap((f) =>
      read(f).split('\n').filter((l) => /compliance/i.test(l) && /\b(every|each) (full )?cycle\b/i.test(l) && /parallel/i.test(l)).map((l) => `${f}: ${l}`));
    expect(unconditional).toEqual([]);
  });

  it('PDPA is Singapore\'s law everywhere in the docs (parked T12, final-review Minor 1)', () => {
    expect(tracked().filter((f) => inDocScope(f) || f.startsWith('.claude/')).filter((f) => /thai/i.test(read(f)))).toEqual([]);
    expect(read('HANDBOOK/16-glossary.md')).toContain('**PDPA (Personal Data Protection Act 2012 — Singapore)**');
  });

  const COMPLIANCE = ['iso25010', 'iso5055', 'istqb', 'cmmi', 'gdpr', 'pdpa'];
  const spv = (): string => read('.claude/agents/spv/qa-compliance-spv.md');
  const section = (md: string, heading: string): string => new RegExp(`\\n## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(md)![1]!;

  it('every compliance gap cites the artefacts that show it, and the reviewer accepts an absence pointer (T11 I1)', () => {
    for (const id of COMPLIANCE) {
      expect(read(`.claude/agents/compliance/qa-compliance-${id}.md`)).toContain(
        '- Every gap cites the run artefacts that show it: TC, DEF or REQ ids, or the run-relative path of the file that shows the missing coverage (for a coverage gap, the file that shows the absence counts)',
      );
    }
    expect(section(spv(), 'Review Checklist')).toMatch(/4\. \*\*Evidence-backed gaps\.\*\*[^\n]*a pointer to the run artefact that shows the absence/);
  });

  it('the data-check item matches each worker\'s Process steps (T11 I2)', () => {
    expect(section(spv(), 'Review Checklist')).toContain(
      '7. **Data checks (GDPR, PDPA).** GDPR: synthetic-data and HAR-sanitisation checks (Process steps 4–5); PDPA: synthetic-data check (Process step 4).',
    );
  });

  it('the reviewer reads the six worker files and passes a real clause outside the catalogue with notes (T11 m1)', () => {
    const md = spv();
    const contract = parse(/```yaml\n([\s\S]*?)\n```/.exec(section(md, 'Contract \\(machine-checked\\)'))![1]!) as { reads: string[] };
    for (const id of COMPLIANCE) {
      const file = `.claude/agents/compliance/qa-compliance-${id}.md`;
      expect(section(md, 'Inputs')).toContain(`- \`${file}\``);
      expect(contract.reads).toContain(file);
    }
    expect(section(md, 'Review Checklist')).toMatch(/3\. \*\*Clause exists\.\*\*[^\n]*A real clause outside the catalogue = passed-with-notes[^\n]*A clause that does not exist = requested-changes/);
  });

  it('the shared reviewer\'s "Submitting Your Verdict" section is the common SPV text', () => {
    const other = read('.claude/agents/spv/qa-ui-specialist-spv.md');
    expect(section(spv(), 'Submitting Your Verdict')).toBe(section(other, 'Submitting Your Verdict').split('qa-ui-specialist-spv').join('qa-compliance-spv'));
  });
});

describe('final wave doc fixes (parked A)', () => {
  it('HANDBOOK/06 model column follows model-policy.yaml (T1 #4)', () => {
    const FAMILY: Record<string, string> = { planning: 'Opus', implementation: 'Sonnet', validation: 'Opus', 'read-only': 'Haiku' };
    const policy = parse(read('.claude/model-policy.yaml')) as { assignments: Record<string, string[]> };
    const tierOf = new Map(Object.entries(policy.assignments).flatMap(([tier, agents]) => agents.map((a) => [a, tier] as const)));
    const wrong = read('HANDBOOK/06-agents.md').split('\n').flatMap((l) => {
      const m = /^\| `(qa-[a-z0-9-]+)` \|(?: [^|]+ \|)? (Opus|Sonnet|Haiku) \|/.exec(l);
      const tier = m ? tierOf.get(m[1]!) : undefined;
      return m && tier && FAMILY[tier] !== m[2] ? [`${m[1]}: ${m[2]}, policy ${FAMILY[tier]}`] : [];
    });
    expect(wrong).toEqual([]);
  });

  it('HANDBOOK/06 links no missing doc (T1 #4)', () => {
    const missing = [...read('HANDBOOK/06-agents.md').matchAll(/docs\/[A-Za-z0-9-]+\.md/g)].map((m) => m[0]).filter((p) => !fs.existsSync(path.join(ROOT, p)));
    expect(missing).toEqual([]);
  });

  it('D13 marks the devops.* events retired, and D12 claims no lint step the skill does not run (T2 #3, T2 #4)', () => {
    expect(read('docs/D13-event-bus-spec.md')).toMatch(/### DevOps \(retired\)\n[^\n]*no agent emits these types/);
    const bootstrap = /## Bootstrapping via `\/qa-ci-bootstrap`\n([\s\S]*?)\n---/.exec(read('docs/D12-cicd-workflow.md'))![1]!;
    expect(bootstrap).not.toMatch(/actionlint|yamllint/);
    expect(read('.claude/skills/qa-ci-bootstrap/SKILL.md')).not.toMatch(/actionlint|yamllint/);
  });

  it('/qa-promote states it is the owner\'s review of the curator (T7 #1)', () => {
    const purpose = /## Purpose\n([^\n]+)/.exec(read('.claude/skills/qa-promote/SKILL.md'))![1]!;
    expect(purpose).toContain('This is the owner\'s review of the curator: no SPV reviews `qa-curator`.');
  });
});
