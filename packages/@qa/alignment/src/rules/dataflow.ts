import { join } from "node:path";
import { existsWithContent } from "../load.js";
import { isCliRecordedEventType } from "@qa/run-state";
import { CLI_RECORDS, commandRecords } from "../cli-records.js";
import { proseLines } from "../markdown.js";
import { isTooBroad, matches, normalizePath, overlaps } from "../paths.js";
import type { AgentContract, PathEntry } from "../schema.js";
import { isAgentContract, isSkillContract, pathOf, SPECIAL_PHASES, violation, type Model, type Unit, type Violation } from "../types.js";

function phaseIndex(m: Model): Map<string, number> {
  const idx = new Map<string, number>();
  (m.pipeline?.phases ?? []).forEach((p, i) => idx.set(p.id, i));
  return idx;
}

function unitPhase(m: Model, u: Unit, idx: Map<string, number>, eff: Map<string, string> = new Map()): number | undefined {
  if (u.contract === null || !("phase" in u.contract)) return undefined;
  return idx.get(eff.get(u.name) ?? u.contract.phase);
}

export function allSources(m: Model): string[] {
  const s = m.pipeline?.sources;
  return s ? [...s.cli, ...s.owner, ...s.target, ...s.repo] : [];
}

/** Units reachable from a pipeline phase or an execution skill through `dispatches` (spec §6 AH-06). */
export function reachableUnits(m: Model): Set<string> {
  const seen = new Set<string>();
  const queue = [
    ...(m.pipeline?.phases ?? []).flatMap((p) => p.agents),
    ...[...m.units.values()].filter((u) => isSkillContract(u) && u.contract.kind === "execution").map((u) => u.name),
  ];
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (seen.has(n)) continue;
    seen.add(n);
    queue.push(...(m.units.get(n)?.contract?.dispatches ?? []));
  }
  return seen;
}

const DURING = /\bduring (?:the )?([a-z]+)(?: phase)?\b/gi;

function expandBraces(token: string): string[] {
  const b = /^(.*)\{([^}]+)\}(.*)$/.exec(token);
  return b === null ? [token] : b[2]!.split(",").map((alt) => `${b[1]}${alt.trim()}${b[3]}`);
}

/**
 * Spec §6 AH-08: an agent with a special phase that qa-orchestrator dispatches "during <Phase>" belongs
 * to that pipeline phase for PRODUCER ordering. `lines` are the orchestrator prose lines used.
 */
export function effectivePhases(m: Model): { phaseOf: Map<string, string>; lines: number[] } {
  const phaseOf = new Map<string, string>();
  const lines: number[] = [];
  const orch = m.units.get("qa-orchestrator");
  if (orch === undefined || orch.contract === null) return { phaseOf, lines };
  const ids = new Set((m.pipeline?.phases ?? []).map((p) => p.id));
  const dispatched = new Set(orch.contract.dispatches);
  for (const { text, line } of proseLines(orch.source)) {
    for (const d of text.matchAll(DURING)) {
    const phase = d[1]!.toLowerCase();
    if (!ids.has(phase)) continue;
    let used = false;
    for (const t of text.matchAll(/qa-[a-z0-9-]*\{[^}]+\}[a-z0-9-]*|qa-[a-z0-9-]+/g)) {
      for (const n of expandBraces(t[0])) {
        const u = m.units.get(n);
        if (!dispatched.has(n) || u === undefined || u.contract === null || !("phase" in u.contract) || !SPECIAL_PHASES.has(u.contract.phase)) continue;
        phaseOf.set(n, phase);
        used = true;
      }
    }
    if (used && !lines.includes(line)) lines.push(line);
    }
  }
  return { phaseOf, lines };
}

function reviewedBy(m: Model, spv: string): Array<Unit & { contract: AgentContract }> {
  return [...m.units.values()].filter(isAgentContract).filter((w) => w.contract.reviewedBy === spv);
}

/** Non-repo sources (CLI, owner, target): pattern membership is enough. */
function patternSources(m: Model): string[] {
  const s = m.pipeline?.sources;
  return s ? [...s.cli, ...s.owner, ...s.target] : [];
}

