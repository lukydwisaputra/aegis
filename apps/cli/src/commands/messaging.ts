import { Command } from "commander";
import { assertCallerAllowed, buildPlan, checkMessaging, execWithMessaging, fetchContract, scanSecrets } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

/** NEW-07: the messaging specialist's contract, plan, key and secret scan. Output never holds a key value. */
export function messagingCommand(): Command {
  const messaging = new Command("messaging").description("Messaging-integration testing: provider contract, plan, live key");

  messaging
    .command("fetch-contract")
    .description("Fetch the provider contract named in aegis.config.json#messaging into runs/<id>/messaging/contract.json")
    .option("--run <runId>", "run id (default: the active run)")
    .action(action(async (o: { run?: string }) => {
      const ctx = context();
      assertCallerAllowed(ctx.caller, "messaging.fetch-contract");
      return fetchContract(ctx.root, runIdFor(ctx, o.run), ctx.caller);
    }));

  messaging
    .command("plan")
    .description("Write and print runs/<id>/messaging/plan.json: operations, env names, stub wiring line, static checklist")
    .option("--run <runId>", "run id (default: the active run)")
    .action(action((o: { run?: string }) => {
      const ctx = context();
      assertCallerAllowed(ctx.caller, "messaging.plan");
      return buildPlan(ctx.root, runIdFor(ctx, o.run));
    }));

  messaging
    .command("check")
    .description("Report contract, stub port and key presence (never a value)")
    .option("--run <runId>", "run id (default: the active run)")
    .action(action((o: { run?: string }) => {
      const ctx = context();
      assertCallerAllowed(ctx.caller, "messaging.check");
      return checkMessaging(ctx.root, runIdFor(ctx, o.run));
    }));

  messaging
    .command("scan-secrets")
    .description("Report file:line of any provider key in the given paths (never the match)")
    .option("--run <runId>", "run id (default: the active run)")
    .argument("<paths...>", "files or directories to scan")
    .action(action((paths: string[], o: { run?: string }) => {
      const ctx = context();
      assertCallerAllowed(ctx.caller, "messaging.scan-secrets");
      return scanSecrets(ctx.root, runIdFor(ctx, o.run), paths);
    }));

  messaging
    .command("exec")
    .description("Run a command in the target root with the stub wiring, plan, contract, preflight file and (when found) the live key injected; output redacted")
    .option("--run <runId>", "run id (default: the active run)")
    .argument("<command...>", "the command, after --")
    .action(action(async (cmd: string[], o: { run?: string }) => {
      const ctx = context();
      assertCallerAllowed(ctx.caller, "messaging.exec");
      const r = await execWithMessaging(ctx.root, runIdFor(ctx, o.run), ctx.caller, cmd);
      process.exitCode = r.exitCode;
      return r;
    }));

  return messaging;
}
