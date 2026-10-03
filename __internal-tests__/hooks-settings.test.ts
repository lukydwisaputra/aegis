import * as fs from 'fs';
import * as path from 'path';

const REPO = path.join(__dirname, '..');
const settings = JSON.parse(fs.readFileSync(path.join(REPO, '.claude', 'settings.json'), 'utf-8')) as {
  hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }> }>>;
};

function script(event: string): string {
  const entry = settings.hooks[event];
  expect(entry).toHaveLength(1);
  const command = entry![0]!.hooks[0]!.command;
  const m = /"\$CLAUDE_PROJECT_DIR\/(scripts\/hooks\/[a-z-]+\.mjs)"/.exec(command);
  expect(m).not.toBeNull();
  expect(fs.existsSync(path.join(REPO, m![1]!))).toBe(true);
  return m![1]!;
}

it('the PostToolUse territory hook is gone (AUD-019)', () => {
  expect(settings.hooks['PostToolUse']).toBeUndefined();
  expect(JSON.stringify(settings)).not.toMatch(/CLAUDE_TOOL_INPUT_FILE_PATH|CLAUDE_AGENT_NAME/);
});

it('H1 guards every write tool, Bash and dispatches (spec §4.2)', () => {
  expect(script('PreToolUse')).toBe('scripts/hooks/guard-writes.mjs');
  const matcher = settings.hooks['PreToolUse']![0]!.matcher!.split('|').sort();
  expect(matcher).toEqual(['Agent', 'Bash', 'Edit', 'MultiEdit', 'NotebookEdit', 'Task', 'Write']);
});

it('H2 runs on SubagentStop', () => {
  expect(script('SubagentStop')).toBe('scripts/hooks/require-work-report.mjs');
});

it('every pipeline.yaml#hookEmits hook is a script in scripts/hooks/', () => {
  const { parse } = require('yaml') as typeof import('yaml');
  const pipeline = parse(fs.readFileSync(path.join(REPO, '.claude', 'pipeline.yaml'), 'utf-8')) as { hookEmits?: Array<{ hook: string; event: string }> };
  expect(pipeline.hookEmits).toEqual([{ hook: 'require-work-report', event: 'token.used' }]);
  for (const h of pipeline.hookEmits!) expect(fs.existsSync(path.join(REPO, 'scripts', 'hooks', `${h.hook}.mjs`))).toBe(true);
});
