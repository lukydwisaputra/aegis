import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { join } from "node:path";
import { TestTechniqueSchema, TestTypeSchema } from "@qa/contracts";
import { CLI_COMMANDS, OWNER_COMMANDS, OWNER_ONLY, type CliCommand } from "@qa/run-state";
import { isAgentContract, violation, type Model, type Violation } from "../types.js";

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
  const raw = m.aegisConfig["environments"];
  const envs = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  for (const [env, cfg] of Object.entries(envs)) {
    if (cfg === null || typeof cfg !== "object" || Array.isArray(cfg)) continue;
    const names: unknown[] = [];
    for (const field of ["allowedSpecialists", "forbiddenSpecialists"] as const) {
      const list = (cfg as Record<string, unknown>)[field];
      if (list === undefined) continue;
      if (!Array.isArray(list)) {
        out.push(violation("ENV", env, field, "not-a-list", "aegis.config.json", 1, `${field} of ${env} must be a list`));
        continue;
      }
      names.push(...list);
    }
    for (const name of names) {
      if (typeof name === "string" && name !== "*" && !Object.hasOwn(map, name)) {
        out.push(violation("ENV", env, name, "unmapped", "aegis.config.json", 1, `${name} maps to no agent`));
      }
    }
  }
  return out;
}

/** A `{x}` segment (e.g. `environments.{env}.readOnly`) matches any child key. */
const PLACEHOLDER = /^\{[^{}]+\}$/;

function hasKeys(cur: unknown, keys: readonly string[]): boolean {
  if (keys.length === 0) return true;
  if (cur === null || typeof cur !== "object") return false;
  const [k, ...rest] = keys as [string, ...string[]];
  const obj = cur as Record<string, unknown>;
  if (PLACEHOLDER.test(k)) return Object.keys(obj).some((child) => hasKeys(obj[child], rest));
  return Object.hasOwn(obj, k) && hasKeys(obj[k], rest);
}

function hasPath(obj: unknown, dotted: string): boolean {
  return hasKeys(obj, dotted.split("."));
}

function readStructured(root: string, file: string): unknown {
  try {
    const text = readFileSync(join(root, file), "utf-8");
    if (file.endsWith(".json")) return JSON.parse(text);
    if (file.endsWith(".yaml") || file.endsWith(".yml")) return parseYaml(text);
  } catch {
    return undefined;
  }
  return undefined;
}

export function configRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const u of m.units.values()) {
    for (const ref of u.contract?.config ?? []) {
      const [file, key] = ref.split("#") as [string, string | undefined];
      let ok: boolean;
      if (key === undefined) ok = existsSync(join(m.root, file));
      else if (file === "aegis.config.json") ok = hasPath(m.aegisConfig, key);
      else if (file === "thresholds.yaml") ok = hasPath(m.thresholds, key);
      else ok = hasPath(readStructured(m.root, file), key);
      if (!ok) out.push(violation("CONFIG", u.name, ref, "missing", u.file, u.contractLine, `${ref} does not exist`));
    }
  }
  return out;
}

/** Spec §6 AH-10: a worker with an SPV claims its task and submits its work report through the CLI. */
export function handoffRule(m: Model): Violation[] {
  const out: Violation[] = [];
  for (const w of [...m.units.values()].filter(isAgentContract)) {
    const spv = w.contract.reviewedBy;
    if (w.contract.phase === "spv" || typeof spv !== "string") continue;
    for (const cmd of ["task.claim", "work-report.submit"]) {
      if (!w.contract.cli.includes(cmd)) out.push(violation("CLI", w.name, cmd, "handoff-missing", w.file, w.contractLine, `reviewed by ${spv}, so it must claim its task and submit its work report (cli ${cmd})`));
    }
  }
  return out;
}
