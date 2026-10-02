import { basename, isAbsolute, join, resolve } from "node:path";

/**
 * Best-effort Bash write-target parser for the PreToolUse hook (P0 spec §4.2 H1, §10 risk). It sees redirections, the
 * common file commands, heredocs, `cd` and `bash -c`; it does not see writes made inside interpreters (`node -e`, …).
 */

/** One shell word, quotes removed. `dynamic` when it holds an expansion ($VAR, $(…), `…`) the hook cannot resolve. */
export interface ShellWord {
  readonly value: string;
  readonly dynamic: boolean;
}

export interface SimpleCommand {
  /** Leading NAME=value assignments (e.g. AEGIS_AGENT=qa-ui-specialist). */
  env: Record<string, string>;
  argv: ShellWord[];
  /** Targets of >, >>, >|, &>, &>> (fd duplications such as 2>&1 are not targets). */
  redirects: ShellWord[];
  /** Body of a here-document fed to this command. */
  heredoc: string | null;
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
}

/** A simple command with the directory it runs in (after any earlier `cd`). */
export interface LocatedCommand extends SimpleCommand {
  readonly cwd: string;
}

type Tok = { t: "w"; w: ShellWord } | { t: "op"; op: string };

const OPS = ["&&", "||", ";;", "&>>", "&>", ">>", ">|", "<<<", "<<-", "<<", ";", "|&", "|", "&", "(", ")", ">", "<", "\n"] as const;
const SEPARATORS: ReadonlySet<string> = new Set(["&&", "||", ";;", ";", "|&", "|", "&", "(", ")", "\n"]);
const FILE_REDIRECTS: ReadonlySet<string> = new Set([">", ">>", ">|", "&>", "&>>"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HEREDOC_DELIM = /(-?)\s*\\?(['"]?)([^\s;&|<>()'"]+)\2/y;

/** The here-document markers on one line, in order; quoted or commented `<<` is not one. */
function heredocMarkers(line: string): Array<{ strip: boolean; delimiter: string }> {
  const out: Array<{ strip: boolean; delimiter: string }> = [];
  let i = 0;
  let wordStart = true;
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
    } else if (c === "#" && wordStart) {
      break;
    } else if (c === "<" && line[i + 1] === "<" && line[i + 2] !== "<" && line[i - 1] !== "<") {
      HEREDOC_DELIM.lastIndex = i + 2;
      const m = HEREDOC_DELIM.exec(line);
      if (m !== null) {
        out.push({ strip: m[1] === "-", delimiter: m[3]! });
        i = HEREDOC_DELIM.lastIndex;
      } else i += 2;
      wordStart = false;
    } else {
      wordStart = c === " " || c === "\t" || c === ";" || c === "|" || c === "&" || c === "(" || c === ")";
      i++;
    }
  }
  return out;
}

/** Remove here-document bodies from the text (they are data, not commands) and return them in order. */
function extractHeredocs(src: string): { text: string; bodies: string[] } {
  const lines = src.split("\n");
  const kept: string[] = [];
  const bodies: string[] = [];
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]!;
    kept.push(line);
    for (const { strip, delimiter } of heredocMarkers(line)) {
      const body: string[] = [];
      k++;
      while (k < lines.length && (strip ? lines[k]!.replace(/^\t+/, "") : lines[k]) !== delimiter) {
        body.push(lines[k]!);
        k++;
      }
      bodies.push(body.join("\n"));
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

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let cur = "";
  let dynamic = false;
  let inWord = false;
  const flush = (): void => {
    if (inWord) out.push({ t: "w", w: { value: cur, dynamic } });
    cur = "";
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
      inWord = true; // ANSI-C quoting: literal up to the closing unescaped quote
      i += 2;
      while (i < src.length && src[i] !== "'") {
        if (src[i] === "\\" && i + 1 < src.length) {
          cur += src[i + 1];
          i += 2;
        } else {
          cur += src[i];
          i++;
        }
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
  const push = (): void => {
    if (cur.argv.length > 0 || cur.redirects.length > 0 || cur.heredoc !== null) {
      if (depth > 0) cur.depth = depth;
      if (scopes.length > 0) cur.scopes = [...scopes];
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
        push();
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
      else if (tk.op === "<<" || tk.op === "<<-") cur.heredoc = bodies[body++] ?? "";
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

// Flags that take a value, per command (so the value is not mistaken for a path). Short ones may be attached (-ofile) or clustered (-sSLo file).
const VALUE_FLAGS: Readonly<Record<string, readonly string[]>> = {
  cp: ["-S", "--suffix", "-t", "--target-directory"],
  mv: ["-S", "--suffix", "-t", "--target-directory"],
  ln: ["-S", "--suffix", "-t", "--target-directory"],
  install: ["-m", "--mode", "-o", "--owner", "-g", "--group", "-t", "--target-directory"],
  mkdir: ["-m", "--mode"],
  touch: ["-d", "-r", "-t", "--date", "--reference"],
  truncate: ["-s", "--size", "-r", "--reference"],
  rsync: ["--exclude", "--include", "--filter", "-f", "--exclude-from", "--include-from", "-e", "--rsh", "--chmod", "--chown", "--rsync-path", "--log-file", "--backup-dir", "--temp-dir", "-T", "--files-from"],
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
function writtenBy(name: string, rawArgs: readonly ShellWord[]): ShellWord[] {
  const args = name === "sed" ? dropBsdSuffix(rawArgs) : rawArgs;
  const { ops, valued, flags } = split(name, args);
  const flag = (...names: string[]): ShellWord[] => valued.filter(([f]) => names.includes(f)).map(([, w]) => w);
  switch (name) {
    case "rm":
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
      return ops.filter((o) => o.value.startsWith("of=")).map((o) => ({ value: o.value.slice(3), dynamic: o.dynamic }));
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
}

/** Git global options that take a separate value (besides -C, handled apart). */
const GIT_VALUE_OPTS: ReadonlySet<string> = new Set(["-c", "--namespace", "--exec-path", "--super-prefix", "--config-env"]);

/** Every path a Bash command may write, resolved against `cwd` (and `cd` inside the command). */
export function bashWriteTargets(src: string, cwd: string, home: string = process.env["HOME"] ?? ""): { targets: WriteTarget[]; commands: LocatedCommand[] } {
  const targets: WriteTarget[] = [];
  const commands: LocatedCommand[] = [];
  const homeLoc: Loc = home === "" ? { dir: "~", dyn: true, stat: cwd } : { dir: home, dyn: false, stat: home };

  const locate = (base: Loc, w: ShellWord): { path: string; dynamic: boolean } => {
    if (w.dynamic) return { path: w.value, dynamic: true };
    const v = w.value;
    if (v === "~") return { path: homeLoc.dir, dynamic: homeLoc.dyn };
    if (v.startsWith("~/")) return { path: join(homeLoc.dir, v.slice(2)), dynamic: homeLoc.dyn };
    if (isAbsolute(v)) return { path: resolve(v), dynamic: false };
    if (base.dyn) return { path: `${base.dir}/${v}`, dynamic: true };
    return { path: resolve(base.dir, v), dynamic: false };
  };
  const moveTo = (base: Loc, w: ShellWord): Loc => {
    const r = locate(base, w);
    return { dir: r.path, dyn: r.dynamic, stat: r.dynamic ? base.stat : r.path };
  };
  const cd = (base: Loc, args: readonly ShellWord[]): Loc => {
    const d = args.find((a) => a.dynamic || !/^-[LPe@]+$/.test(a.value));
    if (d === undefined) return homeLoc;
    if (!d.dynamic && d.value === "-") return { dir: "-", dyn: true, stat: base.stat };
    return moveTo(base, d);
  };

  /** Writes of `git` subcommands that change the working tree. */
  const gitWrites = (base: Loc, args: readonly ShellWord[]): WriteTarget[] => {
    let at = base;
    let k = 0;
    while (k < args.length) {
      const a = args[k]!;
      if (a.dynamic || !a.value.startsWith("-")) break;
      if (a.value === "-C" && args[k + 1] !== undefined) {
        at = moveTo(at, args[k + 1]!);
        k += 2;
      } else k += GIT_VALUE_OPTS.has(a.value) ? 2 : 1;
    }
    const sub = args[k]?.value ?? "";
    const rest = args.slice(k + 1);
    const flagText = rest.filter((a) => !a.dynamic && a.value.startsWith("-")).map((a) => a.value);
    const has = (...names: string[]): boolean => flagText.some((f) => names.includes(f));
    const paths = (ws: readonly ShellWord[]): WriteTarget[] =>
      ws.map((w) => {
        const r = locate(at, w);
        return { path: r.path, dynamic: r.dynamic, content: null, via: "git" };
      });
    const everything = (): WriteTarget[] => [{ path: at.dir, dynamic: true, content: null, via: "git" }];
    switch (sub) {
      case "checkout": {
        const i = rest.findIndex((a) => !a.dynamic && a.value === "--");
        return i >= 0 ? paths(rest.slice(i + 1)) : [];
      }
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
      case "clean":
        return flagText.some((f) => f === "--dry-run" || (/^-[a-zA-Z]+$/.test(f) && f.includes("n"))) ? [] : everything();
      case "reset":
        return has("--hard") ? everything() : [];
      case "stash": {
        const sub2 = rest.find((a) => a.dynamic || !a.value.startsWith("-"))?.value;
        return sub2 === "list" || sub2 === "show" ? [] : everything();
      }
      default:
        return [];
    }
  };

  const walk = (text: string, start: Loc, depth: number): void => {
    let loc = start;
    let prevContent: string | null = null;
    const open: Array<{ id: number; saved: Loc }> = [];
    for (const c of parseBash(text)) {
      // Leaving a ( … ) group restores the directory it was entered from.
      const path = c.scopes ?? [];
      let common = 0;
      while (common < open.length && common < path.length && open[common]!.id === path[common]) common++;
      while (open.length > common) loc = open.pop()!.saved;
      while (open.length < path.length) open.push({ id: path[open.length]!, saved: loc });
      commands.push({ ...c, cwd: loc.stat });
      const { argv } = unwrap(c);
      const name = argv[0]?.value ?? "";
      const args = argv.slice(1);
      const own = c.heredoc ?? (name === "echo" || name === "printf" ? args.map((a) => a.value).join(" ") : null);
      const content: string | null = own ?? (c.pipe === true && (name === "tee" || name === "cat") ? prevContent : null);
      prevContent = content;
      for (const r of c.redirects) {
        const t = locate(loc, r);
        targets.push({ path: t.path, dynamic: t.dynamic, content, via: ">" });
      }
      if (name === "cd" || (name === "pushd" && args.some((a) => a.dynamic || !a.value.startsWith("-")))) {
        loc = cd(loc, args);
        continue;
      }
      if ((name === "bash" || name === "sh" || name === "zsh") && depth < 2) {
        const k = args.findIndex((a) => /^-[a-z]*c$/.test(a.value));
        const inner = k >= 0 ? args[k + 1] : undefined;
        if (inner !== undefined) walk(inner.value, loc, depth + 1);
        continue;
      }
      if (name === "git") {
        targets.push(...gitWrites(loc, args));
        continue;
      }
      for (const w of writtenBy(name, args)) {
        const t = locate(loc, w);
        targets.push({ path: t.path, dynamic: t.dynamic, content: name === "tee" ? content : null, via: name });
      }
    }
  };
  walk(src, { dir: cwd, dyn: false, stat: cwd }, 0);
  return { targets, commands };
}
