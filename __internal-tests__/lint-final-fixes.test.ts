import * as fs from 'fs';
import * as path from 'path';
import { createRun, lintBlockMessage, lintRun, maskedLines, maskPersonalData, notScannedCount, readRunConfig, resolveRules, runDir, scanPii, scanWithRules } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

const PII = { syntheticEmailDomains: [], syntheticNamePrefixes: ['QA', 'Test', 'E2E', 'Dummy', 'Sample'], syntheticPhonePatterns: [], syntheticValues: [] };
const rules = (budget: number | null = 0) => resolveRules({ extend: [], disable: [], allow: [], pii: PII }, budget);
const ids = (text: string, budget: number | null = 0) => scanWithRules('closure.md', text, rules(budget), []).map((f) => f.rule);

describe('I1: no real-looking value is printed anywhere', () => {
  const RAW = ['S1234567D', 'tan@gmail.com', '9123 4567', 'Tan Wei Ming'];
  let t: TmpAegis;
  let runId: string;
  beforeEach(async () => {
    t = makeAegisRoot();
    runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
  });
  afterEach(() => t.cleanup());
  const put = (rel: string, v: string) => {
    const f = path.join(runDir(t.root, runId), rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, v);
  };

  it('the context of a wording finding masks an NRIC, an email and a phone number on the same line', () => {
    const fs = scanWithRules('closure.md', 'Found this cycle for S1234567D, tan@gmail.com, +65 9123 4567', rules(), []);
    expect(fs.map((f) => f.rule)).toEqual(['qa-cycle']);
    for (const v of ['S1234567D', 'tan@gmail.com', '+65 9123 4567', '9123 4567']) expect(fs[0]!.context).not.toContain(v);
    expect(fs[0]!.context).toContain('S****567D');
  });

  it('maskPersonalData masks a person name under a label and maps offsets', () => {
    const m = maskPersonalData('| Name | Tan Wei Ming | this cycle |');
    expect(m.text).not.toContain('Tan Wei Ming');
    expect(m.text.slice(m.map('| Name | Tan Wei Ming | '.length, 'start'))).toMatch(/^this cycle/);
  });

  it('an invalid JSON file is skipped with exactly "not valid JSON", never the parser text', async () => {
    put('defects/DEF-001-AUTH-UI.json', '{"nric": S1234567D}');
    const r = await lintRun(t.root, runId, 'G2', 'qa-orchestrator');
    expect(r.skipped).toEqual([{ file: 'defects/DEF-001-AUTH-UI.json', reason: 'not valid JSON' }]);
    expect(r.note).toBe('1 file(s) were not scanned (see skipped in the report)');
  });

  it('none of the raw values appears in the stored report or the returned object', async () => {
    put('reports/closure/closure.md', [
      'Found this cycle for S1234567D.',
      'This cycle tan@gmail.com wrote in.',
      'Call this cycle on +65 9123 4567.',
      '| Name | Tan Wei Ming | this cycle |',
    ].join('\n') + '\n');
    put('defects/DEF-002-AUTH-UI.json', '{"nric": S1234567D, "email": tan@gmail.com, "phone": 9123 4567, "name": Tan Wei Ming}');
    const r = await lintRun(t.root, runId, 'G3', 'qa-orchestrator');
    expect(r.findings.filter((f) => f.rule === 'qa-cycle')).toHaveLength(4);
    const stored = fs.readFileSync(path.join(runDir(t.root, runId), 'reports/lint/gate-G3.json'), 'utf8');
    for (const v of RAW) {
      expect(stored).not.toContain(v);
      expect(JSON.stringify(r)).not.toContain(v);
    }
  });
});

