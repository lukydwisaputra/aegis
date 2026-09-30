import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RunStateError } from "./errors.js";

export interface AegisSettings {
  profile: "full" | "lite";
  maxSpecialists: number;
  environments: string[];
}

interface RawConfig {
  profile?: unknown;
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
    profile: raw.profile === "lite" ? "lite" : "full",
    maxSpecialists: cap,
    environments: Object.keys(raw.environments ?? {}),
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

export function readRunConfig(root: string): RunConfig {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(join(root, "aegis.config.json"), "utf-8")) as Record<string, unknown>;
  } catch (e) {
    throw new RunStateError("invalid-input", `cannot read aegis.config.json: ${(e as Error).message}`);
  }
  const intake = raw["intake"];
  return {
    targetProjectRoot: typeof raw["targetProjectRoot"] === "string" ? raw["targetProjectRoot"] : "..",
    compliance: stringList(raw["compliance"], "compliance"),
    preCycleHealthCheck: raw["preCycleHealthCheck"] === true,
    intakeSources: stringList(intake !== null && typeof intake === "object" ? (intake as Record<string, unknown>)["sources"] : undefined, "intake.sources"),
  };
}
