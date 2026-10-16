import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');

// Every Playwright browser the framework drives is headless by default; headed is an explicit opt-in.
describe('Playwright runs are headless by default', () => {
  it('ships playwright.headed false in aegis.config.json', () => {
    const config = JSON.parse(read('aegis.config.json')) as { playwright?: { headed?: boolean } };
    expect(config.playwright?.headed).toBe(false);
  });

  it('starts the Playwright MCP server with --headless (the server is headed unless told otherwise)', () => {
    const mcp = JSON.parse(read('.mcp.json')) as { mcpServers: Record<string, { args: string[] } | undefined> };
    expect(mcp.mcpServers.playwright?.args).toContain('--headless');
  });

  it('has the environment engineer generate a headless qa-e2e entry, honouring QA_HEADED and never flipping a CI run', () => {
    const engineer = read('.claude/agents/tier1-phase/qa-environment-engineer.md');
    expect(engineer).toContain('**headless by default**, headed only by explicit opt-in');
    expect(engineer).toContain("headless: !!process.env.CI || process.env.QA_HEADED !== '1'");
    expect(engineer).toContain("headless: !!process.env.CI || process.env.QA_HEADED === '0'");
    expect(engineer).toContain('Never write a bare `headless: false`');
    expect(engineer).not.toMatch(/`false` if `aegis\.config\.json\.playwright\.headed` is `true` \(headless otherwise\)/);
  });

  it('has the engineer SPV refuse a bare headless false', () => {
    const spv = read('.claude/agents/spv/qa-environment-engineer-spv.md');
    expect(spv).toContain("headless: !!process.env.CI || process.env.QA_HEADED !== '1'");
    expect(spv).toContain('A bare `headless: false`');
  });

  it('documents the opt-in in the handbook and CLAUDE.md', () => {
    const faq = read('HANDBOOK/15-faq-and-troubleshooting.md');
    expect(faq).toContain('QA_HEADED=1 npx playwright test --project=qa-e2e');
    expect(faq).toContain('npx playwright test --headed');
    expect(faq).toContain('`--headless`');
    const claude = read('CLAUDE.md');
    expect(claude).toContain('`playwright.headed` — default `false`');
  });

  it('writes playwright.headed false in reset-target when the key is absent and keeps an explicit true', () => {
    expect(read('scripts/reset-target.sh')).toContain('.playwright.headed            = (.playwright.headed // false)');
  });
});
