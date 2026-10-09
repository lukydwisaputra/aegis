import { Command, Option } from "commander";
import { completeRun, createRun, descopeRun, nextStep, readActiveRun, reissueRun, requestStop, resumeRun, RunStateError, runStatus } from "@qa/run-state";
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
        // CO-10: the errors an owner acknowledgement waives stay visible.
        return { ...state, next: nextStep(state), integrityWaived: state.integrityAcknowledged?.errors ?? [] };
      })
    );

  run
    .command("complete")
    .description("Complete the run once every phase and gate is done (orchestrator only)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(action((o: { run?: string }) => {
      const ctx = context();
      return completeRun(ctx.root, runIdFor(ctx, o.run), ctx.caller);
    }));

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
      action(async (o: { run?: string; acknowledgeIntegrity?: boolean; reason?: string }) => {
        const ctx = context();
        if (o.acknowledgeIntegrity === true && (o.reason ?? "").trim() === "") {
          throw new RunStateError("invalid-input", "--reason is required with --acknowledge-integrity");
        }
        const acknowledging = o.acknowledgeIntegrity === true;
        const state = await resumeRun(ctx.root, runIdFor(ctx, o.run), ctx.caller, acknowledging ? { acknowledgeIntegrity: { reason: o.reason ?? "" } } : {});
        // CO-10: say exactly which errors this acknowledgement waives from now on.
        return { ...state, acknowledgedErrors: acknowledging ? state.integrityAcknowledged?.errors ?? [] : [] };
      })
    );

  run
    .command("reissue")
    .description("Reopen the executive or curator phase of a completed run (owner only); the run becomes the active run")
    .option("--run <id>", "run id (defaults to the active run)")
    .requiredOption("--phase <id>", "phase to reissue: a phase after the last gate (executive or curator)")
    .requiredOption("--reason <text>", "why the phase is reissued")
    .action(
      action(async (o: { run?: string; phase: string; reason: string }) => {
        const ctx = context();
        const runId = runIdFor(ctx, o.run);
        const previous = readActiveRun(ctx.root);
        const state = await reissueRun(ctx.root, runId, { phase: o.phase, reason: o.reason }, ctx.caller);
        // The reissued run is now the active one; say so when it replaced another.
        return { ...state, next: nextStep(state), activeRun: runId, previousActiveRun: previous !== runId ? previous : null };
      })
    );

  run
    .command("descope")
    .description("Record a test case as out of scope for the run (owner only); every count and report states it apart")
    .option("--run <id>", "run id (defaults to the active run)")
    .requiredOption("--case <id>", "test case id, e.g. TC-AUTH-012 (repeat the command for each case)")
    .requiredOption("--reason <text>", "why the case is out of scope; the reports quote it")
    .action(
      action(async (o: { run?: string; case: string; reason: string }) => {
        const ctx = context();
        const runId = runIdFor(ctx, o.run);
        const { state, caseId, recorded } = await descopeRun(ctx.root, runId, { caseId: o.case, reason: o.reason }, ctx.caller);
        const entry = state.descoped?.find((d) => d.caseId === caseId);
        const message = recorded ? `${caseId} is now out of scope for ${runId}` : `${caseId} is already descoped ("${entry?.reason ?? ""}"); nothing changed`;
        return { runId, caseId, recorded, message, descoped: state.descoped ?? [] };
      })
    );

  return run;
}
