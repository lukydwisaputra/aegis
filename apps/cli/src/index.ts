#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { reconfigureCommand } from "./commands/reconfigure.js";
import { updateCommand } from "./commands/update.js";
import { doctorCommand } from "./commands/doctor.js";

const program = new Command();

program
  .name("aegis")
  .description("QA framework management CLI")
  .version("1.0.0");

program.addCommand(initCommand());
program.addCommand(reconfigureCommand());
program.addCommand(updateCommand());
program.addCommand(doctorCommand());

program.parse();
