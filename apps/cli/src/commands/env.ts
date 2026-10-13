import { Command } from "commander";
import { assertCallerAllowed, envExecInfo, execWithEnv } from "@qa/run-state";
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
      const r = await execWithEnv(ctx.root, runIdFor(ctx, o.run), cmd);
      process.exitCode = r.exitCode;
      return r;
    }));

  return env;
}
