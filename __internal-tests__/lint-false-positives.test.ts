import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findPlainLanguage } from '@qa/contracts';
import { decide, type GuardContext, type HookToolInput } from '@qa/path-guard';
import { addTask, claimTask, lintFindings, readRunConfig, runDir, submitWorkReport } from '@qa/run-state';
import { makeAegisRoot, startedRun, type TmpAegis } from './helpers/aegis-root';
import { ORCH, TS } from './helpers/pipeline';

// The false positives of the end-to-end replay over three finished runs: the checks fired on text nobody can change (framework-made
// identifiers, the append-only audit fields of a defect, the config's own fake recipient) or on a severity name. Each block holds the
// shape that was a false positive and the real problem the same rule must keep catching.

let t: TmpAegis;
let runId: string;
afterEach(() => t.cleanup());
beforeEach(async () => {
  t = makeAegisRoot();
  runId = await startedRun(t.root);
});

const put = (rel: string, v: unknown) => {
  const f = path.join(runDir(t.root, runId), rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2));
};
const lint = (gate?: 'G2' | 'G3') => lintFindings(t.root, runId, gate).findings.filter((f) => f.kind !== 'data');
const rulesOf = (file: string, gate?: 'G2' | 'G3') => lint(gate).filter((f) => f.file === file).map((f) => f.rule).sort();

const DEFECT = {
  id: 'DEF-001-ATT-UI', title: 'Centre create loses the mid-save draft', summary: 'The draft is lost when the save is interrupted.',
  reproductionSteps: [{ step: 1, action: 'Open the centre form and start a save.' }], expectedResult: 'The draft stays.', actualResult: 'The draft is gone.',
};
const AUDIT = "Re-verified this round per the owner's G2 rejection (T-execution-32, the cycle took 3 hours).";

describe('internal-task-id: a generated identifier or file name is not prose', () => {
  it('charterSessionId of an RTM row and of a defect is never flagged; a task id in a description or a summary still is', () => {
    put('rtm.json', { rows: [{ requirementId: 'REQ-ATT-001', description: 'Attendance is recorded.', charterSessionId: 'T-explore-3-session1' }, { requirementId: 'REQ-ATT-002', description: 'Check-in.', charterSessionId: 'T-explore-2-session1; EXP-RETEST-001' }] });
    put('defects/DEF-001-ATT-UI.json', { ...DEFECT, charterSessionId: 'T-explore-4-session1' });
    expect(lint('G2')).toEqual([]);
    put('rtm.json', { rows: [{ requirementId: 'REQ-ATT-001', description: 'Found by T-explore-3 in the session.', charterSessionId: 'T-explore-3-session1' }] });
    put('defects/DEF-001-ATT-UI.json', { ...DEFECT, summary: 'The draft is lost; see T-execution-3 for the run.', charterSessionId: 'T-explore-4-session1' });
    expect(rulesOf('rtm.json')).toEqual(['internal-task-id']);
    expect(rulesOf('defects/DEF-001-ATT-UI.json')).toEqual(['internal-task-id']);
  });

  it('a whitespace-free path under an evidence key is data, a sentence under the same key is prose', () => {
    const evidence = 'evidence/DEF-001-ATT-UI/T-explore-4-session1_centre-create-mid-save_20261007T105424Z.png';
    put('defects/DEF-001-ATT-UI.json', {
      ...DEFECT, evidence: { screenshots: [evidence] }, rootCause: { status: 'identified', summary: 'A race in the save.', evidence: [evidence] },
      originConfirmation: { ruledOut: ['test setup'], reproducedOnClean: true, evidenceRef: 'evidence/DEF-001-ATT-UI/T-explore-4-session1.json' },
    });
    expect(lint('G2')).toEqual([]);
    put('defects/DEF-001-ATT-UI.json', { ...DEFECT, rootCause: { status: 'identified', summary: 'A race.', evidence: ['see T-execution-3 for details'] } });
    expect(rulesOf('defects/DEF-001-ATT-UI.json')).toEqual(['internal-task-id']);
  });

  it('a generated file name cited in the Markdown of a defect or a compliance report is not flagged; a task id in a sentence is', () => {
    put('defects/DEF-001-ATT-UI.md', '# Centre create loses the mid-save draft\n\n## Evidence\n\n- evidence/DEF-001-ATT-UI/T-explore-4-session1_centre-create-mid-save_1.png\n- `reports/exploratory/T-explore-5-session1-notes.md`\n');
    put('reports/compliance/pdpa.md', 'The session notes are in reports/exploratory/T-explore-5-session1-notes.md and evidence/T-explore-5-session1_shot.png.\n');
    expect(lint('G3')).toEqual([]);
    put('reports/compliance/pdpa.md', 'The session T-explore-5-session1 found it, as T-execution-3 confirmed.\n');
    expect(rulesOf('reports/compliance/pdpa.md', 'G3')).toEqual(['internal-task-id', 'internal-task-id']);
  });

  it('stays an error for prose in the closure, the plan, a compliance report and a defect field', () => {
    put('reports/closure/closure.json', { summary: 'Task T-execution-3 was re-run.' });
    put('plan.json', { scope: 'Covered by T-design-2.' });
    put('reports/compliance/iso25010.md', 'Case TC-AUTH-001 (T-execution-3) passed.\n');
    put('defects/DEF-001-ATT-UI.json', { ...DEFECT, expectedResult: 'T-execution-3' });
    for (const f of ['reports/closure/closure.json', 'plan.json', 'reports/compliance/iso25010.md', 'defects/DEF-001-ATT-UI.json']) {
      expect(rulesOf(f, 'G3')).toContain('internal-task-id');
    }
  });
});

