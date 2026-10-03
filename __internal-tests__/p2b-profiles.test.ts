import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { parse } from 'yaml';
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
interface Contract { reads: Array<string | { path: string }>; writes: Array<string | { path: string }>; emits: Array<{ event: string }> }
const contractOf = (md: string): Contract => parse(/## Contract \(machine-checked\)\s*```yaml\n([\s\S]*?)```/.exec(md)![1]!) as Contract;
const paths = (xs: Array<string | { path: string }>): string[] => xs.map((x) => (typeof x === 'string' ? x : x.path));

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

describe('the email specialist detects, no-ops, and reads the inbox through its Mailpit helper (AUD-051, T4)', () => {
  const FILE = '.claude/agents/tier2-specialist/qa-email-specialist.md';
  const md = (): string => read(FILE);

  it('reports a no-op exactly when the profile shows no email flows, and never over an unreachable inbox', () => {
    const process = section(md(), 'Process');
    expect(process).toMatch(/1\. \*\*Check for email flows\.\*\* Read `target-profile\.json#hasEmailFlows`\. When it is false, emit `specialist\.no-op`[^\n]*release the task `done`/);
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

    function loadHelper(fetchStub: (url: string, init: { method: string }) => Promise<unknown>, env: Record<string, string> = {}) {
      const code = /```ts\n([\s\S]*?)\n```/.exec(section(md(), 'Mailpit helper'))![1]!;
      const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
      const mod = { exports: {} as Record<string, (...args: never[]) => Promise<unknown>> };
      new Function('exports', 'module', 'fetch', 'process', js)(mod.exports, mod, fetchStub, { env });
      return { code, api: mod.exports as unknown as {
        purgeAll(): Promise<void>;
        listMessages(): Promise<Array<{ ID: string; Subject: string }>>;
        getMessage(id: string): Promise<{ ID: string; Text: string }>;
        waitForEmail(p: (m: { ID: string; Subject: string }) => boolean, timeoutMs?: number): Promise<{ ID: string; Text: string }>;
      } };
    }

    it('imports nothing and defaults to the configured Mailpit http port', () => {
      const { code } = loadHelper(async () => response({}));
      expect(code).not.toMatch(/^\s*import\s|require\(/m);
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
  });
});
