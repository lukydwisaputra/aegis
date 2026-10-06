import type { TestTechnique, TestType } from "./artefacts.js";
/** The single routing table. Mirrored by .claude/pipeline.yaml#routing and the qa-test-executor route lines. */
export const TEST_ROUTING = {
  byType: {
    Functional: "qa-ui-specialist", UI: "qa-ui-specialist", E2E: "qa-ui-specialist",
    API: "qa-api-specialist", Integration: "qa-api-specialist",
    Performance: "qa-performance-specialist", Security: "qa-security-specialist",
    Database: "qa-database-specialist", Compatibility: "qa-responsive-specialist",
    Usability: "qa-exploratory-specialist",
  },
  byTechnique: {
    Unit: "qa-unit-specialist", Accessibility: "qa-accessibility-specialist",
    Messaging: "qa-messaging-specialist", Realtime: "qa-realtime-specialist",
    FeatureFlag: "qa-feature-flag-specialist", Exploratory: "qa-exploratory-specialist",
  },
  documentationOnly: ["BoundaryValue", "EquivalencePartition", "StateTransition", "DecisionTable", "Pairwise",
    "Regression", "Smoke", "Flow", "Visual", "Contract", "Load", "Migration"],
} as const satisfies {
  byType: Record<TestType, string>; byTechnique: Partial<Record<TestTechnique, string>>; documentationOnly: readonly TestTechnique[];
};
/** A documentation-only technique is executed by the TC's primary specialist, so it needs one of these types. */
export const TECHNIQUE_COMPANION_TYPES: Readonly<Partial<Record<TestTechnique, readonly TestType[]>>> = {
  Flow: ["Functional", "E2E"], Visual: ["UI", "Compatibility"], Contract: ["API", "Integration"],
  Load: ["Performance"], Migration: ["Database"],
};
const BY_TECHNIQUE: Readonly<Partial<Record<TestTechnique, string>>> = TEST_ROUTING.byTechnique;
/** Specialists for one TC: every testType value, then each routed technique; each specialist once. */
export function routeTestCase(tc: { testType: readonly TestType[]; testTechnique?: readonly TestTechnique[] }): string[] {
  const out: string[] = [];
  const add = (agent: string | undefined) => {
    if (agent !== undefined && !out.includes(agent)) out.push(agent);
  };
  for (const t of tc.testType) add(TEST_ROUTING.byType[t]);
  for (const t of tc.testTechnique ?? []) add(BY_TECHNIQUE[t]);
  return out;
}
