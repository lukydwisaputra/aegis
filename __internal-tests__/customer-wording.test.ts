import * as fs from 'fs';
import * as path from 'path';
import { TOOLING_WORD_PATTERNS, checkBrandExposure, checkToolingWords } from '@qa/contracts';
import { decide, type GuardContext, type HookToolInput } from '@qa/path-guard';

// Gap I: customer-facing wording rules, pinned in the agent text and checked by H1 for defects, closure and compliance files.

const ROOT = path.join(__dirname, '..');
const agent = (rel: string) => fs.readFileSync(path.join(ROOT, '.claude', 'agents', rel), 'utf8');

const BLOCK = [
  '## Customer-facing wording (shared rule)',
  'Customer-facing files (the closure, the compliance reports, the defect records, the triage summary, the cases, the plan and the RTM) never contain tooling words: CLI, aegis, defectMap, event sequence numbers, framework (as in "framework defect"), refusal counts, review counts, attempt counts, "record owner".',
  'Tooling facts (what a command refused, how many reviews or attempts a task took, which event recorded what) go to events and the work report, never into those files.',
  'Every open question asks a decision of a named audience (the PM, the owner or the developers) and says what changes with each answer; a limit or a finding with no decision to take is a finding, not an open question.',
];
const WORKERS = ['tier1-phase/qa-defect-manager.md', 'tier1-phase/qa-closure-reporter.md', ...['iso25010', 'iso5055', 'istqb', 'cmmi', 'gdpr', 'pdpa'].map((c) => `compliance/qa-compliance-${c}.md`)];

describe('shared wording rule block', () => {
  it.each(WORKERS)('%s carries the shared block before its Quality Standards', (rel) => {
    const t = agent(rel);
    for (const line of BLOCK) expect(t).toContain(line);
    expect(t.indexOf('## Customer-facing wording (shared rule)')).toBeLessThan(t.indexOf('## Quality Standards'));
  });

  it('the three SPVs check it: defect manager, closure reporter and the compliance SPV (six regulations)', () => {
    expect(agent('spv/qa-defect-manager-spv.md')).toMatch(/\*\*Customer-facing wording\.\*\* `defects\/\*\.\{md,json\}` and `defects\/triage-summary\.md` contain none of the tooling words.*= requested-changes/);
    expect(agent('spv/qa-closure-reporter-spv.md')).toMatch(/\*\*Customer-facing wording\.\*\* The closure .* contains none of the tooling words.*asks a decision of a named audience.*= requested-changes/);
    expect(agent('spv/qa-compliance-spv.md')).toMatch(/\*\*Customer-facing wording\.\*\* The report contains none of the tooling words.*Review counts, refusal figures and attempt counts of the QA process belong in events and the work report/);
  });

  it('the GDPR agent keeps a gap under its own article and lists every assessed article, Art35 included; its SPV checks it', () => {
    expect(agent('compliance/qa-compliance-gdpr.md')).toMatch(/Keep a gap under the article it belongs to: erasure stays `GDPR-Art17` and portability `GDPR-Art20`.*`articlesCovered` lists every article you assessed, Art35 included/);
    expect(agent('spv/qa-compliance-spv.md')).toMatch(/a gap folded into another article \(erasure or portability under Art5 or Art25\) or an assessed article missing from `articlesCovered` \(Art35 included\) = requested-changes/);
  });
});

describe('TOOLING_WORD_PATTERNS', () => {
  it('flags the tooling wording found in RUN-20261012-002 customer-facing files', () => {
    for (const text of [
      'Filed as a framework defect: the CLI refused the call.', 'the defectMap keeps 8 pairs', 'see event seq 784', 'seq #987', '12 refusals in the run', 'cli.refused events',
      'the review count was 3', 'the SPV requested changes', 'work report attempt', 'the record owner needs to correct it', 'Event sequence numbers are listed below',
    ]) expect([text, checkToolingWords(text) !== null]).toEqual([text, true]);
  });

  it('leaves application wording alone, including the words a target app may use', () => {
    for (const text of [
      'The Next.js framework renders the page.', 'A test framework was used.', 'The volunteer sees a sequence of three steps.', 'Retest on build ebf4b428 found 25 x 403.',
      'The registration flow was refused with HTTP 403.', 'Reviewed by the QA team.', 'The map of defects below lists each requirement.', 'Sequence 3 of onboarding is skipped.',
    ]) expect([text, checkToolingWords(text)]).toEqual([text, null]);
  });

  it('is separate from the brand patterns: aegis is a brand hit, CLI is a tooling hit', () => {
    expect(checkBrandExposure('the CLI refused')).toBeNull();
    expect(checkToolingWords('found by aegis')).toBeNull();
    expect(TOOLING_WORD_PATTERNS.length).toBeGreaterThan(5);
  });
});

describe('H1 denies tooling wording in defects, closure and compliance files', () => {
  const RUN = 'RUN-20261002-001';
  const RUN_DIR = `${ROOT}/runs/${RUN}`;
  const ctx: GuardContext = {
    aegisRoot: ROOT, targetRoot: path.join(ROOT, '..'), testsDir: path.join(ROOT, '..', 'tests', 'qa'), runDir: RUN_DIR, activeRunId: RUN,
    environment: 'development', currentPhase: 'closure-draft', envPolicy: { mutating: true, allowedSpecialists: ['*'] }, tempDirs: ['/tmp'],
  };
  const deps = { cliAllowed: () => null };
  const write = (file: string, content: string, who: string): HookToolInput => ({ tool_name: 'Write', tool_input: { file_path: `${RUN_DIR}/${file}`, content }, cwd: ROOT, agent_type: who, agent_id: 'a1' });

  it.each([
    ['defects/triage-summary.md', 'qa-defect-manager', 'The framework defect is logged; see event seq 867.'],
    ['reports/closure/closure.md', 'qa-closure-reporter', 'The record owner needs to correct it.'],
    ['reports/compliance/cmmi.md', 'qa-compliance-cmmi', 'The SPV requested changes twice (2 review counts).'],
  ])('refuses %s with tooling words', (file, who, text) => {
    const r = decide(write(file, text, who), ctx, deps);
    expect(r.allow).toBe(false);
    expect(!r.allow && r.reason).toMatch(/customer-facing and the text has tooling wording/);
  });

  it.each([
    ['defects/triage-summary.md', 'qa-defect-manager'], ['reports/closure/closure.md', 'qa-closure-reporter'], ['reports/compliance/cmmi.md', 'qa-compliance-cmmi'],
  ])('allows clean text in %s', (file, who) => {
    expect(decide(write(file, 'Two defects remain open; the developers decide whether the current fix resolves everything.', who), ctx, deps).allow).toBe(true);
  });

  it('does not apply to other run files (a work report names the tooling)', () => {
    expect(decide(write('discovery-report.md', 'The CLI refused 3 calls.', 'qa-web-explorer'), ctx, deps).allow).toBe(true);
  });
});
