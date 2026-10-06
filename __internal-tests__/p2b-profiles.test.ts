import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
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

describe('the email specialist detects, no-ops, and reads the inbox through its Mailpit helper (AUD-051, T4)', () => {
  const FILE = '.claude/agents/tier2-specialist/qa-email-specialist.md';
  const md = (): string => read(FILE);

  it('reports a no-op exactly when the profile shows no email flows, and never over an unreachable inbox', () => {
    const process = section(md(), 'Process');
    expect(process).toMatch(/1\. \*\*Check for email flows\.\*\* Read `runs\/\{runId\}\/target-profile\.json#hasEmailFlows`\. Only the literal boolean `false` in a readable profile permits a no-op: emit `specialist\.no-op`[^\n]*release the task `done`[^\n]*missing, unreadable or schema-invalid[^\n]*emit `execution\.blocked`[^\n]*release the task `failed`/);
    expect(section(md(), 'Quality Standards \\(SPV rejects if violated\\)')).toContain('A `specialist.no-op` without a readable `hasEmailFlows: false`');
    expect(process).toMatch(/3\. \*\*Check that the inbox answers\.\*\*[^\n]*emit `execution\.blocked`[^\n]*release the task `failed`[^\n]*never a no-op/);
    expect(section(md(), 'Your Role')).toContain('Never report a no-op while `hasEmailFlows` is true.');
  });

  it('names no Gmail adapter, no @qa/email-adapters and no secrets file', () => {
    expect(md()).not.toMatch(/gmail/i);
    expect(md()).not.toMatch(/@qa\/email-adapters|\bEmailAdapter\b|secrets\/\.env/);
    const escapes = (parse(read('.claude/pipeline.yaml')) as { escapes: Array<{ unit: string; field: string }> }).escapes;
    expect(escapes.filter((e) => e.unit === 'qa-email-specialist' && e.field === 'optional')).toEqual([]);
  });

  it('its contract reads the profile, writes the helper, and emits the no-op and the block', () => {
    const c = contractOf(md());
    expect(paths(c.reads)).toContain('{run}/target-profile.json');
    expect(paths(c.reads).some((p) => p.startsWith('secrets/'))).toBe(false);
    expect(paths(c.writes)).toContain('{tests}/qa/support/mailpit.ts');
    expect(c.emits.map((e) => e.event)).toEqual(expect.arrayContaining(['specialist.no-op', 'execution.blocked']));
  });

  it('only the email specialist may write the helper (path-guard role table)', () => {
    const p = { aegisRoot: '/r/aegis', targetRoot: '/r', testsDir: '/r/tests/qa', runDir: '/r/aegis/runs/RUN-20261003-001' };
    expect(roleWritable('qa-email-specialist', '/r/tests/qa/support/mailpit.ts', p)).toBe(true);
    for (const other of ['qa-ui-specialist', 'qa-api-specialist', 'qa-environment-engineer']) {
      expect(roleWritable(other, '/r/tests/qa/support/mailpit.ts', p)).toBe(false);
    }
  });

  describe('the helper in the prose works against the Mailpit HTTP API', () => {
    type Call = { url: string; method: string };
    const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

    type Init = { method: string; signal: AbortSignal };
    function loadHelper(
      fetchStub: (url: string, init: Init) => Promise<unknown>,
      env: Record<string, string> = {},
      abortSignal: { timeout(ms: number): AbortSignal } = AbortSignal,
    ) {
      const code = /```ts\n([\s\S]*?)\n```/.exec(section(md(), 'Mailpit helper'))![1]!;
      const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
      const mod = { exports: {} as Record<string, (...args: never[]) => Promise<unknown>> };
      new Function('exports', 'module', 'fetch', 'process', 'AbortSignal', js)(mod.exports, mod, fetchStub, { env }, abortSignal);
      return { code, api: mod.exports as unknown as {
        purgeAll(): Promise<void>;
        listMessages(): Promise<Array<{ ID: string; Subject: string }>>;
        getMessage(id: string): Promise<{ ID: string; Text: string }>;
        waitForEmail(p: (m: { ID: string; Subject: string }) => boolean, timeoutMs?: number): Promise<{ ID: string; Text: string }>;
      } };
    }

    it('imports nothing, is brand-clean, and defaults to the configured Mailpit http port', () => {
      const { code } = loadHelper(async () => response({}));
      expect(code).not.toMatch(/^\s*import\s|require\(/m);
      // The helper is copied into the target's tests: it must not name the framework or an agent.
      expect(checkBrandExposure(code)).toBeNull();
      expect(code).toContain('const DEFAULT_URL = "http://localhost:8025"; // QA config ports.mailpit.http');
      const port = (JSON.parse(read('aegis.config.json')) as { ports: { mailpit: { http: number } } }).ports.mailpit.http;
      expect(code).toContain(`const DEFAULT_URL = "http://localhost:${port}";`);
    });

    it('purges, lists and fetches through the three Mailpit endpoints, honouring MAILPIT_URL', async () => {
      const calls: Call[] = [];
      const { api } = loadHelper(async (url, init) => {
        calls.push({ url, method: init.method });
        return response(url.endsWith('/api/v1/messages') ? { messages: [{ ID: 'a b', Subject: 'Hi' }] } : { ID: 'a b', Text: 'body' });
      }, { MAILPIT_URL: 'http://mail.test:9000/' });
      await api.purgeAll();
      expect(await api.listMessages()).toEqual([{ ID: 'a b', Subject: 'Hi' }]);
      expect(await api.getMessage('a b')).toEqual({ ID: 'a b', Text: 'body' });
      expect(calls).toEqual([
        { url: 'http://mail.test:9000/api/v1/messages', method: 'DELETE' },
        { url: 'http://mail.test:9000/api/v1/messages', method: 'GET' },
        { url: 'http://mail.test:9000/api/v1/message/a%20b', method: 'GET' },
      ]);
    });

    it('waitForEmail polls until a message matches, then returns the full message', async () => {
      let lists = 0;
      const { api } = loadHelper(async (url) => {
        if (url.endsWith('/api/v1/messages')) return response({ messages: lists++ === 0 ? [] : [{ ID: 'm1', Subject: 'Welcome' }] });
        return response({ ID: 'm1', Text: 'Confirm your account' });
      });
      await expect(api.waitForEmail((m) => m.Subject === 'Welcome', 5_000)).resolves.toEqual({ ID: 'm1', Text: 'Confirm your account' });
      expect(lists).toBe(2);
    });

    it('waitForEmail rejects after its timeout, and a non-2xx answer is an error, not an empty inbox', async () => {
      const { api } = loadHelper(async () => response({ messages: [] }));
      await expect(api.waitForEmail(() => false, 50)).rejects.toThrow('no matching email within 50 ms');
      const down = loadHelper(async () => response({}, 503)).api;
      await expect(down.listMessages()).rejects.toThrow('Mailpit GET /api/v1/messages failed: HTTP 503');
    });

    it('every request carries a 10 s timeout, so a hung inbox makes waitForEmail reject instead of hang', async () => {
      const asked: number[] = [];
      // The stub honours the abort signal like the real fetch; the injected timeout fires after 20 ms instead of 10 s.
      const hung = (_url: string, init: Init) =>
        new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('The operation was aborted due to timeout'))));
      const { api } = loadHelper(hung, {}, { timeout: (ms: number) => (asked.push(ms), AbortSignal.timeout(20)) });
      const started = Date.now();
      await expect(api.waitForEmail(() => true, 60_000)).rejects.toThrow('Mailpit GET /api/v1/messages failed: The operation was aborted due to timeout');
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(asked).toEqual([10_000]);
    });
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

  it('the designer tags Email only when the profile shows email flows', () => {
    expect(read('.claude/agents/tier1-phase/qa-test-designer.md')).toContain(
      '`Email` when target-profile.json `hasEmailFlows` is true and the requirement sends mail (sign-up confirmation, password reset, invitation, notification)',
    );
  });

  it('both specialists name their profile field in the no-op path', () => {
    const realtimeMd = read('.claude/agents/tier2-specialist/qa-realtime-specialist.md');
    expect(realtimeMd).not.toMatch(/If no WS or SSE detected|does not detect any real-time|when no real-time features detected|detected WebSocket\/SSE routes/);
    expect(section(realtimeMd, 'Your Role')).toMatch(/If `target-profile\.json#hasRealtimeFeatures` is false[^\n]*emit `specialist\.no-op`/);
    expect(section(realtimeMd, 'Process')).toMatch(/`runs\/\{runId\}\/target-profile\.json#hasRealtimeFeatures`\. Only the literal boolean `false` in a readable profile permits a no-op: emit `specialist\.no-op`/);
    const emailMd = read('.claude/agents/tier2-specialist/qa-email-specialist.md');
    expect(section(emailMd, 'Process')).toMatch(/`runs\/\{runId\}\/target-profile\.json#hasEmailFlows`\. Only the literal boolean `false` in a readable profile permits a no-op: emit `specialist\.no-op`/);
  });

  it('both workers never no-op over a true flag, and block (failed release) on a missing or unreadable profile', () => {
    const realtimeMd = read('.claude/agents/tier2-specialist/qa-realtime-specialist.md');
    const emailMd = read('.claude/agents/tier2-specialist/qa-email-specialist.md');
    expect(section(realtimeMd, 'Your Role')).toContain('Never report a no-op while `hasRealtimeFeatures` is true.');
    expect(section(emailMd, 'Your Role')).toContain('Never report a no-op while `hasEmailFlows` is true.');
    for (const [md, flag] of [[realtimeMd, 'hasRealtimeFeatures'], [emailMd, 'hasEmailFlows']] as const) {
      expect(section(md, 'Process')).toMatch(/missing, unreadable or schema-invalid, or `\w+` is not a boolean, emit `execution\.blocked`[^\n]*release the task `failed`/);
      expect(section(md, 'Quality Standards \\(SPV rejects if violated\\)')).toContain(`A \`specialist.no-op\` without a readable \`${flag}: false\``);
      // One no-op rule per worker, not two bullets with overlapping meaning.
      expect(section(md, 'Quality Standards \\(SPV rejects if violated\\)').split('\n').filter((l) => /no-op/.test(l))).toHaveLength(1);
      expect(contractOf(md).emits.map((e) => e.event)).toEqual(expect.arrayContaining(['specialist.no-op', 'execution.blocked']));
    }
  });

  it('worker and reviewer state one recipient rule, and the worker records the Mailpit URL it used', () => {
    const rule = '`qa_`, `test_` or `e2e_` prefixed addresses, or `qa+*@example.com` / `test+*@example.com` aliases, all captured by Mailpit; never a real external recipient';
    expect(section(read('.claude/agents/tier2-specialist/qa-email-specialist.md'), 'Process')).toContain(rule);
    expect(section(read('.claude/agents/spv/qa-email-specialist-spv.md'), 'Review Checklist')).toContain(rule);
    expect(read('.claude/agents/tier2-specialist/qa-email-specialist.md')).toContain('Record the Mailpit URL your specs used');
  });

  it('both SPVs judge a no-op by the same field, and the email SPV checks the helper and the adapter', () => {
    const emailSpv = read('.claude/agents/spv/qa-email-specialist-spv.md');
    const checklist = section(emailSpv, 'Review Checklist');
    expect(checklist).toContain('10. **No-op legitimacy.** A `specialist.no-op` is legitimate only when `target-profile.json` is readable and `hasEmailFlows` is `false`; a missing or unreadable profile, or `true`, = requested-changes.');
    expect(checklist).toContain('11. **Inbox URL matches config.** `DEFAULT_URL` in `tests/qa/support/mailpit.ts` equals `http://localhost:` plus the port in `aegis.config.json#ports.mailpit.http`.');
    expect(checklist).toContain('is recorded in the work report');
    expect(checklist).toContain("A `MAILPIT_URL` named in the work report must be the run environment's Mailpit address; otherwise requested-changes.");
    expect(checklist).toContain('An existing helper whose port had drifted is updated by the worker');
    expect(section(read('.claude/agents/tier2-specialist/qa-email-specialist.md'), 'Process')).toContain(
      "if the existing helper's `DEFAULT_URL` port differs from `aegis.config.json#ports.mailpit.http`, update that line and say so in your work report",
    );
    expect(checklist).toContain('asserted valid, HTTP 200');
    expect(contractOf(emailSpv).config).toEqual(expect.arrayContaining(['aegis.config.json#ports.mailpit.http']));
    expect(checklist).toContain('1. **Inbox through the helper.** Specs reach the inbox only through `tests/qa/support/mailpit.ts`: no raw SMTP or `nodemailer`, and no Mailpit REST call in a spec body. A violation = requested-changes.');
    expect(checklist).toContain('5. **Adapter matches config.** `aegis.config.json#emailAdapter` is `mailpit`, the only supported inbox.');
    expect(checklist).toContain('Each test calls `purgeAll()` from the helper in `beforeEach`.');
    expect(emailSpv).not.toMatch(/gmail/i);
    expect(emailSpv).not.toMatch(/@qa\/email-adapters|\bEmailAdapter\b|adapter\.purgeAll/);
    expect(paths(contractOf(emailSpv).reads)).toEqual(expect.arrayContaining(['{run}/target-profile.json', '{tests}/qa/support/mailpit.ts']));
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

describe('Mailpit is the only inbox (AUD-051, T4)', () => {
  it('no Gmail adapter remains in the email pair, the environment engineer, the CLI or the environment docs', () => {
    const files = [
      '.claude/agents/tier2-specialist/qa-email-specialist.md',
      '.claude/agents/spv/qa-email-specialist-spv.md',
      '.claude/agents/tier1-phase/qa-environment-engineer.md',
      'apps/cli/src/commands/init.ts',
      'apps/cli/src/commands/reconfigure.ts',
      'docs/D12-environments-overview.md',
      'secrets/README.md',
    ];
    expect(files.filter((f) => /gmail/i.test(read(f)))).toEqual([]);
    expect(read('docs/D12-environments-overview.md')).toContain('| Email testing | ✓ (Mailpit) | ✓ (per-PR Mailpit) | ✓ (Mailpit; needs `MAILPIT_URL` set) | ✗ |');
    expect(JSON.parse(read('aegis.config.json')).emailAdapter).toBe('mailpit');
  });

  it('the environment engineer checks the inbox only when the profile shows email flows', () => {
    expect(read('.claude/agents/tier1-phase/qa-environment-engineer.md')).toContain(
      'If `target-profile.json#hasEmailFlows` is true: verify the Mailpit inbox answers at `MAILPIT_URL` (default `http://localhost:{ports.mailpit.http}`)',
    );
  });
});
