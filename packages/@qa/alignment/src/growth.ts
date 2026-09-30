import { parse as parseYaml } from "yaml";
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
