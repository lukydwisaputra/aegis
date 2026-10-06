import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { checkBrandExposure, routeTestCase } from '@qa/contracts';
import { roleWritable } from '@qa/path-guard';

// P2b — profiles and relevance (docs/superpowers/specs/2026-10-02-p2-roster-design.md §4.8–4.10, §7).
const ROOT = path.join(__dirname, '..');

/** Git-tracked files that exist in the working tree. */
function tracked(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' })
    .split('\0')
    .filter((f) => f !== '' && fs.existsSync(path.join(ROOT, f)));
}
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const section = (md: string, heading: string): string => new RegExp(`\\n## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(md)![1]!;
interface Contract { reads: Array<string | { path: string }>; writes: Array<string | { path: string }>; emits: Array<{ event: string }>; config: string[] }
const contractOf = (md: string): Contract => parse(/## Contract \(machine-checked\)\s*```yaml\n([\s\S]*?)```/.exec(md)![1]!) as Contract;
const paths = (xs: Array<string | { path: string }>): string[] => xs.map((x) => (typeof x === 'string' ? x : x.path));

describe('the lite profile is gone from code and config (AUD-053, code half)', () => {
  it('no contracts, run-state or CLI source names a lite profile', () => {
    const sources = tracked().filter((f) => /^(packages\/@qa\/(contracts|run-state)|apps\/cli)\/src\/.*\.ts$/.test(f));
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.filter((f) => /\blite\b/i.test(read(f)))).toEqual([]);
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

  it('the orchestrator skips gdpr and pdpa on the Scan snapshot the CLI uses, never on the profile file', () => {
    const orch = read('.claude/agents/orchestrator/qa-orchestrator.md');
    expect(orch).toContain(
      'Skip `qa-compliance-gdpr` and `qa-compliance-pdpa` only when `aegis run status` shows `phases.scan.personalData: false`, the snapshot Scan recorded when it passed: it is false only when `target-profile.json#hasPersonalData` and `target-profile.json#hasAuth` were both false and `target-profile.json#personalDataSignals` was empty.',
    );
    expect(orch).toContain('Decide from that snapshot, never from `target-profile.json` itself');
    expect(orch).toContain('an absent snapshot counts as personal data present');
    expect(orch).toContain('Compliance (an empty compliance list, or no listed regulation applies because the target profile shows no personal data)');
  });

  describe('report consumers expect one report per relevant regulation, never a fixed six', () => {
    const SKILL = '.claude/skills/_qa-report-technical-pdf/SKILL.md';
    const EXEC = '.claude/agents/tier1-phase/qa-executive-reporter.md';
    const CLOSURE = '.claude/agents/tier1-phase/qa-closure-reporter.md';
    const PLANNER = '.claude/agents/tier1-phase/qa-test-planner.md';
    const RULE = 'minus gdpr and pdpa when `aegis run status` shows `phases.scan.personalData: false`';

    it('each consumer states the relevance rule', () => {
      expect(read(SKILL)).toContain('- One compliance section per report in `reports/compliance/`; omitted when the Compliance phase was not-applicable');
      expect(read(SKILL)).toContain('one gap report per relevant regulation');
      expect(read(EXEC)).toContain('the per-regulation compliance reports (one per relevant regulation)');
      expect(read(CLOSURE)).toContain('Expect one compliance report per relevant regulation: the regulations in `aegis.config.json#compliance` (all six when the key is absent), ' + RULE + '.');
      expect(read(CLOSURE)).toContain('A missing report for a relevant regulation is a closure gap, not a pass.');
      expect(read(CLOSURE)).toContain('"GDPR and PDPA were not assessed: no personal data was detected in the application."');
      expect(read(PLANNER)).toContain('one compliance report per relevant regulation');
      expect(read(PLANNER)).toContain(RULE + '; never promise a GDPR or PDPA report then.');
      expect(read(PLANNER)).toContain('- `aegis/aegis.config.json` — compliance flags, environment model\n');
    });

    it('no consumer promises six compliance reports or sections', () => {
      for (const f of [SKILL, EXEC, CLOSURE, PLANNER]) {
        expect(read(f)).not.toMatch(/\b(six|6)\b[^\n.]{0,30}compliance (reports?|sections?)|\b(six|6) per-regulation/i);
      }
    });

    it('the brand-clean closure sentence names no framework or agent', () => {
      expect(checkBrandExposure('GDPR and PDPA were not assessed: no personal data was detected in the application.')).toBeNull();
    });
  });
});

