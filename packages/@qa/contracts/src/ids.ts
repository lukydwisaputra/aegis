import { z } from "zod";

// ID format patterns
// TC-AUTH-031, DEF-AUTH-0017, STORY-AUTH-204, REQ-AUTH-04, RISK-AUTH-007
// TP-PROJECT-R2.4, RUN-20260523-001, L-TD-012, WR-T-42, RV-td-spv-T-42

const MODULE = "[A-Z]{2,8}";

export const TestCaseIdSchema = z.string().regex(
  new RegExp(`^TC-${MODULE}-\\d{3,4}$`),
  "TestCase ID format: TC-{MODULE}-{NNN}"
);

export const DefectIdSchema = z.string().regex(
  new RegExp(`^DEF-${MODULE}-\\d{4,5}$`),
  "Defect ID format: DEF-{MODULE}-{NNNN}"
);

export const StoryIdSchema = z.string().regex(
  new RegExp(`^STORY-${MODULE}-\\d{3,4}$`),
  "Story ID format: STORY-{MODULE}-{NNN}"
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

export const WorkReportIdSchema = z.string().regex(
  /^WR-T-\d+$/,
  "WorkReport ID format: WR-T-{taskNumber}"
);

export const ReviewIdSchema = z.string().regex(
  /^RV-[a-z-]+-T-\d+$/,
  "Review ID format: RV-{agent-slug}-T-{taskNumber}"
);

export type TestCaseId = z.infer<typeof TestCaseIdSchema>;
export type DefectId = z.infer<typeof DefectIdSchema>;
export type StoryId = z.infer<typeof StoryIdSchema>;
export type RequirementId = z.infer<typeof RequirementIdSchema>;
export type RiskId = z.infer<typeof RiskIdSchema>;
export type RunId = z.infer<typeof RunIdSchema>;
export type LessonId = z.infer<typeof LessonIdSchema>;

export const IdKindSchema = z.enum(["TC", "DEF", "STORY", "REQ", "RISK", "TP", "RUN", "L", "WR", "RV"]);
export type IdKind = z.infer<typeof IdKindSchema>;
