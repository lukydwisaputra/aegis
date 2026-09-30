import type { AgentContract, PathEntry, Pipeline, SkillContract } from "./schema.js";

export const SPECIAL_PHASES: ReadonlySet<string> = new Set(["crosscutting", "spv", "devops", "tooling"]);

export type RuleId =
  | "CONTRACT" | "DISPATCH" | "SPV" | "PRODUCER" | "CONSUMER" | "EVENT" | "CLI"
  | "WRITE-POLICY" | "ROUTE" | "ENV" | "CONFIG" | "SKILL" | "DRIFT" | "DOC-REF";

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
  declaredEvents: Set<string>;
  packageNames: Set<string>; // "@qa/<dir>" dir names
  docs: Array<{ file: string; source: string }>; // HANDBOOK/**, CLAUDE.md, README.md
  loadErrors: Violation[];
}

export interface Violation {
  rule: RuleId;
  subject: string;
  detail: string;
  key: string;
  file: string;
  line: number;
  message: string;
}

export function violation(rule: RuleId, subject: string, detail: string, file: string, line: number, message: string): Violation {
  return { rule, subject, detail, key: `${rule}:${subject}:${detail}`, file, line, message };
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
