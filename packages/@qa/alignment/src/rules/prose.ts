import { pathExists } from "../load.js";
import { CONTRACT_HEADING, frontmatterLite } from "../markdown.js";
import { normalizePath, overlaps, staticPrefix } from "../paths.js";
import { isAgentContract, isSkillContract, pathOf, violation, type Model, type Section, type Unit, type Violation } from "../types.js";
import { allSources } from "./dataflow.js";

const CONTRACT_TITLE = CONTRACT_HEADING.slice(3);

/** Every section except the contract block — all agent sections count (spec §7 AH-09). */
function proseSections(u: Unit): Section[] {
  return u.sections.filter((x) => x.heading !== CONTRACT_TITLE);
}

function lineOf(sec: Section, offset: number): number {
  return sec.startLine + sec.text.slice(0, offset).split("\n").length;
}

const FAMILY = /qa-[a-z0-9-]*-[{*]/;

/**
 * The part of a line that speaks about this unit: null for negated or family lines; otherwise the text
 * before the first other unit's name, so an own path before "then qa-b reads …" is kept (AH-14).
 */
function ownPart(line: string, self: string, names: Set<string>): string | null {
  if (/\b(never|must not)\b/i.test(line) || FAMILY.test(line)) return null;
  for (const t of line.matchAll(/qa-[a-z0-9-]+/g)) {
    if (t[0] !== self && names.has(t[0])) return line.slice(0, t.index ?? 0);
  }
  return line;
}

/**
 * Drop the clauses of a line that state a prohibition or a violation: "— NOT the legacy `x/`",
 * "no writes into `y/`", "Any … written to `z/` = requested-changes". Such paths are not contract paths.
 */
function affirmed(line: string): string {
  return line
    .split(/(?<=[.;])\s+|\s+—\s+/)
    .filter((c) => !/^(?:no|not|never)\b/i.test(c.trim()) && !/^Any\b.*=\s*(?:requested-changes|passed-with-notes)\b/.test(c.trim()))
    .join(" ");
}

/**
 * A section whose bullets are the conditions an SPV rejects. Each bullet's leading clause (up to the first
 * `(`, `;` or `—`) states the prohibited action and is not a contract path; the parenthetical or remedy text
 * after it ("temp files belong in `x/`", "— must be `y`") is still checked.
 */
const VIOLATION_SECTION = /\bSPV rejects if violated\b/i;
const violationRemedy = (line: string) => line.replace(/^(\s*(?:[-*]|\d+\.)\s+)[^(;—]*/, "$1");

/** Which contract list a prose path must appear in: Inputs → reads, Outputs → writes, else either. */
export type PathSide = "reads" | "writes" | "either";

function sideOf(u: Unit, heading: string): PathSide {
  if (u.kind === "skill") return "either";
  if (/^Inputs/.test(heading)) return "reads";
  if (/^Outputs/.test(heading)) return "writes";
  return "either";
}

/** Aegis-root directories whose prose paths DRIFT also checks, reported as `{aegis}/…` (AH-09). */
const AEGIS_ROOTS = /^(config|artifacts|promotions|knowledge|agent-memory|templates)\//;
const bare = (p: string) => normalizePath(p).replace(/^\{aegis\}\//, "");

function pathsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const p = normalizePath(m[1]!);
    if (p.startsWith("{run}/") || p.startsWith("{tests}/") || p.startsWith("{target}/")) out.push(p);
    else if (AEGIS_ROOTS.test(bare(p))) out.push(`{aegis}/${bare(p)}`);
  }
  return out;
}

export function prosePaths(u: Unit, names: Set<string> = new Set()): Array<{ path: string; line: number; side: PathSide }> {
  const out: Array<{ path: string; line: number; side: PathSide }> = [];
  const description = frontmatterLite(u.source).description;
  if (description !== undefined) {
    const own = ownPart(description, u.name, names);
    const line = u.source.split("\n").findIndex((l) => /^description:/.test(l)) + 1;
    if (own !== null) for (const path of pathsIn(own)) out.push({ path, line, side: "either" });
  }
  for (const sec of proseSections(u)) {
    const violations = VIOLATION_SECTION.test(sec.heading);
    const side = sideOf(u, sec.heading);
    const narrow = u.kind === "skill" || !/^(Inputs|Outputs)/.test(sec.heading);
    sec.text.split("\n").forEach((raw, i) => {
      if (/\b(testDir|testMatch|outputDir)\b/.test(raw)) return;
      const text = violations ? violationRemedy(raw) : raw;
      const own = narrow ? ownPart(text, u.name, names) : text;
      if (own === null) return;
      const scan = narrow ? affirmed(own) : own;
      for (const path of pathsIn(scan)) out.push({ path, line: sec.startLine + 1 + i, side });
    });
  }
  return out;
}

const EVENT_SECTION = /^Events (You Emit|emitted)/i;
const EVENT_TOKEN = /`([a-z]+(?:\.[a-z0-9-]+)+)`/g;
const FILE_LIKE = /\.(jsonl?|md|ya?ml|ts|js|mjs|cjs|pdf|html|txt|csv|har|png|lock|sh)$/;

export function proseEvents(u: Unit, declared: Set<string>): Array<{ event: string; line: number }> {
  const out: Array<{ event: string; line: number }> = [];
  for (const sec of u.sections.filter((s) => EVENT_SECTION.test(s.heading))) {
    for (const m of sec.text.matchAll(EVENT_TOKEN)) {
      if (declared.has(m[1]!)) out.push({ event: m[1]!, line: lineOf(sec, m.index ?? 0) });
    }
  }
  return out;
}

/** Event-like tokens in "Events You Emit" that are not declared events (file names excluded) — AH-09. */
export function proseUndeclaredEvents(u: Unit, declared: Set<string>): Array<{ event: string; line: number }> {
  const out: Array<{ event: string; line: number }> = [];
  for (const sec of u.sections.filter((s) => EVENT_SECTION.test(s.heading))) {
    for (const m of sec.text.matchAll(EVENT_TOKEN)) {
      if (!declared.has(m[1]!) && !FILE_LIKE.test(m[1]!)) out.push({ event: m[1]!, line: lineOf(sec, m.index ?? 0) });
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
  const sources = allSources(m);
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
      const onDisk = prefix !== "" && !prefix.startsWith("{") && pathExists(m, prefix);
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
    // Config files the contract lists under `config` are read (spec §4); prose may name them.
    const reads = [...c.reads.map((e) => bare(pathOf(e))), ...c.config.map((r) => bare(r.split("#")[0]!))];
    const writes = c.writes.map((e) => bare(pathOf(e)));
    const seen = new Set<string>();
    for (const { path, line, side } of prosePaths(u, allNames)) {
      // A last segment without a file extension is a module specifier (`…/auth.fixture`): it names `…/auth.fixture.<ext>`.
      const alts = /\/[^/*{}]+$/.test(path) && !FILE_LIKE.test(path) ? [bare(path), `${bare(path)}.*`] : [bare(path)];
      const inReads = reads.some((d) => alts.some((a) => overlaps(d, a)));
      const inWrites = writes.some((d) => alts.some((a) => overlaps(d, a)));
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
    for (const { event, line } of proseUndeclaredEvents(u, m.declaredEvents)) {
      if (seen.has(event)) continue;
      seen.add(event);
      out.push(violation("DRIFT", u.name, event, "undeclared-event", u.file, line, `prose lists ${event}, which is not a declared event`));
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
  // A skill is invoked by its directory name, `_qa-*` included (AH-16); nothing resolves through a frontmatter name.
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
      // `**/qa-x**` (bold) and `[/qa-x]` (link text) are slash commands too (AH-14 lookbehinds).
      for (const sc of line.matchAll(/(?<=^|[\s`(*[])\/(_?qa-[a-z0-9-]+)/g)) {
        const t = sc[1]!.replace(/-+$/, "");
        const after = line.slice((sc.index ?? 0) + sc[0].length);
        if (/^\.(?:ya?ml|md|json|ts)\b/.test(after)) continue;
        if (/^[/(]/.test(after)) continue; // `/qa-x/` or `/qa-x-(…)`: a regex literal or path segment, not a command
        const key = `/${t}`;
        if (skillDirs.has(t) || t === self || seen.has(key)) continue;
        if (sc[1]!.endsWith("-") && [...skillDirs].some((a) => a.startsWith(`${t}-`))) continue;
        seen.add(key);
        out.push(violation("DOC-REF", file, key, "unknown-command", file, i + 1, `${key} is not a skill`));
      }
      for (const mt of line.matchAll(/(?<![@/\w-])_?qa-[a-z0-9-]+/g)) {
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