describe('the audit fields of a defect (history, investigationLog) are exempt from the wording group', () => {
  const record = (extra: Record<string, unknown> = {}) => ({
    ...DEFECT, history: [{ at: TS, actor: 'QA team', event: AUDIT }], investigationLog: [{ at: TS, agent: 'QA team', note: AUDIT }], ...extra,
  });

  it('the same text in history and investigationLog gives no finding, in the JSON and in its Markdown twin', () => {
    put('defects/DEF-001-ATT-UI.json', record());
    put('defects/DEF-001-ATT-UI.md', `# Centre create loses the mid-save draft\n\n## Summary\n\nThe draft is lost.\n\n## Investigation log\n\n- ${AUDIT}\n\n## History\n\n- ${AUDIT}\n`);
    expect(lint('G2')).toEqual([]);
    expect(lint('G3')).toEqual([]);
  });

  it('the text in every other field of the record, and after the audit sections of the Markdown, is still an error', () => {
    put('defects/DEF-001-ATT-UI.json', record({ summary: AUDIT, actualResult: AUDIT, retestVerdict: { verdict: 'FIXED', reason: AUDIT }, g2Triage: { retestVerdictDetail: AUDIT } }));
    expect(rulesOf('defects/DEF-001-ATT-UI.json')).toEqual(expect.arrayContaining(['qa-cycle', 'qa-round', 're-verified', 'gate-history', 'internal-task-id']));
    put('defects/DEF-001-ATT-UI.json', record());
    put('defects/DEF-001-ATT-UI.md', `# Centre create loses the mid-save draft\n\n## History\n\n- ${AUDIT}\n\n## Retest verdict\n\n${AUDIT}\n\n## Actual\n\nThe cycle took 3 hours.\n`);
    const md = lint().filter((f) => f.file === 'defects/DEF-001-ATT-UI.md');
    expect(md.length).toBeGreaterThan(0);
    expect(md.every((f) => f.line >= 7)).toBe(true);
    put('defects/DEF-001-ATT-UI.md', `# Centre create loses the mid-save draft\n\n## History\n\n- ${AUDIT}\n\n## Investigation log\n\n- ${AUDIT}\n`);
    expect(lint()).toEqual([]);
  });

  it('only a defect record has audit fields: the same keys in the closure, a compliance report or a case are checked', () => {
    put('reports/closure/closure.json', { history: [{ event: AUDIT }], investigationLog: [{ note: AUDIT }] });
    put('reports/compliance/gdpr.json', { history: [AUDIT] });
    put('cases/TC-ATT-001.json', { id: 'TC-ATT-001', title: 'x', history: [AUDIT] });
    for (const f of ['reports/closure/closure.json', 'reports/compliance/gdpr.json', 'cases/TC-ATT-001.json']) expect(rulesOf(f, 'G3')).toContain('qa-round');
  });

  it('personal data and the brand rule still apply inside the audit fields', () => {
    put('defects/DEF-001-ATT-UI.json', record({ history: [{ at: TS, actor: 'QA team', event: 'Volunteer S1234567D was used by qa-ui-specialist.' }] }));
    expect(rulesOf('defects/DEF-001-ATT-UI.json')).toEqual(['brand-name', 'pii-nric']);
  });

  it('tooling words in the audit fields are not a finding (H1 refused them at write; the old entry cannot change), in a title they are', () => {
    put('defects/DEF-001-ATT-UI.json', record({ history: [{ at: TS, actor: 'QA team', event: 'Seen in the work report of the CLI run, see rtm.json.' }] }));
    expect(lint('G2')).toEqual([]);
    put('defects/DEF-001-ATT-UI.json', record({ title: 'Centre create loses the draft (work report)', summary: 'The CLI run lost it for the volunteer.' }));
    expect(rulesOf('defects/DEF-001-ATT-UI.json').filter((r) => r === 'tooling-tier1').length).toBe(2);
  });

  it('the closure and the compliance reports keep every wording rule as an error', () => {
    put('reports/closure/closure.json', { summary: AUDIT });
    put('reports/compliance/istqb.md', `${AUDIT}\n`);
    for (const f of ['reports/closure/closure.json', 'reports/compliance/istqb.md']) {
      expect(rulesOf(f, 'G3')).toEqual(expect.arrayContaining(['qa-cycle', 'qa-round', 're-verified', 'gate-history', 'internal-task-id']));
    }
  });

  it('a defect manager submit stamps only what it can fix: nothing for the audit fields, the id for any other field', async () => {
    put('defects/DEF-001-ATT-UI.json', record());
    put('defects/DEF-001-ATT-UI.md', `# Centre create loses the mid-save draft\n\n## History\n\n- ${AUDIT}\n`);
    await addTask(t.root, runId, { id: 'T-triage-1', title: 'triage', agent: 'qa-defect-manager' }, ORCH);
    await claimTask(t.root, runId, 'T-triage-1', 'qa-defect-manager');
    const wf = path.join(t.root, 'w.json');
    const wr = { taskId: 'T-triage-1', agent: 'qa-defect-manager', startedAt: TS, completedAt: TS, summary: 'Triaged the defect for the submit lint test.', approach: 'Fixture-driven submit test.', artifactsProduced: ['defects/'] };
    fs.writeFileSync(wf, JSON.stringify(wr));
    const clean = await submitWorkReport(t.root, runId, wf, 'qa-defect-manager');
    expect(clean.lint).toMatchObject({ errors: [], filesScanned: 2 });
    expect('lintErrors' in JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), clean.path), 'utf8'))).toBe(false);
    put('defects/DEF-001-ATT-UI.json', record({ summary: 'The draft is lost, re-verified this round.' }));
    const bad = await submitWorkReport(t.root, runId, wf, 'qa-defect-manager');
    expect(bad.lint!.errors.map((e) => e.rule).sort()).toEqual(['qa-round', 're-verified']);
  });
});

