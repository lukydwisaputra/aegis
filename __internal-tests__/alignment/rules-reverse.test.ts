import { countRule, docNameRule, loadModel, unusedConfigRule } from '@qa/alignment';
import { MIN_PIPELINE, makeRepo } from './helpers';

const keys = (vs: { key: string }[]) => vs.map((v) => v.key).sort();
const none = { none: 'test only' };
const ag = (extra: object = {}) => ({ contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: none, ...extra });

it('AH-11: a top/second-level config key no contract lists and no package source reads is unused', () => {
  const t = makeRepo({
    config: { used: { a: 1 }, readByCode: 1, nested: { listed: 1, dead: 2 }, dead: true },
    agents: { 'qa-a': { contract: ag({ config: ['aegis.config.json#used.a', 'aegis.config.json#nested.listed'] }) } },
    files: { 'packages/@qa/x/src/index.ts': 'export const v = cfg.readByCode;\n', 'packages/@qa/alignment/src/self.ts': 'cfg.dead;\n' },
  });
  expect(keys(unusedConfigRule(loadModel(t.root)))).toEqual(['CONFIG:aegis.config.json:dead:unused', 'CONFIG:aegis.config.json:nested.dead:unused']);
  t.cleanup();
});

it('AH-11: @qa package and pnpm script names in docs must exist', () => {
  const t = makeRepo({
    packages: ['event-bus'],
    files: {
      'package.json': JSON.stringify({ scripts: { build: 'x', aegis: 'y' }, devDependencies: { tsx: '1' } }),
      'apps/dash/package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
    },
    docs: {
      'CLAUDE.md': ['Use `@qa/event-bus` and `@qa/ghost`.', '```bash', '# Build all (pnpm workspaces)', 'pnpm build', 'pnpm qa-health', 'pnpm install', '```', 'Run `pnpm dev`, `pnpm tsx x.ts` or `pnpm nope`.'].join('\n') + '\n',
    },
  });
  expect(keys(docNameRule(loadModel(t.root)))).toEqual([
    'DOC-REF:CLAUDE.md:@qa/ghost:unknown-package',
    'DOC-REF:CLAUDE.md:nope:unknown-script',
    'DOC-REF:CLAUDE.md:qa-health:unknown-script',
  ]);
  t.cleanup();
});

it('AH-11: "N agents" claims and tier-table counts match the agent files', () => {
  const t = makeRepo({
    agents: { 'qa-o': { dir: 'orchestrator', contract: null }, 'qa-p': { dir: 'tier1-phase', contract: null }, 'qa-p2': { dir: 'tier1-phase', contract: null } },
    docs: {
      'CLAUDE.md': ['Full profile (12 agents).', '| Tier | Count | Role |', '|---|---|---|', '| 0 — Orchestrator | 1 | x |', '| 1 — Phase managers | 3 | y |'].join('\n') + '\n',
      'HANDBOOK/06.md': 'All 3 agents run; the 4 agents cap is separate.\n',
    },
  });
  expect(keys(countRule(loadModel(t.root)))).toEqual(['DOC-REF:CLAUDE.md:12 agents:count-mismatch', 'DOC-REF:CLAUDE.md:tier1-phase=3:count-mismatch']);
  t.cleanup();
});

it('AH-11: a tier-table row with no agent directory (the retired DevOps tier) produces no key (T10)', () => {
  const t = makeRepo({
    agents: { 'qa-o': { dir: 'orchestrator', contract: null } },
    docs: { 'CLAUDE.md': ['| Tier | Count | Role |', '|---|---|---|', '| 0 — Orchestrator | 1 | x |', '| 2.5 — DevOps | 6 | GitHub, CI/CD |'].join('\n') + '\n' },
  });
  expect(keys(countRule(loadModel(t.root)))).toEqual([]);
  t.cleanup();
});

it('AH-11: with the lite profile deleted (AUD-053), a "lite" count is a total claim like any other', () => {
  const t = makeRepo({
    agents: { 'qa-o': { dir: 'orchestrator', contract: null } },
    docs: { 'HANDBOOK.md': 'Lite mode drops to 14 agents.\nFull has 12 agents; an elite team of 15 agents.\n' },
  });
  expect(keys(countRule(loadModel(t.root)))).toEqual(['DOC-REF:HANDBOOK.md:12 agents:count-mismatch', 'DOC-REF:HANDBOOK.md:14 agents:count-mismatch', 'DOC-REF:HANDBOOK.md:15 agents:count-mismatch']);
  t.cleanup();
});

it('AH-11: pipeline.externalScripts names are not unknown pnpm scripts', () => {
  const t = makeRepo({
    pipeline: { ...MIN_PIPELINE, externalScripts: ['husky'] },
    docs: { 'CLAUDE.md': 'Run `pnpm husky install` and `pnpm nope`.\n' },
  });
  expect(keys(docNameRule(loadModel(t.root)))).toEqual(['DOC-REF:CLAUDE.md:nope:unknown-script']);
  t.cleanup();
});
