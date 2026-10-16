import * as fs from 'fs';
import * as path from 'path';

// The browser tool of exploration and ad-hoc page inspection is `playwright-cli` (@playwright/cli) run through
// Bash. The subagents' tool allowlists carry no `mcp__playwright__*` tool, so no agent prose may depend on MCP.
const ROOT = path.join(__dirname, '..');
const AGENTS = path.join(ROOT, '.claude', 'agents');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function agentFiles(): string[] {
  const out: string[] = [];
  for (const dir of fs.readdirSync(AGENTS)) {
    const full = path.join(AGENTS, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const f of fs.readdirSync(full)) if (f.endsWith('.md')) out.push(path.join('.claude', 'agents', dir, f));
  }
  return out.sort();
}

function toolsOf(src: string): string[] {
  const m = /^tools:\s*\[(.*)\]\s*$/m.exec(src);
  return m ? (m[1] ?? "").split(',').map((t) => t.trim()).filter(Boolean) : [];
}

const DOCS = [
  'HANDBOOK/03-architecture.md',
  'HANDBOOK/04-stlc-walkthrough.md',
  'HANDBOOK/06-agents.md',
  'docs/D03-agent-workflow-diagram.md',
  'CLAUDE.md',
];

// The commands `playwright-cli --help` lists (@playwright/cli 0.1.22).
const REAL_COMMANDS = new Set([
  'open', 'attach', 'close', 'detach', 'goto', 'type', 'click', 'dblclick', 'fill', 'drag', 'drop', 'hover', 'select',
  'upload', 'check', 'uncheck', 'snapshot', 'find', 'eval', 'dialog-accept', 'dialog-dismiss', 'resize', 'delete-data',
  'go-back', 'go-forward', 'reload', 'press', 'keydown', 'keyup', 'mousemove', 'mousedown', 'mouseup', 'mousewheel',
  'screenshot', 'pdf', 'tab-list', 'tab-new', 'tab-close', 'tab-select', 'state-load', 'state-save', 'cookie-list',
  'cookie-get', 'cookie-set', 'cookie-delete', 'cookie-clear', 'localstorage-list', 'localstorage-get',
  'localstorage-set', 'localstorage-delete', 'localstorage-clear', 'sessionstorage-list', 'sessionstorage-get',
  'sessionstorage-set', 'sessionstorage-delete', 'sessionstorage-clear', 'set-color-scheme', 'set-reduced-motion',
  'set-forced-colors', 'set-contrast', 'set-media', 'clear-color-scheme', 'clear-reduced-motion', 'clear-forced-colors',
  'clear-contrast', 'clear-media', 'requests', 'request', 'request-headers', 'request-body', 'response-headers',
  'response-body', 'route', 'route-list', 'unroute', 'network-state-set', 'console', 'run-code', 'recording-start',
  'recording-stop', 'tracing-start', 'tracing-stop', 'video-start', 'video-stop', 'video-chapter', 'video-show-actions',
  'video-hide-actions', 'show', 'pause-at', 'resume', 'step-over', 'generate-locator', 'highlight', 'webmcp-list',
  'webmcp-call', 'install', 'install-browser', 'list', 'close-all', 'kill-all',
]);

describe('agents without an mcp__playwright__ tool never depend on one', () => {
  const noMcp = agentFiles().filter((f) => !toolsOf(read(f)).some((t) => t.startsWith('mcp__playwright__')));

  it('the allowlists really carry no Playwright MCP tool (every agent is covered)', () => {
    expect(noMcp.length).toBe(agentFiles().length);
  });

  it.each(noMcp)('%s: no line names an mcp__playwright__ tool except to say it is absent', (f) => {
    const offending = read(f)
      .split('\n')
      .filter((l) => l.includes('mcp__playwright__'))
      .filter((l) => !/exist only in a context that has them/.test(l) && !/allowlist has none/.test(l));
    expect(offending).toEqual([]);
  });

  it.each(noMcp)('%s: MCP is never primary, required, mandatory or preferred', (f) => {
    const src = read(f);
    expect(src).not.toMatch(/MCP[^.\n]{0,60}\b(primary|required|mandatory|preferred)\b/i);
    expect(src).not.toMatch(/\b(primary|required|mandatory|preferred)\b[^.\n]{0,60}\bMCP\b/i);
  });
});

