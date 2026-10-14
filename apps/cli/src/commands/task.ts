import { Command, Option } from "commander";
import { abandonTask, addTask, cancelTask, claimTask, listTasks, releaseTask, RunStateError } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

interface TaskRef {
  task?: string;
  id?: string;
  taskId?: string;
}

/**
 * The task id of claim, release and cancel, as an agent writes it: `--task T-1` (the documented form), `--id T-1`, `--task-id T-1` or
 * the bare `T-1`. Agents guessed these spellings 60 times in one run and were refused for each; the id is the same whichever way it comes.
 */
function taskIdOf(o: TaskRef, positional: string | undefined): string {
  const id = o.task ?? o.id ?? o.taskId ?? positional;
  if (id === undefined || id === "") throw new RunStateError("invalid-input", "a task id is required: --task <id> (or the id alone: task <verb> T-12)");
  return id;
}

/** `--task <id>` plus the spellings above; the three are the same option, only --task is documented. */
function withTaskRef(c: Command, summary: string): Command {
  return c
    .argument("[task]", "the task id, when --task is not given")
    .option("--task <id>", summary)
    .addOption(new Option("--id <id>").hideHelp())
    .addOption(new Option("--task-id <id>").hideHelp());
}

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

  withTaskRef(task.command("claim"), "task id")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((arg: string | undefined, o: TaskRef & { run?: string }) => {
        const ctx = context();
        return claimTask(ctx.root, runIdFor(ctx, o.run), taskIdOf(o, arg), ctx.caller);
      })
    );

  withTaskRef(task.command("release"), "task id")
    .addOption(new Option("--result <r>", "outcome").choices(["done", "failed"]).makeOptionMandatory())
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((arg: string | undefined, o: TaskRef & { result: "done" | "failed"; run?: string }) => {
        const ctx = context();
        return releaseTask(ctx.root, runIdFor(ctx, o.run), taskIdOf(o, arg), o.result, ctx.caller);
      })
    );

  task.command("abandon")
    .description("Owner only: clear an in-progress task that can never finish (no work report waiting for review); records task.cancelled")
    .requiredOption("--task <id>", "task id")
    .requiredOption("--reason <text>", "why the task is abandoned")
    .option("--run <runId>", "run id (default: the active run)")
    .action(action(async (o: { task: string; reason: string; run?: string }) => {
      const ctx = context();
      return abandonTask(ctx.root, runIdFor(ctx, o.run), o.task, o.reason, ctx.caller);
    }));

  withTaskRef(task.command("cancel").description("Withdraw a never-claimed pending task (its creator only)"), "task id")
    .requiredOption("--reason <text>", "why the task is withdrawn")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((arg: string | undefined, o: TaskRef & { reason: string; run?: string }) => {
        const ctx = context();
        return cancelTask(ctx.root, runIdFor(ctx, o.run), taskIdOf(o, arg), o.reason, ctx.caller);
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
