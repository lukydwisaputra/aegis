import { AegisEventSchema, FrameworkDefectProposalSchema } from '@qa/contracts';
import { appendChained, readLines } from '@qa/event-bus';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertAppendableByAgent, FRAMEWORK_DEFECT_LINE, runContextFor } from '@qa/run-state';
import { makeAegisRoot, startedRun, thrownCode, type TmpAegis } from './helpers/aegis-root';

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// P2c — NEW-06 framework-defect channel (docs/superpowers/specs/2026-10-02-p2-roster-design.md §4.12).
const ts = '2026-10-03T09:15:00.000Z';

describe('events', () => {
  it('framework.defect-suspected: component, a 10–300 character symptom, at least one evidence line; agents may append it', () => {
    const ok = { type: 'framework.defect-suspected', ts, component: 'aegis task claim', symptom: 'refuses the --task flag', evidence: ['stderr: unknown option'] };
    expect(AegisEventSchema.safeParse(ok).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...ok, evidence: [] }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ ...ok, symptom: 'short' }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ ...ok, component: 'x'.repeat(201) }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ ...ok, evidence: ['x'.repeat(301)] }).success).toBe(false);
    expect(() => assertAppendableByAgent('framework.defect-suspected')).not.toThrow();
  });

  it('cli.refused: invalid-input or internal from a qa-* caller; only the CLI records it', () => {
    const ok = { type: 'cli.refused', ts, runId: 'RUN-20261003-001', command: 'task.claim', code: 'invalid-input', caller: 'qa-ui-specialist', message: 'm' };
    expect(AegisEventSchema.safeParse(ok).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...ok, code: 'internal' }).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...ok, code: 'cap-reached' }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ ...ok, caller: 'owner' }).success).toBe(false);
    expect(AegisEventSchema.safeParse({ ...ok, message: 'x'.repeat(301) }).success).toBe(false);
    expect(thrownCode(() => assertAppendableByAgent('cli.refused'))).toBe('invalid-input');
  });

  it('framework.defect-suspected: an undeclared field is refused at append and nothing is written', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-fd-'));
    try {
      const bus = path.join(dir, 'events.jsonl');
      const ctx = { emittedBy: 'qa-ui-specialist', runId: 'RUN-20261003-001' };
      const ev = { type: 'framework.defect-suspected', ts, component: 'aegis task claim', symptom: 'refuses the --task flag', evidence: ['stderr: unknown option'] };
      await expect(appendChained({ ...ev, patch: 'edit caller.ts' }, bus, ctx)).rejects.toThrow(/undeclared field\(s\).*patch/);
      expect(readLines(bus)).toEqual([]);
      await appendChained(ev, bus, ctx);
      expect(readLines(bus)).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** A proposal as the curator writes it (Task 8 pins the copy in qa-curator.md to the same schema). */
const PROPOSAL = {
  type: 'framework-defect',
  id: 'framework-defect-aegis-task-claim',
  runId: 'RUN-20261003-001',
  component: 'aegis task claim',
  symptom: 'The --task flag named in the Task Protocol is refused as an unknown option',
  signals: [
    { source: 'framework.defect-suspected', seq: 42, agent: 'qa-ui-specialist', detail: 'Task Protocol step 1 names --task; the CLI refuses it' },
    { source: 'cli.refused', seq: 41, agent: 'qa-ui-specialist', detail: "invalid-input: unknown option '--task'" },
  ],
  occurrences: 2,
  suggestedOwnerAction: 'Check that aegis task claim accepts --task, or correct the Task Protocol text',
  createdAt: ts,
};

describe('FrameworkDefectProposalSchema', () => {
  it('accepts a curator proposal', () => {
    expect(FrameworkDefectProposalSchema.parse(PROPOSAL)).toEqual(PROPOSAL);
  });

  it('rejects a destination field (nothing is ever applied), an id outside the slug form, no signals and an unknown signal source', () => {
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, destination: '.claude/agents/' }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, id: 'framework-defect-Task Claim' }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, signals: [] }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, signals: [{ ...PROPOSAL.signals[0], source: 'review.passed' }] }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, occurrences: 0 }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, suggestedOwnerAction: 'x'.repeat(301) }).success).toBe(false);
  });

  it('rejects stray patch and command keys (a proposal carries nothing to run or apply)', () => {
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, patch: '--- a/caller.ts' }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, command: 'pnpm aegis task claim' }).success).toBe(false);
  });

  it('rejects fewer occurrences than listed signals', () => {
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, occurrences: 1 }).success).toBe(false);
    expect(FrameworkDefectProposalSchema.safeParse({ ...PROPOSAL, occurrences: 5 }).success).toBe(true);
  });
});

/** The slug rule of qa-curator.md §5, in its stated order. */
const slugOf = (component: string): string =>
  component.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '') || 'unknown';

