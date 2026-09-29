import { Command, Option } from "commander";
import { nextId, type AcCategory, type DefectType } from "@qa/ids";
import { assertCallerAllowed, RunStateError } from "@qa/run-state";
import { action, context } from "./_io.js";

function need(value: string | undefined, flag: string, kind: string): string {
  if (value === undefined || value === "") throw new RunStateError("invalid-input", `--${flag} is required for --kind ${kind}`);
  return value;
}

export function idCommand(): Command {
  const id = new Command("id").description("Mint artefact IDs from the shared counters");

  id.command("next")
    .description("Mint the next ID of a kind")
    .addOption(new Option("--kind <kind>", "id kind").choices(["TC", "DEF", "STORY", "REQ", "RISK", "AC"]).makeOptionMandatory())
    .option("--module <code>", "module code (TC, DEF, STORY, REQ, RISK)")
    .option("--story <id>", "story id (AC)")
    .addOption(new Option("--category <c>", "AC category").choices(["happy", "rejection", "edge"]))
    .option("--defect-type <t>", "defect type (DEF), e.g. UI, API, SEC")
    .action(
      action(async (o: { kind: string; module?: string; story?: string; category?: string; defectType?: string }) => {
        const ctx = context();
        assertCallerAllowed(ctx.caller, "id.next");
        switch (o.kind) {
          case "AC":
            return { id: await nextId("AC", need(o.story, "story", "AC"), need(o.category, "category", "AC") as AcCategory) };
          case "DEF":
            return { id: await nextId("DEF", need(o.module, "module", "DEF"), (o.defectType ?? "UI").toUpperCase() as DefectType) };
          case "TC":
            return { id: await nextId("TC", need(o.module, "module", "TC")) };
          case "STORY":
            return { id: await nextId("STORY", need(o.module, "module", "STORY")) };
          case "REQ":
            return { id: await nextId("REQ", need(o.module, "module", "REQ")) };
          case "RISK":
            return { id: await nextId("RISK", need(o.module, "module", "RISK")) };
          default:
            throw new RunStateError("invalid-input", `unsupported kind ${o.kind}`);
        }
      })
    );

  return id;
}
