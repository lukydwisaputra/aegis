import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PhaseId } from "@qa/contracts";
import { runDir } from "./paths.js";
import { OUTPUT_SCHEMAS, PHASE_OUTPUT_SETS, PHASE_OUTPUTS, type OutputSchema } from "./phase-map.js";
import { formatIssues } from "./util.js";

/** Read and validate one output file: its parsed value, or the problem to report. */
function checkOutput(file: string, rel: string, schema: OutputSchema | undefined): { problem: string } | { value: unknown } {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    return { problem: `output ${rel} is not valid JSON: ${(e as Error).message}` };
  }
  if (schema === undefined) return { value };
  const parsed = schema.safeParse(value);
  return parsed.success ? { value } : { problem: `output ${rel} is invalid: ${formatIssues(parsed.error?.issues ?? [])}` };
}

/** Spec §6.1 item 6: every required output of `phase` exists and validates; empty when the phase may complete. */
export function outputProblems(root: string, runId: string, phase: PhaseId): string[] {
  const problems: string[] = [];
  const dir = runDir(root, runId);
  for (const rel of PHASE_OUTPUTS[phase] ?? []) {
    const file = join(dir, rel);
    if (!existsSync(file)) {
      problems.push(`output ${rel} is missing`);
      continue;
    }
    const checked = checkOutput(file, rel, OUTPUT_SCHEMAS[rel]);
    if ("problem" in checked) problems.push(checked.problem);
  }
  for (const set of PHASE_OUTPUT_SETS[phase] ?? []) {
    const at = join(dir, set.dir);
    const names = existsSync(at) ? readdirSync(at).filter((f) => set.file.test(f)).sort() : [];
    if (names.length < set.min) {
      problems.push(`output ${set.dir}/ needs at least ${set.min} file(s) named like ${set.file.source}`);
      continue;
    }
    for (const name of names) {
      const rel = `${set.dir}/${name}`;
      const checked = checkOutput(join(at, name), rel, set.schema);
      if ("problem" in checked) {
        problems.push(checked.problem);
        continue;
      }
      const id = (checked.value as { id?: unknown }).id;
      if (set.idIsFileName && id !== name.replace(/\.json$/, "")) problems.push(`output ${rel}: id ${String(id)} does not match the file name`);
    }
  }
  return problems;
}
