import * as fs from 'fs';
import * as path from 'path';

// When aegis.config.json#testing.manualBudgetPercent is 0 the scope is automated testing only: every agent that could
// produce or report a manual case says so, in the same words.
const read = (f: string): string => fs.readFileSync(path.join(__dirname, '..', f), 'utf-8');
const SWITCH = '**Automated-only scope.** When `aegis.config.json#testing.manualBudgetPercent` is 0 (and `manualCategoriesAllowed` is empty) the scope is automated testing only';

describe('automated-only scope (testing.manualBudgetPercent 0)', () => {
  const files = [
    '.claude/agents/tier1-phase/qa-test-designer.md',
    '.claude/agents/spv/qa-test-designer-spv.md',
    '.claude/agents/tier1-phase/qa-test-executor.md',
    '.claude/agents/spv/qa-test-executor-spv.md',
    '.claude/agents/tier1-phase/qa-closure-reporter.md',
  ];

  it.each(files)('%s states the switch and declares the config key in its contract', (f) => {
    const md = read(f);
    expect(md).toContain(SWITCH);
    expect(md).toContain('aegis.config.json#testing.manualBudgetPercent');
  });

  it('the designer never writes a manual case and records the uncovered criterion as a scope status', () => {
    const md = read('.claude/agents/tier1-phase/qa-test-designer.md');
    expect(md).toContain('never set `requiresManual` or `automationStatus: Manual`');
    expect(md).toContain('the acceptance criterion it would cover takes the scope status Not verified');
    expect(md).toContain('`test.design-complete` carries `manualCount: 0`');
  });

  it('the executor emits no manual event and never reports "pending manual"', () => {
    const md = read('.claude/agents/tier1-phase/qa-test-executor.md');
    expect(md).toContain('never emit `manual.test.required`');
    expect(md).toContain('write `pendingManual: 0` in `execution-summary.json`');
  });

  it('both reviewers reject a manual case, a manual event or a nonzero pendingManual', () => {
    expect(read('.claude/agents/spv/qa-test-designer-spv.md')).toContain('any test case with `automationStatus: Manual`');
    expect(read('.claude/agents/spv/qa-test-executor-spv.md')).toContain('a nonzero `pendingManual`');
  });

  it('the closure report never mentions manual testing', () => {
    expect(read('.claude/agents/tier1-phase/qa-closure-reporter.md')).toContain('the closure report never mentions manual testing, manual cases or a manual-testing budget');
  });
});
