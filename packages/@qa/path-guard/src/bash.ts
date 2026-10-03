import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

/**
 * Best-effort Bash write-target parser for the PreToolUse hook (P0 spec §4.2 H1, §10 risk). It sees redirections, the
 * common file commands, heredocs, `cd` and `bash -c`; it does not see writes made inside interpreters (`node -e`, …).
 */

/** One shell word, quotes removed. `dynamic` when it holds an expansion ($VAR, $(…), `…`) the hook cannot resolve. */
export interface ShellWord {
  readonly value: string;
  readonly dynamic: boolean;
  /** Unquoted brace expansion ({a,b}, {1..3}) or glob (* ? [): the word names several paths, not one. */
  readonly pattern?: true;
}

export interface SimpleCommand {
  /** Leading NAME=value assignments (e.g. AEGIS_AGENT=qa-ui-specialist). */
  env: Record<string, string>;
  argv: ShellWord[];
  /** Targets of >, >>, >|, &>, &>> (fd duplications such as 2>&1 are not targets). */
  redirects: ShellWord[];
  /** Body of a here-document fed to this command. */
  heredoc: string | null;
  /** The here-document delimiter was quoted ('EOF', "EOF" or \\EOF): the shell expands nothing in its body. */
  heredocQuoted?: true;
  /** Subshell nesting depth, set only when above 0, so a `cd` inside `( … )` does not leak out. */
  depth?: number;
  /** Ids of the ( … ) groups this command sits in, outermost first: sibling subshells do not share a `cd`. */
  scopes?: number[];
  /** Set when the previous pipeline stage feeds this command (`|` or `|&`). */
  pipe?: true;
}

export interface WriteTarget {
  /** Absolute path, or the raw text when `dynamic`. */
  readonly path: string;
  readonly dynamic: boolean;
  /** Text known to be written: a heredoc body, or echo/printf arguments for a redirect. */
  readonly content: string | null;
  /** How it is written: ">" for a redirection, else the command name (rm, mkdir, cp, …). */
  readonly via: string;
  /** The path text holds an unquoted brace or glob pattern (see expandBraces). */
  readonly pattern?: true;
  /**
   * The operand joined to its directory but NOT normalized, set only when it differs from `path` (a `..`, `.` or `//`).
   * The guard canonicalizes this form physically, so `link/..` follows the link before it climbs (Task 9 I1).
   */
  readonly raw?: string;
  /** The operands come from stdin (`… | xargs rm`): `path` is the text of the stage that feeds it, not a path. */
  readonly stdin?: true;
}

/** A simple command with the directory it runs in (after any earlier `cd`). */
export interface LocatedCommand extends SimpleCommand {
  /** The last literal directory the command runs in (after a dynamic `cd` it is the directory before it). */
  readonly cwd: string;
  /** Set after a `cd` whose target could not be resolved: `cwd` is then not where the command really runs. */
  readonly cwdDynamic?: true;
  /** Every NAME=value this command sets: prefix, after wrappers, and export/declare arguments (see assignmentsOf). */
  readonly assigned: Record<string, string>;
}

type Tok = { t: "w"; w: ShellWord } | { t: "op"; op: string };

const OPS = ["&&", "||", ";;", "&>>", "&>", ">>", ">|", "<<<", "<<-", "<<", ";", "|&", "|", "&", "(", ")", ">", "<", "\n"] as const;
const SEPARATORS: ReadonlySet<string> = new Set(["&&", "||", ";;", ";", "|&", "|", "&", "(", ")", "\n"]);
const FILE_REDIRECTS: ReadonlySet<string> = new Set([">", ">>", ">|", "&>", "&>>"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Read a here-document delimiter word after `<<` (quotes and backslashes removed); null when there is none. */
function readDelimiter(line: string, from: number): { strip: boolean; delimiter: string; end: number; quoted: boolean } | null {
  let i = from;
  let strip = false;
  let quoted = false;
  if (line[i] === "-") {
    strip = true;
    i++;
  }
  while (line[i] === " " || line[i] === "\t") i++;
  let d = "";
  let any = false;
  while (i < line.length) {
    const c = line[i]!;
    if (c === "\\") {
      if (i + 1 >= line.length) break;
      quoted = true;
      d += line[i + 1];
      i += 2;
    } else if (c === "'") {
      quoted = true;
      const e = line.indexOf("'", i + 1);
      const stop = e === -1 ? line.length : e;
      d += line.slice(i + 1, stop);
      i = stop + 1;
    } else if (c === '"') {
      quoted = true;
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\" && i + 1 < line.length) i++;
        d += line[i];
        i++;
      }
      i++;
    } else if (/[\s;&|<>()]/.test(c)) break;
    else {
      d += c;
      i++;
    }
    any = true;
  }
  return any ? { strip, delimiter: d, end: Math.min(i, line.length), quoted } : null;
}

interface Marker {
  strip: boolean;
  delimiter: string;
  quoted: boolean;
  /** Inside an unquoted $( … ): the tokenizer folds it into an expansion, so no command takes its body. */
  nested: boolean;
}

/** The here-document markers on one line, in order; quoted or commented `<<` is not one. */
function heredocMarkers(line: string): Marker[] {
  const out: Marker[] = [];
  let i = 0;
  let wordStart = true;
  let sub = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === "\\") {
      i += 2;
      wordStart = false;
    } else if (c === "'") {
      const end = line.indexOf("'", i + 1);
      i = end === -1 ? line.length : end + 1;
      wordStart = false;
    } else if (c === '"' || (c === "$" && line[i + 1] === "'")) {
      const quote = c === '"' ? '"' : "'";
      i += c === '"' ? 1 : 2;
      while (i < line.length && line[i] !== quote) i += line[i] === "\\" ? 2 : 1;
      i++;
      wordStart = false;
    } else if (c === "$" && line[i + 1] === "(") {
      sub++;
      i += 2;
      wordStart = true;
    } else if (sub > 0 && (c === "(" || c === ")")) {
      sub += c === "(" ? 1 : -1;
      i++;
      wordStart = true;
    } else if (c === "#" && wordStart) {
      break;
    } else if (c === "<" && line[i + 1] === "<" && line[i + 2] !== "<" && line[i - 1] !== "<") {
      const m = readDelimiter(line, i + 2);
      if (m !== null) {
        out.push({ strip: m.strip, delimiter: m.delimiter, quoted: m.quoted, nested: sub > 0 });
        i = m.end;
      } else i += 2;
      wordStart = false;
    } else {
      wordStart = c === " " || c === "\t" || c === ";" || c === "|" || c === "&" || c === "(" || c === ")";
      i++;
    }
  }
  return out;
}

