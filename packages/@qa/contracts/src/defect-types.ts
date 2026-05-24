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
