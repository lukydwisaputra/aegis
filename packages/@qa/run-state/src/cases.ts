import { existsSync } from "node:fs";
import { join } from "node:path";
import { TestCaseIdSchema } from "@qa/contracts";
import { RunStateError } from "./errors.js";
import { runDir } from "./paths.js";

/**
 * Test case ids given to a run command (aegis run reissue --cases, aegis run descope --case): trimmed, empties and duplicates
 * dropped, order kept. Each must have the TC-<MODULE>-<NNN> format and, once the run has a cases/ folder, its design file
 * cases/<id>.json there. Reads only; refuses with invalid-input.
 */
export function parseCaseIds(root: string, runId: string, ids: readonly string[]): string[] {
  const out = [...new Set(ids.map((id) => id.trim()).filter((id) => id !== ""))];
  if (out.length === 0) throw new RunStateError("invalid-input", "at least one test case id is required");
  const bad = out.filter((id) => !TestCaseIdSchema.safeParse(id).success);
  if (bad.length > 0) throw new RunStateError("invalid-input", `not a test case id (TC-<MODULE>-<NNN>): ${bad.join(", ")}`);
  const casesDir = join(runDir(root, runId), "cases");
  if (existsSync(casesDir)) {
    const unknown = out.filter((id) => !existsSync(join(casesDir, `${id}.json`)));
    if (unknown.length > 0) throw new RunStateError("invalid-input", `no design file cases/<id>.json in run ${runId} for: ${unknown.join(", ")}`);
  }
  return out;
}
