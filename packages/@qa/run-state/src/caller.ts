import { RunStateError } from "./errors.js";

export const OWNER = "owner";

/** An agent name: the only caller identity besides "owner". Also a path segment in lock and report files. */
export const AGENT_ID = /^qa-[a-z0-9-]+$/;

export const CLI_COMMANDS = [
  "run.create",
  "run.status",
  "run.stop",
  "run.resume",
  "event.append",
  "id.next",
  "task.add",
  "task.claim",
  "task.release",
  "task.cancel",
  "task.list",
  "work-report.submit",
  "review.submit",
  "integrity.verify",
  "integrity.repair-tail",
  "phase.start",
  "phase.complete",
  "gate.open",
  "gate.decide",
  "gate.auto-decide",
  "run.complete",
  "escalation.decide",
] as const;

export type CliCommand = (typeof CLI_COMMANDS)[number];

// Commands the main thread may run (through a skill). Everything else is agent-only.
export const OWNER_COMMANDS: ReadonlySet<CliCommand> = new Set<CliCommand>([
  "run.create",
  "run.status",
  "run.stop",
  "run.resume",
  "task.list",
  "integrity.verify",
  "integrity.repair-tail",
  "gate.decide",
  "escalation.decide",
]);

export function resolveCaller(env: NodeJS.ProcessEnv = process.env): string {
  const name = env["AEGIS_AGENT"]?.trim();
  if (name === undefined || name === "") {
    throw new RunStateError(
      "caller-unknown",
      "AEGIS_AGENT is not set: prefix the command with AEGIS_AGENT=<agent-name> (the main thread uses AEGIS_AGENT=owner)"
    );
  }
  if (name !== OWNER && !AGENT_ID.test(name)) {
    throw new RunStateError("caller-unknown", `AEGIS_AGENT="${name}" is neither "owner" nor a qa-* agent`);
  }
  return name;
}

// Commands only the main thread may run; agents reach them through the matching /qa-* skill.
export const OWNER_ONLY: ReadonlySet<CliCommand> = new Set<CliCommand>([
  "run.create", "run.stop", "run.resume", "gate.decide", "escalation.decide", "integrity.repair-tail",
]);

export const ORCHESTRATOR = "qa-orchestrator";

// Commands that advance the run; only the orchestrator runs them (spec §3.6).
export const ORCHESTRATOR_ONLY: ReadonlySet<CliCommand> = new Set<CliCommand>(["phase.start", "phase.complete", "gate.open", "gate.auto-decide", "run.complete"]);

export function assertCallerAllowed(caller: string, command: CliCommand): void {
  if (caller === OWNER && !OWNER_COMMANDS.has(command)) {
    throw new RunStateError("caller-forbidden", `"${command}" is agent-only; the main thread cannot run it`);
  }
  if (caller !== OWNER && OWNER_ONLY.has(command)) {
    throw new RunStateError("caller-forbidden", `${command} is owner-only; run it through its /qa-* command`);
  }
  if (caller !== OWNER && caller !== ORCHESTRATOR && ORCHESTRATOR_ONLY.has(command)) {
    throw new RunStateError("caller-forbidden", `${command} is run only by ${ORCHESTRATOR}`);
  }
}

// Event families whose facts the CLI records itself; an agent appending one directly would forge run state.
export const CLI_RECORDED_PREFIXES: readonly string[] = ["run.", "task.", "gate.", "review.", "integrity.", "escalation."];
export const CLI_RECORDED_TYPES: ReadonlySet<string> = new Set(["artifact.created", "env.specialist-blocked", "preflight.failed"]);

export function isCliRecordedEventType(type: string): boolean {
  return CLI_RECORDED_TYPES.has(type) || CLI_RECORDED_PREFIXES.some((p) => type.startsWith(p));
}

export function assertAppendableByAgent(type: string): void {
  if (isCliRecordedEventType(type)) {
    throw new RunStateError("invalid-input", `event type ${type} is recorded by the CLI, not appended directly`);
  }
}

/** Tier-2 specialists count against parallelism.maxSpecialists; their SPVs do not. */
export function isSpecialist(agent: string): boolean {
  return /^qa-[a-z0-9-]+-specialist$/.test(agent);
}

// Workers whose SPV is shared across a family rather than named `<agent>-spv`.
const SHARED_SPV: Readonly<Record<string, string>> = {
  "qa-cicd-planner": "qa-cicd-spv",
  "qa-cicd-implementer": "qa-cicd-spv",
  "qa-cicd-evaluator": "qa-cicd-spv",
  "qa-github-planner": "qa-github-spv",
  "qa-github-implementer": "qa-github-spv",
};

/** The one SPV allowed to review `agent`'s work. */
export function pairedSpv(agent: string): string {
  return SHARED_SPV[agent] ?? `${agent}-spv`;
}
