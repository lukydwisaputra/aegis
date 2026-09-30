import { Command, Option } from "commander";
import { nextId, type AcCategory, type DefectType } from "@qa/ids";
import { StoryIdSchema } from "@qa/contracts";
import { assertCallerAllowed, MODULE_CODE, RunStateError } from "@qa/run-state";
import { action, context } from "./_io.js";

const DEFECT_TYPES = ["UI", "API", "A11Y", "SEC", "PERF", "DATA", "UNIT", "EXP"];

function moduleCode(value: string | undefined, kind: string): string {
  const m = need(value, "module", kind);
  if (!MODULE_CODE.test(m)) throw new RunStateError("invalid-input", `--module must be 2-8 uppercase letters, got "${m}"`);
  return m;
}

function need(value: string | undefined, flag: string, kind: string): string {
  if (value === undefined || value === "") throw new RunStateError("invalid-input", `--${flag} is required for --kind ${kind}`);
  return value;
}

function storyId(value: string | undefined): string {
  const s = need(value, "story", "AC");
  if (!StoryIdSchema.safeParse(s).success) throw new RunStateError("invalid-input", `--story is not a valid story id: "${s}"`);
  return s;
}

function defectType(value: string | undefined): DefectType {
  const t = value ?? "UI";
  if (!DEFECT_TYPES.includes(t)) throw new RunStateError("invalid-input", `--defect-type must be one of ${DEFECT_TYPES.join(", ")}`);
  return t as DefectType;
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
            return { id: await nextId("AC", storyId(o.story), need(o.category, "category", "AC") as AcCategory) };
          case "DEF":
            return { id: await nextId("DEF", moduleCode(o.module, "DEF"), defectType(o.defectType)) };
          case "TC":
            return { id: await nextId("TC", moduleCode(o.module, "TC")) };
          case "STORY":
            return { id: await nextId("STORY", moduleCode(o.module, "STORY")) };
          case "REQ":
            return { id: await nextId("REQ", moduleCode(o.module, "REQ")) };
          case "RISK":
            return { id: await nextId("RISK", moduleCode(o.module, "RISK")) };
          default:
            throw new RunStateError("invalid-input", `unsupported kind ${o.kind}`);
        }
      })
    );

  return id;
}