describe('I4: the two refusal texts', () => {
  const e = [{ file: 'defects/DEF-001-AUTH-UI.md', line: 1, rule: 'qa-cycle' }];
  it('the phase-complete text asks for a correction task; the gate-open text says the phase is already complete and names the owner recovery', () => {
    const phase = lintBlockMessage('G2', e, 'phase-complete');
    expect(phase).toContain('correction task');
    expect(phase).toContain('aegis lint run --gate G2');
    const open = lintBlockMessage('G2', e, 'gate-open');
    expect(open).toContain('already complete');
    expect(open).not.toContain('correction task');
    expect(open).toMatch(/reportRules\.allow/);
    expect(open).toMatch(/\. Run aegis lint run --gate G2 for the detail/);
  });
  it('both end with the not-scanned note when files were skipped, neither otherwise', () => {
    for (const at of ['phase-complete', 'gate-open'] as const) {
      expect(lintBlockMessage('G3', e, at, 2).endsWith('2 file(s) were not scanned (see skipped in the report)')).toBe(true);
      expect(lintBlockMessage('G3', e, at)).not.toContain('not scanned');
    }
  });
});

describe('I5: a hard time budget on hostile input', () => {
  const time = (fn: () => unknown): number => { const t0 = Date.now(); fn(); return Date.now() - t0; };
  const both = (text: string) => () => { scanWithRules('closure.md', text, rules(), []); scanPii('closure.md', text, PII); };
  it.each([
    ['100k curly quotes', '“'.repeat(100_000)],
    ['100k "T-"', 'T-'.repeat(100_000)],
    ['name + 100k spaces + x', 'name' + ' '.repeat(100_000) + 'x'],
    ['| name | + 100k spaces + x', '| name |' + ' '.repeat(100_000) + 'x'],
    ['10k unclosed fences', '```js\n'.repeat(10_000)],
    ['20k dashes in a table separator', '| a |\n' + '|' + '-'.repeat(20_000) + 'x\n'],
  ])('%s finishes in under 500 ms', (_name, text) => {
    expect(time(both(text))).toBeLessThan(500);
  });
  it('a 5 MB file of 5,000 ordinary lines scans in under 3 s', () => {
    const line = 'The volunteer registration page rejects an empty password and shows the message to the user. '.repeat(11).slice(0, 1000);
    const text = Array.from({ length: 5_000 }, () => line).join('\n');
    expect(text.length).toBeGreaterThan(4_900_000);
    expect(time(both(text))).toBeLessThan(3_000);
  });
  it('the patterns themselves are fast on 100k characters (no reliance on the line guard)', () => {
    expect(time(() => maskedLines('“'.repeat(100_000)))).toBeLessThan(500);
    expect(time(() => maskedLines('```js\n'.repeat(10_000)))).toBeLessThan(500);
    const task = rules().find((r) => r.id === 'internal-task-id')!.re;
    expect(time(() => task.test('T-'.repeat(100_000)))).toBeLessThan(500);
  });
  it('a line over 20000 characters is scanned in its first 20000 characters only', () => {
    const text = 'x'.repeat(20_010) + ' this cycle';
    expect(ids(text)).toEqual([]);
    expect(ids('this cycle ' + 'x'.repeat(30_000))).toEqual(['qa-cycle']);
  });
  it('the unclosed fence is still read as prose, once', () => {
    expect(ids('```js\nthis cycle\nmore')).toEqual(['qa-cycle']);
    expect(ids('```js\ncode this cycle\n```\nthe rest')).toEqual([]);
  });
});

describe('the long line note', () => {
  let t: TmpAegis;
  afterEach(() => t.cleanup());
  it('names a file with a line over 20000 characters as scanned in part, and it never blocks', async () => {
    t = makeAegisRoot();
    const runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
    const f = path.join(runDir(t.root, runId), 'reports/closure/closure.md');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'a'.repeat(25_000) + '\n');
    const r = await lintRun(t.root, runId, 'G3', 'qa-orchestrator');
    expect(r).toMatchObject({ ok: true, filesScanned: 1, skipped: [{ file: 'reports/closure/closure.md', reason: 'line over 20000 characters: scanned in part' }] });
  });
});