/** Remove here-document bodies from the text (they are data, not commands) and return the ones commands receive, in order. */
function extractHeredocs(src: string): { text: string; bodies: Array<{ body: string; quoted: boolean }> } {
  const lines = src.split("\n");
  const kept: string[] = [];
  const bodies: Array<{ body: string; quoted: boolean }> = [];
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]!;
    kept.push(line);
    for (const { strip, delimiter, quoted, nested } of heredocMarkers(line)) {
      let end = k + 1;
      while (end < lines.length && (strip ? lines[end]!.replace(/^\t+/, "") : lines[end]) !== delimiter) end++;
      // No closing line: the rest is not a body; parse it as commands.
      const body = end < lines.length ? lines.slice(k + 1, end).join("\n") : "";
      if (end < lines.length) k = end;
      if (!nested) bodies.push({ body, quoted });
    }
  }
  return { text: kept.join("\n"), bodies };
}

/** Consume one expansion starting at src[i] ($NAME, ${…}, $(…), `…`, $1); returns the index after it. */
function expansion(src: string, i: number, add: (s: string) => void): number {
  const start = i;
  if (src[i] === "`") {
    const end = src.indexOf("`", i + 1);
    i = end === -1 ? src.length : end + 1;
  } else if (src[i + 1] === "(" || src[i + 1] === "{") {
    const open = src[i + 1]!;
    const close = open === "(" ? ")" : "}";
    let depth = 0;
    i += 1;
    while (i < src.length) {
      const ch = src[i]!;
      i++;
      if (ch === open) depth++;
      else if (ch === close && --depth === 0) break;
    }
  } else if (/[A-Za-z_]/.test(src[i + 1] ?? "")) {
    i += 1;
    while (/[A-Za-z0-9_]/.test(src[i] ?? "")) i++;
  } else {
    i += 2;
  }
  add(src.slice(start, Math.min(i, src.length)));
  return i;
}

const ANSI_SIMPLE: Readonly<Record<string, string>> = { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", e: "\x1b", f: "\f", v: "\v", "\\": "\\", "'": "'", '"': '"', "?": "?" };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let cur = "";
  let dynamic = false;
  let inWord = false;
  let glob = false;
  let brace = false;
  const flush = (): void => {
    if (inWord) {
      const pattern = glob || (brace && /\{[^{}]*(,|\.\.)[^{}]*\}/.test(cur));
      out.push({ t: "w", w: pattern ? { value: cur, dynamic, pattern: true } : { value: cur, dynamic } });
    }
    cur = "";
    glob = false;
    brace = false;
    dynamic = false;
    inWord = false;
  };
  const append = (s: string): void => {
    cur += s;
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\") {
      if (src[i + 1] === "\n") {
        i += 2;
        continue;
      }
      cur += src[i + 1] ?? "";
      inWord = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      const stop = end === -1 ? src.length : end;
      cur += src.slice(i + 1, stop);
      inWord = true;
      i = stop + 1;
      continue;
    }
    if (c === '"') {
      inWord = true;
      i++;
      while (i < src.length && src[i] !== '"') {
        const d = src[i]!;
        if (d === "\\" && i + 1 < src.length) {
          cur += src[i + 1];
          i += 2;
        } else if (d === "$" || d === "`") {
          dynamic = true;
          i = expansion(src, i, append);
        } else {
          cur += d;
          i++;
        }
      }
      i++;
      continue;
    }
    if (c === "$" && src[i + 1] === "'") {
      inWord = true; // ANSI-C quoting: decoded, literal up to the closing unescaped quote
      i += 2;
      while (i < src.length && src[i] !== "'") {
        if (src[i] !== "\\" || i + 1 >= src.length) {
          cur += src[i];
          i++;
          continue;
        }
        const e = src[i + 1]!;
        i += 2;
        const simple = ANSI_SIMPLE[e];
        if (simple !== undefined) cur += simple;
        else if (e === "x" && /^[0-9a-fA-F]{1,2}/.test(src.slice(i, i + 2))) {
          const h = /^[0-9a-fA-F]{1,2}/.exec(src.slice(i, i + 2))![0];
          cur += String.fromCharCode(parseInt(h, 16));
          i += h.length;
        } else if (/[0-7]/.test(e)) {
          const o = /^[0-7]{0,2}/.exec(src.slice(i, i + 2))![0];
          cur += String.fromCharCode(parseInt(e + o, 8));
          i += o.length;
        } else cur += `\\${e}`;
      }
      i++;
      continue;
    }
    if (c === "$" || c === "`") {
      dynamic = true;
      inWord = true;
      i = expansion(src, i, append);
      continue;
    }
    if (c === "#" && !inWord) {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      flush();
      i++;
      continue;
    }
    if (!inWord && /[0-9]/.test(c)) {
      let j = i;
      while (/[0-9]/.test(src[j] ?? "")) j++;
      if (src[j] === ">" || src[j] === "<") {
        i = j; // fd-prefixed redirection (2>file): the operator follows
        continue;
      }
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op !== undefined) {
      flush();
      if ((op === ">" || op === ">>" || op === "<") && src[i + op.length] === "&") {
        i += op.length + 1;
        let j = i;
        while (src[j] === " " || src[j] === "\t") j++;
        if (op === ">" && j < src.length && !/[0-9-]/.test(src[j]!)) {
          out.push({ t: "op", op: "&>" }); // >&file sends both streams to the file
          continue;
        }
        i = j; // fd duplication: 2>&1, >&-, <&3
        while (/[0-9-]/.test(src[i] ?? "")) i++;
        continue;
      }
      out.push({ t: "op", op });
      i += op.length;
      continue;
    }
    if (c === "*" || c === "?" || c === "[") glob = true;
    else if (c === "{") brace = true;
    cur += c;
    inWord = true;
    i++;
  }
  flush();
  return out;
}

