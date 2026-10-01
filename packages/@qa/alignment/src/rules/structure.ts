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

// Names resolve exactly (spec §7 AH-17): no `x` → `_x` fallback and no frontmatter-name aliases.
function unitFor(m: Model, name: string): Unit | undefined {
  return m.units.get(name);
}

function known(m: Model, name: string): boolean {
  return m.units.has(name);
}

// A unit that exists but failed to load: its state is unknown, the load error already reports it.
function unloaded(m: Model, name: string): boolean {
  const u = unitFor(m, name);
  return u !== undefined && u.contract === null;
}

export function contractRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const phasesOf = new Map<string, string[]>();
  for (const p of m.pipeline?.phases ?? []) {
    for (const a of p.agents) {
      const list = phasesOf.get(a) ?? [];
      if (!list.includes(p.id)) list.push(p.id);
      phasesOf.set(a, list);
    }
  }
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
    // An agent dispatched in several phases (qa-environment-engineer: env-auth, env-data) is listed under each;
    // its contract names the last of them (HANDBOOK 14.11).
    const listed = phasesOf.get(u.name) ?? [];
    if (listed.length > 0 && !listed.includes(phase)) {
      for (const lp of listed) {
        out.push(violation("CONTRACT", u.name, lp, "phase-mismatch", u.file, u.contractLine, `pipeline lists ${u.name} in ${lp}, contract says ${phase}`));
      }
    }
    if (listed.length > 1 && listed[listed.length - 1] !== phase) {
      out.push(violation("CONTRACT", u.name, "-", "multi-phase", u.file, u.contractLine, `pipeline lists ${u.name} in several phases: ${listed.join(", ")}; the contract phase must be the last of them`));
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
    const declared = new Set(c.dispatchedBy);
    const by = dispatchersOf.get(a.name) ?? [];
    if (!inPipeline.has(a.name) && by.length === 0 && c.dispatch === undefined && !c.dispatchedBy.some((d) => unloaded(m, d))) {
      out.push(violation("DISPATCH", a.name, "-", "undispatched", a.file, a.contractLine, "nothing dispatches this agent"));
    }
    for (const d of declared) {
      const du = unitFor(m, d);
      if (du?.contract && !du.contract.dispatches.includes(a.name)) {
        out.push(violation("DISPATCH", a.name, d, "not-reciprocal", a.file, a.contractLine, `${d} does not list ${a.name} in dispatches`));
      }
    }
    for (const d of new Set(by)) {
      if (!declared.has(d)) {
        out.push(violation("DISPATCH", a.name, d, "undeclared-dispatcher", a.file, a.contractLine, `${d} dispatches ${a.name} but dispatchedBy omits it`));
      }
    }
  }
  return out;
}

export function spvRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const all = agents(m);
  const expectedFor = (w: string): string => m.pipeline?.spvPairs[w] ?? pairedSpv(w);
  for (const [w, s] of Object.entries(m.pipeline?.spvPairs ?? {})) {
    if (pairedSpv(w) !== s) out.push(violation("SPV", "pipeline", w, "pair-mismatch", ".claude/pipeline.yaml", 1, `pipeline pairs ${w} with ${s}, runtime with ${pairedSpv(w)}`));
  }
  const reviewedTargets = new Set<string>();
  for (const w of all) {
    if (w.contract.phase === "spv") continue;
    const r = reviewer(w.contract);
    if (r === null) continue;
    reviewedTargets.add(r);
    const expected = expectedFor(w.name);
    if (r !== expected) out.push(violation("SPV", w.name, expected, "not-paired", w.file, w.contractLine, `reviewedBy ${r}, expected ${expected}`));
    const spv = unitFor(m, expected);
    if (spv === undefined) {
      out.push(violation("SPV", w.name, expected, "missing-spv", w.file, w.contractLine, `${expected} does not exist`));
      continue;
    }
    if (!isAgentContract(spv)) continue;
    const wBy = new Set(w.contract.dispatchedBy);
    if (!spv.contract.dispatchedBy.some((d) => wBy.has(d))) {
      out.push(violation("SPV", w.name, expected, "not-dispatched-together", w.file, w.contractLine, `${expected} is not dispatched by ${w.name}'s dispatcher`));
    }
  }
  for (const s of all.filter((a) => a.contract.phase === "spv")) {
    const claimed = new Set(all.filter((w) => reviewer(w.contract) === s.name).map((w) => w.name));
    const reviews = new Set(s.contract.reviews);
    for (const w of new Set([...reviews, ...claimed])) {
      if (unloaded(m, w)) continue;
      if (!(reviews.has(w) && claimed.has(w))) {
        out.push(violation("SPV", s.name, w, "not-reciprocal", s.file, s.contractLine, `${s.name}.reviews and ${w}.reviewedBy disagree`));
      }
    }
    const maybeReviewed = [...m.units.values()].some((u) => u.kind === "agent" && u.contract === null && (reviews.has(u.name) || expectedFor(u.name) === s.name));
    if (!reviewedTargets.has(s.name) && !maybeReviewed) out.push(violation("SPV", s.name, "-", "orphan-spv", s.file, s.contractLine, "no worker names this SPV"));
  }
  return out;
}

/** Spec §6 AH-05: dispatching agents needs Agent, dispatching skills needs Skill, writing needs Write or Edit. Skills have no tools frontmatter. */
export function toolRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of agents(m)) {
    const c = u.contract;
    const has = (t: string) => u.tools.includes(t);
    const agentTargets = c.dispatches.filter((d) => m.units.get(d)?.kind === "agent");
    const skillTargets = c.dispatches.filter((d) => m.units.get(d)?.kind === "skill");
    if (agentTargets.length > 0 && !has("Agent")) out.push(violation("CONTRACT", u.name, "Agent", "missing-tool", u.file, u.contractLine, `dispatches ${agentTargets.join(", ")} but frontmatter tools lack Agent`));
    if (skillTargets.length > 0 && !has("Skill")) out.push(violation("CONTRACT", u.name, "Skill", "missing-tool", u.file, u.contractLine, `dispatches ${skillTargets.join(", ")} but frontmatter tools lack Skill`));
    if (c.writes.length > 0 && !has("Write") && !has("Edit")) out.push(violation("CONTRACT", u.name, "Write", "missing-tool", u.file, u.contractLine, "writes files but frontmatter tools lack Write and Edit"));
  }
  return out;
}