const hasPlaceholder = (p: string) => /[{*]/.test(p.startsWith("{aegis}/") ? p.slice("{aegis}/".length) : p);

/**
 * A concrete (placeholder-free) read that only a `sources.repo` glob satisfies must exist on disk;
 * glob membership alone would hide a missing file. Returns true when the read is repo-only and missing.
 */
export function missingRepoSource(m: Model, p: string): boolean {
  const repo = m.pipeline?.sources.repo ?? [];
  if (hasPlaceholder(p) || !repo.some((s) => overlaps(s, p)) || patternSources(m).some((s) => overlaps(s, p))) return false;
  return !existsWithContent(join(m.root, p.startsWith("{aegis}/") ? p.slice("{aegis}/".length) : p));
}

const optional = (e: PathEntry) => typeof e !== "string" && e.optional === true;
const terminal = (e: PathEntry) => typeof e !== "string" && e.terminal === true;
const rmw = (e: PathEntry) => typeof e !== "string" && e.rmw === true;

export function producerRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const idx = phaseIndex(m);
  const { phaseOf } = effectivePhases(m);
  const reachable = reachableUnits(m);
  const sources = allSources(m);
  const hasTarget = (m.pipeline?.sources.target.length ?? 0) > 0;
  const writers = [...m.units.values()].flatMap((u) => (u.contract?.writes ?? []).map((w) => ({ u, path: pathOf(w) })));
  for (const u of [...m.units.values()].filter((x) => x.kind === "agent")) {
    for (const p of new Set(writers.filter((w) => w.u === u && isTooBroad(w.path)).map((w) => normalizePath(w.path)))) {
      out.push(violation("PRODUCER", u.name, p, "too-broad", u.file, u.contractLine, `${p} is too broad to index as a producer`));
    }
  }
  const indexed = writers.filter((w) => !isTooBroad(w.path));
  for (const r of [...m.units.values()].filter(isAgentContract)) {
    const rp = unitPhase(m, r, idx, phaseOf);
    for (const e of r.contract.reads) {
      if (optional(e)) continue;
      if (isTooBroad(pathOf(e))) continue;
      const p = normalizePath(pathOf(e));
      // AH-10: an SPV's work-report read is produced by `aegis work-report submit` of a worker it reviews.
      if (r.contract.phase === "spv" && overlaps("{run}/reports/work/**", p)) {
        const submitters = reviewedBy(m, r.name).filter((w) => w.contract.cli.includes("work-report.submit") && overlaps(`{run}/reports/work/${w.name}.json`, p));
        if (submitters.length === 0) out.push(violation("PRODUCER", r.name, p, "no-submitter", r.file, r.contractLine, `${p} is a work report, but no worker ${r.name} reviews lists work-report.submit`));
        continue;
      }
      const prods = indexed.filter((w) => (w.u.name !== r.name || rmw(e)) && overlaps(w.path, p));
      if (prods.length === 0 && missingRepoSource(m, p)) {
        out.push(violation("PRODUCER", r.name, p, "missing-source", r.file, r.contractLine, `${p} is a repo source but does not exist`));
        continue;
      }
      if (sources.some((s) => overlaps(s, p))) continue;
      if (hasTarget && matches("{tests}/**", p) && !overlaps("{tests}/qa/**", p)) continue;
      if (prods.length === 0) {
        out.push(violation("PRODUCER", r.name, p, "none", r.file, r.contractLine, `nothing produces ${p}`));
        continue;
      }
      const live = prods.filter((w) => reachable.has(w.u.name));
      if (live.length === 0) {
        const names = [...new Set(prods.map((w) => w.u.name))].join(", ");
        out.push(violation("PRODUCER", r.name, p, "unreachable-producer", r.file, r.contractLine, `${p} is produced only by ${names}, which nothing reachable dispatches`));
        continue;
      }
      if (rp === undefined) continue;
      const earlyOrUnbound = live.some((w) => {
        const wp = unitPhase(m, w.u, idx, phaseOf);
        return wp === undefined || wp <= rp;
      });
      if (!earlyOrUnbound) out.push(violation("PRODUCER", r.name, p, "later-phase", r.file, r.contractLine, `${p} is only produced in a later phase`));
    }
  }
  // Skills: same rule for concrete repo-source reads (their other reads are checked by the SKILL rule).
  const agentWrites = indexed.filter((w) => w.u.kind === "agent");
  for (const u of [...m.units.values()].filter((x) => x.kind === "skill" && x.contract !== null)) {
    const own = (u.contract?.writes ?? []).map(pathOf);
    for (const e of u.contract?.reads ?? []) {
      if (optional(e)) continue;
      const p = normalizePath(pathOf(e));
      if (agentWrites.some((w) => overlaps(w.path, p)) || own.some((w) => overlaps(w, p))) continue;
      if (missingRepoSource(m, p)) out.push(violation("PRODUCER", u.name, p, "missing-source", u.file, u.contractLine, `${p} is a repo source but does not exist`));
    }
  }
  return out;
}