describe('H1 does not refuse a tooling word in the audit fields of a defect record, and still refuses it elsewhere', () => {
  const RUN = 'RUN-20261002-001';
  // Not the checkout the tests run in: a worktree under .claude/ is framework territory for the guard, whatever the content.
  const ROOT = path.join(os.tmpdir(), 'aegis-fp-root');
  const RUN_DIR = `${ROOT}/runs/${RUN}`;
  const ctx: GuardContext = {
    aegisRoot: ROOT, targetRoot: path.join(ROOT, '..'), testsDir: path.join(ROOT, '..', 'tests', 'qa'), runDir: RUN_DIR, activeRunId: RUN,
    environment: 'development', currentPhase: 'triage', envPolicy: { mutating: true, allowedSpecialists: ['*'] }, tempDirs: ['/tmp'],
  };
  const deps = { cliAllowed: () => null };
  const write = (file: string, content: string): HookToolInput => ({ tool_name: 'Write', tool_input: { file_path: `${RUN_DIR}/${file}`, content }, cwd: ROOT, agent_type: 'qa-defect-manager', agent_id: 'a1' });
  const rec = (extra: Record<string, unknown>) => JSON.stringify({ ...DEFECT, ...extra });
  const old = [{ at: TS, actor: 'QA team', event: 'Reported in the work report of the CLI, 3 refusals.' }];

  it('allows it in history and investigationLog of the JSON and in the audit sections of the Markdown', () => {
    expect(decide(write('defects/DEF-001-ATT-UI.json', rec({ history: old, investigationLog: [{ at: TS, agent: 'QA team', note: 'work report, localhost:3000' }] })), ctx, deps).allow).toBe(true);
    expect(decide(write('defects/DEF-001-ATT-UI.md', '# Centre create loses the draft\n\n## Summary\n\nThe draft is lost.\n\n## History\n\n- Reported in the work report of the CLI.\n'), ctx, deps).allow).toBe(true);
  });

  it('refuses it in any other field, a Markdown section that is not an audit section, and the brand name anywhere', () => {
    const why = (file: string, content: string) => { const r = decide(write(file, content), ctx, deps); return r.allow ? 'allowed' : r.reason; };
    expect(why('defects/DEF-001-ATT-UI.json', rec({ summary: 'It is in the work report of the CLI run.', history: old }))).toMatch(/tooling wording \("CLI", .* at \.summary\)/);
    expect(why('defects/DEF-001-ATT-UI.md', '# Centre create loses the draft\n\n## History\n\n- fine\n\n## Actual\n\nSee the work report.\n')).toMatch(/tooling wording \("work report"/);
    expect(why('defects/DEF-001-ATT-UI.json', rec({ history: [{ at: TS, actor: 'QA team', event: 'Seen by qa-ui-specialist.' }] }))).toMatch(/matches/);
    expect(why('reports/closure/closure.json', JSON.stringify({ history: old }))).toMatch(/tooling wording/);
  });
});

describe('the config\'s own fake recipients are synthetic values', () => {
  const setConfig = (extra: Record<string, unknown>) => {
    const f = path.join(t.root, 'aegis.config.json');
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), ...extra }));
  };
  const MSG = { adapter: 'commshub', commshub: { contract: { repo: 'x/y', path: 'a.yaml', ref: 'main' } } };

  it('messaging.fakeRecipients phone and email join reportRules.pii.syntheticValues, with the default recipients when none is set', () => {
    setConfig({ messaging: { ...MSG, fakeRecipients: { phone: '+6500001234', email: 'probe@example.org' } }, reportRules: { disable: ['env-probe'], pii: { syntheticValues: ['S1234567D'] } } });
    expect(readRunConfig(t.root).reportRules.pii.syntheticValues).toEqual(['S1234567D', '+6500001234', 'probe@example.org']);
    setConfig({ messaging: MSG });
    expect(readRunConfig(t.root).reportRules.pii.syntheticValues).toEqual(expect.arrayContaining(['+6500000000']));
    setConfig({ messaging: undefined, reportRules: { disable: ['env-probe'] } });
    expect(readRunConfig(t.root).reportRules.pii.syntheticValues).toEqual([]);
  });

  it('a case that quotes the fake recipient is clean, in any spacing; another number, in a case or the closure, is an error', () => {
    setConfig({ messaging: { ...MSG, fakeRecipients: { phone: '+6500001234', email: 'qa-probe@example.com' } } });
    put('cases/TC-COMMS-001.json', { id: 'TC-COMMS-001', steps: ['Send the message to the fake phone (+6500001234) and to +65 0000 1234.'] });
    expect(lint('G2')).toEqual([]);
    put('cases/TC-COMMS-001.json', { id: 'TC-COMMS-001', steps: ['Send the message to the fake phone +6591234567.'] });
    put('reports/closure/closure.md', 'The volunteer phone +65 8123 4567 was used.\n');
    expect(rulesOf('cases/TC-COMMS-001.json')).toEqual(['pii-phone']);
    expect(rulesOf('reports/closure/closure.md', 'G3')).toEqual(['pii-phone']);
  });

  it('a project with no messaging block keeps the number an error', () => {
    put('cases/TC-COMMS-001.json', { id: 'TC-COMMS-001', steps: ['Send the message to the fake phone +6500000000.'] });
    expect(rulesOf('cases/TC-COMMS-001.json')).toEqual(['pii-phone']);
  });
});