describe('proposals derived by the curator rules validate', () => {
  const signal = (source: 'framework.defect-suspected' | 'cli.refused', seq: number, agent: string, detail: string) => ({ source, seq, agent, detail });
  const derive = (component: string, symptom: string, signals: ReturnType<typeof signal>[], occurrences: number) => ({
    type: 'framework-defect',
    id: `framework-defect-${slugOf(component)}`,
    runId: 'RUN-20261003-001',
    component,
    symptom,
    signals,
    occurrences,
    suggestedOwnerAction: 'Check the component against the agent instructions that name it',
    createdAt: ts,
  });

  it('the slug rule: lower case, runs to -, cut to 60, then trimmed, unknown when empty', () => {
    expect(slugOf('/qa-start')).toBe('qa-start');
    expect(slugOf('{tests}/qa/support/x.ts')).toBe('tests-qa-support-x-ts');
    expect(slugOf('%%%/{}')).toBe('unknown');
    expect(slugOf(`${'a'.repeat(59)}/b`)).toBe('a'.repeat(59));
  });

  it('a /qa-start component', () => {
    const p = derive('/qa-start', 'The skill names a --profile flag that does not exist', [signal('framework.defect-suspected', 7, 'qa-orchestrator', 'qa-start step 2 names --profile')], 1);
    expect(p.id).toBe('framework-defect-qa-start');
    expect(FrameworkDefectProposalSchema.safeParse(p).success).toBe(true);
  });

  it('a path component and an all-symbol component', () => {
    const a = derive('{tests}/qa/support/x.ts', 'The vendored helper named by step 3b is missing', [signal('framework.defect-suspected', 3, 'qa-environment-engineer', 'missing file')], 1);
    expect(FrameworkDefectProposalSchema.safeParse(a).success).toBe(true);
    const b = derive('%%%/{}', 'The component named in the instructions is unreadable', [signal('framework.defect-suspected', 4, 'qa-ui-specialist', 'see the symptom')], 1);
    expect(b.id).toBe('framework-defect-unknown');
    expect(FrameworkDefectProposalSchema.safeParse(b).success).toBe(true);
  });

  it('a cli.refused internal group with an empty message: detail is the code, symptom counts the refusals', () => {
    const component = 'aegis task add';
    const p = derive(component, `${component} refused with internal 3 times`, [
      signal('cli.refused', 11, 'qa-test-designer', 'internal'),
      signal('cli.refused', 12, 'qa-test-designer', 'internal'),
    ], 3);
    expect(p.id).toBe('framework-defect-aegis-task-add');
    expect(FrameworkDefectProposalSchema.safeParse(p).success).toBe(true);
  });
});

describe('the curator proposes framework defects (spec §4.12)', () => {
  const curator = () => read('.claude/agents/crosscutting/qa-curator.md');
  const example = (): Record<string, unknown> =>
    JSON.parse(/```json\n([\s\S]*?)\n```/.exec(curator().split('### 5. Framework-Defect Proposals')[1]!)![1]!) as Record<string, unknown>;

  it('the example in qa-curator.md is a valid proposal, and a destination field makes it invalid', () => {
    const parsed = FrameworkDefectProposalSchema.parse(example());
    expect(parsed).toMatchObject({ type: 'framework-defect', occurrences: 2 });
    expect(parsed.occurrences).toBeGreaterThanOrEqual(parsed.signals.length);
    expect(FrameworkDefectProposalSchema.safeParse({ ...example(), destination: '.claude/agents/' }).success).toBe(false);
  });

  it('states the grouping threshold, never applies anything, and writes framework-defect-{slug}.json', () => {
    const text = curator();
    expect(text).toMatch(/`invalid-input` seen at least twice in the run or from at least two agents/);
    expect(text).toMatch(/You never fix the framework, and a proposal names nothing to apply/);
    expect(text).toContain('  - "{run}/pending-promotions/framework-defect-{slug}.json"');
    expect(text).toContain('- `framework-defect-{slug}.json`');
  });

  it('states the slug order, the merge on a shared slug, per-run de-duplication and the field mapping', () => {
    const text = curator();
    expect(text).toContain('cut it to 60 characters; then strip any leading or trailing `-`; use `unknown` when nothing is left');
    expect(text).toMatch(/qualifying groups that end with the same slug merge into one proposal \(their signals concatenated, their occurrences summed\)/);
    expect(text).toMatch(/this de-duplication is per run/);
    expect(text).toMatch(/`seq` is the event's chain `seq`/);
    expect(text).toMatch(/`agent` is its `emittedBy` \(for `cli\.refused` that is its `caller`\)/);
    expect(text).toMatch(/or its `code` when the message is empty/);
    expect(text).toMatch(/`occurrences`: the number of events in the group, never fewer than the signals listed/);
  });

  it('curator.proposals-ready names only the fields events.ts declares', () => {
    const line = curator().split('## Events You Emit')[1]!.split('\n').find((l) => l.includes('curator.proposals-ready'))!;
    expect(line).toContain('`proposalCount`');
    expect(line).toContain('`path`');
    expect(line).toContain('framework-defect proposals included');
    expect(line).not.toMatch(/types/);
  });
});

describe('every qa-* agent is told how to report a framework defect (T10)', () => {
  let t: TmpAegis;
  beforeEach(() => { t = makeAegisRoot(); });
  afterEach(() => t.cleanup());

  it('runContextFor carries the line, with or without an active run', async () => {
    expect(FRAMEWORK_DEFECT_LINE).toMatch(/append `framework\.defect-suspected` with the component, the symptom and the evidence.*Never edit the framework to work around it\.$/);
    expect(runContextFor(t.root, 'qa-ui-specialist', 'a1')).toContain(FRAMEWORK_DEFECT_LINE);
    await startedRun(t.root);
    for (const agent of ['qa-orchestrator', 'qa-test-designer', 'qa-ui-specialist-spv']) expect(runContextFor(t.root, agent, 'x')).toContain(FRAMEWORK_DEFECT_LINE);
  });

  it('the orchestrator and HANDBOOK/10 send framework defects to the owner queue', () => {
    expect(read('.claude/agents/orchestrator/qa-orchestrator.md')).toContain("framework defects go to the owner's `/qa-promote` queue (`framework.defect-suspected` and `cli.refused`, grouped by the curator)");
    expect(read('HANDBOOK/10-self-improvement.md')).toMatch(/Until `\/qa-promote` loads this type, read the proposals in `summary\.md`\./);
    expect(read('HANDBOOK/10-self-improvement.md')).toMatch(/^\| Suspected framework defect \(`framework\.defect-suspected`, `cli\.refused`\) \| .*never applied \|$/m);
  });
});
