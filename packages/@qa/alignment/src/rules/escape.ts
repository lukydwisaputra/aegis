import { normalizePath } from "../paths.js";
import { violation, type Model, type Unit, type Violation } from "../types.js";

/** Identity of one escape hatch: `unit:field` or `unit:field:path` (path normalized). */
export function escapeId(unit: string, field: string, value?: string): string {
  return value === undefined ? `${unit}:${field}` : `${unit}:${field}:${normalizePath(value)}`;
}

function detailOf(field: string, value?: string): string {
  return value === undefined ? field : `${field}:${normalizePath(value)}`;
}

/** Every escape hatch the contracts use (spec §3). */
export function contractEscapes(m: Model): Map<string, { unit: Unit; detail: string }> {
  const out = new Map<string, { unit: Unit; detail: string }>();
  const add = (u: Unit, field: string, value?: string) => out.set(escapeId(u.name, field, value), { unit: u, detail: detailOf(field, value) });
  for (const u of m.units.values()) {
    const c = u.contract;
    if (c === null) continue;
    if ("reviewedBy" in c && typeof c.reviewedBy !== "string") add(u, "reviewedBy.none");
    if (c.dispatch !== undefined) add(u, "dispatch.none");
    for (const e of [...c.reads, ...c.writes]) {
      if (typeof e === "string") continue;
      if (e.optional === true) add(u, "optional", e.path);
      if (e.terminal === true) add(u, "terminal", e.path);
      if (e.rmw === true) add(u, "rmw", e.path);
    }
  }
  return out;
}

export function escapeRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const present = contractEscapes(m);
  const listed = new Set<string>();
  for (const e of m.pipeline?.escapes ?? []) {
    const id = escapeId(e.unit, e.field, e.value);
    listed.add(id);
    if (present.has(id)) continue;
    if (m.units.get(e.unit)?.contract === null) continue; // failed to load: its load error already reports it
    const detail = detailOf(e.field, e.value);
    out.push(violation("ESCAPE", e.unit, detail, "stale", ".claude/pipeline.yaml", 1, `pipeline.yaml#escapes lists ${detail} for ${e.unit}, but its contract has no such hatch`));
  }
  for (const [id, { unit, detail }] of present) {
    if (!listed.has(id)) {
      out.push(violation("ESCAPE", unit.name, detail, "unlisted", unit.file, unit.contractLine, `${detail} is an escape hatch that pipeline.yaml#escapes does not list`));
    }
  }
  return out;
}
