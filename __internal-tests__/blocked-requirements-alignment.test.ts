import * as fs from 'fs';
import * as path from 'path';

// BLOCKed requirements: one definition across the analyst, the planner and both reviewers.
const read = (f: string): string => fs.readFileSync(path.join(__dirname, '..', f), 'utf-8');
const analyst = read('.claude/agents/tier1-phase/qa-requirements-analyst.md');
const analystSpv = read('.claude/agents/spv/qa-requirements-analyst-spv.md');
const planner = read('.claude/agents/tier1-phase/qa-test-planner.md');
const plannerSpv = read('.claude/agents/spv/qa-test-planner-spv.md');

describe('scope status and Blocked are separate terms; BLOCK is only a rating', () => {
  const vocab = ['**In scope**', '**Out of scope**', '**Deferred**', '**Being built**', '**Not verified**', '**Blocked**'];

  it('the planner defines the vocabulary once and takes scope from the ruling, not the rating', () => {
    vocab.forEach((t) => expect(planner).toContain(t));
    expect(planner).toContain('The testability rating BLOCK is a score only: it never means Blocked or Out of scope.');
    expect(planner).toContain('A BLOCK rating never stops the plan, and never decides scope by itself.');
    expect(planner).toContain('*Scope status* belongs to an acceptance criterion (an AC has exactly one)');
    expect(planner).toContain("A requirement's status is that of its ACs: when they differ");
    expect(planner).toContain('A requirement rated BLOCK with no ruling is **Not verified**');
    expect(planner).toContain('A defect candidate recorded while the environment was faulty');
  });

  it('the planner reviewer checks one status per requirement, ruling first, and Blocked items with blocker and unblock condition', () => {
    expect(plannerSpv).toContain('7. **Scope statuses and Blocked items.**');
    expect(plannerSpv).toContain('Every acceptance criterion has exactly one scope status');
    expect(plannerSpv).toContain('a requirement whose ACs differ is listed once per status with its ACs under each; status counts count ACs');
    expect(plannerSpv).toContain('a BLOCK rating alone never makes a requirement Out of scope');
    expect(plannerSpv).toContain('a Blocked item without blocker and unblock condition');
    expect(plannerSpv).toContain('"{run}/gates/gate-*-decision.json"');
  });

  it('the analyst calls the rating BLOCK-rated, defines the count unit, and re-scores ruled requirements', () => {
    expect(analyst).toContain('This is a rating, not a status: it never means Blocked or Out of scope.');
    expect(analyst).toContain('A requirement is **BLOCK-rated** when any of its four dimensions is BLOCK');
    expect(analyst).toContain('`blockCount`, `flagCount` and `passCount` count **dimension scores** across all requirements, so they add up to 4 × `requirementsAnalysed`');
    expect(analyst).toContain("The finding's `severity` is the requirement's worst dimension score");
    expect(analyst).toContain('a decided requirement is no longer Understandable-BLOCK');
  });

  it('the analyst reviewer rejects a BLOCK score without a BLOCK finding, and a ruled requirement still rated BLOCK', () => {
    expect(analystSpv).toContain('12. **Severity and counts agree with the scores.**');
    expect(analystSpv).toContain('A BLOCK dimension without a BLOCK finding, or a count that does not match the scores = requested-changes.');
    expect(analystSpv).toContain('a BLOCK is a rating, not a status');
  });

  it('the orchestrator and its reviewer never call a scope status blocked or a Blocked item out of scope', () => {
    expect(read('.claude/agents/orchestrator/qa-orchestrator.md')).toContain('never calling a scope status "blocked" and never calling a Blocked item "out of scope"');
    expect(read('.claude/agents/spv/qa-orchestrator-spv.md')).toContain('9. **Derived stories, non-In-scope requirements and Blocked items at G1.**');
  });

  it('the handbook states the same vocabulary', () => {
    expect(read('HANDBOOK/04-stlc-walkthrough.md')).toContain('**Scope vocabulary.** An acceptance criterion has exactly one *scope status*');
  });
});