const blank = (): SimpleCommand => ({ env: {}, argv: [], redirects: [], heredoc: null });

/** Split a Bash command into simple commands (pipelines, lists and subshells flattened). */
export function parseBash(src: string): SimpleCommand[] {
  const { text, bodies } = extractHeredocs(src);
  const toks = tokenize(text);
  const cmds: SimpleCommand[] = [];
  let cur = blank();
  let body = 0;
  let depth = 0;
  let nextScope = 1;
  let curPipe = false;
  const scopes: number[] = [];
  const push = (followedByPipe = false): void => {
    if (cur.argv.length > 0 || cur.redirects.length > 0 || cur.heredoc !== null || Object.keys(cur.env).length > 0) {
      if (depth > 0) cur.depth = depth;
      // Every stage of a pipeline runs in its own subshell: a `cd` there does not reach the next command.
      const stage = curPipe || followedByPipe ? [nextScope++] : [];
      if (scopes.length > 0 || stage.length > 0) cur.scopes = [...scopes, ...stage];
      if (curPipe) cur.pipe = true;
      cmds.push(cur);
    }
    cur = blank();
    curPipe = false;
  };
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]!;
    if (tk.t === "op") {
      if (SEPARATORS.has(tk.op)) {
        push(tk.op === "|" || tk.op === "|&");
        if (tk.op === "(") {
          depth++;
          scopes.push(nextScope++);
        } else if (tk.op === ")") {
          depth = Math.max(0, depth - 1);
          scopes.pop();
        }
        curPipe = tk.op === "|" || tk.op === "|&";
        continue;
      }
      const next = toks[k + 1];
      const word = next !== undefined && next.t === "w" ? next.w : null;
      if (word !== null) k++;
      if (FILE_REDIRECTS.has(tk.op) && word !== null) cur.redirects.push(word);
      else if (tk.op === "<<" || tk.op === "<<-") {
        const h = bodies[body++];
        cur.heredoc = h?.body ?? "";
        if (h?.quoted === true) cur.heredocQuoted = true;
        else delete cur.heredocQuoted;
      }
      continue; // "<" and "<<<" read input
    }
    if (cur.argv.length === 0 && ASSIGNMENT.test(tk.w.value)) {
      const eq = tk.w.value.indexOf("=");
      cur.env[tk.w.value.slice(0, eq)] = tk.w.value.slice(eq + 1);
      continue;
    }
    cur.argv.push(tk.w);
  }
  push();
  return cmds;
}

/** Shell reserved words that precede a command (or end a block) without being one. */
const RESERVED: ReadonlySet<string> = new Set(["!", "{", "}", "do", "then", "else", "elif", "if", "while", "until", "done", "fi", "esac"]);
/** Compound-command headers (`for x in a b`, `case x in`): they name no command. */
const HEADERS: ReadonlySet<string> = new Set(["for", "select", "case", "function"]);
/** Wrappers, with the options of each that take a separate value. */
const WRAPPERS: Readonly<Record<string, readonly string[]>> = {
  env: ["-u", "-C", "-S"],
  sudo: ["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U"],
  command: [],
  builtin: [],
  exec: ["-a"],
  time: ["-f", "-o"],
  nohup: [],
  nice: ["-n"],
  timeout: ["-s", "-k"],
};

/** The command behind wrappers and reserved words (`env A=1 sudo -u x rm y` → rm y), with assignments made after one merged into env. */
export function unwrap(c: SimpleCommand): { env: Record<string, string>; argv: ShellWord[] } {
  const env: Record<string, string> = { ...c.env };
  let argv = c.argv;
  let wrapped = false;
  for (;;) {
    const head = argv[0];
    if (head === undefined) break;
    if (!head.dynamic) {
      if (HEADERS.has(head.value)) {
        argv = [];
        break;
      }
      if (RESERVED.has(head.value)) {
        argv = argv.slice(1);
        wrapped = true;
        continue;
      }
      const valued = Object.hasOwn(WRAPPERS, head.value) ? WRAPPERS[head.value]! : undefined;
      if (valued !== undefined) {
        argv = argv.slice(1);
        wrapped = true;
        while (argv[0] !== undefined && !argv[0].dynamic && argv[0].value.startsWith("-") && argv[0].value !== "-") {
          const opt = argv[0].value;
          argv = argv.slice(1);
          if (opt === "--") break;
          if (valued.includes(opt) && argv.length > 0) argv = argv.slice(1);
        }
        if (head.value === "timeout" && argv[0] !== undefined && /^[0-9.]+[smhd]?$/.test(argv[0].value)) argv = argv.slice(1);
        continue;
      }
    }
    if (wrapped && ASSIGNMENT.test(head.value)) {
      const eq = head.value.indexOf("=");
      env[head.value.slice(0, eq)] = head.value.slice(eq + 1);
      argv = argv.slice(1);
      continue;
    }
    break;
  }
  return { env, argv };
}