describe('the documents say the same: playwright-cli is the exploration tool', () => {
  it.each(DOCS)('%s does not call Playwright MCP primary, required, mandatory or preferred', (f) => {
    const src = read(f);
    expect(src).not.toMatch(/MCP[^.\n]{0,60}\b(primary|required|mandatory|preferred)\b/i);
    expect(src).not.toMatch(/\b(primary|required|mandatory|preferred)\b[^.\n]{0,60}\bMCP\b/i);
    expect(src).not.toMatch(/Playwright MCP\*\*[^.\n]{0,30}when available/);
  });

  it('the handbook walkthrough states the CLI, the no-MCP allowlist and the headless default', () => {
    const t = read('HANDBOOK/04-stlc-walkthrough.md');
    expect(t).toMatch(/`qa-web-explorer` uses \*\*Playwright CLI\*\*/);
    expect(t).toMatch(/no Playwright MCP tools in their tool allowlist/);
    expect(t).toMatch(/headless by default \(`open <url> --headed` is the opt-in\)/);
    expect(t).toMatch(/`playwright-cli find`, `snapshot --depth=N` or `snapshot --filename=<file>`/);
  });
});

describe('the exploring and inspecting agents state the token-efficiency rule and the headless default', () => {
  const EXPLORERS = [
    '.claude/agents/tier2-specialist/qa-web-explorer.md',
    '.claude/agents/tier2-specialist/qa-exploratory-specialist.md',
  ];
  const INSPECTORS = [
    '.claude/agents/tier2-specialist/qa-ui-specialist.md',
    '.claude/agents/tier2-specialist/qa-accessibility-specialist.md',
    '.claude/agents/tier2-specialist/qa-responsive-specialist.md',
  ];

  it.each([...EXPLORERS, ...INSPECTORS])('%s', (f) => {
    const t = read(f);
    expect(t).toMatch(/\bplaywright-cli\b/);
    expect(t).toMatch(/playwright-cli find/);
    expect(t).toMatch(/snapshot --depth=4/);
    expect(t).toMatch(/snapshot --filename=<file>/);
    expect(t).toMatch(/headless by default/);
    expect(t).toMatch(/--headed/);
    expect(t).toMatch(/never depend on them/);
  });

  it.each(EXPLORERS)('%s: playwright-cli is the only browser tool, and no spec scripts are used', (f) => {
    const t = read(f);
    expect(t).toMatch(/Your browser tool is `playwright-cli`/);
    expect(t).toMatch(/Never use `@playwright\/test` Node API/);
  });

  it('qa-test-executor routes exploratory sessions and issue analysis to the CLI', () => {
    const t = read('.claude/agents/tier1-phase/qa-test-executor.md');
    expect(t).toMatch(/Exploratory sessions[^\n]*\*\*Playwright CLI\*\*/);
    expect(t).toMatch(/Issue analysis[^\n]*\*\*Playwright CLI\*\*/);
  });
});

describe('the SPVs of the explorers check the CLI, not MCP', () => {
  it('exploratory SPV: playwright-cli is the tool, scripts are refused, MCP absence is never faulted', () => {
    const t = read('.claude/agents/spv/qa-exploratory-specialist-spv.md');
    expect(t).toMatch(/\*\*`playwright-cli` is the browser tool\.\*\*/);
    expect(t).toMatch(/never faulted for not using them/);
    expect(t).toMatch(/Any `\.spec\.ts` file created during the session, or `@playwright\/test` Node API used for session navigation, = requested-changes/);
    expect(t).toMatch(/playwright-cli snapshot --filename=<file>/);
  });
  it('web explorer SPV: playwright-cli through Bash, node API refused, MCP absence is never faulted', () => {
    const t = read('.claude/agents/spv/qa-web-explorer-spv.md');
    expect(t).toMatch(/\*\*Correct browser tool used\.\*\* Work report confirms browser interactions were performed with `playwright-cli` through Bash/);
    expect(t).toMatch(/never faulted for not using them/);
    expect(t).toMatch(/`chromium\.launch\(\)`, `browser\.newPage\(\)`\), flag as requested-changes/);
  });
});

describe('every playwright-cli command in the prose exists in the real CLI', () => {
  const files = [...agentFiles(), ...DOCS];
  it.each(files)('%s', (f) => {
    const src = read(f);
    const bad: string[] = [];
    for (const m of src.matchAll(/playwright-cli\s+(?:-s=\S+\s+)?([a-z][a-z-]*)\b/g)) {
      if (!REAL_COMMANDS.has(m[1] ?? "")) bad.push(m[0]);
    }
    expect(bad).toEqual([]);
  });
});
