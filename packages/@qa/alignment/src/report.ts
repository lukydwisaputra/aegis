import { stringify } from "yaml";
import { loadModel } from "./load.js";
import { loadBaseline, ratchet, type RatchetResult } from "./ratchet.js";
import { cliRule, configRule, envRule, routeRule } from "./rules/config.js";
import { consumerRule, eventRule, producerRule, writePolicyRule } from "./rules/dataflow.js";
import { docRefRule, driftRule, skillRule } from "./rules/prose.js";
import { contractRule, dispatchRule, spvRule } from "./rules/structure.js";
import type { Model, Violation } from "./types.js";

export const ALL_RULES: Array<(m: Model) => Violation[]> = [
  contractRule, dispatchRule, spvRule, cliRule, routeRule, envRule, configRule,
  producerRule, consumerRule, eventRule, writePolicyRule, skillRule, driftRule, docRefRule,
];

export interface AlignmentReport {
  violations: Violation[];
  ratchet: RatchetResult;
  counts: Record<string, number>;
  filter?: string;
}

const byKey = (a: Violation, b: Violation) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function filterReport(r: AlignmentReport, rule: string): AlignmentReport {
  const violations = r.violations.filter((v) => v.rule === rule);
  const counts: Record<string, number> = {};
  for (const v of violations) counts[v.rule] = (counts[v.rule] ?? 0) + 1;
  return { ...r, violations, counts, filter: rule };
}

export function checkAlignment(root: string): AlignmentReport {
  const m = loadModel(root);
  const all = [...m.loadErrors, ...ALL_RULES.flatMap((r) => r(m))];
  const unique = [...new Map(all.map((v) => [v.key, v])).values()].sort(byKey);
  const counts: Record<string, number> = {};
  for (const v of unique) counts[v.rule] = (counts[v.rule] ?? 0) + 1;
  return { violations: unique, ratchet: ratchet(unique, loadBaseline(root), m.matrixIds), counts };
}

export function formatReport(r: AlignmentReport): string {
  const lines = [`violations: ${r.violations.length}${r.filter !== undefined ? ` (filtered: ${r.filter})` : ""}`];
  for (const [rule, n] of Object.entries(r.counts).sort()) lines.push(`  ${rule.padEnd(13)} ${n}`);
  lines.push(`ratchet: ${r.ratchet.ok ? "ok" : "FAILED"}`);
  for (const v of r.ratchet.unexpected) lines.push(`  + add or fix  ${v.key}  (${v.file}:${v.line}) ${v.message}`);
  for (const s of r.ratchet.stale) lines.push(`  - delete      ${s.key}  (fixed; ids ${s.ids.join(",")})`);
  for (const u of r.ratchet.unknownIds) lines.push(`  ? unknown id  ${u.id} on ${u.key}`);
  for (const d of r.ratchet.duplicates) lines.push(`  ! duplicate   ${d}`);
  return lines.join("\n");
}

export function baselineDraft(r: AlignmentReport): string {
  return stringify({ baseline: 1, entries: r.violations.map((v) => ({ key: v.key, ids: ["TODO-ASSIGN"], note: v.message })) });
}