const DECLARERS: ReadonlySet<string> = new Set(["export", "declare", "typeset", "readonly", "local"]);
const SHELL_NAMES: ReadonlySet<string> = new Set(["bash", "sh", "zsh"]);
/** Commands that remove the operands xargs feeds them from stdin. */
const STDIN_REMOVERS: ReadonlySet<string> = new Set(["rm", "rmdir", "unlink", "mv"]);

/** xargs options that take a separate value. */
export const XARGS_VALUE_FLAGS: ReadonlySet<string> = new Set(["-I", "-i", "-n", "-P", "-L", "-l", "-d", "-s", "-E", "-e", "-a", "-R", "-S"]);

/** The command `xargs [options] cmd args…` starts: its words, options peeled. */
export function xargsCommand(args: readonly ShellWord[]): ShellWord[] {
  let k = 0;
  while (k < args.length && !args[k]!.dynamic && args[k]!.value.startsWith("-") && args[k]!.value !== "--") k += XARGS_VALUE_FLAGS.has(args[k]!.value) ? 2 : 1;
  if (args[k]?.value === "--") k++;
  return args.slice(k);
}

export interface FindParts {
  /** The start points (none: `.`). */
  starts: ShellWord[];
  /** -delete is present. */
  deletes: boolean;
  /** Each -exec/-execdir/-ok/-okdir command, up to its `;` or `+`; `dir` for the *dir forms. */
  execs: Array<{ dir: boolean; words: ShellWord[] }>;
  /** Files named by -fprint, -fprint0, -fprintf and -fls. */
  writes: ShellWord[];
}

const FIND_EXECS: ReadonlySet<string> = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const FIND_FILE_ACTIONS: ReadonlySet<string> = new Set(["-fprint", "-fprint0", "-fprintf", "-fls"]);

/** Item 5: `find` split into its start points and actions; the leading -H, -L, -P, -O<n> and -D <x> are skipped. */
export function findParts(args: readonly ShellWord[]): FindParts {
  let k = 0;
  while (k < args.length && !args[k]!.dynamic) {
    const v = args[k]!.value;
    if (v === "-H" || v === "-L" || v === "-P" || /^-O\d*$/.test(v)) k++;
    else if (v === "-D") k += 2;
    else break;
  }
  const starts: ShellWord[] = [];
  while (k < args.length) {
    const a = args[k]!;
    if (!a.dynamic && (a.value.startsWith("-") || a.value === "(" || a.value === "!")) break;
    starts.push(a);
    k++;
  }
  const out: FindParts = { starts, deletes: false, execs: [], writes: [] };
  while (k < args.length) {
    const v = args[k]!.dynamic ? "" : args[k]!.value;
    if (v === "-delete") {
      out.deletes = true;
      k++;
    } else if (FIND_EXECS.has(v)) {
      const words: ShellWord[] = [];
      k++;
      while (k < args.length && !(!args[k]!.dynamic && (args[k]!.value === ";" || args[k]!.value === "+"))) words.push(args[k++]!);
      k++;
      out.execs.push({ dir: v.endsWith("dir"), words });
    } else if (FIND_FILE_ACTIONS.has(v)) {
      if (args[k + 1] !== undefined) out.writes.push(args[k + 1]!);
      k += v === "-fprintf" ? 3 : 2;
    } else k++;
  }
  return out;
}

/** Every NAME=value the command sets for itself or its children: prefix, after wrappers, and export/declare arguments. */
export function assignmentsOf(c: SimpleCommand): Record<string, string> {
  const { env, argv } = unwrap(c);
  const out: Record<string, string> = { ...env };
  if (argv[0] !== undefined && !argv[0].dynamic && DECLARERS.has(argv[0].value)) {
    for (const a of argv.slice(1)) {
      if (ASSIGNMENT.test(a.value)) out[a.value.slice(0, a.value.indexOf("="))] = a.value.slice(a.value.indexOf("=") + 1);
    }
  }
  return out;
}

const MAX_BRACE_EXPANSIONS = 256;

/** Expand the alternatives of the first expandable brace group in `w`; null when over the cap. */
function expandOnce(w: string): string[] | null {
  for (let s = 0; s < w.length; s++) {
    if (w[s] !== "{") continue;
    let depth = 0;
    let end = -1;
    const commas: number[] = [];
    for (let k = s; k < w.length; k++) {
      const ch = w[k]!;
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        end = k;
        break;
      } else if (ch === "," && depth === 1) commas.push(k);
    }
    if (end < 0) continue;
    const inner = w.slice(s + 1, end);
    let alts: string[] | null = null;
    if (commas.length > 0) {
      alts = [];
      let from = s + 1;
      for (const c of [...commas, end]) {
        alts.push(w.slice(from, c));
        from = c + 1;
      }
    } else {
      const num = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(inner);
      const chr = /^([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?\d+))?$/.exec(inner);
      const m = num ?? chr;
      if (m !== null) {
        const a = num !== null ? Number(m[1]) : m[1]!.charCodeAt(0);
        const b = num !== null ? Number(m[2]) : m[2]!.charCodeAt(0);
        const step = Math.abs(Number(m[3] ?? 1));
        if (step === 0) return null;
        if (Math.floor(Math.abs(b - a) / step) + 1 > MAX_BRACE_EXPANSIONS) return null;
        alts = [];
        for (let v = a; a <= b ? v <= b : v >= b; v += a <= b ? step : -step) alts.push(num !== null ? String(v) : String.fromCharCode(v));
      }
    }
    if (alts === null) continue;
    const posts = expandOnce(w.slice(end + 1));
    if (posts === null) return null;
    const out: string[] = [];
    for (const alt of alts) {
      const heads = expandOnce(alt);
      if (heads === null) return null;
      for (const h of heads) {
        for (const t of posts) {
          out.push(w.slice(0, s) + h + t);
          if (out.length > MAX_BRACE_EXPANSIONS) return null;
        }
      }
    }
    return out;
  }
  return [w];
}

