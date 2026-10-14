import { Command, Option } from "commander";
import { assertCallerAllowed, envExecInfo, execWithEnv, PROBE_STAGES, probeEnvironment, type ProbeStage } from "@qa/run-state";
import { makeProbeSystem } from "../env-probe-system.js";
import { action, context, runIdFor } from "./_io.js";

/** Test runners get the QA environment's Supabase credentials without an agent ever reading the secrets file. */
export function envCommand(): Command {
  const env = new Command("env").description("QA environment variables for test runners (values are never printed)");

  env
    .command("check")
    .description("Report which QA variables env exec would inject, by name only")
    .option("--run <runId>", "run id (default: the active run)")
    .action(action((o: { run?: string }) => {
      const ctx = context();
      assertCallerAllowed(ctx.caller, "env.check");
      const i = envExecInfo(ctx.root, runIdFor(ctx, o.run));
      return { environment: i.environment, injected: i.injected, missing: i.missing };
    }));

  env
    .command("exec")
    .description("Run a command in the target root with the QA Supabase credentials and dev keys injected; output redacted; refused on a read-only environment")
    .option("--run <runId>", "run id (default: the active run)")
    .argument("<command...>", "the command, after --")
    .action(action(async (cmd: string[], o: { run?: string }) => {
      const ctx = context();
      assertCallerAllowed(ctx.caller, "env.exec");
      const r = await execWithEnv(ctx.root, runIdFor(ctx, o.run), ctx.caller, cmd);
      process.exitCode = r.exitCode;
      return r;
    }));

  env
    .command("probe")
    .description(
      "Probe the environment under test (health url and declared health paths, listeners on a local port, declared required env names, build under test); writes reports/env/probe-{stage}.json"
    )
    .addOption(new Option("--stage <stage>", "execution (after Env-data, before Execution starts) or g2 (after Execution)").choices([...PROBE_STAGES]).makeOptionMandatory())
    .option("--run <runId>", "run id (default: the active run)")
    .action(async (...args: [{ stage: ProbeStage; run?: string }, Command]) => {
      await action((o: { stage: ProbeStage; run?: string }, _cmd: Command) => {
        const ctx = context();
        return probeEnvironment(ctx.root, runIdFor(ctx, o.run), ctx.caller, o.stage, makeProbeSystem());
      })(...args);
      // A keep-alive socket or a child that outlived its timeout must not keep the CLI alive: the result is printed, the process ends.
      await flushed(process.stdout);
      await flushed(process.stderr);
      process.exit();
    });

  return env;
}

/** Resolves once everything written to `stream` so far has been handed to the OS (a pipe on macOS is asynchronous). */
const flushed = (stream: NodeJS.WriteStream): Promise<void> => new Promise((res) => stream.write("", () => res()));
