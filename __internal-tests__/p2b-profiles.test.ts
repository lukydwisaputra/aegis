import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// P2b — profiles and relevance (docs/superpowers/specs/2026-10-02-p2-roster-design.md §4.8–4.10, §7).
const ROOT = path.join(__dirname, '..');

/** Git-tracked files that exist in the working tree. */
function tracked(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' })
    .split('\0')
    .filter((f) => f !== '' && fs.existsSync(path.join(ROOT, f)));
}
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');

describe('the lite profile is gone from code and config (AUD-053, code half)', () => {
  it('no contracts, run-state or CLI source names a lite profile', () => {
    const sources = tracked().filter((f) => /^(packages\/@qa\/(contracts|run-state)|apps\/cli)\/src\/.*\.ts$/.test(f));
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.filter((f) => /["']lite["']|\|lite\b/.test(read(f)))).toEqual([]);
  });

  it('aegis.config.json and the init template have no profile key', () => {
    expect(JSON.parse(read('aegis.config.json'))).not.toHaveProperty('profile');
    expect(read('apps/cli/src/commands/init.ts')).not.toMatch(/\bprofile: "full"/);
  });

  it('the orchestrator and the run-report chapter name no run profile', () => {
    expect(read('.claude/agents/orchestrator/qa-orchestrator.md')).not.toMatch(/— profile,/);
    expect(read('HANDBOOK/09-reports-and-dashboards.md')).not.toMatch(/profile/i);
  });
});

describe('compliance relevance is stated where it is acted on (AUD-055)', () => {
  const RELEVANCE = 'GDPR and PDPA run only when the target profile shows personal data';

  it('HANDBOOK/01, 06 and 08 state the relevance rule and the not-applicable case', () => {
    for (const f of ['HANDBOOK/01-what-is-this.md', 'HANDBOOK/06-agents.md', 'HANDBOOK/08-compliance.md']) {
      expect(read(f)).toContain(RELEVANCE);
      expect(read(f)).toMatch(/not-applicable when no listed regulation applies/);
    }
    expect(read('HANDBOOK/08-compliance.md')).toMatch(/except `qa-compliance-gdpr` and `qa-compliance-pdpa` when the target profile shows no personal data/);
  });

  it('the orchestrator skips gdpr and pdpa on the three signals the CLI uses', () => {
    const orch = read('.claude/agents/orchestrator/qa-orchestrator.md');
    expect(orch).toContain(
      'Skip `qa-compliance-gdpr` and `qa-compliance-pdpa` when the target profile shows no personal data: `target-profile.json#hasPersonalData` and `target-profile.json#hasAuth` are both false and `target-profile.json#personalDataSignals` is empty.',
    );
    expect(orch).toContain('Compliance (an empty compliance list, or no listed regulation applies because the target profile shows no personal data)');
  });
});
