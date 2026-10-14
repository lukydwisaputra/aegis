import * as fs from 'fs';
import * as path from 'path';
import { findToolingWords, findToolingWordsIn, localPortsOf, toolingRules, TOOLING_WORD_RULES } from '@qa/contracts';
import { decide, loadGuardContext, type GuardContext, type HookToolInput } from '@qa/path-guard';
import { readRunConfig } from '@qa/run-state';
import { makeAegisRoot, startedRun, thrownCode, type TmpAegis } from './helpers/aegis-root';
import { GATE3, SCRIPT, fixture, run, temps } from './helpers/exec-pdf';

afterAll(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });

// Local ports are project config (aegis.config.json#reportRules.localPorts), read by every caller of the tooling rules; a defect record's
// reproduction data takes the word rules only, its title every rule.

const setConfig = (root: string, patch: Record<string, unknown>) => {
  const file = path.join(root, 'aegis.config.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>;
  fs.writeFileSync(file, JSON.stringify({ ...cfg, ...patch, reportRules: { ...(cfg['reportRules'] ?? {}), ...((patch['reportRules'] as object) ?? {}) } }));
};

describe('the rules: built-in hosts always, colon-prefixed ports only when the project lists them', () => {
  it('the default flags localhost:3000, [::1]:3000 and 0.0.0.0, never a bare or unlisted :N', () => {
    expect(findToolingWords('The app served http://localhost:3000/login.').map((h) => h.phrase)).toEqual(['localhost']);
    expect(findToolingWords('The app served http://[::1]:3000/login.').map((h) => h.phrase)).toEqual(['[::1]:3000']);
    expect(findToolingWords('It bound 0.0.0.0:8080 at start.').map((h) => h.phrase)).toEqual(['0.0.0.0:8080']);
    for (const clean of ['The listener on :3002 restarted.', 'Subnet 10.0.0.0 is private.', 'Ingress from 0.0.0.0/0 is open.', 'Version 0.0.0.0.1 shipped.', '3002 volunteers signed up at 12:30.']) {
      expect([clean, findToolingWords(clean)]).toEqual([clean, []]);
    }
    expect(toolingRules()).toBe(TOOLING_WORD_RULES);
  });

  it('a project with other localPorts is flagged on its own ports and not on the old literal list', () => {
    const opts = { localPorts: [4010, 8081] };
    expect(findToolingWords('The stub on :4010 and the app on :8081 answered.', opts).map((h) => h.phrase)).toEqual([':4010', ':8081']);
    for (const old of [':3002', ':3011', ':3998', ':54421', ':54422']) expect([old, findToolingWords(`Served on ${old}.`, opts)]).toEqual([old, []]);
    expect(findToolingWords('4010 records were exported.', opts)).toEqual([]);
    expect(findToolingWords('Served on :40100.', opts)).toEqual([]);
    expect(findToolingWordsIn({ a: { note: 'see :4010' }, evidence: ':4010' }, 'closure.json', opts).map((h) => h.location)).toEqual(['closure.json.a.note']);
  });

  it('kinds ["word"] keeps the word rules and drops every path, host and port rule', () => {
    const text = 'Open http://127.0.0.1:3002/x; see rtm.json on port 3000; the work report says so.';
    expect(findToolingWords(text, { localPorts: [3002] }).map((h) => h.phrase)).toEqual(['work report', 'rtm.json', '127.0.0.1', 'port 3000', ':3002']);
    expect(findToolingWords(text, { kinds: ['word'], localPorts: [3002] }).map((h) => h.phrase)).toEqual(['work report']);
    expect(findToolingWords(text, { kinds: ['path'] }).map((h) => h.phrase)).toEqual(['rtm.json', '127.0.0.1', 'port 3000']);
  });

  it('localPortsOf reads reportRules.localPorts and refuses anything but a list of port numbers', () => {
    expect(localPortsOf({})).toEqual([]);
    expect(localPortsOf(null)).toEqual([]);
    expect(localPortsOf({ reportRules: { localPorts: [3002, 3002, 54421] } })).toEqual([3002, 54421]);
    for (const bad of [['3002'], [0], [65536], [30.5], 3002, ':3002']) {
      expect(() => localPortsOf({ reportRules: { localPorts: bad } })).toThrow(/reportRules\.localPorts must be a list of port numbers/);
    }
  });
});

describe('the lint config (readRunConfig) carries reportRules.localPorts', () => {
  let t: TmpAegis;
  beforeEach(() => { t = makeAegisRoot(); });
  afterEach(() => t.cleanup());

  it('is [] by default, the listed ports when set, and invalid-input when malformed', () => {
    expect(readRunConfig(t.root).reportRules.localPorts).toEqual([]);
    setConfig(t.root, { reportRules: { localPorts: [4010] } });
    expect(readRunConfig(t.root).reportRules.localPorts).toEqual([4010]);
    setConfig(t.root, { reportRules: { localPorts: ['4010'] } });
    expect(thrownCode(() => readRunConfig(t.root))).toBe('invalid-input');
  });
});

describe('H1 reads localPorts through loadGuardContext and exempts defect reproduction data', () => {
  let t: TmpAegis;
  let runId: string;
  beforeEach(async () => { t = makeAegisRoot(); runId = await startedRun(t.root); });
  afterEach(() => t.cleanup());

  const ctxAt = (phase: string): GuardContext => ({ ...loadGuardContext(t.root), currentPhase: phase as GuardContext['currentPhase'] });
  const write = (rel: string, content: string, who: string): HookToolInput => ({ tool_name: 'Write', tool_input: { file_path: path.join(t.root, 'runs', runId, rel), content }, cwd: t.root, agent_type: who, agent_id: 'a1' });
  const deps = { cliAllowed: () => null };
  const closure = (text: string) => decide(write('reports/closure/closure.md', text, 'qa-closure-reporter'), ctxAt('closure-draft'), deps);

  it('a project with other localPorts is flagged on them; the default flags localhost:3000 and [::1]:3000 but no bare :N', () => {
    expect(closure('The stub on :4010 answered.').allow).toBe(true);
    setConfig(t.root, { reportRules: { localPorts: [4010] } });
    expect(loadGuardContext(t.root).localPorts).toEqual([4010]);
    const r = closure('The stub on :4010 answered.');
    expect(r.allow).toBe(false);
    expect(!r.allow && r.reason).toMatch(/tooling wording \(":4010".*write the local test server \(no port\) instead/);
    expect(closure('The app on :3002 answered.').allow).toBe(true);
    for (const host of ['The app served localhost:3000.', 'The app served [::1]:3000.']) expect([host, closure(host).allow]).toEqual([host, false]);
  });

  it('a malformed localPorts fails closed like a corrupt config', () => {
    setConfig(t.root, { reportRules: { localPorts: 'all' } });
    expect(() => loadGuardContext(t.root)).toThrow(/reportRules\.localPorts must be a list of port numbers/);
  });

  // The real shapes of the three runs: R12 DEF-005-COMMS-EXP step 1, the ruled-out notes of R12/R06, S05's build line and history event.
  const RECORD = {
    id: 'DEF-005-COMMS-EXP',
    title: 'Opening a communication with a malformed id shows a raw error page',
    reproductionSteps: [{ step: 1, action: 'Log in as an admin and open http://127.0.0.1:3002/communications/not-a-uuid.' }],
    originConfirmation: {
      ruledOut: [
        'environment/stale-build: reproduced on the restarted :3002 server and independently by a rolled-back SQL insert that raised 23503',
        'G2 re-triage (read-only source verification at f1c1715). Citations: rtm.json row for REQ-COMMS-004 and the route handler.',
      ],
    },
    environment: { build: 'Next.js dev server, port 3000, commit ebf4b42' },
    history: [{ at: '2026-10-05T10:00:00Z', event: 'Opened from execution-summary.json row TC-COMMS-007 (FAIL)' }],
  };

  it('the real defect shapes pass H1 as JSON and as markdown, with the project listing 3002', () => {
    setConfig(t.root, { reportRules: { localPorts: [3002] } });
    const triage = ctxAt('triage');
    const json = decide(write(`defects/${RECORD.id}.json`, JSON.stringify(RECORD, null, 2), 'qa-defect-manager'), triage, deps);
    expect(json).toMatchObject({ allow: true });
    const md = `# ${RECORD.id}\n\n1. ${RECORD.reproductionSteps[0]!.action}\n\nRuled out: ${RECORD.originConfirmation.ruledOut.join(' ')}\n\nBuild: ${RECORD.environment.build}\n`;
    expect(decide(write(`defects/${RECORD.id}.md`, md, 'qa-defect-manager'), triage, deps)).toMatchObject({ allow: true });
  });

  it('a defect title with a path, file name or host is still refused, naming the title', () => {
    const triage = ctxAt('triage');
    for (const title of ['Export fails while reading rtm.json', 'Login page at 127.0.0.1 shows a raw error', 'Report lists reports/metrics/coverage.json']) {
      const r = decide(write(`defects/${RECORD.id}.json`, JSON.stringify({ ...RECORD, title }), 'qa-defect-manager'), triage, deps);
      expect([title, r.allow]).toEqual([title, false]);
      expect(!r.allow && r.reason).toMatch(/tooling wording .* at \.title\)/);
    }
  });

  it('a word rule still denies in a defect record, and the triage summary keeps every rule', () => {
    const triage = ctxAt('triage');
    const word = decide(write(`defects/${RECORD.id}.json`, JSON.stringify({ ...RECORD, originConfirmation: { ruledOut: ['all 7 passing (T-execution-32 work report, this round)'] } }), 'qa-defect-manager'), triage, deps);
    expect(!word.allow && word.reason).toMatch(/"work report"/);
    const summary = decide(write('defects/triage-summary.md', 'The app ran on http://127.0.0.1:3002 during triage.', 'qa-defect-manager'), triage, deps);
    expect(!summary.allow && summary.reason).toMatch(/"127\.0\.0\.1"/);
  });

  const edit = (rel: string, newString: string): HookToolInput => ({ tool_name: 'Edit', tool_input: { file_path: path.join(t.root, 'runs', runId, rel), old_string: 'x', new_string: newString }, cwd: t.root, agent_type: 'qa-defect-manager', agent_id: 'a1' });

  it('an Edit fragment of a defect record: a title member or a lone string value takes every rule, any other member only the word rules', () => {
    const triage = ctxAt('triage');
    const json = `defects/${RECORD.id}.json`;
    for (const fragment of ['"title": "Export fails reading rtm.json"', '"title":"Export fails at http://127.0.0.1:3002/x",\n  "severity": "Sev3"', '"Export fails reading rtm.json"']) {
      const r = decide(edit(json, fragment), triage, deps);
      expect([fragment, r.allow]).toEqual([fragment, false]);
      expect(!r.allow && r.reason).toMatch(/tooling wording .* at \.title\)/);
    }
    for (const fragment of ['"action": "Open http://127.0.0.1:3002/x and compare with rtm.json"', '"build": "Next.js dev server, port 3000",', '"why": "Why does the attempt count decrement in this case?"']) {
      expect([fragment, decide(edit(json, fragment), triage, deps).allow]).toEqual([fragment, true]);
    }
    const multi: HookToolInput = { tool_name: 'MultiEdit', tool_input: { file_path: path.join(t.root, 'runs', runId, json), edits: [{ old_string: 'a', new_string: '"action": "open localhost:3000"' }, { old_string: 'b', new_string: '"title": "Crash in coverage.json export"' }] }, cwd: t.root, agent_type: 'qa-defect-manager', agent_id: 'a1' };
    expect(decide(multi, triage, deps).allow).toBe(false);
  });

  it('the markdown twin: its first # heading takes every rule, the body only the word rules', () => {
    const triage = ctxAt('triage');
    const md = `defects/${RECORD.id}.md`;
    const body = `\n\n1. ${RECORD.reproductionSteps[0]!.action}\n`;
    const bad = decide(write(md, `# ${RECORD.id}: Export fails reading rtm.json${body}`, 'qa-defect-manager'), triage, deps);
    expect(!bad.allow && bad.reason).toMatch(/"rtm\.json".* at \.title\)/);
    expect(decide(write(md, `# ${RECORD.id}: ${RECORD.title}${body}`, 'qa-defect-manager'), triage, deps).allow).toBe(true);
    expect(decide(edit(md, `2. Open http://127.0.0.1:3002/x again; see rtm.json.`), triage, deps).allow).toBe(true);
  });

  it("S05's application attempt count is allowed in a defect record and refused in the closure and the triage summary", () => {
    const text = 'Why does the attempt count decrement in this case?';
    expect(decide(write(`defects/${RECORD.id}.json`, JSON.stringify({ ...RECORD, rootCause: { fiveWhys: [{ why: text }] } }), 'qa-defect-manager'), ctxAt('triage'), deps).allow).toBe(true);
    const c = closure(text);
    expect(!c.allow && c.reason).toMatch(/"attempt count"/);
    const summary = decide(write('defects/triage-summary.md', text, 'qa-defect-manager'), ctxAt('triage'), deps);
    expect(!summary.allow && summary.reason).toMatch(/"attempt count"/);
    expect(findToolingWords('The review count was 3.', { kinds: ['word'] }).map((h) => h.phrase)).toEqual(['review count']);
  });

  it('a CIDR range is not a host: 0.0.0.0/0 is allowed in a compliance report, 0.0.0.0 and 0.0.0.0:8080 are not', () => {
    const cmmi = (text: string) => decide(write('reports/compliance/cmmi.md', text, 'qa-compliance-cmmi'), ctxAt('compliance'), deps);
    expect(cmmi('The security group allows 0.0.0.0/0 ingress on the public load balancer.')).toMatchObject({ allow: true });
    for (const text of ['The service bound 0.0.0.0:8080.', 'The service bound 0.0.0.0 at start.']) {
      const r = cmmi(text);
      expect(!r.allow && r.reason).toMatch(/tooling wording \("0\.0\.0\.0/);
    }
  });

  it('the same reproduction text in reports/closure/** is still denied', () => {
    setConfig(t.root, { reportRules: { localPorts: [3002] } });
    const r = decide(write('reports/closure/closure.json', JSON.stringify({ evaluation: RECORD.originConfirmation.ruledOut, steps: RECORD.reproductionSteps }), 'qa-closure-reporter'), ctxAt('closure-draft'), deps);
    expect(!r.allow && r.reason).toMatch(/tooling wording \(":3002".* at \.evaluation\[0\]\)/);
    for (const text of [RECORD.reproductionSteps[0]!.action, RECORD.environment.build, RECORD.history[0]!.event, RECORD.originConfirmation.ruledOut[1]!]) {
      expect([text, closure(text).allow]).toEqual([text, false]);
    }
  });
});

describe('the report scripts read localPorts from the project config', () => {
  const closureWith = (text: string) => ({ metrics: { passed: 5, failed: 0, blocked: 0 }, variancesFromPlan: [{ variance: text, reason: 'Owner decision.' }] });
  const withPorts = (root: string, localPorts: unknown) => {
    fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify({ dashboard: { projectName: 'Northwind Portal' }, reportRules: { localPorts } }));
  };

  it('the technical report (7) and the sign-off (9) refuse a listed :N and render it when the project does not list it', () => {
    const files = { 'reports/closure/closure.json': closureWith('The stand-in feed ran on :4010 only.'), 'gates/gate-3-decision.json': GATE3 };
    const plain = fixture(files);
    for (const s of [SCRIPT.technical, SCRIPT.signoff]) expect(run(s, plain.root).stderr).not.toMatch(/tooling phrase/);
    const listed = fixture(files);
    withPorts(listed.root, [4010]);
    for (const [s, code] of [[SCRIPT.technical, 7], [SCRIPT.signoff, 9]] as const) {
      const r = run(s, listed.root);
      expect(r.status).toBe(code);
      expect(r.stderr).toContain('closure.json.variancesFromPlan[0].variance: ":4010" -> write the local test server (no port)');
    }
  });

  it('an unreadable aegis.config.json stops every script with exit 2 and says so, instead of rendering without the ports', () => {
    const { root, runDir } = fixture({ 'reports/closure/closure.json': closureWith('The stand-in feed ran on :4010 only.'), 'gates/gate-3-decision.json': GATE3, 'reports/executive/executive-deck.json': { keyFinding: 'k', supportingInsights: [], recommendations: [], residualRisks: [] } });
    fs.writeFileSync(path.join(root, 'aegis.config.json'), '{"reportRules": {"localPorts": [4010]');
    for (const s of [SCRIPT.technical, SCRIPT.signoff, SCRIPT.slides]) {
      const r = run(s, root);
      expect([s, r.status]).toEqual([s, 2]);
      expect(r.stderr).toMatch(/aegis\.config\.json cannot be read \(.*\); the owner repairs it/);
    }
    expect(fs.existsSync(path.join(runDir, 'reports', 'executive', 'technical-report.pdf'))).toBe(false);
  });

  it('the deck (10) refuses a listed :N, and every script exits 2 on a malformed localPorts', () => {
    const DECK = {
      keyFinding: 'All critical customer journeys were tested; one login issue remains open.',
      supportingInsights: [
        { what: 'The stand-in feed on :4010 answered every call', soWhat: 'Core flows work', nowWhat: 'Fix the login issue' },
        { what: 'Three issues are open', soWhat: 'Some users retry login', nowWhat: 'Fix before launch' },
      ],
      recommendations: [{ action: 'Fix the login issue', owner: 'Engineering', deadline: '2026-10-11', impact: 'HIGH' }],
      residualRisks: [{ plain: 'Login may fail for some users.' }],
    };
    const files = { 'reports/closure/closure.json': { metrics: {} }, 'reports/executive/executive-deck.json': DECK, 'gates/gate-3-decision.json': GATE3 };
    expect(run(SCRIPT.slides, fixture(files).root).stderr).not.toMatch(/tooling phrase/);
    const listed = fixture(files);
    withPorts(listed.root, [4010]);
    const r = run(SCRIPT.slides, listed.root);
    expect(r.status).toBe(10);
    expect(r.stderr).toContain('executive-deck.json.supportingInsights[0].what: ":4010"');
    const bad = fixture({ ...files, 'reports/closure/closure.json': closureWith('Plain.') });
    withPorts(bad.root, ['4010']);
    for (const s of [SCRIPT.technical, SCRIPT.signoff, SCRIPT.slides]) {
      const b = run(s, bad.root);
      expect([s, b.status]).toEqual([s, 2]);
      expect(b.stderr).toMatch(/reportRules\.localPorts must be a list of port numbers/);
    }
  });
});
