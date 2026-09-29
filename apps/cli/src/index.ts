#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { reconfigureCommand } from "./commands/reconfigure.js";
import { updateCommand } from "./commands/update.js";
import { doctorCommand } from "./commands/doctor.js";
import { runCommand } from "./commands/run.js";
import { eventCommand } from "./commands/event.js";
import { idCommand } from "./commands/id.js";
import { taskCommand } from "./commands/task.js";
import { reviewCommand, workReportCommand } from "./commands/submit.js";
import { integrityCommand } from "./commands/integrity.js";

const program = new Command();

program
  .name("aegis")
  .description("QA framework management CLI")
  .version("1.0.0");

program.addCommand(initCommand());
program.addCommand(reconfigureCommand());
program.addCommand(updateCommand());
program.addCommand(doctorCommand());
program.addCommand(runCommand());
program.addCommand(eventCommand());
program.addCommand(idCommand());
program.addCommand(taskCommand());
program.addCommand(workReportCommand());
program.addCommand(reviewCommand());
program.addCommand(integrityCommand());

program.parse();
