import * as fs from 'fs';
import * as path from 'path';
import { BRAND_CLEAN_RUN_GLOBS, CLI_ONLY_RUN_GLOBS } from '@qa/path-guard';

// P0b-2 final fix wave: the prose rulings, pinned so they do not drift from the code.
const REPO = path.join(__dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf-8');
const claude = read('CLAUDE.md');

describe('M1: CLAUDE.md describes what the CLI and the hooks write', () => {
  const tree = /### Run output structure\s*```\n([\s\S]*?)```/.exec(claude)?.[1] ?? '';
  it('the run tree names every CLI-owned place and the hook ledger, and no stale locks/ dir', () => {
    for (const entry of ['events.jsonl', 'run.json', 'reports/work/', 'reports/review/', 'reports/.locks/', 'gates/', 'taskmaster/', 'intake/', 'hooks/agents.jsonl', 'integrity/']) {
      expect([entry, tree.includes(entry)]).toEqual([entry, true]);
    }
    expect(tree).not.toMatch(/^\s*locks\//m);
    // Every CLI-only glob's top-level place is in the tree.
    for (const g of CLI_ONLY_RUN_GLOBS.filter((x) => !x.startsWith('**'))) expect([g, tree.includes(g.replace(/\*\*$/, ''))]).toEqual([g, true]);
  });

  it('the brand list is exactly the hook-enforced customer-facing globs (guard.ts BRAND_CLEAN_RUN_GLOBS)', () => {
    const section = /## Brand exposure rule([\s\S]*?)\n---/.exec(claude)?.[1] ?? '';
    const listed = [...section.matchAll(/^- `runs\/\*\/([^`]+)`$/gm)].map((m) => m[1]!).sort();
    expect(listed).toEqual([...BRAND_CLEAN_RUN_GLOBS].sort());
  });
});

describe('A14 and the tracked runs/ files: CLAUDE.md names the exceptions the hook applies', () => {
  it('names the configured collector and the two tracked runs/ files', () => {
    expect(claude).toMatch(/collector repo named by `aegis\.config\.json#collector\.path`/);
    expect(claude).toMatch(/`runs\/README\.md` and `runs\/\.gitkeep`/);
  });
});

describe('A17: the build fix is spelled the same everywhere', () => {
  it('CLAUDE.md and D02 say pnpm build (or pnpm install without --ignore-scripts), the pin, and re-building after a pull', () => {
    expect(claude).toMatch(/run `pnpm build` \(or `pnpm install` without `--ignore-scripts`\)/);
    expect(claude).toMatch(/pinned pnpm, package\.json#packageManager; re-run pnpm build after every pull/);
    const d02 = read('docs/D02-teammate-onboarding.md');
    expect(d02).toMatch(/run `pnpm build` \(or `pnpm install` without `--ignore-scripts`/);
    expect(d02).toMatch(/pinned pnpm/);
    expect(d02).toMatch(/re-run `pnpm build` after pulling/);
  });
});

describe('I1: the matrix states what H1 does not stop', () => {
  it('AUD-022 is partial, with package-manager writes carried to P5', () => {
    const row = read('docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md').split('\n').find((l) => l.startsWith('| AUD-022 |'))!;
    expect(row).toMatch(/\| partial — /);
    expect(row).toMatch(/package-manager writes → P5/);
  });
  it('HANDBOOK/13 documents the package-manager rule', () => {
    expect(read('HANDBOOK/13-mechanics.md')).toMatch(/A `qa-\*` agent never changes dependencies in this repo or the target/);
  });
});

describe('A9: the qa-setup and qa-teardown projects never write the target default test-results/', () => {
  const agent = read('.claude/agents/tier1-phase/qa-environment-engineer.md');
  const spv = read('.claude/agents/spv/qa-environment-engineer-spv.md');
  it('the agent gives both projects testDir, testMatch and the canonical outputDir', () => {
    expect(agent).toContain("{ name: 'qa-setup', testDir: 'tests/qa', testMatch: '**/global-setup.ts', teardown: 'qa-teardown', outputDir }");
    expect(agent).toContain("{ name: 'qa-teardown', testDir: 'tests/qa', testMatch: '**/global-teardown.ts', outputDir }");
    expect(agent).toMatch(/All three `qa-\*` projects set `testDir` and `outputDir` themselves/);
  });
  it('SPV check 9 covers all three qa-* projects', () => {
    expect(spv).toMatch(/9\. \*\*Playwright `outputDir`, on all three `qa-\*` projects\.\*\* Each of `qa-e2e`, `qa-setup` and `qa-teardown`/);
  });
});

describe('A1 and A8: the event-log docs and the orphan run directory', () => {
  it('names appendChained (called by the CLI and writeArtifact) wherever the append protocol is described', () => {
    expect(read('HANDBOOK/13-mechanics.md')).toMatch(/called by the aegis CLI and `@qa\/reporters\.writeArtifact`/);
    expect(read('docs/D13-event-bus-spec.md')).toMatch(/called by the aegis CLI and `@qa\/reporters\.writeArtifact`/);
    const d13 = read('docs/D13-concurrency-and-locking.md');
    expect(d13).toMatch(/appendChained\(event, busPath, \{ emittedBy, runId \}\)/);
    expect(d13).not.toMatch(/@qa\/event-bus\.append\(/);
    expect(read('HANDBOOK/14-extending.md')).toMatch(/writeArtifact\(\{[^)]*chain: \{ emittedBy, runId \}/);
    expect(read('docs/D14-extending-the-system.md')).toMatch(/chain: \{ emittedBy: 'qa-closure-reporter', runId \}/);
    expect(read('sandbox/.gitignore')).toMatch(/removed by its agent at task end/);
    expect(read('sandbox/.gitignore')).not.toMatch(/Auto-pruned/);
  });
  it('HANDBOOK/13 says an orphan RUN-* directory without run.json is inert and safe to delete', () => {
    expect(read('HANDBOOK/13-mechanics.md')).toMatch(/\*\*Orphan run directory\.\*\*[^\n]*no `run\.json`: it is inert[^\n]*safe to delete/);
  });
});
