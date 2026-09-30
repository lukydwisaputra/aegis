import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { BaselineSchema, type Baseline } from "./schema.js";
import type { Violation } from "./types.js";

export const BASELINE_PATH = "__internal-tests__/alignment/baseline.yaml";

export interface RatchetResult {
  ok: boolean;
  unexpected: Violation[];
  stale: Array<{ key: string; ids: string[] }>;
  unknownIds: Array<{ key: string; id: string }>;
  duplicates: string[];
}

export function loadBaseline(root: string): Baseline {
  const file = join(root, BASELINE_PATH);
  if (!existsSync(file)) return { baseline: 1, entries: [] };
  const parsed = BaselineSchema.safeParse(parseYaml(readFileSync(file, "utf-8")) ?? { baseline: 1, entries: [] });
  if (!parsed.success) throw new Error(`baseline invalid: ${parsed.error.message}`);
  return parsed.data;
}

export function ratchet(violations: Violation[], baseline: Baseline, matrixIds: Set<string>): RatchetResult {
  const current = new Set(violations.map((v) => v.key));
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const e of baseline.entries) {
    if (seen.has(e.key)) duplicates.push(e.key);
    seen.add(e.key);
  }
  const unexpected = violations.filter((v) => !seen.has(v.key));
  const stale = baseline.entries.filter((e, i) => !current.has(e.key) && baseline.entries.findIndex((x) => x.key === e.key) === i).map((e) => ({ key: e.key, ids: e.ids }));
  const unknownIds = baseline.entries.flatMap((e) => e.ids.filter((id) => !matrixIds.has(id)).map((id) => ({ key: e.key, id })));
  return { ok: unexpected.length === 0 && stale.length === 0 && unknownIds.length === 0 && duplicates.length === 0, unexpected, stale, unknownIds, duplicates };
}
