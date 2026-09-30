import * as fs from 'fs'; import * as path from 'path';
import { parse } from 'yaml';
import { TEST_ROUTING, routeTestCase, TestTypeSchema, TestTechniqueSchema } from '@qa/contracts';
const pipeline = parse(fs.readFileSync(path.join(__dirname, '..', '.claude', 'pipeline.yaml'), 'utf-8'));
const sorted = (xs: readonly string[]) => [...xs].sort();
describe('test vocabulary and routing (P1)', () => {
  it('pipeline.yaml#routing mirrors TEST_ROUTING', () => {
    expect(pipeline.routing.byType).toEqual(TEST_ROUTING.byType);
    expect(pipeline.routing.byTechnique).toEqual(TEST_ROUTING.byTechnique);
    expect(sorted(pipeline.routing.techniqueWithoutSpecialist)).toEqual(sorted(TEST_ROUTING.documentationOnly));
    // the designer emits exactly the schema vocabulary
    expect(sorted(pipeline.routing.designerEmits.testType)).toEqual(sorted(TestTypeSchema.options));
    expect(sorted(pipeline.routing.designerEmits.testTechnique)).toEqual(sorted(TestTechniqueSchema.options));
  });
  it('every technique is routed or documentation-only, never both', () => {
    const routed = Object.keys(TEST_ROUTING.byTechnique);
    const doc: readonly string[] = TEST_ROUTING.documentationOnly;
    expect(routed.filter((t) => doc.includes(t))).toEqual([]);
    expect(sorted([...routed, ...doc])).toEqual(sorted(TestTechniqueSchema.options));
  });
  it('E2E is a type routed to qa-ui-specialist; the E2E technique and BVA/EP are gone; Flow is added', () => {
    expect(TestTypeSchema.safeParse('E2E').success).toBe(true);
    expect(routeTestCase({ testType: ['E2E'], testTechnique: ['Flow'] })).toEqual(['qa-ui-specialist']);
    for (const v of ['E2E', 'BVA', 'EP']) expect(TestTechniqueSchema.safeParse(v).success).toBe(false);
    expect(TestTechniqueSchema.safeParse('Flow').success).toBe(true);
  });
  it('routes every type, then each routed technique, each specialist once', () => {
    expect(routeTestCase({ testType: ['Functional', 'UI', 'Security'], testTechnique: ['Accessibility', 'BoundaryValue', 'Flow'] }))
      .toEqual(['qa-ui-specialist', 'qa-security-specialist', 'qa-accessibility-specialist']);
    expect(routeTestCase({ testType: ['Database'], testTechnique: ['Migration'] })).toEqual(['qa-database-specialist']);
    expect(routeTestCase({ testType: ['Usability'], testTechnique: ['Exploratory'] })).toEqual(['qa-exploratory-specialist']);
  });
});
