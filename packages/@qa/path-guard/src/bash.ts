import { join, resolve } from "node:path";

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

const OPS = ["&&", "||", ";;", "&>>", "&>", ">>", ">|", "<<<", "<<-", "<<", ";", "|", "&", "(", ")", ">", "<", "\n"] as const;
const SEPARATORS: ReadonlySet<string> = new Set(["&&", "||", ";;", ";", "|", "&", "(", ")", "\n"]);
const FILE_REDIRECTS: ReadonlySet<string> = new Set([">", ">>", ">|", "&>", "&>>"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HEREDOC = /(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;

/** Remove here-document bodies from the text (they are data, not commands) and return them in order. */
function extractHeredocs(src: string): { text: string; bodies: string[] } {
  const lines = src.split("\n");
  const kept: string[] = [];
  const bodies: string[] = [];
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]!;
    kept.push(line);
    for (const m of line.matchAll(HEREDOC)) {
      const strip = m[1] === "-";
      const delimiter = m[3]!;
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
        i += op.length + 1; // fd duplication: 2>&1, >&-, <&3
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
  const push = (): void => {
    if (cur.argv.length > 0 || cur.redirects.length > 0) {
      if (depth > 0) cur.depth = depth;
      cmds.push(cur);
    }
    cur = blank();
  };
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]!;
    if (tk.t === "op") {
      if (SEPARATORS.has(tk.op)) {
        push();
        if (tk.op === "(") depth++;
        else if (tk.op === ")") depth = Math.max(0, depth - 1);
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

const WRAPPERS: ReadonlySet<string> = new Set(["env", "sudo", "command", "exec", "time", "nohup", "nice"]);

/** The command behind wrappers (`env A=1 sudo rm x` → rm x), with assignments made after a wrapper merged into env. */
export function unwrap(c: SimpleCommand): { env: Record<string, string>; argv: ShellWord[] } {
  const env: Record<string, string> = { ...c.env };
  let argv = c.argv;
  let wrapped = false;
  for (;;) {
    const head = argv[0];
    if (head === undefined) break;
    if (WRAPPERS.has(head.value)) {
      argv = argv.slice(1);
      wrapped = true;
      continue;
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

// Flags that take the next word as their value, per command (so the value is not mistaken for a path).
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

function split(name: string, args: readonly ShellWord[]): { ops: ShellWord[]; valued: Array<[string, ShellWord]> } {
  const takes = new Set(VALUE_FLAGS[name] ?? []);
  const ops: ShellWord[] = [];
  const valued: Array<[string, ShellWord]> = [];
  let flagsDone = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k]!;
    if (!flagsDone && a.value === "--") {
      flagsDone = true;
      continue;
    }
    if (!flagsDone && !a.dynamic && a.value.startsWith("-") && a.value !== "-") {
      const eq = a.value.indexOf("=");
      if (eq > 0) valued.push([a.value.slice(0, eq), { value: a.value.slice(eq + 1), dynamic: a.dynamic }]);
      else if (takes.has(a.value) && args[k + 1] !== undefined) {
        valued.push([a.value, args[k + 1]!]);
        k++;
      }
      continue;
    }
    ops.push(a);
  }
  return { ops, valued };
}

/** The operands a file command writes (or removes). */
function writtenBy(name: string, args: readonly ShellWord[]): ShellWord[] {
  const { ops, valued } = split(name, args);
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
      return ops.length > 1 ? [ops[ops.length - 1]!] : [];
    }
    case "mv":
      return [...ops, ...flag("-t", "--target-directory")];
    case "sed": {
      if (!args.some((a) => /^-[a-zA-Z]*i/.test(a.value) || a.value.startsWith("--in-place"))) return [];
      const scripted = valued.some(([f]) => f === "-e" || f === "--expression" || f === "-f" || f === "--file");
      const rest = ops.filter((o) => o.value !== ""); // macOS `sed -i ''`
      return scripted ? rest : rest.slice(1);
    }
    case "perl": {
      if (!args.some((a) => /^-[a-zA-Z]*i/.test(a.value) && !a.value.startsWith("-e") && !a.value.startsWith("-E"))) return [];
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

/** Every path a Bash command may write, resolved against `cwd` (and `cd` inside the command). */
export function bashWriteTargets(src: string, cwd: string, home: string = process.env["HOME"] ?? ""): { targets: WriteTarget[]; commands: LocatedCommand[] } {
  const targets: WriteTarget[] = [];
  const commands: LocatedCommand[] = [];
  const walk = (text: string, startCwd: string, depth: number): void => {
    let dir = startCwd;
    const saved: string[] = [];
    const abs = (w: ShellWord): string => (w.dynamic ? w.value : w.value.startsWith("~/") ? join(home, w.value.slice(2)) : resolve(dir, w.value));
    for (const c of parseBash(text)) {
      const level = c.depth ?? 0;
      while (saved.length > level) dir = saved.pop()!;
      while (saved.length < level) saved.push(dir);
      commands.push({ ...c, cwd: dir });
      const { argv } = unwrap(c);
      const name = argv[0]?.value ?? "";
      const args = argv.slice(1);
      const content = c.heredoc ?? (name === "echo" || name === "printf" ? args.map((a) => a.value).join(" ") : null);
      for (const r of c.redirects) targets.push({ path: abs(r), dynamic: r.dynamic, content, via: ">" });
      if (name === "cd") {
        const d = args[0];
        if (d !== undefined && !d.dynamic) dir = abs(d);
        continue;
      }
      if ((name === "bash" || name === "sh" || name === "zsh") && depth < 2) {
        const k = args.findIndex((a) => /^-[a-z]*c$/.test(a.value));
        const inner = k >= 0 ? args[k + 1] : undefined;
        if (inner !== undefined) walk(inner.value, dir, depth + 1);
        continue;
      }
      for (const w of writtenBy(name, args)) targets.push({ path: abs(w), dynamic: w.dynamic, content: null, via: name });
    }
  };
  walk(src, cwd, 0);
  return { targets, commands };
}
