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
