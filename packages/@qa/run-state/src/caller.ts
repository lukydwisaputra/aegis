import { roleOf } from "@qa/path-guard";
import { RunStateError } from "./errors.js";

export const OWNER = "owner";

/** An agent name: the only caller identity besides "owner". Also a path segment in lock and report files. */
export const AGENT_ID = /^qa-[a-z0-9-]+$/;

export const CLI_COMMANDS = [
  "run.create",
  "run.status",
  "run.stop",
  "run.resume",
  "run.reissue",
  "run.descope",
  "event.append",
  "id.next",
  "task.add",
  "task.claim",
  "task.release",
  "task.cancel",
  "task.abandon",
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
  "helpers.vendor",
  "messaging.fetch-contract",
  "messaging.plan",
  "messaging.check",
  "messaging.scan-secrets",
  "messaging.exec",
  "metrics.coverage",
  "defect.amend",
  "rtm.unlink",
  "metrics.defects",
  "metrics.rollups",
  "rtm.sync-defects",
  "rtm.render",
  "env.exec",
  "env.check",
  "lint.run",
  "explore.probe",
  "env.probe",
] as const;

export type CliCommand = (typeof CLI_COMMANDS)[number];

// Commands the main thread may run (through a skill). Everything else is agent-only.
export const OWNER_COMMANDS: ReadonlySet<CliCommand> = new Set<CliCommand>([
  "run.create",
  "run.status",
  "run.stop",
  "run.resume",
  "run.reissue",
  "run.descope",
  "task.abandon",
  "task.list",
  "integrity.verify",
  "integrity.repair-tail",
  "gate.decide",
  "escalation.decide",
  // NEW-07: read-only, presence only — the owner checks where to put the messaging key.
  "messaging.check",
  "metrics.coverage",
  // Gap 5: the owner may correct a record too; qa-defect-manager is the only agent that may (SINGLE_AGENT_COMMANDS).
  "defect.amend",
  "rtm.unlink",
  // Gap 7: read-only, the defect headline numbers of the run's records.
  "metrics.defects",
  "metrics.rollups",
  "rtm.sync-defects",
  "rtm.render",
  // The orchestrator lints the customer-facing files before a gate; the owner may run it too.
  "lint.run",
  // The orchestrator takes the Explore baseline and runs the probe that verifies carried-over discovery; the owner may run it too.
  "explore.probe",
  // The orchestrator probes the environment before Execution starts and before G2; the owner may run it too.
  "env.probe",
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
  "run.create", "run.stop", "run.resume", "run.reissue", "run.descope", "task.abandon", "gate.decide", "escalation.decide", "integrity.repair-tail",
]);

export const ORCHESTRATOR = "qa-orchestrator";

// Commands that advance the run; only the orchestrator runs them (spec §3.6).
export const ORCHESTRATOR_ONLY: ReadonlySet<CliCommand> = new Set<CliCommand>(["phase.start", "phase.complete", "gate.open", "gate.auto-decide", "run.complete"]);

// Agent-only commands that one named agent runs (P2 spec §4.11.3): the environment engineer copies the QA helpers in Env-auth.
// NEW-07: the messaging specialist owns its contract, plan and key; the environment engineer checks the setup.
export const SINGLE_AGENT_COMMANDS: Readonly<Partial<Record<CliCommand, string>>> = {
  "helpers.vendor": "qa-environment-engineer",
  "messaging.fetch-contract": "qa-messaging-specialist",
  "messaging.plan": "qa-messaging-specialist",
  "messaging.exec": "qa-messaging-specialist",
  "messaging.check": "qa-environment-engineer",
  "metrics.coverage": "qa-metrics-collector",
  "defect.amend": "qa-defect-manager",
  "rtm.unlink": "qa-defect-manager",
  "rtm.sync-defects": "qa-defect-manager",
  "rtm.render": "qa-defect-manager",
};

const ENV_EXEC_AGENTS: readonly string[] = [
  "qa-environment-engineer",
  "qa-test-executor",
  "qa-accessibility-specialist",
  "qa-api-specialist",
  "qa-database-specialist",
  "qa-messaging-specialist",
  "qa-responsive-specialist",
  "qa-security-specialist",
  "qa-ui-specialist",
  "qa-unit-specialist",
];