describe('minors', () => {
  it('qa-round: a round trip is not a QA round, in both spellings, and this round still is', () => {
    expect(ids('the round trip to the server')).not.toContain('qa-round');
    expect(ids('this round trip is slow')).not.toContain('qa-round');
    expect(ids('this round-trip is slow')).not.toContain('qa-round');
    expect(ids('that round trip time')).not.toContain('qa-round');
    expect(ids('Re-confirmed this round per the owner')).toContain('qa-round');
  });

  it('manual-testing also catches executed manually, manual verification, manually executed/verified/tested (only with a zero budget)', () => {
    for (const l of ['The case was executed manually.', 'Done by manual verification.', 'It was manually verified.', 'manually executed twice', 'manually tested once']) {
      expect(ids(l)).toContain('manual-testing');
      expect(ids(l, 20)).not.toContain('manual-testing');
    }
    expect(ids('The manual for the device')).not.toContain('manual-testing');
  });

  it('gate-history flags the owner gate decisions and earlier drafts, and leaves a gate to a building alone', () => {
    for (const l of [
      'Re-run after the owner Gate 2 rejection.', 'after the owner\u2019s Gate 2 rejection', "after the owner's Gate 2 rejection", 'per the owner G3 decision', 'Following Gate 2 decision the scope changed',
      'Since the gate 3 rejection', 'owner G2 rejection noted', 'the closure draft said 12 defects', 'the draft said that nothing failed', 'this version corrects the counts', 'this final pass corrects the figures',
    ]) expect(ids(l)).toContain('gate-history');
    for (const l of [
      'the gate to the building', 'the draft board', 'Gate 2 of the airport', 'a decision after gate entry', 'the owner decision log',
      'reported earlier than the timeout', 'this version corrects the typo in the label', 'the draft said nothing', 'as reported earlier',
    ]) expect(ids(l)).not.toContain('gate-history');
  });
});

describe('config minors', () => {
  let t: TmpAegis;
  beforeEach(() => { t = makeAegisRoot(); });
  afterEach(() => t.cleanup());
  const set = (extra: object) => {
    const f = path.join(t.root, 'aegis.config.json');
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), ...extra }));
  };
  it('refuses a blank syntheticPhonePatterns entry like a blank syntheticValues entry', () => {
    set({ reportRules: { pii: { syntheticPhonePatterns: [''] } } });
    expect(() => readRunConfig(t.root)).toThrow(/syntheticPhonePatterns\[0\] must not be blank/);
    set({ reportRules: { pii: { syntheticPhonePatterns: ['  '] } } });
    expect(() => readRunConfig(t.root)).toThrow(/must not be blank/);
  });
  it('refuses a testing.manualBudgetPercent that is not a number; absent stays null', () => {
    expect(readRunConfig(t.root).manualBudgetPercent).toBeNull();
    set({ testing: {} });
    expect(readRunConfig(t.root).manualBudgetPercent).toBeNull();
    set({ testing: { manualBudgetPercent: '0' } });
    expect(() => readRunConfig(t.root)).toThrow('aegis.config.json#testing.manualBudgetPercent must be a number');
    set({ testing: { manualBudgetPercent: 0 } });
    expect(readRunConfig(t.root).manualBudgetPercent).toBe(0);
  });
});

