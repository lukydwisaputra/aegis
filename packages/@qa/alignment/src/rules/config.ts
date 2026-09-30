import { existsSync } from "node:fs";
import { join } from "node:path";
import { TestTechniqueSchema, TestTypeSchema } from "@qa/contracts";
import { CLI_COMMANDS, OWNER_COMMANDS, OWNER_ONLY, type CliCommand } from "@qa/run-state";
import { violation, type Model, type Violation } from "../types.js";

const COMMANDS: ReadonlySet<string> = new Set(CLI_COMMANDS);

export function cliRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of m.units.values()) {
    const c = u.contract;
    if (c === null) continue;
    for (const cmd of c.cli) {
      if (!COMMANDS.has(cmd)) {
        out.push(violation("CLI", u.name, cmd, "unknown", u.file, u.contractLine, `${cmd} is not an aegis command`));
        continue;
      }
      if (u.kind === "agent" && OWNER_ONLY.has(cmd as CliCommand)) {
        out.push(violation("CLI", u.name, cmd, "owner-only", u.file, u.contractLine, `${cmd} is owner-only`));
      }
      if (u.kind === "skill" && !OWNER_COMMANDS.has(cmd as CliCommand)) {
        out.push(violation("CLI", u.name, cmd, "agent-only", u.file, u.contractLine, `skills run as owner; ${cmd} is agent-only`));
      }
    }
    if (u.kind === "agent" && (c.cli.length > 0 || c.runs.length > 0) && !u.tools.includes("Bash")) {
      out.push(violation("CLI", u.name, "tools", "no-bash", u.file, u.contractLine, "runs commands but frontmatter tools lack Bash"));
    }
  }
  return out;
}

export function routeRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const r = m.pipeline?.routing;
  if (r === undefined) return out;
  const types = new Set<string>(TestTypeSchema.options);
  const techniques = new Set<string>(TestTechniqueSchema.options);
  const noSpecialist = new Set(r.techniqueWithoutSpecialist);
  const file = ".claude/pipeline.yaml";
  for (const v of r.designerEmits.testType) {
    if (!types.has(v)) out.push(violation("ROUTE", "testType", v, "not-in-schema", file, 1, `${v} is not a TestType`));
    else if (r.byType[v] === undefined) out.push(violation("ROUTE", "testType", v, "unrouted", file, 1, `no specialist for ${v}`));
  }
  for (const v of r.designerEmits.testTechnique) {
    if (!techniques.has(v)) out.push(violation("ROUTE", "testTechnique", v, "not-in-schema", file, 1, `${v} is not a TestTechnique`));
    else if (r.byTechnique[v] === undefined && !noSpecialist.has(v)) out.push(violation("ROUTE", "testTechnique", v, "unrouted", file, 1, `no specialist for ${v}`));
  }
  const emitted = new Set(r.designerEmits.testTechnique);
  for (const v of techniques) {
    if (!emitted.has(v) && r.byTechnique[v] === undefined && !noSpecialist.has(v)) {
      out.push(violation("ROUTE", "testTechnique", v, "schema-unrouted", file, 1, `${v} is in the schema but never routed`));
    }
  }
  for (const target of new Set([...Object.values(r.byType), ...Object.values(r.byTechnique)])) {
    if (!m.units.has(target)) out.push(violation("ROUTE", "target", target, "missing", file, 1, `route target ${target} does not exist`));
  }
  return out;
}

export function envRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const map = m.pipeline?.envSpecialists ?? {};
  const envs = (m.aegisConfig["environments"] ?? {}) as Record<string, { allowedSpecialists?: string[]; forbiddenSpecialists?: string[] }>;
  for (const [env, cfg] of Object.entries(envs)) {
    for (const name of [...(cfg.allowedSpecialists ?? []), ...(cfg.forbiddenSpecialists ?? [])]) {
      if (name !== "*" && map[name] === undefined) {
        out.push(violation("ENV", env, name, "unmapped", "aegis.config.json", 1, `${name} maps to no agent`));
      }
    }
  }
  return out;
}

function hasPath(obj: unknown, dotted: string): boolean {
  let cur: unknown = obj;
  for (const k of dotted.split(".")) {
    if (cur === null || typeof cur !== "object" || !(k in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[k];
  }
  return true;
}

export function configRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of m.units.values()) {
    for (const ref of u.contract?.config ?? []) {
      const [file, key] = ref.split("#") as [string, string | undefined];
      let ok: boolean;
      if (key !== undefined && file === "aegis.config.json") ok = hasPath(m.aegisConfig, key);
      else if (key !== undefined && file === "thresholds.yaml") ok = hasPath(m.thresholds, key);
      else ok = existsSync(join(m.root, file));
      if (!ok) out.push(violation("CONFIG", u.name, ref, "missing", u.file, u.contractLine, `${ref} does not exist`));
    }
  }
  return out;
}
