import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { AegisEventSchema } from "@qa/contracts";
import { AgentContractSchema, PipelineSchema, SkillContractSchema } from "./schema.js";
import type { Pipeline } from "./schema.js";
import { violation, type Model, type Section, type Unit, type Violation } from "./types.js";

export const CONTRACT_HEADING = "## Contract (machine-checked)";

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
  lines.forEach((l, i) => {
    if (l.startsWith("## ")) {
      if (cur) out.push(cur);
      cur = { heading: l.slice(3).trim(), text: "", startLine: i + 1 };
    } else if (cur) {
      cur.text += l + "\n";
    }
  });
  if (cur) out.push(cur);
  return out;
}

export function frontmatterLite(source: string): { name?: string; tools: string[] } {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(source);
  const block = m?.[1] ?? "";
  const name = /^name:\s*(.+)$/m.exec(block)?.[1]?.trim();
  const tools = /^tools:\s*\[(.*)\]\s*$/m.exec(block)?.[1];
  return {
    ...(name !== undefined ? { name } : {}),
    tools: tools === undefined ? [] : tools.split(",").map((t) => t.trim()).filter(Boolean),
  };
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
  const skillAliases = new Set<string>();

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
    if (typeof source !== "string" && !existsSync(join(skillsDir, dir))) continue;
    if (typeof source !== "string" && (source as NodeJS.ErrnoException).code === "ENOENT" && !lstatOk(file)) continue;
    if (register(file, "skill", dir, source) === null) continue;
    skillAliases.add(dir);
    const fmName = frontmatterLite(source as string).name;
    if (fmName) skillAliases.add(fmName);
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
  for (const f of walk(join(root, "docs", "superpowers", "specs"), (p) => p.endsWith("-audit-remediation-matrix.md"))) {
    const text = tryRead(f);
    if (typeof text !== "string") continue;
    for (const [id, status] of matrixRows(text)) {
      matrixIds.add(id);
      matrixStatus.set(id, status);
    }
  }

  const declaredEvents = new Set<string>(
    AegisEventSchema.options.map((o) => (o.shape.type as { value: string }).value)
  );

  const docs = [
    ...walk(join(root, "HANDBOOK"), (p) => p.endsWith(".md")),
    ...["CLAUDE.md", "README.md"].map((f) => join(root, f)).filter((f) => existsSync(f)),
  ].flatMap((f) => {
    const source = tryRead(f);
    return typeof source !== "string" ? [] : [{ file: relative(root, f), source }];
  });

  return {
    root,
    units,
    skillAliases,
    pipeline,
    aegisConfig: readJson(join(root, "aegis.config.json")),
    thresholds,
    matrixIds,
    matrixStatus,
    declaredEvents,
    docs,
    loadErrors: errors,
  };
}
