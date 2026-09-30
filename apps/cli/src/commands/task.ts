import { Command, Option } from "commander";
import { addTask, claimTask, releaseTask } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function taskCommand(): Command {
  const task = new Command("task").description("Create, claim and release run tasks");

  task.command("add")
    .requiredOption("--id <id>", "task id, e.g. T-12")
    .requiredOption("--title <text>", "task title")
    .option("--description <text>", "task description")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { id: string; title: string; description?: string; run?: string }) => {
        const ctx = context();
        return addTask(
          ctx.root,
          runIdFor(ctx, o.run),
          { id: o.id, title: o.title, ...(o.description !== undefined ? { description: o.description } : {}) },
          ctx.caller
        );
      })
    );

  task.command("claim")
    .requiredOption("--task <id>", "task id")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { task: string; run?: string }) => {
        const ctx = context();
        return claimTask(ctx.root, runIdFor(ctx, o.run), o.task, ctx.caller);
      })
    );

  task.command("release")
    .requiredOption("--task <id>", "task id")
    .addOption(new Option("--result <r>", "outcome").choices(["done", "failed"]).makeOptionMandatory())
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { task: string; result: "done" | "failed"; run?: string }) => {
        const ctx = context();
        return releaseTask(ctx.root, runIdFor(ctx, o.run), o.task, o.result, ctx.caller);
      })
    );

  return task;
}
