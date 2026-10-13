import { Command } from "commander";
import { noteParseRefusal } from "./commands/_io.js";
import { alignCommand } from "./commands/align.js";
import { doctorCommand } from "./commands/doctor.js";
import { escalationCommand } from "./commands/escalation.js";
import { eventCommand } from "./commands/event.js";
import { gateCommand } from "./commands/gate.js";
import { idCommand } from "./commands/id.js";
import { initCommand } from "./commands/init.js";
import { integrityCommand } from "./commands/integrity.js";
import { messagingCommand } from "./commands/messaging.js";
import { metricsCommand } from "./commands/metrics.js";
import { phaseCommand } from "./commands/phase.js";
import { reconfigureCommand } from "./commands/reconfigure.js";
import { runCommand } from "./commands/run.js";
import { reviewCommand, workReportCommand } from "./commands/submit.js";
import { taskCommand } from "./commands/task.js";
import { updateCommand } from "./commands/update.js";
import { helpersCommand } from "./commands/vendor.js";

/** The aegis program. Parsing never exits the process: parse errors are thrown as commander errors (see runCli). */
export function buildProgram(): Command {
  const program = new Command();
  program.name("aegis").description("QA framework management CLI").version("1.0.0");
  for (const command of [
    initCommand(), reconfigureCommand(), updateCommand(), doctorCommand(), runCommand(), eventCommand(), idCommand(),
    taskCommand(), workReportCommand(), reviewCommand(), integrityCommand(), alignCommand(), phaseCommand(), gateCommand(),
    escalationCommand(), helpersCommand(), messagingCommand(), metricsCommand(),
  ]) {
    program.addCommand(command);
  }
  quietErrors(program);
  return program;
}

// addCommand() does not copy settings to subcommands, so every level gets exitOverride and a silent error writer.
function quietErrors(cmd: Command): void {
  cmd.exitOverride();
  cmd.configureOutput({ outputError: () => undefined });
  for (const sub of cmd.commands) quietErrors(sub);
}

// Help and version output are already printed; they keep commander's exit code.
const PASS_THROUGH: ReadonlySet<string> = new Set(["commander.helpDisplayed", "commander.help", "commander.version"]);

export interface Envelope {
  exitCode: number;
  stderr: string;
}

/** CO-04: a commander parse error becomes the CLI's JSON refusal envelope (exit 2), like a RunStateError. */
export function envelopeFor(err: { code: string; exitCode: number; message: string }): Envelope {
  if (PASS_THROUGH.has(err.code)) return { exitCode: err.exitCode, stderr: "" };
  return { exitCode: 2, stderr: JSON.stringify({ error: "invalid-input", message: parseMessage(err) }) + "\n" };
}

/** The refusal message of a commander parse error, computed once for the envelope and the cli.refused record. */
function parseMessage(err: { message: string }): string {
  return err.message.replace(/^error:\s*/, "");
}

function isCommanderError(e: unknown): e is { code: string; exitCode: number; message: string } {
  const code = (e as { code?: unknown } | null)?.code;
  return e instanceof Error && typeof code === "string" && code.startsWith("commander.");
}

export async function runCli(argv: readonly string[]): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync([...argv], { from: "user" });
  } catch (e) {
    if (!isCommanderError(e)) throw e;
    const env = envelopeFor(e);
    if (env.stderr !== "") process.stderr.write(env.stderr);
    process.exitCode = env.exitCode;
    if (env.exitCode === 2) await noteParseRefusal(argv, parseMessage(e), program);
  }
}
