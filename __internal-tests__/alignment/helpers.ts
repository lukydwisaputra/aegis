import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stringify } from 'yaml';

export interface RepoSpec {
  agents?: Record<string, { dir?: string; tools?: string[]; body?: string; contract?: unknown | null }>;
  skills?: Record<string, { name?: string; body?: string; contract?: unknown | null }>;
  pipeline?: unknown | null;
  config?: Record<string, unknown>;
  thresholds?: string;
  matrix?: string[];
  docs?: Record<string, string>;
  files?: Record<string, string>;
  packages?: string[];
}

export function contractBlock(obj: unknown): string {
  return `\n## Contract (machine-checked)\n\n\`\`\`yaml\n${stringify(obj)}\`\`\`\n`;
}

export const MIN_PIPELINE = {
  pipeline: 1,
  phases: [{ id: 'design', agents: [] as string[] }],
  routing: { byType: {}, byTechnique: {}, designerEmits: { testType: [], testTechnique: [] } },
  sources: {},
};

export function makeRepo(spec: RepoSpec): { root: string; cleanup(): void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-align-'));
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  write('aegis.config.json', JSON.stringify(spec.config ?? { targetProjectRoot: '..', testsDir: '../tests', environments: {} }));
  write('thresholds.yaml', spec.thresholds ?? 'testing: {}\n');
  for (const [name, a] of Object.entries(spec.agents ?? {})) {
    const fm = `---\nname: ${name}\ndescription: test agent\nmodelTier: implementation\ntools: [${(a.tools ?? ['Read']).join(', ')}]\n---\n`;
    const body = a.body ?? `# ${name}\n\n## Your Role\n\nTest.\n`;
    write(`.claude/agents/${a.dir ?? 'tier1-phase'}/${name}.md`, fm + body + (a.contract === null || a.contract === undefined ? '' : contractBlock(a.contract)));
  }
  for (const [dir, s] of Object.entries(spec.skills ?? {})) {
    const fm = `---\nname: ${s.name ?? dir}\ndescription: test skill\n---\n`;
    const body = s.body ?? `# /${dir}\n\n## Purpose\n\nTest.\n`;
    write(`.claude/skills/${dir}/SKILL.md`, fm + body + (s.contract === null || s.contract === undefined ? '' : contractBlock(s.contract)));
  }
  if (spec.pipeline !== null) write('.claude/pipeline.yaml', stringify(spec.pipeline ?? MIN_PIPELINE));
  write('docs/superpowers/specs/2026-01-01-audit-remediation-matrix.md', (spec.matrix ?? ['AUD-001']).map((id) => `| ${id} | x | y | HIGH | open |`).join('\n') + '\n');
  for (const [rel, content] of Object.entries(spec.docs ?? {})) write(rel, content);
  for (const [rel, content] of Object.entries(spec.files ?? {})) write(rel, content);
  for (const pkg of spec.packages ?? []) write(`packages/@qa/${pkg}/package.json`, '{}');
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
