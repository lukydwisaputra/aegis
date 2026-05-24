import { z } from "zod";

export const SeverityCodeSchema = z.enum(["Sev1", "Sev2", "Sev3", "Sev4", "Sev5"]);
export type SeverityCode = z.infer<typeof SeverityCodeSchema>;

export const SeverityNameSchema = z.enum(["Blocker", "Critical", "Major", "Minor", "Trivial"]);
export type SeverityName = z.infer<typeof SeverityNameSchema>;

export const SeveritySchema = z.object({
  code: SeverityCodeSchema,
  name: SeverityNameSchema,
});
export type Severity = z.infer<typeof SeveritySchema>;

export const SEVERITY_MAP: Record<SeverityCode, SeverityName> = {
  Sev1: "Blocker",
  Sev2: "Critical",
  Sev3: "Major",
  Sev4: "Minor",
  Sev5: "Trivial",
};

export function makeSeverity(code: SeverityCode): Severity {
  return { code, name: SEVERITY_MAP[code] };
}

export const PriorityCodeSchema = z.enum(["P0", "P1", "P2", "P3", "P4"]);
export type PriorityCode = z.infer<typeof PriorityCodeSchema>;

export const PriorityNameSchema = z.enum(["Hotfix", "Next release", "This quarter", "Backlog", "Won't fix"]);
export type PriorityName = z.infer<typeof PriorityNameSchema>;

export const PrioritySchema = z.object({
  code: PriorityCodeSchema,
  name: PriorityNameSchema,
});
export type Priority = z.infer<typeof PrioritySchema>;

export const PRIORITY_MAP: Record<PriorityCode, PriorityName> = {
  P0: "Hotfix",
  P1: "Next release",
  P2: "This quarter",
  P3: "Backlog",
  P4: "Won't fix",
};

export function makePriority(code: PriorityCode): Priority {
  return { code, name: PRIORITY_MAP[code] };
}
