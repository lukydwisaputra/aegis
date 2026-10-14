import * as fs from 'fs';
import * as path from 'path';
import { readRunConfig } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

let t: TmpAegis;
afterEach(() => t.cleanup());
beforeEach(() => { t = makeAegisRoot({ envProbe: true }); });
const set = (extra: object) => {
  const f = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), ...extra }));
};

describe('reportRules', () => {
  it('defaults to empty rules and the default synthetic markers', () => {
    expect(readRunConfig(t.root).reportRules).toEqual({
      extend: [], disable: [], allow: [],
      pii: { syntheticEmailDomains: [], syntheticNamePrefixes: ['QA', 'Test', 'E2E', 'Dummy', 'Sample'], syntheticPhonePatterns: [], syntheticValues: [] },
    });
  });

  it('reads the project rules and the manual budget', () => {
    set({
      reportRules: { extend: [{ id: 'no-sprint', pattern: '\\bsprint \\d+\\b', message: 'name the build, not the sprint' }], disable: ['qa-round'], allow: ['discharge cycle'],
        pii: { syntheticEmailDomains: ['qa.werkdone.example'], syntheticPhonePatterns: ['^\\+65 ?0\\d{7}$'] } },
      testing: { manualBudgetPercent: 0 },
    });
    const c = readRunConfig(t.root);
    expect(c.reportRules.extend[0]).toMatchObject({ id: 'no-sprint', severity: 'error' });
    expect(c.reportRules.disable).toEqual(['qa-round']);
    expect(c.reportRules.pii.syntheticEmailDomains).toEqual(['qa.werkdone.example']);
    expect(c.manualBudgetPercent).toBe(0);
  });

  it('refuses a rule with an invalid pattern, a duplicate id, or a wrong type', () => {
    set({ reportRules: { extend: [{ id: 'bad', pattern: '(', message: 'x' }] } });
    expect(() => readRunConfig(t.root)).toThrow(/reportRules.extend\[0\].pattern is not a valid regular expression/);
    set({ reportRules: { extend: [{ id: 'a', pattern: 'x', message: 'm' }, { id: 'a', pattern: 'y', message: 'm' }] } });
    expect(() => readRunConfig(t.root)).toThrow(/reportRules.extend: id "a" is listed twice/);
    set({ reportRules: { allow: 'discharge cycle' } });
    expect(() => readRunConfig(t.root)).toThrow(/reportRules.allow must be a list of strings/);
  });

  it('reads pii.syntheticValues, and refuses a blank entry or a non-list', () => {
    set({ reportRules: { pii: { syntheticValues: ['+6500000000', 'S1234567D'] } } });
    expect(readRunConfig(t.root).reportRules.pii.syntheticValues).toEqual(['+6500000000', 'S1234567D']);
    set({ reportRules: { pii: { syntheticValues: ['ok', '  '] } } });
    expect(() => readRunConfig(t.root)).toThrow(/reportRules.pii.syntheticValues\[1\] must not be blank/);
    set({ reportRules: { pii: { syntheticValues: '+6500000000' } } });
    expect(() => readRunConfig(t.root)).toThrow(/reportRules.pii.syntheticValues must be a list of strings/);
  });
});
