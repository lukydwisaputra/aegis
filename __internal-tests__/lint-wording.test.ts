import { maskedLines, resolveRules, scanWithRules } from '@qa/run-state';

const rules = (budget: number | null = 0, extra: Partial<Parameters<typeof resolveRules>[0]> = {}) =>
  resolveRules({ extend: [], disable: [], allow: [], pii: { syntheticEmailDomains: [], syntheticNamePrefixes: [], syntheticPhonePatterns: [], syntheticValues: [] }, ...extra }, budget);
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

describe('fix round 1: narrower patterns', () => {
  it.each([
    '**Run:** RUN-20261005-002 · **Cycle:** full STLC',
    '| Cycle: | full |',
    '| **Cycle** | full |',
    '- Cycle: x',
    '1. Cycle: x',
    '> Cycle: x',
    'Cycle: x',
    'the cycle lasted two days',
    'This testing cycle covered the module',
  ])('qa-cycle flags: %s', (line) => expect(ids(line)).toContain('qa-cycle'));

  it.each([
    'the cycle restarts at midnight',
    'the next cycle starts on the 1st',
    'the current cycle of the subscription',
    'the full cycle of the order',
  ])('qa-cycle leaves alone application prose: %s', (line) => expect(ids(line)).not.toContain('qa-cycle'));

  it('qa-round keeps this round and round N, and leaves other rounds alone', () => {
    expect(ids('Re-confirmed this round')).toContain('qa-round');
    expect(ids('Re-confirmed (T-execution-11, round 2)')).toContain('qa-round');
    expect(ids('round 2.5 up to 3')).toEqual([]);
    expect(ids('the previous round of reviews in the app')).toEqual([]);
  });

  it('report-history looks at report cues only', () => {
    expect(ids('the earlier draft counted 62')).toContain('report-history');
    expect(ids('What changed since the previous version')).toContain('report-history');
    expect(ids('the previous figure of this report said 5')).toContain('report-history');
    for (const t of ['the last count of attendance', 'the first version of the form', 'the previous version of the app', 'quantity updated from 5 to 3 after save']) {
      expect(ids(t)).toEqual([]);
    }
  });

  it('internal-task-id flags T-1 and T-GATE-G1', () => {
    expect(ids('see T-1')).toContain('internal-task-id');
    expect(ids('opened by T-GATE-G1')).toContain('internal-task-id');
  });
});

describe('fix round 1: allow is exact, scan is stable', () => {
  it('an allow phrase does not silence a different nearby finding', () => {
    expect(ids('the discharge cycle runs; this cycle ended', rules(), ['discharge cycle'])).toEqual(['qa-cycle']);
    expect(ids('this cycle and this cycle', rules(), ['this cycle'])).toEqual([]);
    const long = `${'x'.repeat(90)} this cycle ${'y'.repeat(90)}`;
    expect(ids(long, rules(), [long])).toEqual([]);
  });

  it('reports a second match on the same line separately and sorts by line then rule id', () => {
    expect(ids('this cycle and this cycle')).toEqual(['qa-cycle', 'qa-cycle']);
    expect(ids('Re-verified this cycle')).toEqual(['qa-cycle', 're-verified']);
  });

  it('a rule with a preset g flag works and leaks no lastIndex between calls', () => {
    const g = [{ id: 'x', re: /foo/g, message: 'm', severity: 'warning' as const }];
    const first = scanWithRules('a.md', 'foo foo', g, []);
    expect(first).toHaveLength(2);
    expect(scanWithRules('a.md', 'foo foo', g, [])).toEqual(first);
    expect(g[0]!.re.lastIndex).toBe(0);
  });
});

describe('fix round 1: masking', () => {
  it('skips a ~~~ fence, with an indent and a language tag', () => {
    expect(ids('  ~~~md\nthis cycle\n~~~\nok')).toEqual([]);
    expect(ids('```ts\nthis cycle\n```')).toEqual([]);
  });

  it('an unclosed fence does not hide a later finding', () => {
    expect(ids('```\nRe-verified as fixed')).toContain('re-verified');
    const f = scanWithRules('c.md', 'a\n```\nb\nRe-verified', rules(), []);
    expect(f.map((x) => x.line)).toEqual([4]);
  });

  it('a stray double quote does not pair across prose', () => {
    expect(ids('5" screen with this cycle')).toContain('qa-cycle');
    expect(ids('a 5" screen and a 7" one, this cycle')).toContain('qa-cycle');
    expect(ids('says "this cycle" here')).toEqual([]);
    expect(ids('"this cycle" at line start')).toEqual([]);
  });

  it('blanks a double-backtick code span as one span', () => {
    expect(ids('a ``x ` this cycle`` b')).toEqual([]);
  });
});

describe('calibration C1: qa-round leaves a hyphenated compound alone', () => {
  it('this round-trip and round-robin are not flagged', () => {
    expect(ids("this round-trip did not resolve within the test's")).toEqual([]);
    expect(ids('a round-robin scheduler')).toEqual([]);
    expect(ids('round 2-trip')).toEqual([]);
  });
  it('this round and round N are still flagged', () => {
    expect(ids('Re-confirmed this round per the owner')).toContain('qa-round');
    expect(ids('Re-run round 28')).toContain('qa-round');
  });
});
