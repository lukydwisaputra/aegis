import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { AegisEventSchema } from "@qa/contracts";
import { AgentContractSchema, PipelineSchema, SkillContractSchema } from "./schema.js";
import type { Pipeline } from "./schema.js";
import { violation, type Model, type Section, type Tracked, type Unit, type Violation } from "./types.js";
import { CONTRACT_HEADING, frontmatterLite } from "./markdown.js";

export function extractContract(source: string): { yaml: string; line: number } | "missing" | "duplicate" | "no-fence" {
  const lines = source.split("\n");
  const heads = lines.flatMap((l, i) => (l.trim() === CONTRACT_HEADING ? [i] : []));
  if (heads.length === 0) return "missing";
  if (heads.length > 1) return "duplicate";
  const start = heads[0]!;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (l === "") continue;
    if (l !== "```yaml") return "no-fence";
    const end = lines.findIndex((x, j) => j > i && x.trim() === "```");
    if (end === -1) return "no-fence";
    return { yaml: lines.slice(i + 1, end).join("\n") + "\n", line: i + 2 };
  }
  return "no-fence";
}

export function parseSections(source: string): Section[] {
  const lines = source.split("\n");
  const out: Section[] = [];
  let cur: Section | null = null;
  let fence: string | null = null;
  lines.forEach((l, i) => {
    const f = /^\s*(```|~~~)/.exec(l);
    if (f !== null) fence = fence === null ? f[1]! : fence === f[1] ? null : fence;
    if (fence === null && f === null && l.startsWith("## ")) {
      if (cur) out.push(cur);
      cur = { heading: l.slice(3).trim(), text: "", startLine: i + 1 };
    } else if (cur) {
      cur.text += l + "\n";
    }
  });
  if (cur) out.push(cur);
  return out;
}

function walk(dir: string, match: (p: string) => boolean): string[] {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((e) => {
      const p = join(dir, e);
      try {
        return statSync(p).isDirectory() ? walk(p, match) : match(p) ? [p] : [];
      } catch {
        // broken symlink etc.: still surface files that match so the caller can report them
        return match(p) ? [p] : [];
      }
    });
  } catch {
    return [];
  }
}

/**
 * A file, or a directory holding at least one file somewhere below it. Git does not track empty
 * directories, so an empty one exists only in this checkout and must not count (clean-clone parity).
 * OS metadata files (`.DS_Store`, `Thumbs.db`) are never tracked and do not count as content.
 */
const OS_JUNK = new Set([".DS_Store", "Thumbs.db"]);

export function existsWithContent(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return true;
    return readdirSync(path).some((e) => !OS_JUNK.has(e) && existsWithContent(join(path, e)));
  } catch {
    return false;
  }
}

/** Tracked paths when `root` is the top of a git work tree; null otherwise (spec §7 AH-12). */
export function trackedFiles(root: string, env: NodeJS.ProcessEnv = process.env): Tracked | null {
  try {
    // Inherited GIT_DIR / GIT_WORK_TREE (hooks, `rebase -x`, `bisect run`) would point git at another repo.
    const clean = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("GIT_")));
    const opts = { cwd: root, env: clean, encoding: "utf-8" as const, stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 };
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], opts).trim();
    if (realpathSync(top) !== realpathSync(root)) return null;
    const files = new Set(execFileSync("git", ["ls-files", "-z", "--cached"], opts).split("\0").filter(Boolean));
    const dirs = new Set<string>();
    for (const f of files) {
      const parts = f.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    return { files, dirs };
  } catch {
    return null;
  }
}

/** A tracked file or a directory holding one; the filesystem check when the root is not a git work tree. */
export function pathExists(m: { root: string; tracked: Tracked | null }, rel: string): boolean {
  const p = rel.replace(/^\.\//, "").replace(/\/+$/, "");
  if (m.tracked === null) return existsWithContent(join(m.root, p));
  return m.tracked.files.has(p) || m.tracked.dirs.has(p);
}

function lstatOk(file: string): boolean {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function tryRead(file: string): string | Error {
  try {
    return readFileSync(file, "utf-8");
  } catch (e) {
    return e as Error;
  }
}

function loadUnit(root: string, file: string, kind: "agent" | "skill", name: string, source: string, errors: Violation[]): Unit {
  const rel = relative(root, file);
  const unit: Unit = { kind, name, file: rel, tools: frontmatterLite(source).tools, source, sections: parseSections(source), contract: null, contractLine: 0 };
  const found = extractContract(source);
  if (typeof found === "string") {
    errors.push(violation("CONTRACT", name, "-", found, rel, 1, `contract block ${found}`));
    return unit;
  }
  unit.contractLine = found.line;
  let raw: unknown;
  try {
    raw = parseYaml(found.yaml);
  } catch (e) {
    errors.push(violation("CONTRACT", name, "-", "invalid-yaml", rel, found.line, (e as Error).message));
    return unit;
  }
  const parsed = (kind === "agent" ? AgentContractSchema : SkillContractSchema).safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    errors.push(violation("CONTRACT", name, "-", "invalid", rel, found.line, detail));
    return unit;
  }
  unit.contract = parsed.data;
  return unit;
}

const MATRIX_ROW = /^\|\s*((?:AUD-\d{3}[a-z]?|CO-\d{2}|NEW-\d{2}))\s*\|/;

/** Matrix table rows as [ID, Status]. The Status column is found from each table's `| ID | … |` header; a table without one (carry-overs) counts as open. */
export function matrixRows(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let statusCol = -1;
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) {
      statusCol = -1;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells[0] === "ID") {
      statusCol = cells.indexOf("Status");
      continue;
    }
    const m = MATRIX_ROW.exec(line);
    if (m) out.push([m[1]!, statusCol >= 0 ? (cells[statusCol] ?? "open") : "open"]);
  }
  return out;
}

/** Matrix rows as [ID, owning slice]: the Owner or Slice cell's first token, else the section heading's first word (`## P3 — …` → P3). */
export function matrixOwners(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let section = "";
  let ownerCol = -1;
  for (const line of text.split("\n")) {
    const h = /^## (\S+)/.exec(line);
    if (h !== null) {
      section = h[1]!;
      continue;
    }
    if (!line.startsWith("|")) {
      ownerCol = -1;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells[0] === "ID") {
      ownerCol = cells.findIndex((c) => c === "Owner" || c === "Slice");
      continue;
    }
    const m = MATRIX_ROW.exec(line);
    if (m === null) continue;
    const cell = ownerCol >= 0 ? (cells[ownerCol] ?? "") : "";
    out.push([m[1]!, /^[A-Za-z0-9'-]+/.exec(cell)?.[0] ?? section]);
  }
  return out;
}

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function loadModel(root: string): Model {
  const errors: Violation[] = [];
  const units = new Map<string, Unit>();

  const register = (file: string, kind: "agent" | "skill", fallbackName: string, source: string | Error): string | null => {
    const rel = relative(root, file);
    if (typeof source !== "string") {
      errors.push(violation("CONTRACT", fallbackName, "-", "unreadable", rel, 1, source.message));
      return null;
    }
    const name = kind === "agent" ? frontmatterLite(source).name ?? fallbackName : fallbackName;
    const existing = units.get(name);
    if (existing) {
      errors.push(violation("CONTRACT", name, "-", "duplicate-name", rel, 1, `${name} is also defined in ${existing.file}`));
      return null;
    }
    units.set(name, loadUnit(root, file, kind, name, source, errors));
    return name;
  };

  for (const file of walk(join(root, ".claude", "agents"), (p) => p.endsWith(".md"))) {
    register(file, "agent", basename(file, ".md"), tryRead(file));
  }
  const skillsDir = join(root, ".claude", "skills");
  let skillDirs: string[] = [];
  try {
    skillDirs = existsSync(skillsDir) ? readdirSync(skillsDir) : [];
  } catch {
    skillDirs = [];
  }
  for (const dir of skillDirs) {
    try {
      if (!statSync(join(skillsDir, dir)).isDirectory()) continue; // README.md, .DS_Store: not skill units
    } catch {
      continue; // broken symlink: nothing to load
    }
    const file = join(skillsDir, dir, "SKILL.md");
    const source = tryRead(file);
    if (typeof source !== "string" && (source as NodeJS.ErrnoException).code === "ENOENT" && !lstatOk(file)) continue;
    register(file, "skill", dir, source);
  }

  let pipeline: Pipeline | null = null;
  const pipelineFile = join(root, ".claude", "pipeline.yaml");
  if (!existsSync(pipelineFile)) {
    errors.push(violation("CONTRACT", "pipeline", "-", "missing", ".claude/pipeline.yaml", 1, "pipeline.yaml missing"));
  } else {
    try {
      const parsed = PipelineSchema.safeParse(parseYaml(readFileSync(pipelineFile, "utf-8")));
      if (parsed.success) pipeline = parsed.data;
      else errors.push(violation("CONTRACT", "pipeline", "-", "invalid", ".claude/pipeline.yaml", 1, parsed.error.message));
    } catch (e) {
      errors.push(violation("CONTRACT", "pipeline", "-", "invalid", ".claude/pipeline.yaml", 1, (e as Error).message));
    }
  }

  let thresholds: Record<string, unknown> = {};
  try {
    thresholds = (parseYaml(readFileSync(join(root, "thresholds.yaml"), "utf-8")) ?? {}) as Record<string, unknown>;
  } catch {
    thresholds = {};
  }

  const matrixIds = new Set<string>();
  const matrixStatus = new Map<string, string>();
  const matrixOwner = new Map<string, string>();
  for (const f of walk(join(root, "docs", "superpowers", "specs"), (p) => p.endsWith("-audit-remediation-matrix.md"))) {
    const text = tryRead(f);
    if (typeof text !== "string") continue;
    for (const [id, status] of matrixRows(text)) {
      matrixIds.add(id);
      matrixStatus.set(id, status);
    }
    for (const [id, owner] of matrixOwners(text)) matrixOwner.set(id, owner);
  }

  const declaredEvents = new Set<string>(
    AegisEventSchema.options.map((o) => (o.shape.type as { value: string }).value)
  );

  const tracked = trackedFiles(root);
  const isTracked = (abs: string) => tracked === null || tracked.files.has(relative(root, abs));
  let topDocs: string[] = [];
  try {
    topDocs = readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => join(root, "docs", f));
  } catch {
    topDocs = [];
  }
  const docs = [
    ...walk(join(root, "HANDBOOK"), (p) => p.endsWith(".md")),
    ...["CLAUDE.md", "HANDBOOK.md", "README.md"].map((f) => join(root, f)).filter((f) => existsSync(f)),
    ...topDocs,
  ]
    .filter(isTracked)
    .flatMap((f) => {
      const source = tryRead(f);
      return typeof source !== "string" ? [] : [{ file: relative(root, f), source }];
    });

  return {
    root,
    units,
    tracked,
    pipeline,
    aegisConfig: readJson(join(root, "aegis.config.json")),
    thresholds,
    matrixIds,
    matrixStatus,
    matrixOwner,
    declaredEvents,
    docs,
    loadErrors: errors,
  };
}