// Commands several named agents run (the owner always may where OWNER_COMMANDS says so): the agent that writes the figures and
// the agent that states them; and, for env.exec / env.check, the agents that run a test runner with the QA credentials injected:
// the environment engineer, the executor and the specialists whose contract lists them. No reviewer, compliance agent or scanner may.
export const AGENT_SET_COMMANDS: Readonly<Partial<Record<CliCommand, readonly string[]>>> = {
  "metrics.defects": ["qa-metrics-collector", "qa-defect-manager", "qa-closure-reporter"],
  // The collector writes the rollups; the defect manager may only check them (--check writes nothing, enforced in writeRollups).
  "metrics.rollups": ["qa-metrics-collector", "qa-defect-manager"],
  "env.exec": ENV_EXEC_AGENTS,
  "env.check": ENV_EXEC_AGENTS,
  "lint.run": ["qa-orchestrator"],
  "explore.probe": ["qa-orchestrator"],
  "env.probe": ["qa-orchestrator"],
};

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
  const only = SINGLE_AGENT_COMMANDS[command];
  if (caller !== OWNER && only !== undefined && caller !== only) {
    throw new RunStateError("caller-forbidden", `${command} is run only by ${only}`);
  }
  const set = AGENT_SET_COMMANDS[command];
  if (caller !== OWNER && set !== undefined && !set.includes(caller)) {
    throw new RunStateError("caller-forbidden", `${command} is run only by ${set.join(" and ")}`);
  }
}

// Event families whose facts the CLI records itself; an agent appending one directly would forge run state.
export const CLI_RECORDED_PREFIXES: readonly string[] = ["run.", "task.", "gate.", "review.", "integrity.", "escalation."];
// cli.refused (NEW-06): the CLI records an agent's invalid-input or internal refusal itself. The two lesson events are
// recorded by aegis review submit when it cannot write a CorrectiveInstruction to the worker's lessons (gap 2); the last two by
// aegis defect amend and aegis rtm unlink (gap 5).
export const CLI_RECORDED_TYPES: ReadonlySet<string> = new Set(["artifact.created", "env.specialist-blocked", "preflight.failed", "cli.refused", "messaging.contract-fetched", "messaging.live-preflight", "lesson.conflict-flagged", "lesson.schema-rejected", "defect.record-amended", "rtm.link-removed", "rtm.defect-map-synced", "rtm.rendered", "env.executed", "lint.completed", "explore.probed", "env.probed"]);

export function isCliRecordedEventType(type: string): boolean {
  return CLI_RECORDED_TYPES.has(type) || CLI_RECORDED_PREFIXES.some((p) => type.startsWith(p));
}

/**
 * Content checks `aegis event append` runs before it appends (the schema alone cannot say it): a `defect.management-complete` that
 * states openApplicationDefects must have a severityBreakdown that sums to it, because the breakdown counts the open application
 * defects. The refusal names both numbers. Other types and events without the field pass.
 */
export function assertEventConsistent(type: string, fields: Record<string, unknown>): void {
  if (type !== "defect.management-complete") return;
  const open = fields["openApplicationDefects"];
  const by = fields["severityBreakdown"];
  if (typeof open !== "number" || by === null || typeof by !== "object" || Array.isArray(by)) return;
  const sum = Object.values(by as Record<string, unknown>).reduce<number>((a, n) => a + (typeof n === "number" ? n : 0), 0);
  if (sum !== open) {
    throw new RunStateError(
      "invalid-input",
      `defect.management-complete is inconsistent: severityBreakdown sums to ${sum} but openApplicationDefects is ${open}; severityBreakdown counts the open application defects by severity code. Correct the figures (aegis metrics defects) and append the event again`
    );
  }
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

/**
 * The one SPV allowed to review `agent`'s work: its role-table SPV (CO-08, P2 T11), e.g. qa-compliance-spv for the six
 * compliance agents; an agent whose row names no SPV pairs with `<agent>-spv`.
 */
export function pairedSpv(agent: string): string {
  return roleOf(agent)?.spv ?? `${agent}-spv`;
}
