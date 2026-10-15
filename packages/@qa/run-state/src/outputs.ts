import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { PhaseId } from "@qa/contracts";
import { runDir } from "./paths.js";
import { readRunConfig } from "./config.js";
import { CLOSURE_OUTPUT, OUTPUT_SCHEMAS, PHASE_OUTPUT_SETS, PHASE_OUTPUTS, type OutputSchema } from "./phase-map.js";
import { formatIssues } from "./util.js";

/** Read and validate one output file: its parsed value, or the problem to report. */
function checkOutput(root: string, file: string, rel: string, schema: OutputSchema | undefined, phase?: PhaseId): { problem: string } | { value: unknown } {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    return { problem: `output ${rel} is not valid JSON: ${(e as Error).message}` };
  }
  if (schema === undefined) return { value };
  const parsed = schema.safeParse(value);
  if (parsed.success) return { value };
  const issues = rel === CLOSURE_OUTPUT ? withoutDisabledRules(root, parsed.error?.issues ?? []) : (parsed.error?.issues ?? []);
  if (issues.length === 0) return { value };
  const closure = rel === CLOSURE_OUTPUT;
  // Closure-final keeps the metrics as drafted (the reporter's instructions), so adding a null key is not a remedy there.
  const shaped = closure && phase === "closure-final" ? issues.map((i) => ({ ...i, message: i.message.replace(ADD_KEY_REMEDY, "name each in unavailableMetricValues (the metrics stay as drafted at Closure-final)") })) : issues;
  const exception = closure ? "; reportRules.disable with closure-schema is the owner's recorded exception for a closure that predates this check" : "";
  return { problem: `output ${rel} is invalid: ${formatIssues(shaped)}${exception}` };
}

/** The remedy text of the closure-metrics-missing issue that Closure-final cannot take (see CLOSURE_METRICS_MISSING in contracts). */
const ADD_KEY_REMEDY = "state each (null when it cannot be computed) or name it in unavailableMetricValues";

/**
 * The closure file's issues the owner has not turned off: reportRules.disable with closure-schema lifts the whole check (a run in
 * flight whose closure predates it), or with a rule id (closure-metrics-missing, closure-forbidden-key) lifts that rule. An issue
 * message begins with its rule id. The config is read only when the file already failed, so a valid closure never reads it.
 */
function withoutDisabledRules<T extends { message: string }>(root: string, issues: T[]): T[] {
  let disabled: Set<string>;
  try {
    disabled = new Set(readRunConfig(root).reportRules.disable);
  } catch {
    return issues; // an unreadable config lifts nothing; the closure refusal stands
  }
  if (disabled.has("closure-schema")) return [];
  return issues.filter((i) => ![...disabled].some((id) => i.message.startsWith(`${id}:`)));
}

/** True for a symlink, even a dangling one (existsSync follows links). */
function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** A ran mutation summary may not lower the configured bar: its threshold is at least thresholds.yaml#devTestReview.mutationScoreMin. */
function mutationFloorProblem(root: string, review: unknown): string | null {
  const mutation = (review as { mutation?: { status?: unknown; threshold?: unknown } }).mutation;
  if (mutation?.status !== "ran" || typeof mutation.threshold !== "number") return null;
  let min: unknown;
  try {
    min = (parseYaml(readFileSync(join(root, "thresholds.yaml"), "utf-8")) as { devTestReview?: { mutationScoreMin?: unknown } } | null)?.devTestReview?.mutationScoreMin;
  } catch {
    min = undefined;
  }
  if (typeof min !== "number") return "output dev-test-review.json: thresholds.yaml#devTestReview.mutationScoreMin is not a number, so the mutation threshold cannot be checked";
  return mutation.threshold < min ? `output dev-test-review.json: mutation.threshold ${mutation.threshold} is below thresholds.yaml#devTestReview.mutationScoreMin (${min})` : null;
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
    const checked = checkOutput(root, file, rel, OUTPUT_SCHEMAS[rel], phase);
    if ("problem" in checked) problems.push(checked.problem);
    else if (rel === "dev-test-review.json") {
      const floor = mutationFloorProblem(root, checked.value);
      if (floor !== null) problems.push(floor);
    }
  }
  for (const set of PHASE_OUTPUT_SETS[phase] ?? []) {
    const at = join(dir, set.dir);
    const names: string[] = [];
    if (existsSync(at) || isLink(at)) {
      if (!lstatSync(at).isDirectory()) {
        problems.push(`output ${set.dir}/ is not a plain directory`);
        continue;
      }
      for (const name of readdirSync(at).sort()) {
        if (name.startsWith(".")) continue;
        if (!set.file.test(name)) problems.push(`output ${set.dir}/${name}: not a valid ${set.dir} file name`);
        else if (!lstatSync(join(at, name)).isFile()) problems.push(`output ${set.dir}/${name}: not a regular file`);
        else names.push(name);
      }
    }
    if (names.length < set.min) {
      problems.push(`output ${set.dir}/ needs at least ${set.min} file(s) named like ${set.file.source}`);
      continue;
    }
    for (const name of names) {
      const rel = `${set.dir}/${name}`;
      const checked = checkOutput(root, join(at, name), rel, set.schema);
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