describe('tier 2 leaves a severity name alone and keeps the plain-language problem', () => {
  const hits = (s: string) => findPlainLanguage(s).map((h) => h.phrase.toLowerCase());
  it.each([
    'the open Blocker and Critical defects are not accepted',
    'The Blocker defect is that scanning in a group member fails.',
    'Blocker, Critical and Major defects are counted apart.',
    'one defect of Blocker severity is open',
    'DEF-002 was re-rated from Blocker to Critical.',
    'severity Blocker',
    'rated as Blocker by the owner',
    'No Blocker-severity defect is open.',
    'Critical and Blocker defects: none.',
    'Blocker defects are fixed first.',
    '1 Blocker and 2 Critical defects are open.', 'Sev1 (Blocker) defects: none.', '0 Blocker defects are open.',
  ])('does not flag the severity name: %s', (s) => expect(hits(s)).toEqual([]));
  it.each([
    'criterion 3 names a blocker', 'Blocked with named blocker', 'the missing seed data is a blocker for the run', 'Blocker: the environment was down',
    'each blocker and its unblock condition', 'The blockers were cleared on the second day.', 'a blocker, not a defect', 'It is not a Blocker for the test run.',
  ])('still flags a blocker that stopped a check: %s', (s) => expect(hits(s)).toContain(s.match(/blockers?/i)![0].toLowerCase()));
});
