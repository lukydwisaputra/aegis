import { stringify } from "yaml";
import { loadModel } from "./load.js";
import { loadBaseline, ratchet, type RatchetResult } from "./ratchet.js";
import type { Baseline } from "./schema.js";
import { cliRule, configRule, envRule, handoffRule, routeRule } from "./rules/config.js";
import { consumerRule, cycleRule, emitterRule, eventRule, namedConsumerRule, producerRule, writePolicyRule } from "./rules/dataflow.js";
import { cliAnchorRule, configAnchorRule, runsAnchorRule, skillKindRule } from "./rules/anchors.js";
import { escapeRule } from "./rules/escape.js";
import { pipelineAnchorRule } from "./rules/pipeline.js";
import { docRefRule, driftRule, skillRule } from "./rules/prose.js";
import { countRule, docNameRule, unusedConfigRule } from "./rules/reverse.js";
import { contractRule, dispatchRule, spvRule, toolRule } from "./rules/structure.js";
import type { Model, Violation } from "./types.js";

export const ALL_RULES: Array<(m: Model) => Violation[]> = [
  contractRule, dispatchRule, spvRule, toolRule, cliRule, handoffRule, routeRule, envRule, configRule, unusedConfigRule,
  producerRule, cycleRule, consumerRule, eventRule, emitterRule, namedConsumerRule, writePolicyRule, skillRule, skillKindRule, driftRule,
  cliAnchorRule, configAnchorRule, runsAnchorRule, pipelineAnchorRule, escapeRule, docRefRule, docNameRule, countRule,
];

export interface AlignmentReport {
  violations: Violation[];
  ratchet: RatchetResult;
  counts: Record<string, number>;
  filter?: string;
  slices?: SliceGroup[];
}

export interface SliceGroup {
  slice: string;
  keys: string[];
}

/** Violations grouped by the owning slice of their first baseline ID (matrix Owner/Slice column). */
export function groupBySlice(violations: Violation[], baseline: Baseline, owner: Map<string, string>): SliceGroup[] {
  const idsOf = new Map<string, string[]>();
  for (const e of baseline.entries) idsOf.set(e.key, [...(idsOf.get(e.key) ?? []), ...e.ids]);
  const groups = new Map<string, string[]>();
  for (const v of violations) {
    const id = idsOf.get(v.key)?.[0];
    const slice = id === undefined ? "(not baselined)" : (owner.get(id) ?? "(unknown owner)");
    groups.set(slice, [...(groups.get(slice) ?? []), v.key]);
  }
  return [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([slice, keys]) => ({ slice, keys }));
}

export function formatBySlice(groups: SliceGroup[]): string {
  return groups.flatMap((g) => [`${g.slice.padEnd(16)} ${g.keys.length}`, ...g.keys.map((k) => `  ${k}`)]).join("\n");
}

const byKey = (a: Violation, b: Violation) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function filterReport(r: AlignmentReport, rule: string): AlignmentReport {
  const violations = r.violations.filter((v) => v.rule === rule);
  const counts: Record<string, number> = {};
  for (const v of violations) counts[v.rule] = (counts[v.rule] ?? 0) + 1;
  const slices = r.slices?.map((g) => ({ slice: g.slice, keys: g.keys.filter((k) => k.startsWith(`${rule}:`)) })).filter((g) => g.keys.length > 0);
  return { ...r, violations, counts, filter: rule, ...(slices !== undefined ? { slices } : {}) };
}

export function checkAlignment(root: string): AlignmentReport {
  const m = loadModel(root);
  const baseline = loadBaseline(root);
  const all = [...m.loadErrors, ...ALL_RULES.flatMap((r) => r(m))];
  const unique = [...new Map(all.map((v) => [v.key, v])).values()].sort(byKey);
  const counts: Record<string, number> = {};
  for (const v of unique) counts[v.rule] = (counts[v.rule] ?? 0) + 1;
  return { violations: unique, ratchet: ratchet(unique, baseline, m.matrixIds, m.matrixStatus), counts, slices: groupBySlice(unique, baseline, m.matrixOwner) };
}

export function formatReport(r: AlignmentReport): string {
  const lines = [`violations: ${r.violations.length}${r.filter !== undefined ? ` (filtered: ${r.filter})` : ""}`];
  for (const [rule, n] of Object.entries(r.counts).sort()) lines.push(`  ${rule.padEnd(13)} ${n}`);
  lines.push(`ratchet: ${r.ratchet.ok ? "ok" : "FAILED"}`);
  for (const v of r.ratchet.unexpected) lines.push(`  + add or fix  ${v.key}  (${v.file}:${v.line}) ${v.message}`);
  for (const s of r.ratchet.stale) lines.push(`  - delete      ${s.key}  (fixed; ids ${s.ids.join(",")})`);
  for (const u of r.ratchet.unknownIds) lines.push(`  ? unknown id  ${u.id} on ${u.key}`);
  for (const c of r.ratchet.closedIds) lines.push(`  x closed-id   ${c.id} (${c.status}) on ${c.key}`);
  for (const d of r.ratchet.duplicates) lines.push(`  ! duplicate   ${d}`);
  return lines.join("\n");
}

export function baselineDraft(r: AlignmentReport): string {
  return stringify({ baseline: 1, entries: r.violations.map((v) => ({ key: v.key, ids: ["TODO-ASSIGN"], note: v.message })) });
}
