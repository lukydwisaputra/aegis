import { maskedLines, resolveRules, scanWithRules } from '@qa/run-state';

const rules = (budget: number | null = 0, extra: Partial<Parameters<typeof resolveRules>[0]> = {}) =>
  resolveRules({ extend: [], disable: [], allow: [], pii: { syntheticEmailDomains: [], syntheticNamePrefixes: [], syntheticPhonePatterns: [] }, ...extra }, budget);
const ids = (text: string, r = rules(), allow: string[] = []) => scanWithRules('closure.md', text, r, allow).map((f) => f.rule);

describe('qa-cycle: the QA process, not the application', () => {
  it.each([
    'The cycle took 36.7 hours of wall clock.',
    'None is recorded as fully mitigated by this cycle.',
    '- **Cycle:** full STLC, environment development',
    'Developer-test review ran for real this cycle.',
    'Cycle date: 2026-10-12',
  ])('flags: %s', (line) => expect(ids(line)).toContain('qa-cycle'));

  it.each([
    'from the earlier discharge cycle.',
    "a discharge/readmit history is a real multi-cycle state",
    'the billing cycle closes on the 25th',
    'The `cycleDate` field is a string.',
    'The requirement says "the cycle restarts at midnight".',
  ])('leaves alone: %s', (line) => expect(ids(line)).not.toContain('qa-cycle'));
});

describe('the other default rules', () => {
  it('flags re-verified, the QA round, report history and an internal task id', () => {
    expect(ids('Re-verified as fixed at both layers')).toContain('re-verified');
    expect(ids('Re-confirmed this round per the owner')).toContain('qa-round');
    expect(ids('In round 2 the checks were run again')).toContain('qa-round');
    expect(ids('What changed since the previous version')).toContain('report-history');
    expect(ids('the earlier draft counted 62')).toContain('report-history');
    expect(ids('Re-confirmed (T-execution-11, round 2)')).toContain('internal-task-id');
  });

  it('leaves the application and ordinary words alone', () => {
    expect(ids('health answered 200 before and after the run')).toEqual([]);
    expect(ids('the first round of approvals in the app')).toEqual([]);
    expect(ids('rounding to two decimals')).toEqual([]);
  });

  it('flags a mention of manual testing only when the run is automated-only', () => {
    expect(ids('Manual testing was out of scope.', rules(0))).toContain('manual-testing');
    expect(ids('manual budget and manual categories', rules(0))).toContain('manual-testing');
    expect(ids('Manual testing was out of scope.', rules(10))).toEqual([]);
    expect(ids('Manual testing was out of scope.', rules(null))).toEqual([]);
    expect(ids('The admin uses manual entry of attendance.', rules(0))).toEqual([]);
  });
});

describe('context and project rules', () => {
  it('blanks code spans, fenced blocks and quoted runs but keeps the line numbers', () => {
    const lines = maskedLines('a `this cycle` b\n```\nthis cycle\n```\n"this cycle" c this cycle');
    expect(lines.map((l) => l.text.includes('this cycle'))).toEqual([false, false, false, false, true]);
    expect(lines).toHaveLength(5);
  });

  it('allow silences the named phrase only; disable removes a rule; extend adds one', () => {
    expect(ids('the discharge cycle runs daily; this cycle ended', rules(), ['this cycle'])).toEqual([]);
    expect(ids('this cycle', rules(0, { disable: ['qa-cycle'] }))).toEqual([]);
    const extra = rules(0, { extend: [{ id: 'no-sprint', pattern: '\\bsprint \\d+\\b', flags: 'i', message: 'name the build', severity: 'error' }] });
    expect(ids('done in sprint 14', extra)).toContain('no-sprint');
  });

  it('ignores blank allow entries: an empty phrase would silence every match', () => {
    expect(ids('this cycle', rules(), [''])).toContain('qa-cycle');
    expect(ids('this cycle', rules(), ['  '])).toContain('qa-cycle');
  });

  it('reports the line number and a context window, once per match', () => {
    const f = scanWithRules('closure.md', 'ok\nthe run is fine\nThe cycle took long', rules(), []);
    expect(f).toEqual([expect.objectContaining({ rule: 'qa-cycle', file: 'closure.md', line: 3, severity: 'error' })]);
    expect(f[0]!.context).toContain('The cycle took long');
  });
});
