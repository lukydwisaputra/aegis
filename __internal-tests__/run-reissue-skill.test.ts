import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { extractContract } from '@qa/alignment';

const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const contractOf = (md: string): Record<string, unknown> => {
  const c = extractContract(md);
  if (typeof c === 'string') throw new Error(c);
  return parse(c.yaml) as Record<string, unknown>;
};

describe('/qa-reissue skill', () => {
  const skill = read('.claude/skills/qa-reissue/SKILL.md');

  it('is an execution skill that runs the owner commands and dispatches only the orchestrator', () => {
    expect(skill).toMatch(/^---\nname: qa-reissue\n/);
    expect(contractOf(skill)).toMatchObject({
      kind: 'execution',
      dispatchedBy: [],
      cli: ['run.status', 'run.reissue'],
      dispatches: ['qa-orchestrator'],
      emits: [{ event: 'run.reissued', via: 'cli:run.reissue' }],
    });
  });

  it('names the commands the contract lists and tells the owner what a reissue does and what it overwrites', () => {
    expect(skill).toContain('`AEGIS_AGENT=owner pnpm aegis run status`');
    expect(skill).toContain('`AEGIS_AGENT=owner pnpm aegis run reissue --phase <id> --reason "<reason>"`');
    expect(skill).toContain('Only a completed run can be reissued');
    expect(skill).toContain('active run');
    expect(skill).toMatch(/overwrite[^\n]*copy/i);
  });

  it('the orchestrator is dispatched by it and says how a reissued phase is run', () => {
    const orch = read('.claude/agents/orchestrator/qa-orchestrator.md');
    expect((contractOf(orch) as { dispatchedBy: string[] }).dispatchedBy).toContain('qa-reissue');
    expect(orch).toContain('/qa-reissue');
    expect(orch).toContain('a second `run.completed`');
  });

  it('the docs name the command', () => {
    expect(read('HANDBOOK/13-mechanics.md')).toContain('## 13.10 Reissuing the executive phase (`/qa-reissue`)');
    expect(read('HANDBOOK/13-mechanics.md')).toContain('## 13.11 → Deep dives');
    expect(read('HANDBOOK/05-commands.md')).toContain('#### `/qa-reissue`');
    expect(read('CLAUDE.md')).toContain('/qa-reissue --phase=executive');
  });
});
