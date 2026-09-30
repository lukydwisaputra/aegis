import { z } from "zod";

// ID format patterns
// TC-AUTH-031, DEF-001-AUTH-UI, STORY-AUTH-204, REQ-AUTH-04, RISK-AUTH-007
// TP-PROJECT-R2.4, RUN-20260523-001, L-TD-012, WR-T-42, RV-td-spv-T-42, WR-T-design-1, RV-td-spv-T-GATE-G1

const MODULE = "[A-Z]{2,8}";
const DEF_TYPE = "UI|API|A11Y|SEC|PERF|DATA|UNIT|EXP";

export const TestCaseIdSchema = z.string().regex(
  new RegExp(`^TC-${MODULE}-\\d{3,4}$`),
  "TestCase ID format: TC-{MODULE}-{NNN}"
);

export const DefectIdSchema = z.string().regex(
  new RegExp(`^DEF-\\d{3,4}-${MODULE}-(${DEF_TYPE})$`),
  "Defect ID format: DEF-{NNN}-{MODULE}-{TYPE} where TYPE is UI|API|A11Y|SEC|PERF|DATA|UNIT|EXP"
);

export const StoryIdSchema = z.string().regex(
  new RegExp(`^STORY-${MODULE}-\\d{3,4}$`),
  "Story ID format: STORY-{MODULE}-{NNN}"
);

export const ScenarioIdSchema = z.string().regex(
  new RegExp(`^SCN-${MODULE}-\\d{3,4}$`),
  "Scenario ID format: SCN-{MODULE}-{NNN}"
);

export const AcceptanceCriterionIdSchema = z.string().regex(
  new RegExp(`^AC-${MODULE}-\\d{3,4}-[HRE]\\d{1,2}$`),
  "Acceptance criterion ID format: AC-{MODULE}-{NNN}-{H|R|E}{n}"
);

export const RequirementIdSchema = z.string().regex(
  new RegExp(`^REQ-${MODULE}-\\d{2,4}$`),
  "Requirement ID format: REQ-{MODULE}-{NN}"
);

export const RiskIdSchema = z.string().regex(
  new RegExp(`^RISK-${MODULE}-\\d{3,4}$`),
  "Risk ID format: RISK-{MODULE}-{NNN}"
);

export const TestPlanIdSchema = z.string().regex(
  /^TP-[A-Z0-9-]+-R\d+\.\d+$/,
  "TestPlan ID format: TP-{PROJECT}-R{major}.{minor}"
);

export const RunIdSchema = z.string().regex(
  /^RUN-\d{8}-\d{3}$/,
  "Run ID format: RUN-YYYYMMDD-NNN"
);

export const LessonIdSchema = z.string().regex(
  /^L-[A-Z]{2,4}-\d{3}$/,
  "Lesson ID format: L-{AGENT-INITIALS}-{NNN}"
);

/** A task id inside WR/RV ids: T-<n>, T-<phase>-<n> (phase != GATE, any case) or T-GATE-G<N>. */
const TASK_REF = "T-(?:\\d+|(?![Gg][Aa][Tt][Ee]-)[A-Za-z][A-Za-z0-9]*-\\d+|GATE-G\\d+)";
export const TaskRefSchema = z.string().regex(new RegExp(`^${TASK_REF}$`), "Task ref format: T-{n} | T-{phase}-{n} | T-GATE-G{N}");
export const WorkReportIdSchema = z.string().regex(new RegExp(`^WR-${TASK_REF}$`), "WorkReport ID format: WR-{taskRef}");
export const ReviewIdSchema = z.string().regex(new RegExp(`^RV-[a-z-]+-${TASK_REF}$`), "Review ID format: RV-{agent-slug}-{taskRef}");

export type TestCaseId = z.infer<typeof TestCaseIdSchema>;
export type DefectId = z.infer<typeof DefectIdSchema>;
export type StoryId = z.infer<typeof StoryIdSchema>;
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;
export type AcceptanceCriterionId = z.infer<typeof AcceptanceCriterionIdSchema>;
export type RequirementId = z.infer<typeof RequirementIdSchema>;
export type RiskId = z.infer<typeof RiskIdSchema>;
export type RunId = z.infer<typeof RunIdSchema>;
export type LessonId = z.infer<typeof LessonIdSchema>;

export const IdKindSchema = z.enum(["TC", "DEF", "STORY", "SCN", "REQ", "RISK", "TP", "RUN", "L", "WR", "RV", "AC"]);
export type IdKind = z.infer<typeof IdKindSchema>;