/** Brace expansion of one word ({a,b}, {1..3}, {a..c}, nested); null when it would give more than 256 words. */
export function expandBraces(word: string): string[] | null {
  return expandOnce(word);
}

// Flags that take a value, per command (so the value is not mistaken for a path). Short ones may be attached (-ofile) or clustered (-sSLo file).
const VALUE_FLAGS: Readonly<Record<string, readonly string[]>> = {
  cp: ["-S", "--suffix", "-t", "--target-directory"],
  mv: ["-S", "--suffix", "-t", "--target-directory"],
  ln: ["-S", "--suffix", "-t", "--target-directory"],
  install: ["-m", "--mode", "-o", "--owner", "-g", "--group", "-t", "--target-directory"],
  mkdir: ["-m", "--mode"],
  touch: ["-d", "-r", "-t", "--date", "--reference"],
  truncate: ["-s", "--size", "-r", "--reference"],
  rsync: ["--exclude", "--include", "--filter", "-f", "--exclude-from", "--include-from", "-e", "--rsh", "--chmod", "--chown", "--rsync-path", "--log-file", "--backup-dir", "--temp-dir", "-T", "--files-from", "--link-dest"],
  perl: ["-e", "-E", "-I", "-M", "-m"],
  sed: ["-e", "--expression", "-f", "--file", "-l", "--line-length"],
  curl: ["-o", "--output", "-H", "--header", "-d", "--data", "-X", "--request", "-u", "--user", "-A", "--user-agent", "-b", "--cookie", "-c", "--cookie-jar"],
  wget: ["-O", "--output-document", "-P", "--directory-prefix", "--header", "-U", "--user-agent"],
};

interface Split {
  ops: ShellWord[];
  valued: Array<[string, ShellWord]>;
  /** Every flag seen: "-x" for a short letter, "--name" for a long one. */
  flags: Set<string>;
}

function split(name: string, args: readonly ShellWord[]): Split {
  const takes = new Set(VALUE_FLAGS[name] ?? []);
  const ops: ShellWord[] = [];
  const valued: Array<[string, ShellWord]> = [];
  const flags = new Set<string>();
  const suffixAfterI = name === "sed" || name === "perl"; // -i takes the rest of the cluster as a backup suffix
  let flagsDone = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k]!;
    if (!flagsDone && a.value === "--") {
      flagsDone = true;
      continue;
    }
    if (!flagsDone && !a.dynamic && a.value.startsWith("-") && a.value !== "-") {
      if (a.value.startsWith("--")) {
        const eq = a.value.indexOf("=");
        if (eq > 0) {
          flags.add(a.value.slice(0, eq));
          valued.push([a.value.slice(0, eq), { value: a.value.slice(eq + 1), dynamic: a.dynamic }]);
        } else {
          flags.add(a.value);
          if (takes.has(a.value) && args[k + 1] !== undefined) {
            valued.push([a.value, args[k + 1]!]);
            k++;
          }
        }
        continue;
      }
      const cluster = a.value.slice(1);
      for (let p = 0; p < cluster.length; p++) {
        const f = `-${cluster[p]!}`;
        flags.add(f);
        if (takes.has(f)) {
          const rest = cluster.slice(p + 1);
          if (rest !== "") valued.push([f, { value: rest, dynamic: false }]);
          else if (args[k + 1] !== undefined) {
            valued.push([f, args[k + 1]!]);
            k++;
          }
          break;
        }
        if (f === "-i" && suffixAfterI) break;
      }
      continue;
    }
    ops.push(a);
  }
  return { ops, valued, flags };
}

/** BSD `sed -i .bak …` / `sed -i '' …`: the word after a bare -i is the backup suffix, not an operand. */
function dropBsdSuffix(args: readonly ShellWord[]): readonly ShellWord[] {
  const k = args.findIndex((a) => !a.dynamic && a.value === "-i");
  const next = k >= 0 ? args[k + 1] : undefined;
  if (next === undefined || next.dynamic || !(next.value === "" || /^\.[A-Za-z0-9_~.-]+$/.test(next.value))) return args;
  return [...args.slice(0, k + 1), ...args.slice(k + 2)];
}

