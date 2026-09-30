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
  closedIds: Array<{ key: string; id: string; status: string }>;
  duplicates: string[];
}

export class BaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaselineError";
  }
}

export function loadBaseline(root: string): Baseline {
  const file = join(root, BASELINE_PATH);
  if (!existsSync(file)) return { baseline: 1, entries: [] };
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, "utf-8"));
  } catch (e) {
    throw new BaselineError(`${BASELINE_PATH}: ${(e as Error).message.split("\n")[0]}`);
  }
  const parsed = BaselineSchema.safeParse(raw ?? { baseline: 1, entries: [] });
  if (!parsed.success) {
    const issues = parsed.error.issues;
    const shown = issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    const more = issues.length > 5 ? ` (+${issues.length - 5} more)` : "";
    throw new BaselineError(`${BASELINE_PATH}: ${shown}${more}`);
  }
  return parsed.data;
}

/** A matrix Status that closes an item: an entry it owns can no longer excuse a violation. */
export function isClosedStatus(status: string): boolean {
  return /^(fixed|wontfix)/i.test(status.trim());
}

export function ratchet(violations: Violation[], baseline: Baseline, matrixIds: Set<string>, matrixStatus: Map<string, string> = new Map()): RatchetResult {
  const current = new Set(violations.map((v) => v.key));
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const e of baseline.entries) {
    if (seen.has(e.key)) duplicates.push(e.key);
    seen.add(e.key);
  }
  const unexpected = violations.filter((v) => !seen.has(v.key));
  const stale = baseline.entries
    .filter((e, i) => !current.has(e.key) && baseline.entries.findIndex((x) => x.key === e.key) === i)
    .map((e) => ({ key: e.key, ids: [...new Set(baseline.entries.filter((x) => x.key === e.key).flatMap((x) => x.ids))] }));
  const unknownIds = baseline.entries.flatMap((e) => e.ids.filter((id) => !matrixIds.has(id)).map((id) => ({ key: e.key, id })));
  const closedIds = baseline.entries.flatMap((e) =>
    e.ids.flatMap((id) => {
      const status = matrixStatus.get(id);
      return matrixIds.has(id) && status !== undefined && isClosedStatus(status) ? [{ key: e.key, id, status }] : [];
    }),
  );
  const ok = unexpected.length === 0 && stale.length === 0 && unknownIds.length === 0 && closedIds.length === 0 && duplicates.length === 0;
  return { ok, unexpected, stale, unknownIds, closedIds, duplicates };
}