/** Spec §6 AH-08: two units in the same pipeline phase that read each other's writes (CLI-owned files excluded). */
export function cycleRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const idx = phaseIndex(m);
  const { phaseOf, lines } = effectivePhases(m);
  const cli = m.pipeline?.sources.cli ?? [];
  const handoff = (p: string) => !isTooBroad(p) && !cli.some((s) => overlaps(s, p));
  const phased = [...m.units.values()]
    .filter(isAgentContract)
    .map((u) => ({ u, phase: unitPhase(m, u, idx, phaseOf), reads: u.contract.reads.map(pathOf).filter(handoff), writes: u.contract.writes.map(pathOf).filter(handoff) }))
    .filter((x) => x.phase !== undefined)
    .sort((a, b) => (a.u.name < b.u.name ? -1 : a.u.name > b.u.name ? 1 : 0));
  const feeds = (from: (typeof phased)[number], to: (typeof phased)[number]) => from.writes.some((w) => to.reads.some((r) => overlaps(w, r)));
  const orch = m.units.get("qa-orchestrator");
  if (orch !== undefined && orch.contract !== null && phaseOf.size === 0) {
    const special = orch.contract.dispatches.filter((d) => {
      const c = m.units.get(d)?.contract;
      return c !== undefined && c !== null && "phase" in c && SPECIAL_PHASES.has(c.phase) && c.phase !== "spv";
    });
    if (special.length > 0) out.push(violation("CONTRACT", "qa-orchestrator", "during-phase", "anchor-missing", orch.file, orch.contractLine, `qa-orchestrator dispatches ${special.join(", ")} but no prose line says "during <Phase>"`));
  }
  const where = lines.length > 0 ? ` (phase from qa-orchestrator prose lines ${lines.join(", ")})` : "";
  for (let i = 0; i < phased.length; i++) {
    for (let j = i + 1; j < phased.length; j++) {
      const a = phased[i]!;
      const b = phased[j]!;
      if (a.phase !== b.phase || !feeds(a, b) || !feeds(b, a)) continue;
      out.push(violation("PRODUCER", a.u.name, b.u.name, "same-phase-cycle", a.u.file, a.u.contractLine, `${a.u.name} and ${b.u.name} run in the same phase and read each other's writes${where}`));
    }
  }
  return out;
}

export function consumerRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const allReaders = [...m.units.values()].flatMap((u) => (u.contract?.reads ?? []).map((r) => ({ u, path: pathOf(r) })));
  const sources = allSources(m);
  for (const u of [...m.units.values()].filter((x) => x.kind === "agent")) {
    for (const p of new Set(allReaders.filter((r) => r.u === u && isTooBroad(r.path)).map((r) => normalizePath(r.path)))) {
      if (sources.some((s) => matches(s, p))) continue;
      out.push(violation("CONSUMER", u.name, p, "too-broad", u.file, u.contractLine, `${p} is too broad to index as a reader`));
    }
  }
  const readers = allReaders.filter((r) => !isTooBroad(r.path));
  for (const w of [...m.units.values()].filter(isAgentContract)) {
    for (const e of w.contract.writes) {
      if (terminal(e) || isTooBroad(pathOf(e))) continue;
      const p = normalizePath(pathOf(e));
      if (!readers.some((r) => r.u.name !== w.name && overlaps(r.path, p))) {
        out.push(violation("CONSUMER", w.name, p, "unread", w.file, w.contractLine, `no one reads ${p}`));
      }
    }
  }
  return out;
}