describe('the messaging specialist detects, no-ops, and stays project-agnostic (NEW-07)', () => {
  const FILE = '.claude/agents/tier2-specialist/qa-messaging-specialist.md';
  const SPV = '.claude/agents/spv/qa-messaging-specialist-spv.md';
  const md = (): string => read(FILE);

  it('reports a no-op exactly when the profile shows no messaging integration', () => {
    const process = section(md(), 'Process');
    expect(process).toMatch(/1\. \*\*Check for a messaging integration\.\*\* Read `runs\/\{runId\}\/target-profile\.json#hasMessagingIntegration`\. Only the literal boolean `false` in a readable profile permits a no-op: emit `specialist\.no-op`[^\n]*release the task `done`[^\n]*missing, unreadable or schema-invalid, or `hasMessagingIntegration` is not a boolean, emit `execution\.blocked`[^\n]*release the task `failed`/);
    expect(section(md(), 'Quality Standards \\(SPV rejects if violated\\)')).toContain('A `specialist.no-op` without a readable `hasMessagingIntegration: false`');
    expect(section(md(), 'Quality Standards \\(SPV rejects if violated\\)').split('\n').filter((l) => /no-op/.test(l))).toHaveLength(1);
    expect(section(md(), 'Your Role')).toContain('Never report a no-op while `hasMessagingIntegration` is true.');
  });

  it('worker and reviewer name no provider, env var, key format, country or project (D10)', () => {
    for (const f of [FILE, SPV]) expect(read(f)).not.toMatch(/commshub|COMMS?HUB_|chk_|\+65|renci|slec|mailpit|gmail/i);
  });

  it('drives every provider detail through the CLI', () => {
    const process = section(md(), 'Process');
    for (const cmd of ['aegis messaging fetch-contract', 'aegis messaging plan', 'aegis messaging exec', 'aegis messaging scan-secrets']) expect(process).toContain(cmd);
    const c = contractOf(md());
    expect(paths(c.reads)).toEqual(expect.arrayContaining(['{run}/target-profile.json', '{run}/messaging/plan.json', '{run}/messaging/contract.json']));
    expect(paths(c.reads).some((x) => x.startsWith('secrets/'))).toBe(false);
    expect(paths(c.writes)).toContain('{tests}/qa/messaging/{flow}.messaging.spec.ts');
    expect(c.emits.map((e) => e.event)).toEqual(expect.arrayContaining(['specialist.no-op', 'execution.blocked', 'messaging.live-preflight']));
  });

  it('the reviewer checks the preflight, the fakes and the secret scan', () => {
    const checklist = section(read(SPV), 'Review Checklist');
    expect(checklist).toContain('A `specialist.no-op` is legitimate only when `target-profile.json` is readable and `hasMessagingIntegration` is `false`');
    expect(checklist).toContain('aegis messaging scan-secrets');
    expect(checklist).toContain('messaging.fakeRecipients');
    expect(checklist).toMatch(/preflight/);
    expect(paths(contractOf(read(SPV)).reads)).toEqual(expect.arrayContaining(['{run}/target-profile.json', '{run}/messaging/plan.json']));
  });

  it('worker and reviewer scan absolute paths and treat a skipped path as unclean', () => {
    const skippedRule = 'A scan whose `skipped` list is not empty is not clean: rescan with the correct paths; a `too-large` file is reported as an uncertainty in the work report';
    const process = section(md(), 'Process');
    expect(process).toContain(skippedRule);
    expect(process).toContain('every path absolute');
    expect(process).toContain('the Paths line of your run context');
    // A relative tests path resolves against the framework root, not the target, and is skipped as missing.
    expect(md()).not.toMatch(/scan-secrets` over `tests\/qa|scan-secrets tests\/qa/);
    const item7 = section(read(SPV), 'Review Checklist').split('\n').find((l) => l.startsWith('7. '))!;
    expect(item7).toContain(skippedRule);
    expect(item7).toContain('the Paths line of your run context');
    for (const p of ['runs/{runId}/reports/work/qa-messaging-specialist*.json', 'runs/{runId}/cases/*-result.json', 'runs/{runId}/evidence/TC-*']) expect(item7).toContain(p);
    expect(read(SPV)).not.toMatch(/scan-secrets` over `tests\/qa|scan-secrets tests\/qa/);
    expect(paths(contractOf(read(SPV)).reads)).toEqual(expect.arrayContaining(['{run}/cases/{TC-ID}-result.json', '{run}/evidence/TC-*/**']));
  });

  it('the worker report names everything the reviewer checks, and the preflight is recorded both ways', () => {
    const process = section(md(), 'Process');
    expect(process).toContain('the adapter, the contract repo, path, ref and sha (from `runs/{runId}/messaging/contract.json`)');
    expect(section(read(SPV), 'Review Checklist')).toContain('the contract repo, path, ref and sha');
    expect(process).toContain('emit `messaging.live-preflight { adapter, simulated: true }` once `replay()` returns; when it throws `NotSimulatedError`, emit `messaging.live-preflight { adapter, simulated: false }` before recording the Sev1');
  });

  it('only the CLI writes the vendored helper', () => {
    const p = { aegisRoot: '/r/aegis', targetRoot: '/r', testsDir: '/r/tests/qa', runDir: '/r/aegis/runs/RUN-20261006-001' };
    for (const a of ['qa-messaging-specialist', 'qa-ui-specialist', 'qa-environment-engineer']) expect(roleWritable(a, '/r/tests/qa/support/messaging.ts', p)).toBe(false);
  });
});

