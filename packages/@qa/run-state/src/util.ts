import { readFileSync } from "node:fs";
import { RunStateError } from "./errors.js";

export function iso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

export function loadJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    throw new RunStateError("invalid-input", `cannot read ${file}: ${(e as Error).message}`);
  }
}

export function formatIssues(issues: Array<{ path: Array<string | number>; message: string }>): string {
  return issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}