/** The operands a file command writes (or removes). */
export function writtenBy(name: string, rawArgs: readonly ShellWord[]): ShellWord[] {
  const args = name === "sed" ? dropBsdSuffix(rawArgs) : rawArgs;
  const { ops, valued, flags } = split(name, args);
  const flag = (...names: string[]): ShellWord[] => valued.filter(([f]) => names.includes(f)).map(([, w]) => w);
  switch (name) {
    case "rm":
    case "unlink":
    case "rmdir":
    case "touch":
    case "mkdir":
    case "truncate":
    case "tee":
      return ops;
    case "cp":
    case "ln":
    case "install":
    case "rsync": {
      const target = flag("-t", "--target-directory");
      if (target.length > 0) return target;
      if (name === "install" && (flags.has("-d") || flags.has("--directory"))) return ops;
      if (name === "ln" && ops.length === 1) return [{ value: ops[0]!.dynamic ? ops[0]!.value : basename(ops[0]!.value), dynamic: ops[0]!.dynamic }];
      return ops.length > 1 ? [ops[ops.length - 1]!] : [];
    }
    case "mv":
      return [...ops, ...flag("-t", "--target-directory")];
    case "sed": {
      if (!flags.has("-i") && !flags.has("--in-place")) return [];
      const scripted = valued.some(([f]) => f === "-e" || f === "--expression" || f === "-f" || f === "--file");
      return scripted ? ops : ops.slice(1);
    }
    case "perl": {
      if (!flags.has("-i")) return [];
      const scripted = valued.some(([f]) => f === "-e" || f === "-E");
      return scripted ? ops : ops.slice(1);
    }
    case "dd":
      return ops.filter((o) => o.value.startsWith("of=")).map((o) => ({ value: o.value.slice(3), dynamic: o.dynamic, ...(o.pattern ? { pattern: true as const } : {}) }));
    case "curl":
      return flag("-o", "--output");
    case "wget":
      return flag("-O", "--output-document");
    default:
      return [];
  }
}

/** Where a command runs: `dyn` once a `cd` target could not be resolved (`dir` is then its raw text, `stat` the last literal directory). */
interface Loc {
  readonly dir: string;
  readonly dyn: boolean;
  readonly stat: string;
  /**
   * Item 12: the unnormalized directory text after a physical change of directory (git -C, cd -P, pushd -P), so a path
   * such as `link/..` is resolved through the link by the guard, not as text.
   */
  readonly raw?: string;
}

/** Git global options that take a separate value (besides -C, handled apart). */
const GIT_VALUE_OPTS: ReadonlySet<string> = new Set(["-c", "--namespace", "--exec-path", "--super-prefix", "--config-env"]);

/** A located path, with its unnormalized form only when normalizing changed it. */
function withRaw(path: string, raw: string, dynamic: boolean): { path: string; dynamic: boolean; raw?: string } {
  return raw === path || dynamic ? { path, dynamic } : { path, dynamic, raw };
}

