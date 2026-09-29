import { RunStateError } from "./errors.js";

export const OWNER = "owner";

export type CliCommand =
  | "run.create"
  | "run.status"
  | "run.stop"
  | "run.resume"
  | "event.append"
  | "id.next"
  | "task.add"
  | "task.claim"
  | "task.release"
  | "work-report.submit"
  | "review.submit"
  | "integrity.verify";

// Commands the main thread may run (through a skill). Everything else is agent-only.
const OWNER_COMMANDS: ReadonlySet<CliCommand> = new Set<CliCommand>([
  "run.create",
  "run.status",
  "run.stop",
  "run.resume",
  "integrity.verify",
]);

export function resolveCaller(env: NodeJS.ProcessEnv = process.env): string {
  const name = env["AEGIS_AGENT"]?.trim();
  if (name === undefined || name === "") {
    throw new RunStateError(
      "caller-unknown",
      "AEGIS_AGENT is not set: prefix the command with AEGIS_AGENT=<agent-name> (the main thread uses AEGIS_AGENT=owner)"
    );
  }
  if (name !== OWNER && !/^qa-[a-z0-9-]+$/.test(name)) {
    throw new RunStateError("caller-unknown", `AEGIS_AGENT="${name}" is neither "owner" nor a qa-* agent`);
  }
  return name;
}

export function assertCallerAllowed(caller: string, command: CliCommand): void {
  if (caller === OWNER && !OWNER_COMMANDS.has(command)) {
    throw new RunStateError("caller-forbidden", `"${command}" is agent-only; the main thread cannot run it`);
  }
}

/** Tier-2 specialists count against parallelism.maxSpecialists; their SPVs do not. */
export function isSpecialist(agent: string): boolean {
  return /^qa-[a-z0-9-]+-specialist$/.test(agent);
}
