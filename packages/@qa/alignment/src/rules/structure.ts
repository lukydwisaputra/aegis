import { pairedSpv } from "@qa/run-state";
import { isAgentContract, SPECIAL_PHASES, violation, type Model, type Unit, type Violation } from "../types.js";
import type { AgentContract } from "../schema.js";

type AgentUnit = Unit & { contract: AgentContract };

function agents(m: Model): AgentUnit[] {
  return [...m.units.values()].filter(isAgentContract) as AgentUnit[];
}

function reviewer(c: AgentContract): string | null {
  return typeof c.reviewedBy === "string" ? c.reviewedBy : null;
}

function known(m: Model, name: string): boolean {
  return m.units.has(name) || m.skillAliases.has(name);
}

export function contractRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const phaseOf = new Map<string, string>();
  for (const p of m.pipeline?.phases ?? []) for (const a of p.agents) phaseOf.set(a, p.id);
  const phaseIds = new Set((m.pipeline?.phases ?? []).map((p) => p.id));
  for (const u of m.units.values()) {
    if (u.contract === null) continue;
    const c = u.contract;
    const names = [...c.dispatchedBy, ...c.dispatches, ...("reviews" in c ? c.reviews : [])];
    if ("reviewedBy" in c && typeof c.reviewedBy === "string") names.push(c.reviewedBy);
    for (const n of new Set(names)) {
      if (!known(m, n)) out.push(violation("CONTRACT", u.name, n, "unknown-unit", u.file, u.contractLine, `${n} is not an agent or skill`));
    }
  }
  for (const u of agents(m)) {
    const phase = u.contract.phase;
    if (!phaseIds.has(phase) && !SPECIAL_PHASES.has(phase)) {
      out.push(violation("CONTRACT", u.name, phase, "unknown-phase", u.file, u.contractLine, `phase ${phase} is not in pipeline.yaml`));
    }
    const listed = phaseOf.get(u.name);
    if (listed !== undefined && listed !== phase) {
      out.push(violation("CONTRACT", u.name, phase, "phase-mismatch", u.file, u.contractLine, `pipeline lists ${u.name} in ${listed}`));
    }
  }
  return out;
}

export function dispatchRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const inPipeline = new Set((m.pipeline?.phases ?? []).flatMap((p) => p.agents));
  const dispatchersOf = new Map<string, string[]>();
  for (const u of m.units.values()) {
    for (const d of u.contract?.dispatches ?? []) dispatchersOf.set(d, [...(dispatchersOf.get(d) ?? []), u.name]);
  }
  for (const a of agents(m)) {
    const c = a.contract;
    const by = dispatchersOf.get(a.name) ?? [];
    if (!inPipeline.has(a.name) && by.length === 0 && c.dispatch === undefined) {
      out.push(violation("DISPATCH", a.name, "-", "undispatched", a.file, a.contractLine, "nothing dispatches this agent"));
    }
    for (const d of c.dispatchedBy) {
      const du = m.units.get(d);
      if (du?.contract && !du.contract.dispatches.includes(a.name)) {
        out.push(violation("DISPATCH", a.name, d, "not-reciprocal", a.file, a.contractLine, `${d} does not list ${a.name} in dispatches`));
      }
    }
    for (const d of by) {
      if (!c.dispatchedBy.includes(d)) {
        out.push(violation("DISPATCH", a.name, d, "undeclared-dispatcher", a.file, a.contractLine, `${d} dispatches ${a.name} but dispatchedBy omits it`));
      }
    }
  }
  return out;
}

export function spvRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const all = agents(m);
  const byName = new Map(all.map((a) => [a.name, a]));
  for (const [w, s] of Object.entries(m.pipeline?.spvPairs ?? {})) {
    if (pairedSpv(w) !== s) out.push(violation("SPV", "pipeline", w, "pair-mismatch", ".claude/pipeline.yaml", 1, `pipeline pairs ${w} with ${s}, runtime with ${pairedSpv(w)}`));
  }
  const reviewedTargets = new Set<string>();
  for (const w of all) {
    if (w.contract.phase === "spv") continue;
    const r = reviewer(w.contract);
    if (r === null) continue;
    reviewedTargets.add(r);
    const expected = m.pipeline?.spvPairs[w.name] ?? pairedSpv(w.name);
    if (r !== expected) out.push(violation("SPV", w.name, expected, "not-paired", w.file, w.contractLine, `reviewedBy ${r}, expected ${expected}`));
    const spv = byName.get(expected);
    if (spv === undefined) {
      if (!m.units.has(expected)) out.push(violation("SPV", w.name, expected, "missing-spv", w.file, w.contractLine, `${expected} does not exist`));
      continue;
    }
    if (!spv.contract.dispatchedBy.some((d) => w.contract.dispatchedBy.includes(d))) {
      out.push(violation("SPV", w.name, expected, "not-dispatched-together", w.file, w.contractLine, `${expected} is not dispatched by ${w.name}'s dispatcher`));
    }
  }
  for (const s of all.filter((a) => a.contract.phase === "spv")) {
    const claimed = new Set(all.filter((w) => reviewer(w.contract) === s.name).map((w) => w.name));
    for (const w of new Set([...s.contract.reviews, ...claimed])) {
      if (!(s.contract.reviews.includes(w) && claimed.has(w))) {
        out.push(violation("SPV", s.name, w, "not-reciprocal", s.file, s.contractLine, `${s.name}.reviews and ${w}.reviewedBy disagree`));
      }
    }
    if (!reviewedTargets.has(s.name)) out.push(violation("SPV", s.name, "-", "orphan-spv", s.file, s.contractLine, "no worker names this SPV"));
  }
  return out;
}
