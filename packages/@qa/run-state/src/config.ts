import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPLIANCE_REGULATIONS, isReadOnlyEnvironment, localPortsOf, type EnvironmentSpecialistConfig } from "@qa/contracts";
import { RunStateError } from "./errors.js";
import { assertMessagingConfig, type MessagingConfig } from "./messaging.js";

/** How the executor dispatches specialists (aegis.config.json#execution.dispatchMode); absent means batch. */
export type DispatchMode = "batch" | "continuous";
export const DISPATCH_MODES: readonly DispatchMode[] = ["batch", "continuous"];

export interface AegisSettings {
  maxSpecialists: number;
  /** batch (default): one wave up to the cap, its SPVs once the whole wave returned, then the next wave. continuous: refill a slot as it frees, review alongside. */
  dispatchMode: DispatchMode;
  environments: string[];
  /** Environments with `readOnly: true` or `mutating: false`. */
  readOnlyEnvironments: string[];
}

interface RawConfig {
  parallelism?: { maxSpecialists?: unknown };
  execution?: unknown;
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
    dispatchMode: dispatchModeOf(raw.execution),
    environments: Object.keys(raw.environments ?? {}),
    readOnlyEnvironments: Object.entries(raw.environments ?? {})
      .filter(([, env]) => env !== null && typeof env === "object" && isReadOnlyEnvironment(env as EnvironmentSpecialistConfig))
      .map(([name]) => name),
  };
}

/** aegis.config.json#execution.dispatchMode: absent (or no execution block) is batch; any other value is refused by name. */
function dispatchModeOf(execution: unknown): DispatchMode {
  if (execution === undefined) return "batch";
  if (execution === null || typeof execution !== "object" || Array.isArray(execution)) {
    throw new RunStateError("invalid-input", "aegis.config.json#execution must be an object, for example {\"dispatchMode\": \"batch\"}");
  }
  const mode = (execution as { dispatchMode?: unknown }).dispatchMode;
  if (mode === undefined) return "batch";
  if (typeof mode === "string" && (DISPATCH_MODES as readonly string[]).includes(mode)) return mode as DispatchMode;
  throw new RunStateError("invalid-input", `aegis.config.json#execution.dispatchMode must be "batch" (the default) or "continuous", not ${JSON.stringify(mode)}`);
}

