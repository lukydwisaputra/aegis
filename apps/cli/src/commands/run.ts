import { Command, Option } from "commander";
import { createRun, nextStep, requestStop, resumeRun, RunStateError, runStatus } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function runCommand(): Command {
  const run = new Command("run").description("Create and control QA runs");

  run
    .command("create")
    .description("Create a run and make it the active run")
    .requiredOption("--env <name>", "environment from aegis.config.json#environments")
    .requiredOption("--module <codes...>", "module codes, e.g. AUTH BILLING")
    .addOption(new Option("--cycle <type>", "cycle type").choices(["full", "smoke"]).default("full"))
    .addOption(new Option("--health <result>", "result of the pre-cycle /qa-health run").choices(["passed", "failed", "not-run"]).default("not-run"))
    .option("--intake <globs...>", "target-relative globs to copy into intake/ (overrides aegis.config.json#intake.sources)")
    .action(
      action(async (o: { env: string; module: string[]; cycle: "full" | "smoke"; health: "passed" | "failed" | "not-run"; intake?: string[] }) => {
        const ctx = context();
        return createRun(
          ctx.root,
          { environment: o.env, modules: o.module, cycleType: o.cycle, health: o.health, ...(o.intake !== undefined ? { intake: o.intake } : {}) },
          ctx.caller
        );
      })
    );

  run
    .command("status")
    .description("Show run.json for the active or given run")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { run?: string }) => {
        const ctx = context();
        const state = runStatus(ctx.root, runIdFor(ctx, o.run), ctx.caller);
        return { ...state, next: nextStep(state) };
      })
    );

  run
    .command("stop")
    .description("Request a clean stop; agents refuse new work")
    .option("--run <id>", "run id (defaults to the active run)")
    .requiredOption("--reason <text>", "why the run is stopped")
    .action(
      action((o: { run?: string; reason: string }) => {
        const ctx = context();
        return requestStop(ctx.root, runIdFor(ctx, o.run), o.reason, ctx.caller);
      })
    );

  run
    .command("resume")
    .description("Resume a stopped or blocked run")
    .option("--run <id>", "run id (defaults to the active run)")
    .option("--acknowledge-integrity", "acknowledge a recorded integrity violation")
    .option("--reason <text>", "required with --acknowledge-integrity")
    .action(
      action((o: { run?: string; acknowledgeIntegrity?: boolean; reason?: string }) => {
        const ctx = context();
        if (o.acknowledgeIntegrity === true && (o.reason ?? "").trim() === "") {
          throw new RunStateError("invalid-input", "--reason is required with --acknowledge-integrity");
        }
        return resumeRun(
          ctx.root,
          runIdFor(ctx, o.run),
          ctx.caller,
          o.acknowledgeIntegrity === true ? { acknowledgeIntegrity: { reason: o.reason ?? "" } } : {}
        );
      })
    );

  return run;
}
