import { extractContract, frontmatterLite, loadModel, parseSections } from '@qa/alignment';
import * as fs from 'fs';
import * as path from 'path';
import { contractBlock, makeRepo } from './helpers';

const okAgent = { contract: 1, phase: 'design', dispatchedBy: [], dispatch: { none: 'test only' }, reviewedBy: { none: 'test only' } };

describe('extractContract', () => {
  it('finds one block and its yaml start line', () => {
    const src = `---\nname: a\n---\n# A\n${contractBlock({ contract: 1 })}`;
    const r = extractContract(src);
    expect(r).toMatchObject({ yaml: 'contract: 1\n' });
    expect(typeof r === 'object' && r.line).toBe(9);
  });
  it('reports missing, duplicate and no-fence', () => {
    expect(extractContract('# A\n')).toBe('missing');
    expect(extractContract(`# A${contractBlock({ contract: 1 })}${contractBlock({ contract: 1 })}`)).toBe('duplicate');
    expect(extractContract('# A\n## Contract (machine-checked)\n\nno fence\n')).toBe('no-fence');
  });
});

it('a leading legend comment inside the fence is ignored by the contract parse', () => {
  const legend = '# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.';
  const body = `# qa-a\n\n## Contract (machine-checked)\n\n\`\`\`yaml\n${legend}\ncontract: 1\nphase: design\ndispatch: {none: test only}\nreviewedBy: {none: test only}\n\`\`\`\n`;
  const t = makeRepo({ agents: { 'qa-a': { body, contract: null } } });
  const m = loadModel(t.root);
  expect(m.loadErrors).toEqual([]);
  expect(m.units.get('qa-a')?.contract).toMatchObject({ phase: 'design' });
  t.cleanup();
});

describe('parseSections / frontmatterLite', () => {
  it('splits on ## headings with 1-based start lines', () => {
    const s = parseSections('# T\n## Inputs\n- a\n## Process\n1. b\n');
    expect(s.map((x) => [x.heading, x.startLine])).toEqual([['Inputs', 2], ['Process', 4]]);
  });
  it('reads name and inline tools', () => {
    expect(frontmatterLite('---\nname: qa-x\ntools: [Read, Bash]\n---\n')).toEqual({ name: 'qa-x', tools: ['Read', 'Bash'] });
  });
});

describe('loadModel', () => {
  it('loads agents, skills, pipeline, config and matrix ids', () => {
    const t = makeRepo({
      agents: { 'qa-a': { contract: okAgent } },
      skills: { 'qa-s': { contract: { contract: 1, kind: 'query' } }, '_qa-internal': { name: 'qa-internal', contract: { contract: 1, kind: 'internal' } } },
      matrix: ['AUD-001', 'CO-02'],
    });
    const m = loadModel(t.root);
    expect([...m.units.keys()].sort()).toEqual(['_qa-internal', 'qa-a', 'qa-s']);
    expect(m.skillAliases.has('qa-internal')).toBe(true);
    expect(m.pipeline?.phases[0]?.id).toBe('design');
    expect(m.matrixIds).toEqual(new Set(['AUD-001', 'CO-02']));
    expect(m.declaredEvents.has('run.created')).toBe(true);
    expect(m.loadErrors).toEqual([]);
    t.cleanup();
  });
  it('records CONTRACT violations instead of throwing', () => {
    const t = makeRepo({
      agents: {
        'qa-missing': { contract: null },
        'qa-invalid': { contract: { contract: 1, phase: 'design' } },
      },
      pipeline: null,
    });
    const errs = loadModel(t.root).loadErrors;
    const first = errs.find((v) => v.key === 'CONTRACT:qa-missing:-:missing');
    expect([first?.detail, first?.reason]).toEqual(['-', 'missing']);
    const keys = errs.map((v) => v.key).sort();
    expect(keys).toEqual(['CONTRACT:pipeline:-:missing', 'CONTRACT:qa-invalid:-:invalid', 'CONTRACT:qa-missing:-:missing']);
    t.cleanup();
  });
  it('reports invalid yaml', () => {
    const t = makeRepo({ agents: { 'qa-y': { contract: null, body: '# Y\n## Contract (machine-checked)\n\n```yaml\nfoo: [\n```\n' } } });
    expect(loadModel(t.root).loadErrors.map((v) => v.key)).toContain('CONTRACT:qa-y:-:invalid-yaml');
    t.cleanup();
  });
  it('keeps the first unit and reports duplicate names', () => {
    const t = makeRepo({
      agents: {
        'qa-dup': { contract: okAgent },
        'qa-other': { dir: 'tier2', contract: okAgent, body: '# x\n' },
      },
      skills: { 'qa-x': { contract: { contract: 1, kind: 'query' } } },
    });
    fs.writeFileSync(path.join(t.root, '.claude/agents/tier2/copy.md'), '---\nname: qa-dup\n---\n# dup\n');
    fs.writeFileSync(path.join(t.root, '.claude/agents/tier2/qa-x.md'), '---\nname: qa-x\n---\n# x\n');
    const m = loadModel(t.root);
    const keys = m.loadErrors.map((v) => v.key).filter((k) => k.endsWith('duplicate-name')).sort();
    expect(keys).toEqual(['CONTRACT:qa-dup:-:duplicate-name', 'CONTRACT:qa-x:-:duplicate-name']);
    expect([...m.units.keys()].filter((k) => k === 'qa-dup')).toHaveLength(1);
    t.cleanup();
  });
  it('reports unreadable files without throwing', () => {
    const t = makeRepo({ agents: { 'qa-ok': { contract: okAgent } } });
    fs.symlinkSync('/nonexistent/nowhere', path.join(t.root, '.claude/agents/tier1-phase/qa-broken.md'));
    const m = loadModel(t.root);
    expect(m.loadErrors.map((v) => v.key)).toContain('CONTRACT:qa-broken:-:unreadable');
    expect(m.units.has('qa-ok')).toBe(true);
    t.cleanup();
  });
});