export interface RunConfig {
  targetProjectRoot: string;
  compliance: string[];
  preCycleHealthCheck: boolean;
  intakeSources: string[];
  intakeReferences: IntakeReference[];
  /** NEW-07: aegis.config.json#messaging, null when absent. */
  messaging: MessagingConfig | null;
  /** Project rules for `aegis lint` of the customer-facing run files. */
  reportRules: ReportRules;
  /** aegis.config.json#testing.manualBudgetPercent, null when absent. */
  manualBudgetPercent: number | null;
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

export interface ReportRuleSpec {
  id: string;
  pattern: string;
  flags?: string;
  message: string;
  severity?: "error" | "warning";
}

export interface ReportRules {
  /** Rules added to the defaults. */
  extend: ReportRuleSpec[];
  /** Default rule ids switched off. */
  disable: string[];
  /** Phrases the wording rules never report: a phrase silences a match only when its span overlaps the match (case-insensitive), never a different finding beside it. */
  allow: string[];
  /** The project's local server ports: a colon-prefixed `:N` is tooling wording (never a bare number); [] when absent. */
  localPorts: number[];
  pii: {
    syntheticEmailDomains: string[];
    syntheticNamePrefixes: string[];
    syntheticPhonePatterns: string[];
    /** Exact fake values the project uses on purpose (compared case-insensitively, spaces and hyphens ignored): never reported by a pii rule. */
    syntheticValues: string[];
  };
}

export const DEFAULT_SYNTHETIC_NAME_PREFIXES = ["QA", "Test", "E2E", "Dummy", "Sample"];

function compiles(pattern: string, flags: string): boolean {
  try {
    new RegExp(pattern, flags);
    return true;
  } catch {
    return false;
  }
}

function reportRules(value: unknown): ReportRules {
  if (value !== undefined && (value === null || typeof value !== "object" || Array.isArray(value))) {
    throw new RunStateError("invalid-input", "aegis.config.json#reportRules must be an object");
  }
  const r = (value ?? {}) as Record<string, unknown>;
  let extend: ReportRuleSpec[] = [];
  if (r["extend"] !== undefined) {
    if (!Array.isArray(r["extend"])) throw new RunStateError("invalid-input", "aegis.config.json#reportRules.extend must be a list");
    const seen = new Set<string>();
    extend = r["extend"].map((entry, i) => {
      const key = `reportRules.extend[${i}]`;
      if (entry === null || typeof entry !== "object") throw new RunStateError("invalid-input", `aegis.config.json#${key} must be an object`);
      const e = entry as Record<string, unknown>;
      if (typeof e["id"] !== "string" || e["id"].trim() === "") throw new RunStateError("invalid-input", `aegis.config.json#${key}.id must be a non-empty string`);
      if (seen.has(e["id"])) throw new RunStateError("invalid-input", `aegis.config.json#reportRules.extend: id "${e["id"]}" is listed twice`);
      seen.add(e["id"]);
      if (typeof e["pattern"] !== "string") throw new RunStateError("invalid-input", `aegis.config.json#${key}.pattern must be a string`);
      if (e["flags"] !== undefined && typeof e["flags"] !== "string") throw new RunStateError("invalid-input", `aegis.config.json#${key}.flags must be a string`);
      const flags = typeof e["flags"] === "string" ? e["flags"] : undefined;
      if (!compiles(e["pattern"], flags ?? "i")) {
        throw new RunStateError("invalid-input", `aegis.config.json#${key}.pattern is not a valid regular expression`);
      }
      if (typeof e["message"] !== "string") throw new RunStateError("invalid-input", `aegis.config.json#${key}.message must be a string`);
      if (e["severity"] !== undefined && e["severity"] !== "error" && e["severity"] !== "warning") {
        throw new RunStateError("invalid-input", `aegis.config.json#${key}.severity must be error or warning`);
      }
      return {
        id: e["id"],
        pattern: e["pattern"],
        ...(flags !== undefined ? { flags } : {}),
        message: e["message"],
        severity: (e["severity"] as "error" | "warning" | undefined) ?? "error",
      };
    });
  }
  const pii = r["pii"];
  if (pii !== undefined && (pii === null || typeof pii !== "object" || Array.isArray(pii))) {
    throw new RunStateError("invalid-input", "aegis.config.json#reportRules.pii must be an object");
  }
  const p = (pii ?? {}) as Record<string, unknown>;
  const phonePatterns = stringList(p["syntheticPhonePatterns"], "reportRules.pii.syntheticPhonePatterns");
  phonePatterns.forEach((pattern, i) => {
    if (pattern.trim() === "") throw new RunStateError("invalid-input", `aegis.config.json#reportRules.pii.syntheticPhonePatterns[${i}] must not be blank`);
    if (!compiles(pattern, "")) {
      throw new RunStateError("invalid-input", `aegis.config.json#reportRules.pii.syntheticPhonePatterns[${i}] is not a valid regular expression`);
    }
  });
  const syntheticValues = stringList(p["syntheticValues"], "reportRules.pii.syntheticValues");
  syntheticValues.forEach((v, i) => {
    if (v.trim() === "") throw new RunStateError("invalid-input", `aegis.config.json#reportRules.pii.syntheticValues[${i}] must not be blank`);
  });
  return {
    extend,
    disable: stringList(r["disable"], "reportRules.disable"),
    allow: stringList(r["allow"], "reportRules.allow"),
    localPorts: localPorts(r),
    pii: {
      syntheticEmailDomains: stringList(p["syntheticEmailDomains"], "reportRules.pii.syntheticEmailDomains"),
      syntheticNamePrefixes: p["syntheticNamePrefixes"] === undefined ? [...DEFAULT_SYNTHETIC_NAME_PREFIXES] : stringList(p["syntheticNamePrefixes"], "reportRules.pii.syntheticNamePrefixes"),
      syntheticPhonePatterns: phonePatterns,
      syntheticValues,
    },
  };
}

/** reportRules.localPorts through the one reader every tooling check uses (localPortsOf), as invalid-input. */
function localPorts(reportRules: Record<string, unknown>): number[] {
  try {
    return localPortsOf({ reportRules });
  } catch (e) {
    throw new RunStateError("invalid-input", (e as Error).message);
  }
}

/** testing.manualBudgetPercent: absent is null (the manual-testing rule stays off), present must be a number. */
function manualBudgetPercent(testing: unknown): number | null {
  if (testing === null || typeof testing !== "object") return null;
  const v = (testing as Record<string, unknown>)["manualBudgetPercent"];
  if (v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new RunStateError("invalid-input", "aegis.config.json#testing.manualBudgetPercent must be a number");
  return v;
}

export function readRunConfig(root: string): RunConfig {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(join(root, "aegis.config.json"), "utf-8")) as Record<string, unknown>;
  } catch (e) {
    throw new RunStateError("invalid-input", `cannot read aegis.config.json: ${(e as Error).message}`);
  }
  const intake = raw["intake"];
  const testing = raw["testing"];
  // Compliance is on by default (AUD-055): an absent key means all six; only an explicit [] turns the phase off.
  const compliance = raw["compliance"] === undefined ? [...COMPLIANCE_REGULATIONS] : stringList(raw["compliance"], "compliance");
  // A regulation with no qa-compliance-<id> agent could never get a task, so the Compliance barrier would never pass.
  const known = new Set<string>(COMPLIANCE_REGULATIONS);
  const unknown = compliance.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new RunStateError("invalid-input", `aegis.config.json#compliance lists unknown regulation(s) ${unknown.join(", ")}; known: ${COMPLIANCE_REGULATIONS.join(", ")}`);
  }
  const messaging = assertMessagingConfig(raw);
  const rules = reportRules(raw["reportRules"]);
  // The messaging block's own fake recipients are test data the framework hands the messaging specialist: a case that quotes them is not real
  // personal data, so the personal-data rules read them as declared synthetic values (as reportRules.pii.syntheticValues).
  if (messaging !== null) {
    const squash = (v: string): string => v.toLowerCase().replace(/[\s-]/g, "");
    const known = new Set(rules.pii.syntheticValues.map(squash));
    for (const v of [messaging.fakeRecipients.phone, messaging.fakeRecipients.email]) {
      if (!known.has(squash(v))) { rules.pii.syntheticValues.push(v); known.add(squash(v)); }
    }
  }
  return {
    targetProjectRoot: typeof raw["targetProjectRoot"] === "string" ? raw["targetProjectRoot"] : "..",
    compliance,
    preCycleHealthCheck: raw["preCycleHealthCheck"] === true,
    intakeSources: stringList(intake !== null && typeof intake === "object" ? (intake as Record<string, unknown>)["sources"] : undefined, "intake.sources"),
    intakeReferences: intakeReferences(intake !== null && typeof intake === "object" ? (intake as Record<string, unknown>)["references"] : undefined),
    messaging,
    reportRules: rules,
    manualBudgetPercent: manualBudgetPercent(testing),
  };
}
