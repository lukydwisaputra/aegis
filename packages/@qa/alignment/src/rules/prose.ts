import { join } from "node:path";
import { CONTRACT_HEADING, existsWithContent, frontmatterLite } from "../load.js";
import { normalizePath, overlaps, staticPrefix } from "../paths.js";
import { isAgentContract, isSkillContract, pathOf, violation, type Model, type Section, type Unit, type Violation } from "../types.js";

const CONTRACT_TITLE = CONTRACT_HEADING.slice(3);

function proseSections(u: Unit): Section[] {
  const s = u.sections.filter((x) => x.heading !== CONTRACT_TITLE);
  return u.kind === "skill" ? s : s.filter((x) => /^(Inputs|Outputs|Process)/.test(x.heading));
}

function lineOf(sec: Section, offset: number): number {
  return sec.startLine + sec.text.slice(0, offset).split("\n").length;
}

const FAMILY = /qa-[a-z0-9-]*-[{*]/;

function skipPathLine(line: string, self: string, names: Set<string>): boolean {
  if (/\b(never|must not)\b/i.test(line) || FAMILY.test(line)) return true;
  for (const t of line.matchAll(/qa-[a-z0-9-]+/g)) {
    if (t[0] !== self && names.has(t[0])) return true;
  }
  return false;
}

/** Which contract list a prose path must appear in: Inputs → reads, Outputs → writes, else either. */
export type PathSide = "reads" | "writes" | "either";

function sideOf(u: Unit, heading: string): PathSide {
  if (u.kind === "skill") return "either";
  if (/^Inputs/.test(heading)) return "reads";
  if (/^Outputs/.test(heading)) return "writes";
  return "either";
}

export function prosePaths(u: Unit, names: Set<string> = new Set()): Array<{ path: string; line: number; side: PathSide }> {
  const out: Array<{ path: string; line: number; side: PathSide }> = [];
  for (const sec of proseSections(u)) {
    const side = sideOf(u, sec.heading);
    const narrow = u.kind === "skill" || /^Process/.test(sec.heading);
    sec.text.split("\n").forEach((text, i) => {
      if (narrow && skipPathLine(text, u.name, names)) return;
      if (/\b(testDir|testMatch)\b/.test(text)) return;
      for (const m of text.matchAll(/`([^`\n]+)`/g)) {
        const p = normalizePath(m[1]!);
        if (p.startsWith("{run}/") || p.startsWith("{tests}/") || p.startsWith("{target}/")) out.push({ path: p, line: sec.startLine + 1 + i, side });
      }
    });
  }
  return out;
}

export function proseEvents(u: Unit, declared: Set<string>): Array<{ event: string; line: number }> {
  const out: Array<{ event: string; line: number }> = [];
  for (const sec of u.sections.filter((s) => /^Events (You Emit|emitted)/i.test(s.heading))) {
    for (const m of sec.text.matchAll(/`([a-z]+(?:\.[a-z0-9-]+)+)`/g)) {
      if (declared.has(m[1]!)) out.push({ event: m[1]!, line: lineOf(sec, m.index ?? 0) });
    }
  }
  return out;
}

export function proseDispatches(u: Unit, agents: Set<string>): Array<{ agent: string; line: number }> {
  const out: Array<{ agent: string; line: number }> = [];
  if (u.kind === "agent" && !u.tools.includes("Agent")) return out;
  for (const sec of proseSections(u)) {
    sec.text.split("\n").forEach((line, i) => {
      if (/\b(do not|does not|don't|never)\s+(dispatch|spawn|invoke)|\bdispatched by\b|\bnot by you\b/i.test(line)) return;
      if (!/\b(dispatch|dispatches|dispatched|spawn|invoke|route[sd]? to)\b/i.test(line)) return;
      for (const m of line.matchAll(/qa-[a-z0-9-]+/g)) {
        if (m[0] !== u.name && agents.has(m[0])) out.push({ agent: m[0], line: sec.startLine + 1 + i });
      }
    });
  }
  return out;
}

export function skillRule(m: Model): Violation[] {
  const out: Violation[] = [];
  // Spec §4: a skill read resolves when it exists, an agent produces it, or it is in `sources`;
  // paths the skill itself writes are ignored. Other skills' writes do not count as producers.
  const agentWrites = [...m.units.values()].filter(isAgentContract).flatMap((u) => u.contract.writes.map(pathOf));
  const s = m.pipeline?.sources;
  const sources = s ? [...s.cli, ...s.owner, ...s.target, ...s.repo] : [];
  for (const u of [...m.units.values()].filter(isSkillContract)) {
    const writes = [...agentWrites, ...u.contract.writes.map(pathOf)];
    if (u.contract.kind === "execution") {
      for (const d of u.contract.dispatches) {
        if (d !== "qa-orchestrator") out.push(violation("SKILL", u.name, d, "direct-dispatch", u.file, u.contractLine, `execution skill dispatches ${d} directly`));
      }
    }
    for (const e of u.contract.reads) {
      const p = normalizePath(pathOf(e));
      const prefix = staticPrefix(p.startsWith("{aegis}/") ? p.slice(8) : p);
      const onDisk = prefix !== "" && !prefix.startsWith("{") && existsWithContent(join(m.root, prefix));
      if (onDisk || writes.some((w) => overlaps(w, p)) || sources.some((x) => overlaps(x, p))) continue;
      out.push(violation("SKILL", u.name, p, "unresolved", u.file, u.contractLine, `${p} does not exist and nothing produces it`));
    }
  }
  return out;
}

export function driftRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const allNames = new Set(m.units.keys());
  const agentNames = new Set([...m.units.values()].filter((u) => u.kind === "agent").map((u) => u.name));
  for (const u of m.units.values()) {
    const c = u.contract;
    if (c === null) continue;
    const reads = c.reads.map(pathOf);
    const writes = c.writes.map(pathOf);
    const seen = new Set<string>();
    for (const { path, line, side } of prosePaths(u, allNames)) {
      const inReads = reads.some((d) => overlaps(d, path));
      const inWrites = writes.some((d) => overlaps(d, path));
      let reason: string;
      let message: string;
      if (!inReads && !inWrites) {
        reason = "path-not-in-contract";
        message = `prose mentions ${path}; contract does not`;
      } else if (side === "writes" && !inWrites) {
        reason = "undeclared-write";
        message = `Outputs names ${path}; contract writes do not`;
      } else if (side === "reads" && !inReads) {
        reason = "undeclared-read";
        message = `Inputs names ${path}; contract reads do not`;
      } else continue;
      if (seen.has(`${path}:${reason}`)) continue;
      seen.add(`${path}:${reason}`);
      out.push(violation("DRIFT", u.name, path, reason, u.file, line, message));
    }
    const events = new Set([...c.emits.map((e) => e.event), ...c.awaits]);
    for (const { event, line } of proseEvents(u, m.declaredEvents)) {
      if (!events.has(event) && !seen.has(event)) {
        seen.add(event);
        out.push(violation("DRIFT", u.name, event, "event-not-in-contract", u.file, line, `prose lists ${event}; contract does not`));
      }
    }
    for (const { agent, line } of proseDispatches(u, agentNames)) {
      if (!c.dispatches.includes(agent) && !seen.has(agent)) {
        seen.add(agent);
        out.push(violation("DRIFT", u.name, agent, "dispatch-not-in-contract", u.file, line, `prose dispatches ${agent}; contract does not`));
      }
    }
  }
  return out;
}

export function docRefRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const allow = new Set(m.pipeline?.nonAgentNames ?? []);
  // A skill is invoked by its directory name: `qa-report-x` / `/qa-report-x` do not reach `_qa-report-x`,
  // even when that skill's frontmatter says `name: qa-report-x`.
  const skillDirs = new Set([...m.units.values()].filter((u) => u.kind === "skill").map((u) => u.name));
  const valid = (t: string) => m.units.has(t) || allow.has(t);
  // A unit's own file may use its own frontmatter name (title line, `name:`); nowhere else resolves through it.
  const files: Array<{ file: string; source: string; self?: string }> = [
    ...m.docs,
    ...[...m.units.values()].map((u) => {
      const self = frontmatterLite(u.source).name;
      return self !== undefined ? { file: u.file, source: u.source, self } : { file: u.file, source: u.source };
    }),
  ];
  for (const { file, source, self } of files) {
    const seen = new Set<string>();
    source.split("\n").forEach((line, i) => {
      for (const sc of line.matchAll(/(?<=^|[\s`(])\/(qa-[a-z0-9-]+)/g)) {
        const t = sc[1]!.replace(/-+$/, "");
        const after = line.slice((sc.index ?? 0) + sc[0].length);
        if (/^\.(?:ya?ml|md|json|ts)\b/.test(after)) continue;
        const key = `/${t}`;
        if (skillDirs.has(t) || t === self || seen.has(key)) continue;
        if (sc[1]!.endsWith("-") && [...skillDirs].some((a) => a.startsWith(`${t}-`))) continue;
        seen.add(key);
        out.push(violation("DOC-REF", file, key, "unknown-command", file, i + 1, `${key} is not a skill`));
      }
      for (const mt of line.matchAll(/(?<![@/\w-])qa-[a-z0-9-]+/g)) {
        const t = mt[0].replace(/-+$/, "");
        if (mt[0].endsWith("-") && [...m.units.keys()].some((n) => n.startsWith(`${t}-`))) continue;
        const after = line.slice((mt.index ?? 0) + mt[0].length);
        if (/^\.(?:ya?ml|md|json|ts)\b/.test(after)) continue;
        if (valid(t) || t === self || seen.has(t)) continue;
        seen.add(t);
        out.push(violation("DOC-REF", file, t, "unknown", file, i + 1, `${t} is not an agent, skill, package or allowlisted name`));
      }
    });
  }
  return out;
}