describe('designer, routing and reviewers act on the same profile flags (AUD-051)', () => {
  it('routeTestCase sends a Messaging TC to the messaging specialist and a Realtime TC to the realtime specialist', () => {
    expect(routeTestCase({ testType: ['E2E'], testTechnique: ['Messaging'] })).toEqual(['qa-ui-specialist', 'qa-messaging-specialist']);
    expect(routeTestCase({ testType: ['API'], testTechnique: ['Realtime'] })).toEqual(['qa-api-specialist', 'qa-realtime-specialist']);
  });

  it('a TC without the Messaging or Realtime technique routes to neither specialist', () => {
    const routed = routeTestCase({ testType: ['E2E'], testTechnique: ['Flow'] });
    expect(routed).toEqual(['qa-ui-specialist']);
    expect(routed).not.toContain('qa-messaging-specialist');
    expect(routed).not.toContain('qa-realtime-specialist');
  });

  it('the designer tags Messaging only when the profile shows a messaging integration', () => {
    expect(read('.claude/agents/tier1-phase/qa-test-designer.md')).toContain(
      '`Messaging` when target-profile.json `hasMessagingIntegration` is true and the requirement sends a message (an OTP, a link, a notification, a broadcast, a digest)',
    );
  });

  it('both specialists name their profile field in the no-op path', () => {
    const realtimeMd = read('.claude/agents/tier2-specialist/qa-realtime-specialist.md');
    expect(realtimeMd).not.toMatch(/If no WS or SSE detected|does not detect any real-time|when no real-time features detected|detected WebSocket\/SSE routes/);
    expect(section(realtimeMd, 'Your Role')).toMatch(/If `target-profile\.json#hasRealtimeFeatures` is false[^\n]*emit `specialist\.no-op`/);
    expect(section(realtimeMd, 'Process')).toMatch(/`runs\/\{runId\}\/target-profile\.json#hasRealtimeFeatures`\. Only the literal boolean `false` in a readable profile permits a no-op: emit `specialist\.no-op`/);
    const messagingMd = read('.claude/agents/tier2-specialist/qa-messaging-specialist.md');
    expect(section(messagingMd, 'Your Role')).toMatch(/If `target-profile\.json#hasMessagingIntegration` is false[^\n]*emit `specialist\.no-op`/);
    expect(section(messagingMd, 'Process')).toMatch(/`runs\/\{runId\}\/target-profile\.json#hasMessagingIntegration`\. Only the literal boolean `false` in a readable profile permits a no-op: emit `specialist\.no-op`/);
  });

  it('both workers never no-op over a true flag, and block (failed release) on a missing or unreadable profile', () => {
    const realtimeMd = read('.claude/agents/tier2-specialist/qa-realtime-specialist.md');
    const messagingMd = read('.claude/agents/tier2-specialist/qa-messaging-specialist.md');
    expect(section(realtimeMd, 'Your Role')).toContain('Never report a no-op while `hasRealtimeFeatures` is true.');
    expect(section(messagingMd, 'Your Role')).toContain('Never report a no-op while `hasMessagingIntegration` is true.');
    for (const [md, flag] of [[realtimeMd, 'hasRealtimeFeatures'], [messagingMd, 'hasMessagingIntegration']] as const) {
      expect(section(md, 'Process')).toMatch(/missing, unreadable or schema-invalid, or `\w+` is not a boolean, emit `execution\.blocked`[^\n]*release the task `failed`/);
      expect(section(md, 'Quality Standards \\(SPV rejects if violated\\)')).toContain(`A \`specialist.no-op\` without a readable \`${flag}: false\``);
      // One no-op rule per worker, not two bullets with overlapping meaning.
      expect(section(md, 'Quality Standards \\(SPV rejects if violated\\)').split('\n').filter((l) => /no-op/.test(l))).toHaveLength(1);
      expect(contractOf(md).emits.map((e) => e.event)).toEqual(expect.arrayContaining(['specialist.no-op', 'execution.blocked']));
    }
  });

  it('both SPVs judge a no-op by the same field', () => {
    const messagingChecklist = section(read('.claude/agents/spv/qa-messaging-specialist-spv.md'), 'Review Checklist');
    expect(messagingChecklist).toContain('a missing or unreadable profile, or `true`, = requested-changes');
    const realtimeSpvMd = read('.claude/agents/spv/qa-realtime-specialist-spv.md');
    expect(section(realtimeSpvMd, 'Review Checklist')).toContain(
      'A `specialist.no-op` is legitimate only when `target-profile.json` is readable and `hasRealtimeFeatures` is `false`',
    );
    expect(section(realtimeSpvMd, 'Review Checklist')).toContain('a missing or unreadable profile, or `true`, = requested-changes');
    expect(section(realtimeSpvMd, 'Verdict')).toContain('illegitimate NoOp');
    expect(realtimeSpvMd).not.toMatch(/when no real-time features were detected|for feature detection/);
    expect(paths(contractOf(realtimeSpvMd).reads)).toContain('{run}/target-profile.json');
  });
});

