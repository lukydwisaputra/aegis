import { Command, Option } from "commander";
import { addTask, cancelTask, claimTask, listTasks, releaseTask } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

export function taskCommand(): Command {
  const task = new Command("task").description("Create, claim, release, cancel and list run tasks");

  task.command("add")
    .requiredOption("--id <id>", "task id, e.g. T-12")
    .requiredOption("--title <text>", "task title")
    .requiredOption("--agent <qa-*>", "the agent that will claim the task (its paired SPV reviews it)")
    .option("--description <text>", "task description")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { id: string; title: string; agent: string; description?: string; run?: string }) => {
        const ctx = context();
        return addTask(
          ctx.root,
          runIdFor(ctx, o.run),
          { id: o.id, title: o.title, agent: o.agent, ...(o.description !== undefined ? { description: o.description } : {}) },
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

  task.command("cancel")
    .description("Withdraw a never-claimed pending task (its creator only)")
    .requiredOption("--task <id>", "task id")
    .requiredOption("--reason <text>", "why the task is withdrawn")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { task: string; reason: string; run?: string }) => {
        const ctx = context();
        return cancelTask(ctx.root, runIdFor(ctx, o.run), o.task, o.reason, ctx.caller);
      })
    );

  task.command("list")
    .description("Show the run's tasks with their latest attempt and review state (read-only, any caller)")
    .option("--phase <id>", "only the tasks of this phase")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { phase?: string; run?: string }) => {
        const ctx = context();
        return listTasks(ctx.root, runIdFor(ctx, o.run), ctx.caller, o.phase);
      })
    );

  return task;
}
