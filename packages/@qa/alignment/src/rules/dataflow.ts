import { join } from "node:path";
import { existsWithContent } from "../load.js";
import { isCliRecordedEventType } from "@qa/run-state";
import { CLI_RECORDS, commandRecords } from "../cli-records.js";
import { isTooBroad, matches, normalizePath, overlaps } from "../paths.js";
import type { PathEntry } from "../schema.js";
import { isAgentContract, pathOf, violation, type Model, type Unit, type Violation } from "../types.js";

// CLAUDE.md write table: aegis/runs/** (not only a single run), ../tests/** limited to tests/qa/** (HANDBOOK/17).
const WRITABLE = ["{run}/**", "runs/**", "{tests}/qa/**", "packages/@qa/**", "apps/**", "agent-memory/**", "sandbox/**"];

function phaseIndex(m: Model): Map<string, number> {
  const idx = new Map<string, number>();
  (m.pipeline?.phases ?? []).forEach((p, i) => idx.set(p.id, i));
  return idx;
}

function unitPhase(m: Model, u: Unit, idx: Map<string, number>): number | undefined {
  return u.contract !== null && "phase" in u.contract ? idx.get(u.contract.phase) : undefined;
}

function allSources(m: Model): string[] {
  const s = m.pipeline?.sources;
  return s ? [...s.cli, ...s.owner, ...s.target, ...s.repo] : [];
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

export function producerRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const idx = phaseIndex(m);
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
    const rp = unitPhase(m, r, idx);
    for (const e of r.contract.reads) {
      if (optional(e)) continue;
      if (isTooBroad(pathOf(e))) continue;
      const p = normalizePath(pathOf(e));
      const prods = indexed.filter((w) => w.u.name !== r.name && overlaps(w.path, p));
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
      if (rp === undefined) continue;
      const earlyOrUnbound = prods.some((w) => {
        const wp = unitPhase(m, w.u, idx);
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
  const cliOnly = m.pipeline?.sources.cli ?? [];
  const src = m.pipeline?.sources;
  for (const u of m.units.values()) {
    const extra: string[] = [];
    if (u.kind === "skill") {
      extra.push(...(src?.repo ?? []), ...(src?.owner ?? []));
      if (u.contract !== null && "kind" in u.contract && u.contract.kind === "internal") extra.push(".claude/**", "HANDBOOK/**", "HANDBOOK.md", "docs/**");
    }
    for (const e of u.contract?.writes ?? []) {
      const p = normalizePath(pathOf(e));
      let reason: string | null = null;
      if (cliOnly.some((s) => matches(s, p))) reason = "cli-only";
      else if (matches("{tests}/**", p) && !overlaps("{tests}/qa/**", p)) reason = "outside-tests-qa";
      else if (p.startsWith("{target}/")) reason = "target-source";
      else if (!WRITABLE.some((w) => matches(w, p)) && !extra.some((w) => matches(w, p))) reason = "not-writable";
      if (reason !== null) out.push(violation("WRITE-POLICY", u.name, p, reason, u.file, u.contractLine, `write to ${p} violates the write policy (${reason})`));
    }
  }
  return out;
}
