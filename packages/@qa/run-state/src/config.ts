import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPLIANCE_REGULATIONS, isReadOnlyEnvironment, type EnvironmentSpecialistConfig } from "@qa/contracts";
import { RunStateError } from "./errors.js";

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
}

function stringList(value: unknown, key: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new RunStateError("invalid-input", `aegis.config.json#${key} must be a list of strings`);
  }
  return value as string[];
}

/** AUD-051 (T4): Mailpit is the only supported inbox. An absent key is fine; any other value is refused. */
export function assertMailpitAdapter(value: unknown): void {
  if (value !== undefined && value !== "mailpit") {
    throw new RunStateError("invalid-input", `aegis.config.json#emailAdapter must be mailpit (the only supported inbox), found ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
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
  assertMailpitAdapter(raw["emailAdapter"]);
  return {
    targetProjectRoot: typeof raw["targetProjectRoot"] === "string" ? raw["targetProjectRoot"] : "..",
    compliance,
    preCycleHealthCheck: raw["preCycleHealthCheck"] === true,
    intakeSources: stringList(intake !== null && typeof intake === "object" ? (intake as Record<string, unknown>)["sources"] : undefined, "intake.sources"),
  };
}