describe('I2 and I3: the agent files', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '.claude', 'agents', rel), 'utf8');
  const reporters = ['tier1-phase/qa-executive-reporter.md', 'tier1-phase/qa-test-planner.md', ...['iso25010', 'iso5055', 'istqb', 'cmmi', 'gdpr', 'pdpa'].map((c) => `compliance/qa-compliance-${c}.md`)];
  const specialists = ['ui', 'api', 'unit', 'database', 'security', 'accessibility', 'responsive', 'messaging', 'performance', 'realtime', 'feature-flag', 'exploratory'].map((n) => `tier2-specialist/qa-${n}-specialist.md`);
  it.each(reporters)('%s carries the pre-gate lint sentence', (rel) => expect(read(rel)).toMatch(/The pre-gate lint refuses Gate \d while a customer-facing file carries/));
  it.each([...specialists, 'tier2-specialist/qa-web-explorer.md'])('%s says its files are scanned for personal data', (rel) => expect(read(rel)).toMatch(/scanned for personal data \(a valid NRIC/));
  it('the exploratory specialist never derives a session name from a task id', () => expect(read('tier2-specialist/qa-exploratory-specialist.md')).toContain('never after a task id'));
  it('no agent file tells an agent to write a sentence the lint rejects', () => {
    const closure = read('tier1-phase/qa-closure-reporter.md');
    const planner = read('tier1-phase/qa-test-planner.md');
    for (const phrase of ['applied to this cycle', 'untested in this cycle', 'tested this cycle', 'after this cycle']) {
      expect(closure).not.toContain(phrase);
      expect(planner).not.toContain(phrase);
    }
    expect(closure).toContain('`Test date:`');
  });
  it('the defect manager step 10 allows a lint correction task', () => expect(read('tier1-phase/qa-defect-manager.md')).toContain('pre-gate lint is the same kind of dispatch'));
  it('the orchestrator sends result records to the specialist and the RTM defect table to the defect manager', () => {
    const o = read('orchestrator/qa-orchestrator.md');
    expect(o).toMatch(/result records, cases\/\*-result\*\.json: the specialist that wrote the result/);
    expect(o).toMatch(/defect table inside rtm\.md is rendered by the CLI/);
    expect(o).toContain('the phase is already complete and no correction task can be added');
  });
});

