import { parse as parseYaml } from "yaml";
import { escapeId } from "./rules/escape.js";
import { BaselineSchema, type Baseline } from "./schema.js";

export function parseBaseline(yaml: string, label: string): Baseline {
  const parsed = BaselineSchema.safeParse(parseYaml(yaml) ?? { baseline: 1, entries: [] });
  if (!parsed.success) {
    const shown = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`${label} baseline: ${shown}`);
  }
  return parsed.data;
}

/**
 * Baseline keys present in head and absent in base, sorted.
 * `baseYaml === null` (file absent on base) means the guard is not applicable: returns [].
 * Invalid YAML or schema throws.
 */
export function baselineGrowth(baseYaml: string | null, headYaml: string): string[] {
  const head = parseBaseline(headYaml, "head");
  if (baseYaml === null) return [];
  const base = new Set(parseBaseline(baseYaml, "base").entries.map((e) => e.key));
  return [...new Set(head.entries.map((e) => e.key).filter((k) => !base.has(k)))].sort();
}

function escapeIds(yaml: string, label: string): Set<string> {
  let doc: unknown;
  try {
    doc = parseYaml(yaml);
  } catch (e) {
    throw new Error(`${label} pipeline: ${(e as Error).message.split("\n")[0]}`);
  }
  const list = (doc as { escapes?: unknown } | null)?.escapes;
  if (list === undefined || list === null) return new Set();
  if (!Array.isArray(list)) throw new Error(`${label} pipeline: escapes must be a list`);
  return new Set(
    list.map((e: unknown) => {
      const { unit, field, value } = (e ?? {}) as { unit?: unknown; field?: unknown; value?: unknown };
      if (typeof unit !== "string" || typeof field !== "string") throw new Error(`${label} pipeline: every escapes entry needs unit and field`);
      return escapeId(unit, field, typeof value === "string" ? value : undefined);
    }),
  );
}

/**
 * `pipeline.yaml#escapes` entries present in head and absent in base, sorted (spec §2: they count as
 * baseline growth). `basePipeline === null` (file absent on base): not applicable, returns [].
 */
export function escapesGrowth(basePipeline: string | null, headPipeline: string): string[] {
  const head = escapeIds(headPipeline, "head");
  if (basePipeline === null) return [];
  const base = escapeIds(basePipeline, "base");
  return [...head].filter((id) => !base.has(id)).sort();
}
