import * as fs from 'fs'; import * as path from 'path';
import { parse } from 'yaml';
import { SPECIALISTS, TEST_ROUTING, DEFAULT_ENVIRONMENT_SPECIALISTS, checkEnvironmentSpecialists, specialistShortName } from '@qa/contracts';
const ROOT = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'aegis.config.json'), 'utf-8'));
const pipeline = parse(fs.readFileSync(path.join(ROOT, '.claude', 'pipeline.yaml'), 'utf-8'));
describe('specialist short names and environments (AUD-036/037/038)', () => {
  it('pipeline.yaml#envSpecialists is the canonical map, covering every routed specialist', () => {
    expect(pipeline.envSpecialists).toEqual(Object.fromEntries(Object.entries(SPECIALISTS).map(([k, v]) => [k, v.agent])));
    const routed = new Set([...Object.values(TEST_ROUTING.byType), ...Object.values(TEST_ROUTING.byTechnique)]);
    expect(new Set(Object.values(SPECIALISTS).map((s) => s.agent))).toEqual(routed);
  });
  it('aegis.config.json uses the default lists and has no problems', () => {
    for (const [env, lists] of Object.entries(DEFAULT_ENVIRONMENT_SPECIALISTS))
      expect({ allowedSpecialists: config.environments[env].allowedSpecialists, forbiddenSpecialists: config.environments[env].forbiddenSpecialists }).toEqual(lists);
    expect(checkEnvironmentSpecialists(config.environments)).toEqual([]);
  });
  it('production is read-only and forbids email (AUD-038)', () =>
    expect(config.environments.production).toMatchObject({ readOnly: true, mutating: false, forbiddenSpecialists: expect.arrayContaining(['email']) }));
  it('flags unknown names, "*" or a mutating specialist on a read-only env, and "*" in forbidden', () => {
    expect(checkEnvironmentSpecialists({
      testing: { allowedSpecialists: ['functional'] },
      production: { readOnly: true, allowedSpecialists: ['*'] },
      prod2: { mutating: false, allowedSpecialists: ['ui', 'security'] },
      x: { forbiddenSpecialists: ['*'] },
    })).toEqual([
      'environments.testing.allowedSpecialists: unknown specialist "functional"',
      'environments.production.allowedSpecialists: "*" on a read-only environment',
      'environments.prod2.allowedSpecialists: mutating specialist "security" on a read-only environment',
      'environments.x.forbiddenSpecialists: "*" is only valid in allowedSpecialists',
    ]);
  });
  it('specialistShortName accepts short and agent names only', () =>
    expect(['qa-feature-flag-specialist', 'performance', 'perf', 'toString'].map(specialistShortName)).toEqual(['feature-flag', 'performance', null, null]));
});