describe('round 2: names, long lines and small fixes', () => {
  const noNameIn = (text: string, pii = PII) => {
    const all = [...scanPii('closure.md', text, pii), ...scanWithRules('closure.md', text, rules(), [])];
    expect(all.length).toBeGreaterThan(0);
    for (const f of all) for (const part of ['Tan', 'Wei', 'Ming']) expect(f.context).not.toContain(part);
    return all;
  };

  it.each([
    '| Name | Tan Wei Ming | S1234567D |',
    'Name: Tan Wei Ming, phone +65 9123 4567',
    'Name: Tan Wei Ming, email tan@gmail.com',
    'Full name: Tan Wei Ming this cycle',
    'full name: Tan Wei Ming this cycle', // a line derived from a JSON key
    '- **Name:** Tan Wei Ming (S1234567D)',
  ])('no part of the name appears in any context of any finding: %s', (line) => { noNameIn(line); });

  it('a surname alone is masked in a wording context, and an application noun reports nothing', () => {
    const f = scanWithRules('closure.md', 'Surname: Tan this cycle', rules(), []);
    expect(f.map((x) => x.rule)).toEqual(['qa-cycle']);
    expect(f[0]!.context).not.toContain('Tan');
    expect(scanPii('closure.md', 'Name: Volunteer Registration', PII)).toEqual([]);
    expect(ids('Name: Volunteer Registration')).toEqual([]);
  });

  it('a path with a valid NRIC is shown masked in findings.file and skipped.file', async () => {
    const t = makeAegisRoot();
    try {
      const runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
      const put = (rel: string, v: string) => { const f = path.join(runDir(t.root, runId), rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, v); };
      put('defects/S1234567D.md', 'Found this cycle.\n');
      put('defects/S1234567D.json', '{ not json');
      const r = await lintRun(t.root, runId, 'G2', 'qa-orchestrator');
      expect(r.findings.map((f) => f.file)).toEqual(['defects/S****567D.md']);
      expect(r.skipped.map((f) => f.file)).toEqual(['defects/S****567D.json']);
      expect(fs.readFileSync(path.join(runDir(t.root, runId), 'reports/lint/gate-G2.json'), 'utf8')).not.toContain('S1234567D');
    } finally { t.cleanup(); }
  });

  describe('a very long line is read for personal data in chunks, never cut', () => {
    const filler = (n: number) => 'lorem ipsum '.repeat(Math.ceil(n / 12)).slice(0, n);
    const found = (text: string) => scanPii('closure.md', text, PII).map((f) => f.rule).sort();
    it('a valid NRIC, an email and a phone after character 20,000 are each found once', () => {
      expect(found(filler(25_000) + ' S1234567D')).toEqual(['pii-nric']);
      expect(found(filler(30_000) + ' tan@gmail.com')).toEqual(['pii-email']);
      expect(found(filler(30_000) + ' call +65 9123 4567')).toEqual(['pii-phone']);
    });
    it('a value straddling a chunk boundary is found exactly once, at each boundary position', () => {
      for (const at of [19_590, 19_595, 19_600, 19_605, 39_195, 39_200]) {
        const text = filler(at) + ' S1234567D ' + filler(25_000);
        expect(found(text)).toEqual(['pii-nric']);
      }
      expect(found(filler(19_598) + ' tan@gmail.com ' + filler(25_000))).toEqual(['pii-email']);
    });
    it('the finding keeps the real line number and masks the value in its context', () => {
      const [f] = scanPii('closure.md', 'first\n' + filler(30_000) + ' S1234567D', PII);
      expect(f).toMatchObject({ rule: 'pii-nric', line: 2 });
      expect(f!.context).not.toContain('S1234567D');
    });
    it('a 5 MB file of 250 lines of 20,000 characters, and of 25,000, finishes in under 3 s', () => {
      for (const len of [20_000, 25_000]) {
        const text = Array.from({ length: 250 }, () => filler(len)).join('\n');
        const t0 = Date.now();
        scanPii('closure.md', text, PII);
        scanWithRules('closure.md', text, rules(), []);
        expect(Date.now() - t0).toBeLessThan(3_000);
      }
    });
    it('a file whose only note is the long line does not count as not scanned', async () => {
      const t = makeAegisRoot();
      try {
        const runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
        const f = path.join(runDir(t.root, runId), 'reports/closure/closure.md');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, filler(25_000) + ' S1234567D\n');
        const r = await lintRun(t.root, runId, 'G3', 'qa-orchestrator');
        expect(r.findings.map((x) => x.rule)).toEqual(['pii-nric']);
        expect(r.skipped).toEqual([expect.objectContaining({ reason: expect.stringMatching(/^line over 20000/) })]);
        expect(r.note).toBeUndefined();
        expect(notScannedCount(r.skipped)).toBe(0);
      } finally { t.cleanup(); }
    });
  });

  it('the gate-open text names only possible actions', () => {
    const open = lintBlockMessage('G3', [{ file: 'a.md', line: 1, rule: 'qa-cycle' }], 'gate-open');
    expect(open).toContain('already complete');
    expect(open).toContain('the orchestrator then opens the gate again');
    expect(open).toContain('the owner rejects the open gate and reopens the phase');
    expect(open).not.toContain('or a reopened phase');
  });

  it.each(['evidence/TC-ENG-014/stub-run-full-T-execution-31.json', 'a_T-execution-3', 'Re-verified (T-execution-3)', 'see T-GATE-G12', 'T-closure-final-2'])('an internal task id joined to a name is still flagged: %s', (line) => {
    expect(ids(line)).toContain('internal-task-id');
  });
  it.each(['ST-1 is a station', 'Part-1 of the form', 'TC-AUTH-031 passed', 'T-' + 'a-'.repeat(40)])('is not a task id: %s', (line) => {
    expect(ids(line)).not.toContain('internal-task-id');
  });
  it('the task id and curly-quote patterns stay fast on hostile input', () => {
    const task = rules().find((r) => r.id === 'internal-task-id')!.re;
    for (const text of ['T-'.repeat(50_000), 'T-a-'.repeat(30_000), '-T-'.repeat(50_000)]) {
      const t0 = Date.now();
      task.test(text);
      expect(Date.now() - t0).toBeLessThan(200);
    }
    const t0 = Date.now();
    for (let i = 0; i < 250; i++) maskedLines('“'.repeat(20_000));
    expect(Date.now() - t0).toBeLessThan(750); // 3 ms a line
  });
});
