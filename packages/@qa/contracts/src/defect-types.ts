import { z } from "zod";

// IEEE 1044-2009 defect classification
export const DefectTypeSchema = z.enum([
  "Data",        // Incorrect data values or data state
  "Interface",   // Issues at module/API boundaries
  "Logic",       // Algorithmic or control-flow errors
  "Description", // Errors in comments, docs, or spec text
  "Syntax",      // Compilation or grammar errors
  "Standards",   // Violations of coding/regulatory standards
  "Other",       // Does not fit the above
]);
export type DefectType = z.infer<typeof DefectTypeSchema>;

export const PhaseIntroducedSchema = z.enum([
  "Requirements",
  "Design",
  "Code",
  "Test",
  "Build",
  "Config",
]);
export type PhaseIntroduced = z.infer<typeof PhaseIntroducedSchema>;

export const FoundInSchema = z.enum([
  "Unit",
  "Integration",
  "System",
  "UAT",
  "Prod",
]);
export type FoundIn = z.infer<typeof FoundInSchema>;

export const DefectStatusSchema = z.enum([
  "New",
  "Triaged",
  "In Progress",
  "Resolved",
  "Verified",
  "Closed",
  "Reopened",
  "Won't Fix",
  "Duplicate",
  "Cannot Reproduce",
  "Not a Bug",
]);
export type DefectStatus = z.infer<typeof DefectStatusSchema>;

/**
 * The retest verdict of a defect carried from an earlier run (DefectSchema#retestVerdict.verdict). FIXED, PARTIALLY FIXED, NOT FIXED
 * and CANNOT VERIFY speak about the defect in the application (the last three leave it open); REFRAMED and REPORT WITHDRAWN say the report itself
 * was wrong:
 *   FIXED            the retest shows the defect is gone.
 *   PARTIALLY FIXED  part of the defect is gone, part remains: still open until the remainder is fixed or the developers confirm the
 *                    current fix resolves everything.
 *   NOT FIXED        the retest reproduces the defect.
 *   CANNOT VERIFY    the retest could not reach a verdict (blocked, no oracle).
 *   REFRAMED         the observation stands but the report was mis-stated (wrong severity, wrong requirement, a hardening idea rather
 *                    than a defect); it is not an open application defect as reported.
 *   REPORT WITHDRAWN the report was wrong (test-side artefact, not a defect); nothing is open.
 * The open-application-defect rule built on these (NOT FIXED, PARTIALLY FIXED and CANNOT VERIFY stay open) lives in @qa/metrics.
 */
export const RetestVerdictCodeSchema = z.enum([
  "FIXED",
  "PARTIALLY FIXED",
  "NOT FIXED",
  "CANNOT VERIFY",
  "REFRAMED",
  "REPORT WITHDRAWN",
]);
export type RetestVerdictCode = z.infer<typeof RetestVerdictCodeSchema>;
