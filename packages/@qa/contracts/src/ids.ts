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

/**
 * A task id inside WR/RV ids: T-<n>, T-<phase>-<n> or T-GATE-G<N>. The phase is one or more
 * letter-led segments joined by hyphens, so every PHASE_IDS value (env-auth, closure-draft,
 * dev-test-review) fits; a phase starting with GATE- (any case) is refused, so T-GATE-1 never parses.
 */
const TASK_REF = "T-(?:\\d+|(?![Gg][Aa][Tt][Ee]-)[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z][A-Za-z0-9]*)*-\\d+|GATE-G\\d+)";
export const TaskRefSchema = z.string().regex(new RegExp(`^${TASK_REF}$`), "Task ref format: T-{n} | T-{phase}-{n} | T-GATE-G{N}");
/**
 * A LEGACY task id: T-<letter-led segments> with no trailing number (T-compliance-gdpr, T-compliance-iso25010), which addTask accepted
 * before it began refusing them (a gate rejection leaves such a task pending under its old id, and it can no longer be cancelled and
 * replaced). New tasks stay strict (TaskRefSchema); WR and RV ids accept both, so old runs and their reopened tasks keep working
 * without an invented id. A legacy id may also carry an attempt number (WR-T-compliance-gdpr-2: the strict T-<phase>-<n> shape), and
 * T-GATE-... stays refused.
 */
const LEGACY_TASK_REF = "T-(?![Gg][Aa][Tt][Ee](?:-|$))[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z][A-Za-z0-9]*)*";
const WR_TASK_REF = `(?:${TASK_REF}|${LEGACY_TASK_REF})`;
export const WorkReportIdSchema = z.string().regex(new RegExp(`^WR-${WR_TASK_REF}$`), "WorkReport ID format: WR-{taskId} (a legacy task id with no trailing number may add -{attempt})");
export const ReviewIdSchema = z.string().regex(new RegExp(`^RV-[a-z-]+-${WR_TASK_REF}$`), "Review ID format: RV-{agent-slug}-{taskId}");

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