describe('Mailpit is gone (NEW-07)', () => {
  it('no agent, skill, CLI source or config names Mailpit', () => {
    const files = tracked().filter((f) => /^(\.claude\/|apps\/cli\/src\/|packages\/@qa\/[^/]+\/src\/|aegis\.config\.json)/.test(f));
    expect(files.length).toBeGreaterThan(50);
    expect(files.filter((f) => /mailpit/i.test(read(f)))).toEqual([]);
  });
  // NEW-07 Task 7: the documentation half; Task 7 rewrites the docs and un-skips it.
  it.skip('no environment doc, handbook chapter, secrets README or CLAUDE.md names Mailpit', () => {
    const files = tracked().filter((f) => /^(docs\/D\d|HANDBOOK\/|secrets\/README|CLAUDE\.md)/.test(f));
    expect(files.filter((f) => /mailpit/i.test(read(f)))).toEqual([]);
    expect(read('docs/D12-environments-overview.md')).toContain('| Messaging testing | ✓ (stub + provider dev) | ✗ | ✗ | ✗ |');
  });
  it('the environment engineer checks messaging setup only when the profile shows an integration', () => {
    expect(read('.claude/agents/tier1-phase/qa-environment-engineer.md')).toContain('If `target-profile.json#hasMessagingIntegration` is true: run `aegis messaging check`');
  });
});
