import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPLIANCE_REGULATIONS, isReadOnlyEnvironment, type EnvironmentSpecialistConfig } from "@qa/contracts";
import { RunStateError } from "./errors.js";
import { assertMessagingConfig, type MessagingConfig } from "./messaging.js";

export interface AegisSettings {
  maxSpecialists: number;
  environments: string[];
  /** Environments with `readOnly: true` or `mutating: false`. */
  readOnlyEnvironments: string[];
}

interface RawConfig {
  parallelism?: { maxSpecialists?: unknown };
  environments?: Record<string, unknown>;
}

export function readSettings(root: string): AegisSettings {
  let raw: RawConfig;
  try {
    raw = JSON.parse(readFileSync(join(root, "aegis.config.json"), "utf-8")) as RawConfig;
  } catch (e) {
    throw new RunStateError("invalid-input", `cannot read aegis.config.json: ${(e as Error).message}`);
  }
  const cap = raw.parallelism?.maxSpecialists;
  if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 1) {
    throw new RunStateError("invalid-input", "aegis.config.json#parallelism.maxSpecialists must be a positive integer");
  }
  return {
    maxSpecialists: cap,
    environments: Object.keys(raw.environments ?? {}),
    readOnlyEnvironments: Object.entries(raw.environments ?? {})
      .filter(([, env]) => env !== null && typeof env === "object" && isReadOnlyEnvironment(env as EnvironmentSpecialistConfig))
      .map(([name]) => name),
  };
}

export interface RunConfig {
  targetProjectRoot: string;
  compliance: string[];
  preCycleHealthCheck: boolean;
  intakeSources: string[];
  intakeReferences: IntakeReference[];
  /** NEW-07: aegis.config.json#messaging, null when absent. */
  messaging: MessagingConfig | null;
}

function stringList(value: unknown, key: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new RunStateError("invalid-input", `aegis.config.json#${key} must be a list of strings`);
  }
  return value as string[];
}

/**
 * A pinned repository outside the target (a shared wiki, a baseline spec) whose files are copied into
 * `intake/references/{name}/` at run create. `root` is absolute or relative to the aegis root; `sha`, when set,
 * must equal the checkout's HEAD or the run is refused.
 */
export interface IntakeReference {
  name: string;
  root: string;
  sha?: string;
  sources: string[];
}

const REFERENCE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;

function intakeReferences(value: unknown): IntakeReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new RunStateError("invalid-input", "aegis.config.json#intake.references must be a list");
  const seen = new Set<string>();
  return value.map((entry, i) => {
    const key = `intake.references[${i}]`;
    if (entry === null || typeof entry !== "object") throw new RunStateError("invalid-input", `aegis.config.json#${key} must be an object`);
    const e = entry as Record<string, unknown>;
    if (typeof e["name"] !== "string" || !REFERENCE_NAME.test(e["name"])) {
      throw new RunStateError("invalid-input", `aegis.config.json#${key}.name must be lowercase letters, digits and hyphens`);
    }
    if (seen.has(e["name"])) throw new RunStateError("invalid-input", `aegis.config.json#${key}.name ${e["name"]} is listed twice`);
    seen.add(e["name"]);
    if (typeof e["root"] !== "string" || e["root"].trim() === "") throw new RunStateError("invalid-input", `aegis.config.json#${key}.root must be a path`);
    if (e["sha"] !== undefined && (typeof e["sha"] !== "string" || !GIT_SHA.test(e["sha"]))) {
      throw new RunStateError("invalid-input", `aegis.config.json#${key}.sha must be a full 40-character commit sha`);
    }
    const sources = stringList(e["sources"], `${key}.sources`);
    if (sources.length === 0) throw new RunStateError("invalid-input", `aegis.config.json#${key}.sources must list at least one glob`);
    return { name: e["name"], root: e["root"], ...(e["sha"] !== undefined ? { sha: e["sha"] as string } : {}), sources };
  });
}

export function readRunConfig(root: string): RunConfig {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(join(root, "aegis.config.json"), "utf-8")) as Record<string, unknown>;
  } catch (e) {
    throw new RunStateError("invalid-input", `cannot read aegis.config.json: ${(e as Error).message}`);
  }
  const intake = raw["intake"];
  // Compliance is on by default (AUD-055): an absent key means all six; only an explicit [] turns the phase off.
  const compliance = raw["compliance"] === undefined ? [...COMPLIANCE_REGULATIONS] : stringList(raw["compliance"], "compliance");
  // A regulation with no qa-compliance-<id> agent could never get a task, so the Compliance barrier would never pass.
  const known = new Set<string>(COMPLIANCE_REGULATIONS);
  const unknown = compliance.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new RunStateError("invalid-input", `aegis.config.json#compliance lists unknown regulation(s) ${unknown.join(", ")}; known: ${COMPLIANCE_REGULATIONS.join(", ")}`);
  }
  const messaging = assertMessagingConfig(raw);
  return {
    targetProjectRoot: typeof raw["targetProjectRoot"] === "string" ? raw["targetProjectRoot"] : "..",
    compliance,
    preCycleHealthCheck: raw["preCycleHealthCheck"] === true,
    intakeSources: stringList(intake !== null && typeof intake === "object" ? (intake as Record<string, unknown>)["sources"] : undefined, "intake.sources"),
    intakeReferences: intakeReferences(intake !== null && typeof intake === "object" ? (intake as Record<string, unknown>)["references"] : undefined),
    messaging,
  };
}
