import type { AgentContract, PathEntry, Pipeline, SkillContract } from "./schema.js";

export const SPECIAL_PHASES: ReadonlySet<string> = new Set(["crosscutting", "spv", "devops", "tooling"]);

export const RULE_IDS = [
  "CONTRACT", "DISPATCH", "SPV", "PRODUCER", "CONSUMER", "EVENT", "CLI",
  "WRITE-POLICY", "ROUTE", "ENV", "CONFIG", "SKILL", "DRIFT", "DOC-REF",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export interface Section {
  heading: string;
  text: string;
  startLine: number;
}

export interface Unit {
  kind: "agent" | "skill";
  name: string;
  file: string; // repo-relative
  tools: string[];
  source: string;
  sections: Section[];
  contract: AgentContract | SkillContract | null;
  contractLine: number;
}

export interface Model {
  root: string;
  units: Map<string, Unit>;
  skillAliases: Set<string>; // skill dir names and frontmatter names
  pipeline: Pipeline | null;
  aegisConfig: Record<string, unknown>;
  thresholds: Record<string, unknown>;
  matrixIds: Set<string>;
  matrixStatus: Map<string, string>; // ID → Status cell ("open" when the table has no Status column)
  declaredEvents: Set<string>;
  docs: Array<{ file: string; source: string }>; // HANDBOOK/**, CLAUDE.md, README.md
  loadErrors: Violation[];
}

export interface Violation {
  rule: RuleId;
  subject: string;
  detail: string;
  reason: string;
  key: string;
  file: string;
  line: number;
  message: string;
}

export function violation(rule: RuleId, subject: string, detail: string, reason: string, file: string, line: number, message: string): Violation {
  return { rule, subject, detail, reason, key: `${rule}:${subject}:${detail}:${reason}`, file, line, message };
}

export function pathOf(entry: PathEntry): string {
  return typeof entry === "string" ? entry : entry.path;
}

export function isAgentContract(u: Unit): u is Unit & { contract: AgentContract } {
  return u.kind === "agent" && u.contract !== null;
}

export function isSkillContract(u: Unit): u is Unit & { contract: SkillContract } {
  return u.kind === "skill" && u.contract !== null;
}
