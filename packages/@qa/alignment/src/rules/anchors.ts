import { proseLines } from "../markdown.js";
import { overlaps } from "../paths.js";
import { isSkillContract, pathOf, violation, type Model, type Unit, type Violation } from "../types.js";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CLI_TOKEN = /^(?:AEGIS_AGENT=\S+\s+)?(?:pnpm\s+)?aegis\s+([a-z][a-z-]*)\s+([a-z][a-z-]*)/;

/** Backticked `aegis <noun> <verb>` / `pnpm aegis <noun> <verb>` in prose, as `<noun>.<verb>` (spec §4.1). */
export function proseCli(u: Unit): Array<{ cmd: string; line: number }> {
  const out: Array<{ cmd: string; line: number }> = [];
  for (const { text, line } of proseLines(u.source)) {
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const t = CLI_TOKEN.exec(m[1]!.trim());
      if (t !== null) out.push({ cmd: `${t[1]}.${t[2]}`, line });
    }
  }
  return out;
}

export function cliAnchorRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of m.units.values()) {
    const c = u.contract;
    if (c === null) continue;
    const mentioned = proseCli(u);
    const seen = new Set<string>();
    for (const { cmd, line } of mentioned) {
      if (c.cli.includes(cmd) || seen.has(cmd)) continue;
      seen.add(cmd);
      out.push(violation("DRIFT", u.name, cmd, "cli-not-in-contract", u.file, line, `prose runs \`aegis ${cmd.replace(".", " ")}\`; contract cli does not list ${cmd}`));
    }
    const names = new Set(mentioned.map((x) => x.cmd));
    for (const cmd of c.cli) {
      if (!names.has(cmd)) out.push(violation("DRIFT", u.name, cmd, "cli-not-in-prose", u.file, u.contractLine, `contract cli lists ${cmd}; prose never runs \`aegis ${cmd.replace(".", " ")}\``));
    }
  }
  return out;
}

const CONFIG_REF = /\b(aegis\.config\.json|thresholds\.yaml)#([A-Za-z0-9_{}-]+(?:\.[A-Za-z0-9_{}-]+)*)/g;
const isPlaceholder = (s: string) => /^\{[^{}]+\}$/.test(s);

function sameRef(a: string, b: string): boolean {
  const [fa, ka] = a.split("#") as [string, string | undefined];
  const [fb, kb] = b.split("#") as [string, string | undefined];
  if (fa !== fb) return false;
  if (ka === undefined || kb === undefined) return ka === kb;
  const x = ka.split(".");
  const y = kb.split(".");
  return x.length === y.length && x.every((s, i) => s === y[i] || isPlaceholder(s) || isPlaceholder(y[i]!));
}

function configMentioned(entry: string, lines: Array<{ text: string }>, refs: Array<{ ref: string }>): boolean {
  if (refs.some((r) => sameRef(entry, r.ref))) return true;
  const [file, key] = entry.split("#") as [string, string | undefined];
  const names = [file, file.split("/").pop()!];
  const namesFile = (t: string) => names.some((n) => t.includes(n));
  if (key === undefined) return lines.some((l) => namesFile(l.text));
  const last = [...key.split(".")].reverse().find((s) => !isPlaceholder(s));
  if (last === undefined) return false;
  const word = new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(last)}([^A-Za-z0-9_]|$)`);
  return lines.some((l) => namesFile(l.text) && word.test(l.text));
}

/** Spec §4.2: prose config refs ↔ contract `config`. */
export function configAnchorRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of m.units.values()) {
    const c = u.contract;
    if (c === null) continue;
    const lines = proseLines(u.source);
    const refs = lines.flatMap(({ text, line }) => [...text.matchAll(CONFIG_REF)].map((r) => ({ ref: `${r[1]}#${r[2]}`, line })));
    const seen = new Set<string>();
    for (const { ref, line } of refs) {
      if (c.config.some((x) => sameRef(x, ref)) || seen.has(ref)) continue;
      seen.add(ref);
      out.push(violation("DRIFT", u.name, ref, "config-not-in-contract", u.file, line, `prose reads ${ref}; contract config does not list it`));
    }
    for (const entry of c.config) {
      if (!configMentioned(entry, lines, refs)) out.push(violation("DRIFT", u.name, entry, "config-not-in-prose", u.file, u.contractLine, `contract config lists ${entry}; prose never names it`));
    }
  }
  return out;
}

/** Spec §4.3: every `runs` tool appears as a word in the prose (one direction). */
export function runsAnchorRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of m.units.values()) {
    if (u.contract === null) continue;
    const text = proseLines(u.source).map((l) => l.text).join("\n");
    for (const tool of u.contract.runs) {
      const word = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(tool)}(?![A-Za-z0-9_])`, "i");
      if (!word.test(text)) out.push(violation("DRIFT", u.name, tool, "run-not-in-prose", u.file, u.contractLine, `contract runs ${tool}; prose never names it`));
    }
  }
  return out;
}

/** Spec §4.4: `_` name ⇔ `kind: internal`; `kind: query` has no dispatch, no run-state write, no emit. */
export function skillKindRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of [...m.units.values()].filter(isSkillContract)) {
    const c = u.contract;
    if (u.name.startsWith("_") !== (c.kind === "internal")) {
      const why = u.name.startsWith("_") ? `${u.name} starts with _ but kind is ${c.kind}` : "kind internal requires a _-prefixed name";
      out.push(violation("CONTRACT", u.name, c.kind, "kind-name-mismatch", u.file, u.contractLine, why));
    }
    if (c.kind !== "query") continue;
    if (c.dispatches.length > 0) out.push(violation("CONTRACT", u.name, "dispatches", "query-side-effect", u.file, u.contractLine, `query skill dispatches ${c.dispatches.join(", ")}`));
    const runWrites = c.writes.map(pathOf).filter((w) => overlaps("{run}/**", w) || overlaps("runs/**", w));
    if (runWrites.length > 0) out.push(violation("CONTRACT", u.name, "writes", "query-side-effect", u.file, u.contractLine, `query skill writes run state: ${runWrites.join(", ")}`));
    if (c.emits.length > 0) out.push(violation("CONTRACT", u.name, "emits", "query-side-effect", u.file, u.contractLine, `query skill emits ${c.emits.map((e) => e.event).join(", ")}`));
  }
  return out;
}
