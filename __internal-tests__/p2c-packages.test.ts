import { execFileSync } from 'child_process';
import { parse } from 'yaml';
import * as fs from 'fs';
import * as path from 'path';
import { loadBaseline, loadModel, unusedConfigRule } from '@qa/alignment';

// P2c — package fates (docs/superpowers/specs/2026-10-02-p2-roster-design.md §4.11, §7 P2c).
const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');

/** Git-tracked files that exist in the working tree. */
function tracked(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' })
    .split('\0')
    .filter((f) => f !== '' && fs.existsSync(path.join(ROOT, f)));
}
/** Program records, the ingested corpus and retired agents keep history; nothing else may name a deleted package. */
const HISTORY = /^(docs\/superpowers|knowledge|plan-validation|agent-graveyard)\//;

// Deleted packages (AUD-054). sandbox-manager went in P0b-2; email-adapters joins after the P2b rebase.
const DELETED = ['artifact-policy', 'auth-fixtures', 'dashboard-ui', 'deps-updater', 'multi-app', 'sandbox-manager', 'secrets', 'target-scanner', 'web-explorer'];
const named = new RegExp(`@qa/(?:${DELETED.join('|')})(?![\\w-])`);

describe('deleted packages (AUD-054)', () => {
  it('no tracked file is left under their directories', () => {
    expect(tracked().filter((f) => DELETED.some((p) => f.startsWith(`packages/@qa/${p}/`)))).toEqual([]);
  });

  it('no tracked file outside the history folders names one (sources, manifests, pnpm-lock.yaml, docs, secrets/README.md)', () => {
    // Internal tests may name a deleted package to assert that it is gone (legacy-writers.test.ts).
    const scanned = (f: string) => !HISTORY.test(f) && !/^__internal-tests__\/.*\.test\.ts$/.test(f) && /\.(ts|tsx|js|mjs|cjs|json|ya?ml|md)$/.test(f);
    expect(tracked().filter((f) => scanned(f) && named.test(read(f)))).toEqual([]);
  });

  it('the multi-app doc is gone and nothing links it; its CI job names leave nonAgentNames (single-target rule)', () => {
    const files = tracked();
    expect(files).not.toContain('docs/D12-monorepo-multi-app.md');
    expect(files.filter((f) => /\.(md|ya?ml)$/.test(f) && !HISTORY.test(f) && read(f).includes('D12-monorepo-multi-app'))).toEqual([]);
    const pipeline = parse(read('.claude/pipeline.yaml')) as { nonAgentNames: string[] };
    expect(pipeline.nonAgentNames.filter((n) => ['qa-api', 'qa-web', 'qa-admin'].includes(n))).toEqual([]);
    expect(read('docs/D05-commands-reference.md')).not.toMatch(/Multi-app cycle/);
  });

  it('the CLAUDE.md package list names only packages that exist', () => {
    const section = read('CLAUDE.md').split('### Key packages under `packages/@qa/`')[1]!.split('\n### ')[0]!;
    const listed = [...section.matchAll(/^- \*\*([a-z0-9-]+)\*\*/gm)].map((m) => m[1]!);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.filter((p) => !fs.existsSync(path.join(ROOT, 'packages', '@qa', p, 'package.json')))).toEqual([]);
  });

  it('agents no longer cite the secrets resolver ("secrets refs")', () => {
    for (const f of ['.claude/agents/tier1-phase/qa-environment-engineer.md', '.claude/agents/tier2-specialist/qa-api-specialist.md']) expect(read(f)).not.toMatch(/secrets refs/);
  });
});

describe('dead config keys (spec §4.11.2)', () => {
  it('aegis.config.json drops the keys only deleted packages read', () => {
    const cfg = JSON.parse(read('aegis.config.json'));
    expect(cfg.artifacts).not.toHaveProperty('videoQuality');
    expect(cfg.artifacts).not.toHaveProperty('screenshotOnEveryStep');
    expect(cfg.discovery).not.toHaveProperty('captureScreenshots');
    expect(cfg.target).not.toHaveProperty('apps');
    expect(read('scripts/reset-target.sh')).not.toMatch(/\.target\.apps\s*=/);
  });

  it('no aegis.config.json key is unused except the baselined ones', () => {
    const baselined = new Set(loadBaseline(ROOT).entries.map((e) => e.key));
    expect(unusedConfigRule(loadModel(ROOT)).map((v) => v.key).filter((k) => !baselined.has(k))).toEqual([]);
  });
});
