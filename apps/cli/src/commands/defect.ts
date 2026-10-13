import { Command } from "commander";
import { amendDefect, parseChangeValue, renderRtmDefects, RunStateError, syncRtmDefectMap, unlinkRtmDefect, type DefectChange } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

const collect = (v: string, acc: string[] = []): string[] => [...acc, v];

/** The changes of `--set path=value` (repeatable) and `--json '{"path": value}'`; a value is JSON when it parses, else text. */
function changesOf(sets: readonly string[], json: string | undefined): DefectChange[] {
  const out: DefectChange[] = [];
  for (const s of sets) {
    const eq = s.indexOf("=");
    if (eq <= 0) throw new RunStateError("invalid-input", `--set "${s}" must be <field>=<value>, for example --set retestVerdict.reason="..."`);
    out.push({ path: s.slice(0, eq), value: parseChangeValue(s.slice(eq + 1)) });
  }
  if (json !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      throw new RunStateError("invalid-input", `--json is not valid JSON: ${(e as Error).message}`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new RunStateError("invalid-input", `--json must be an object of {"<field>": <value>}`);
    }
    for (const [path, value] of Object.entries(parsed)) out.push({ path, value });
  }
  return out;
}

/** Corrections to the run's defect records, demanded by a gate decision; never edits the event log. */
export function defectCommand(): Command {
  const defect = new Command("defect").description("Correct a defect record after triage (qa-defect-manager and the owner)");
  defect
    .command("amend")
    .description("Change allow-listed fields of one defect record (retestVerdict.*, g2Triage.*, status.code, status.transitionedAt, requirementId, userStory) and record why")
    .requiredOption("--defect <id>", "defect id, e.g. DEF-003-REG-SEC")
    .option("--set <field=value>", "field to change; repeat for several; a value that parses as JSON is JSON, else text", collect, [] as string[])
    .option("--json <object>", "fields to change as one JSON object, {\"retestVerdict.reason\": \"...\"}")
    .requiredOption("--reason <text>", "what the gate decision or finding demands, and why the record is wrong")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { defect: string; set: string[]; json?: string; reason: string; run?: string }) => {
        const ctx = context();
        return amendDefect(ctx.root, runIdFor(ctx, o.run), o.defect, { changes: changesOf(o.set, o.json), reason: o.reason }, ctx.caller);
      })
    );
  return defect;
}

/** Corrections to the run's requirements traceability matrix; the rest of rtm.json is untouched. */
export function rtmCommand(): Command {
  const rtm = new Command("rtm").description("Correct the requirements traceability matrix after triage (qa-defect-manager and the owner)");
  rtm
    .command("unlink")
    .description("Remove one defect id from a requirement's row of rtm.json, and its defectMap entry for that requirement")
    .requiredOption("--defect <id>", "defect id to unlink")
    .requiredOption("--requirement <id>", "requirement id of the row, e.g. REQ-REG-04")
    .requiredOption("--reason <text>", "why the link is no longer valid (withdrawn, reframed, wrong requirement)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { defect: string; requirement: string; reason: string; run?: string }) => {
        const ctx = context();
        return unlinkRtmDefect(ctx.root, runIdFor(ctx, o.run), { requirementId: o.requirement, defectId: o.defect, reason: o.reason }, ctx.caller);
      })
    );
  rtm
    .command("sync-defects")
    .description("Make rtm.json#defectMap match the defect records (one entry per record; severity, title, requirement and story from the record) and re-render the defect table of rtm.md")
    .requiredOption("--reason <text>", "why the map is synced (the gate decision or finding behind it)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { reason: string; run?: string }) => {
        const ctx = context();
        return syncRtmDefectMap(ctx.root, runIdFor(ctx, o.run), { reason: o.reason }, ctx.caller);
      })
    );
  rtm
    .command("render")
    .description("Rewrite the defect-to-case table of rtm.md from rtm.json#defectMap (the rest of rtm.md is untouched)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action((o: { run?: string }) => {
        const ctx = context();
        return renderRtmDefects(ctx.root, runIdFor(ctx, o.run), ctx.caller);
      })
    );
  return rtm;
}