/** Every path a Bash command may write, resolved against `cwd` (and `cd` inside the command). */
export function bashWriteTargets(src: string, cwd: string, home: string = process.env["HOME"] ?? "", exists: (path: string) => boolean = existsSync): { targets: WriteTarget[]; commands: LocatedCommand[]; linkSources: WriteTarget[] } {
  const targets: WriteTarget[] = [];
  const commands: LocatedCommand[] = [];
  /** What `ln` links point at (via "ln-source"): checked apart from the writes, so no link leads into runs/ (Task 9 I1). */
  const linkSources: WriteTarget[] = [];
  const homeLoc: Loc = home === "" ? { dir: "~", dyn: true, stat: cwd } : { dir: home, dyn: false, stat: home };

  const locate = (base: Loc, w: ShellWord): { path: string; dynamic: boolean; raw?: string } => {
    if (w.dynamic) return { path: w.value, dynamic: true };
    const v = w.value;
    if (v === "~") return { path: homeLoc.dir, dynamic: homeLoc.dyn };
    if (v.startsWith("~/")) return withRaw(join(homeLoc.dir, v.slice(2)), `${homeLoc.dir}/${v.slice(2)}`, homeLoc.dyn);
    // A pattern is joined, not normalized: `..` inside a brace group ({a/../..,b}) only means something per expansion.
    if (w.pattern === true && isAbsolute(v)) return { path: v, dynamic: false };
    if (isAbsolute(v)) return withRaw(resolve(v), v, false);
    if (base.dyn) return { path: `${base.dir}/${v}`, dynamic: true };
    if (w.pattern === true) return { path: `${base.dir}/${v}`, dynamic: false };
    return withRaw(resolve(base.dir, v), `${base.raw ?? base.dir}/${v}`, false);
  };
  const pat = (w: ShellWord): { pattern?: true } => (w.pattern === true ? { pattern: true } : {});
  const rawOf = (r: { raw?: string }): { raw?: string } => (r.raw !== undefined ? { raw: r.raw } : {});
  /** `physical`: the change of directory follows links before `..` (item 12), so the raw text is kept for the guard. */
  const moveTo = (base: Loc, w: ShellWord, physical = false): Loc => {
    const r = locate(base, w);
    if (r.dynamic) return { dir: r.path, dyn: true, stat: base.stat };
    const raw = (physical || base.raw !== undefined) && r.raw !== undefined ? r.raw : undefined;
    return raw === undefined ? { dir: r.path, dyn: false, stat: r.path } : { dir: r.path, dyn: false, stat: raw, raw };
  };
  const cd = (base: Loc, args: readonly ShellWord[]): Loc => {
    const dd = args.findIndex((a) => !a.dynamic && a.value === "--");
    const opts = args.slice(0, dd >= 0 ? dd : args.length).filter((a) => !a.dynamic && /^-[LPe@]+$/.test(a.value));
    const d = dd >= 0 ? args[dd + 1] : args.find((a) => a.dynamic || !/^-[LPe@]+$/.test(a.value));
    if (d === undefined) return homeLoc;
    if (!d.dynamic && d.value === "-") return { dir: "-", dyn: true, stat: base.stat };
    // cd -P (and pushd -P) resolve links before `..`; plain cd is logical.
    return moveTo(base, d, opts.some((o) => o.value.includes("P")));
  };

  /** Writes of `git` subcommands that change the working tree. */
  const gitWrites = (base: Loc, args: readonly ShellWord[]): WriteTarget[] => {
    let at = base;
    let k = 0;
    while (k < args.length) {
      const a = args[k]!;
      if (a.dynamic || !a.value.startsWith("-")) break;
      if (a.value === "-C" && args[k + 1] !== undefined) {
        at = moveTo(at, args[k + 1]!, true); // git -C is a chdir(): physical (item 12)
        k += 2;
      } else k += GIT_VALUE_OPTS.has(a.value) ? 2 : 1;
    }
    const sub = args[k]?.value ?? "";
    const rest = args.slice(k + 1);
    const flagText = rest.filter((a) => !a.dynamic && a.value.startsWith("-")).map((a) => a.value);
    const has = (...names: string[]): boolean => flagText.some((f) => names.includes(f));
    const paths = (ws: readonly ShellWord[], via = "git"): WriteTarget[] =>
      ws.map((w) => {
        const r = locate(at, w);
        return { path: r.path, dynamic: r.dynamic, content: null, via, ...pat(w), ...rawOf(r) };
      });
    const everything = (via = "git"): WriteTarget[] => [{ path: at.dir, dynamic: true, content: null, via, ...(at.raw !== undefined ? { raw: at.raw } : {}) }];
    switch (sub) {
      case "checkout": {
        const i = rest.findIndex((a) => !a.dynamic && a.value === "--");
        if (i >= 0) return paths(rest.slice(i + 1));
        const operands = rest.filter((a) => a.dynamic || !a.value.startsWith("-"));
        if (operands.some((a) => !a.dynamic && a.value === ".")) return everything();
        // `git checkout <ref> <path>`: a token that is an existing file is restored; any other is a branch name.
        return paths(operands.filter((a) => !a.dynamic && exists(locate(at, a).path)));
      }
      case "rm": {
        const i = rest.findIndex((a) => !a.dynamic && a.value === "--");
        return paths(i >= 0 ? rest.slice(i + 1) : rest.filter((a) => a.dynamic || !a.value.startsWith("-")), "git-rm");
      }
      case "mv":
        return paths(rest.filter((a) => a.dynamic || !a.value.startsWith("-")), "git-mv");
      case "restore": {
        if (has("--staged", "-S") && !has("--worktree", "-W")) return [];
        const ws: ShellWord[] = [];
        let done = false;
        for (let j = 0; j < rest.length; j++) {
          const a = rest[j]!;
          if (!done && !a.dynamic && a.value === "--") done = true;
          else if (!done && !a.dynamic && (a.value === "-s" || a.value === "--source")) j++;
          else if (done || a.dynamic || !a.value.startsWith("-")) ws.push(a);
        }
        return paths(ws);
      }
      case "apply":
        return has("--check", "--stat", "--numstat", "--summary") ? [] : everything();
      // Task 9 B1: only -x/-X (and stash --all) reach ignored files such as runs/; plain clean and reset --hard do not.
      case "clean": {
        if (flagText.some((f) => f === "--dry-run" || (/^-[a-zA-Z]+$/.test(f) && f.includes("n")))) return [];
        const ignored = flagText.some((f) => /^-[a-zA-Z]+$/.test(f) && /[xX]/.test(f));
        return everything(ignored ? "git-clean-x" : "git-clean");
      }
      case "reset":
        return has("--hard") ? everything("git-reset") : [];
      case "stash": {
        const sub2 = rest.find((a) => a.dynamic || !a.value.startsWith("-"))?.value;
        if (sub2 === "list" || sub2 === "show") return [];
        return everything(flagText.some((f) => f === "--all" || (/^-[a-zA-Z]+$/.test(f) && f.includes("a"))) ? "git-clean-x" : "git");
      }
      default:
        return [];
    }
  };

  const walk = (text: string, start: Loc, depth: number): void => {
    let loc = start;
    let prevContent: string | null = null;
    let prevText: string | null = null;
    const dirStack: Loc[] = [];
    const open: Array<{ id: number; saved: Loc }> = [];
    for (const c of parseBash(text)) {
      // Leaving a ( … ) group restores the directory it was entered from.
      const path = c.scopes ?? [];
      let common = 0;
      while (common < open.length && common < path.length && open[common]!.id === path[common]) common++;
      while (open.length > common) loc = open.pop()!.saved;
      while (open.length < path.length) open.push({ id: path[open.length]!, saved: loc });
      commands.push({ ...c, cwd: loc.stat, ...(loc.dyn ? { cwdDynamic: true as const } : {}), assigned: assignmentsOf(c) });
      const { argv } = unwrap(c);
      const name = argv[0]?.value ?? "";
      const args = argv.slice(1);
      const own = c.heredoc ?? (name === "echo" || name === "printf" ? args.map((a) => a.value).join(" ") : null);
      const content: string | null = own ?? (c.pipe === true && (name === "tee" || name === "cat") ? prevContent : null);
      prevContent = content;
      for (const r of c.redirects) {
        const t = locate(loc, r);
        targets.push({ path: t.path, dynamic: t.dynamic, content, via: ">", ...pat(r), ...rawOf(t) });
      }
      if (name === "cd" || (name === "pushd" && args.some((a) => a.dynamic || !a.value.startsWith("-")))) {
        if (name === "pushd") dirStack.push(loc);
        loc = cd(loc, args);
        continue;
      }
      if (name === "popd") {
        loc = dirStack.pop() ?? loc;
        continue;
      }
      const fed = c.pipe === true ? prevText : null;
      prevText = c.argv.map((w) => w.value).join(" ");
      apply(name, args, loc, content, depth, fed, 0);
    }
  };
  /** The writes of one command, and of the command an `xargs` or a `find -exec` starts (fix round 3, items 4 and 5). */
  const apply = (name: string, args: readonly ShellWord[], loc: Loc, content: string | null, depth: number, fed: string | null, nest: number): void => {
    if (nest > 3) return;
    if (SHELL_NAMES.has(name) && depth < 2) {
      const k = args.findIndex((a) => /^-[a-z]*c$/.test(a.value));
      // `bash -c -- 'script'`: the script follows the end-of-options marker.
      const inner = k < 0 ? undefined : args[k + 1]?.value === "--" ? args[k + 2] : args[k + 1];
      if (inner !== undefined) walk(inner.value, loc, depth + 1);
      return;
    }
    if (name === "git") {
      targets.push(...gitWrites(loc, args));
      return;
    }
    if (name === "xargs") {
      const launched = xargsCommand(args);
      const head = launched[0];
      if (head === undefined || head.dynamic) return;
      const inner = basename(head.value);
      // Operands read from stdin: the guard sees only the text of the stage that feeds xargs.
      if (STDIN_REMOVERS.has(inner)) targets.push({ path: fed ?? "<stdin>", dynamic: true, content: null, via: inner, stdin: true });
      apply(inner, launched.slice(1), loc, null, depth, null, nest + 1);
      return;
    }
    if (name === "find") {
      const parts = findParts(args);
      for (const w of parts.writes) {
        const t = locate(loc, w);
        targets.push({ path: t.path, dynamic: t.dynamic, content: null, via: "find", ...pat(w), ...rawOf(t) });
      }
      for (const e of parts.execs) {
        // `{}` stands for each found path: the start-point rule (guard findProblem) covers those. With -execdir the
        // command runs in each found file's directory, so a relative operand there is not a literal path.
        const words = e.words
          .filter((w) => !w.value.includes("{}"))
          .map((w) => (e.dir && !w.dynamic && !isAbsolute(w.value) ? { value: w.value, dynamic: true } : w));
        const head = e.words[0];
        if (head === undefined || head.dynamic || head.value.includes("{}")) continue;
        apply(basename(head.value), words.slice(1), loc, null, depth, null, nest + 1);
      }
      return;
    }
    const written = writtenBy(name, args);
    for (const w of written) {
      const t = locate(loc, w);
      targets.push({ path: t.path, dynamic: t.dynamic, content: name === "tee" ? content : null, via: name, ...pat(w), ...rawOf(t) });
    }
    if (name === "ln") linkSources.push(...lnSources(loc, args, written));
    if (name === "cp" || name === "rsync") linkSources.push(...copyLinkSources(name, loc, args));
  };
  /** Item 11: cp -l/-s/--link/--symbolic-link sources and rsync --link-dest, checked as ln sources are. */
  const copyLinkSources = (name: "cp" | "rsync", loc: Loc, args: readonly ShellWord[]): WriteTarget[] => {
    const { ops, valued, flags } = split(name, args);
    const via = `${name}-link-source`;
    const out = (base: Loc, w: ShellWord): WriteTarget => {
      const t = locate(base, w);
      return { path: t.path, dynamic: t.dynamic, content: null, via, ...rawOf(t) };
    };
    if (name === "cp") {
      if (![...flags].some((f) => f === "-l" || f === "-s" || f === "--link" || f === "--symbolic-link")) return [];
      const dirFlag = valued.some(([f]) => f === "-t" || f === "--target-directory");
      return (dirFlag ? ops : ops.slice(0, -1)).map((w) => out(loc, w));
    }
    const dirs = valued.filter(([f]) => f === "--link-dest").map(([, w]) => w);
    if (dirs.length === 0) return [];
    // A relative --link-dest is relative to the destination directory; the cwd reading is checked too.
    const dest = ops.length > 1 ? locate(loc, ops[ops.length - 1]!) : null;
    const bases: Loc[] = [loc];
    if (dest !== null) bases.push(dest.dynamic ? { dir: dest.path, dyn: true, stat: loc.stat } : { dir: dest.path, dyn: false, stat: dest.path });
    return dirs.flatMap((w) => (isAbsolute(w.value) || w.dynamic ? [out(loc, w)] : bases.map((b) => out(b, w))));
  };
  /**
   * The sources of `ln`: a symbolic one is relative to the directory the link lands in, a hard one to the cwd. When the
   * last operand exists it may be a directory (the link goes inside) or a file `-f` replaces: both readings are checked.
   */
  const lnSources = (loc: Loc, args: readonly ShellWord[], written: readonly ShellWord[]): WriteTarget[] => {
    const { ops, valued, flags } = split("ln", args);
    const dirFlag = valued.find(([f]) => f === "-t" || f === "--target-directory")?.[1];
    const sources = dirFlag !== undefined ? ops : ops.length === 1 ? ops : ops.slice(0, -1);
    let bases: Loc[] = [loc];
    if (flags.has("-s") || flags.has("--symbolic")) {
      const link = dirFlag ?? (ops.length > 1 ? written[0] : undefined);
      if (link !== undefined) {
        const at = locate(loc, link);
        const asDir = (d: string): Loc => ({ dir: d, dyn: false, stat: d });
        if (at.dynamic) bases = [{ dir: at.path, dyn: true, stat: loc.stat }];
        else if (dirFlag !== undefined || ops.length > 2) bases = [asDir(at.path)];
        else bases = exists(at.path) ? [asDir(at.path), asDir(dirname(at.path))] : [asDir(dirname(at.path))];
      }
    }
    return bases.flatMap((base) =>
      sources.map((w) => {
        const t = locate(base, w);
        return { path: t.path, dynamic: t.dynamic, content: null, via: "ln-source", ...rawOf(t) };
      }),
    );
  };
  walk(src, { dir: cwd, dyn: false, stat: cwd }, 0);
  return { targets, commands, linkSources };
}