export function eventRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const emitted = new Set([
    ...[...m.units.values()].flatMap((u) => (u.contract?.emits ?? []).map((e) => e.event)),
    ...[...m.units.values()].flatMap((u) => (u.contract?.cli ?? []).flatMap((cmd) => CLI_RECORDS[cmd] ?? [])),
  ]);
  for (const u of m.units.values()) {
    const c = u.contract;
    if (c === null) continue;
    for (const ev of new Set([...c.emits.map((e) => e.event), ...c.awaits])) {
      if (!m.declaredEvents.has(ev)) out.push(violation("EVENT", u.name, ev, "undeclared", u.file, u.contractLine, `${ev} is not a declared event`));
    }
    for (const ev of c.awaits) {
      if (!emitted.has(ev)) out.push(violation("EVENT", u.name, ev, "no-emitter", u.file, u.contractLine, `nobody emits ${ev}`));
    }
    let appends = false;
    for (const e of c.emits) {
      const cmd = e.via === "append" ? "event.append" : e.via.slice("cli:".length);
      if (e.via !== "append" && !c.cli.includes(cmd)) out.push(violation("EVENT", u.name, e.event, "command-not-in-cli", u.file, u.contractLine, `${cmd} is not listed in this unit's cli`));
      if (e.via === "append" || cmd === "event.append") {
        if (e.via === "append") appends = true;
        if (u.kind === "skill") out.push(violation("EVENT", u.name, e.event, "owner-cannot-append", u.file, u.contractLine, "skills run as owner, and the owner cannot append events"));
        else if (isCliRecordedEventType(e.event)) out.push(violation("EVENT", u.name, e.event, "cli-recorded", u.file, u.contractLine, `${e.event} is recorded by the CLI`));
      } else {
        if (!commandRecords(cmd, e.event)) out.push(violation("EVENT", u.name, e.event, "wrong-command", u.file, u.contractLine, `${cmd} does not record ${e.event}`));
      }
    }
    if (u.kind === "agent" && appends && !c.cli.includes("event.append")) {
      out.push(violation("EVENT", u.name, "-", "appends-without-cli", u.file, u.contractLine, "emits events without `aegis event append`"));
    }
  }
  return out;
}

export function writePolicyRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const src = m.pipeline?.sources;
  const cliOnly = src?.cli ?? [];
  const policy = m.pipeline?.writePolicy;
  const writable = policy?.writable ?? [];
  for (const u of m.units.values()) {
    const extra: string[] = [...(policy?.units[u.name] ?? [])];
    if (u.kind === "skill") {
      extra.push(...(src?.repo ?? []), ...(src?.owner ?? []));
      if (u.contract !== null && "kind" in u.contract && u.contract.kind === "internal") extra.push(...(policy?.internalSkills ?? []));
    }
    for (const e of u.contract?.writes ?? []) {
      const p = normalizePath(pathOf(e));
      let reason: string | null = null;
      // AH-15: a write that can land in a CLI-only file or outside tests/qa is flagged (overlaps, not matches).
      if (cliOnly.some((s) => overlaps(s, p))) reason = "cli-only";
      else if (p.startsWith("{tests}/") && !matches("{tests}/qa/**", p)) reason = "outside-tests-qa";
      else if (p.startsWith("{target}/")) reason = "target-source";
      else if (!writable.some((w) => matches(w, p)) && !extra.some((w) => matches(w, p))) reason = "not-writable";
      if (reason !== null) out.push(violation("WRITE-POLICY", u.name, p, reason, u.file, u.contractLine, `write to ${p} violates the write policy (${reason})`));
    }
  }
  return out;
}

/** Spec §6 AH-11 (AUD-011): a reachable unit awaits an event whose every emitter is unreachable. Events with no emitter are `no-emitter`. */
export function emitterRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const reachable = reachableUnits(m);
  const emitters = new Map<string, Set<string>>();
  for (const u of m.units.values()) {
    const c = u.contract;
    if (c === null) continue;
    for (const ev of [...c.emits.map((e) => e.event), ...c.cli.flatMap((cmd) => CLI_RECORDS[cmd] ?? [])]) {
      if (!emitters.has(ev)) emitters.set(ev, new Set());
      emitters.get(ev)!.add(u.name);
    }
  }
  for (const u of m.units.values()) {
    if (u.contract === null || !reachable.has(u.name)) continue;
    for (const ev of new Set(u.contract.awaits)) {
      const es = emitters.get(ev);
      if (es === undefined || es.size === 0 || [...es].some((n) => reachable.has(n))) continue;
      out.push(violation("EVENT", u.name, ev, "unreachable-emitter", u.file, u.contractLine, `${ev} is emitted only by ${[...es].join(", ")}, which nothing reachable dispatches`));
    }
  }
  return out;
}
