import { resolve, normalize } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// ─── Types ────────────────────────────────────────────────────────────────────

export class PathGuardError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly reason: "not-writable" | "env-read-only" | "specialist-blocked" | "territory-violation"
  ) {
    super(message);
    this.name = "PathGuardError";
  }
}

export interface EnvConfig {
  readOnly?: boolean;
  allowedSpecialists?: string[];
  forbiddenSpecialists?: string[];
}

export interface AegisConfig {
  targetProjectRoot?: string;
  testsDir?: string;
  sourceDirs?: string[];
  environments?: Record<string, EnvConfig>;
}

// ─── Allowlist derivation ─────────────────────────────────────────────────────

/**
 * Derive the set of writable path prefixes from aegis.config.json.
 * Returns absolute, normalised paths.
 */
function deriveWriteAllowlist(aegisRoot: string, config: AegisConfig): string[] {
  const target = resolve(aegisRoot, config.targetProjectRoot ?? "..");

  const allowlist: string[] = [
    resolve(aegisRoot, "runs"),
    resolve(aegisRoot, "packages"),
    resolve(aegisRoot, "apps"),
    resolve(aegisRoot, "agent-memory"),
    resolve(aegisRoot, ".aegis"),
    resolve(aegisRoot, "knowledge"),
    resolve(aegisRoot, "docs"),
    resolve(aegisRoot, "HANDBOOK"),
    resolve(aegisRoot, "test-data", "synthetic"),
    resolve(aegisRoot, "test-data", "fixtures"),
    resolve(aegisRoot, ".claude", "agents"),
    resolve(aegisRoot, ".claude", "skills"),
    resolve(aegisRoot, "templates"),
    resolve(aegisRoot, "__internal-tests__"),
    resolve(aegisRoot, "module-codes.md"),
    resolve(aegisRoot, "thresholds.yaml"),
    resolve(aegisRoot, "aegis.config.json"),
  ];

  const testsDir = config.testsDir ? resolve(aegisRoot, config.testsDir) : resolve(target, "tests");
  allowlist.push(testsDir);

  return allowlist.map(normalize);
}

// ─── Config loader (cached) ───────────────────────────────────────────────────

let _config: AegisConfig | null = null;
let _aegisRoot: string | null = null;

function loadConfig(aegisRoot: string): AegisConfig {
  if (_aegisRoot === aegisRoot && _config) return _config;
  const configPath = resolve(aegisRoot, "aegis.config.json");
  if (!existsSync(configPath)) {
    _config = {};
    _aegisRoot = aegisRoot;
    return _config;
  }
  _config = JSON.parse(readFileSync(configPath, "utf-8")) as AegisConfig;
  _aegisRoot = aegisRoot;
  return _config;
}

// ─── Core assertions ──────────────────────────────────────────────────────────

/**
 * Assert that the given absolute path is writable by the QA system.
 * Throws PathGuardError if it falls outside the allowlist.
 */
export function assertWritable(path: string, aegisRoot: string): void {
  const config = loadConfig(aegisRoot);
  const allowlist = deriveWriteAllowlist(aegisRoot, config);
  const normalised = normalize(resolve(path));

  const allowed = allowlist.some((prefix) => {
    return normalised === prefix || normalised.startsWith(prefix + "/") || normalised.startsWith(prefix + "\\");
  });

  if (!allowed) {
    throw new PathGuardError(
      `Write blocked: "${normalised}" is outside the QA write allowlist. ` +
      `Only writes to tests/, aegis/runs/, aegis/packages/, aegis/apps/, and aegis/agent-memory/ are permitted. ` +
      `To modify target app source, file a defect and let the developer apply the fix.`,
      normalised,
      "not-writable"
    );
  }
}

/**
 * Assert that a mutating action is safe to perform against the given environment.
 * Reads environment config from aegis.config.json.
 */
export function assertEnvSafe(
  env: string,
  action: { mutates: boolean; specialist?: string },
  aegisRoot: string
): void {
  const config = loadConfig(aegisRoot);
  const envConfig: EnvConfig = config.environments?.[env] ?? {};

  if (action.mutates && envConfig.readOnly) {
    throw new PathGuardError(
      `Env safety: environment "${env}" is read-only. Mutating action blocked.`,
      env,
      "env-read-only"
    );
  }

  if (action.specialist) {
    const forbidden = envConfig.forbiddenSpecialists ?? [];
    if (forbidden.includes(action.specialist)) {
      throw new PathGuardError(
        `Env safety: specialist "${action.specialist}" is forbidden in environment "${env}".`,
        env,
        "specialist-blocked"
      );
    }

    const allowed = envConfig.allowedSpecialists;
    if (allowed && !allowed.includes("*") && !allowed.includes(action.specialist)) {
      throw new PathGuardError(
        `Env safety: specialist "${action.specialist}" is not in the allowed list for environment "${env}".`,
        env,
        "specialist-blocked"
      );
    }
  }
}

/**
 * Assert Aegis territory rule: only agents whose name starts with "qa-"
 * may write files inside aegis/.
 */
export function assertAegisOwnership(agentName: string, path: string, aegisRoot: string): void {
  const normalised = normalize(resolve(path));
  const aegisNorm = normalize(resolve(aegisRoot));

  const isInsideAegis =
    normalised === aegisNorm ||
    normalised.startsWith(aegisNorm + "/") ||
    normalised.startsWith(aegisNorm + "\\");

  if (isInsideAegis && !agentName.startsWith("qa-")) {
    throw new PathGuardError(
      `Territory violation: agent "${agentName}" attempted to write to aegis/ path "${normalised}". ` +
      `Only agents with names starting "qa-" are allowed to write inside aegis/.`,
      normalised,
      "territory-violation"
    );
  }
}

/**
 * Assert that a path is readable (currently always allowed, but provides
 * a single hook for future read restrictions).
 */
export function assertReadable(_path: string, _aegisRoot: string): void {
  // All paths are currently readable. This function exists as a seam for
  // future fine-grained read restrictions without changing call sites.
}

// ─── Utility: check without throwing ─────────────────────────────────────────

export function isWritable(path: string, aegisRoot: string): boolean {
  try {
    assertWritable(path, aegisRoot);
    return true;
  } catch {
    return false;
  }
}

export function isEnvSafe(
  env: string,
  action: { mutates: boolean; specialist?: string },
  aegisRoot: string
): boolean {
  try {
    assertEnvSafe(env, action, aegisRoot);
    return true;
  } catch {
    return false;
  }
}

// ─── Config validation ────────────────────────────────────────────────────────

export type ConfigValidationResult = { valid: boolean; errors: string[] };

export function validateConfig(aegisRoot: string): ConfigValidationResult {
  const errors: string[] = [];
  const configPath = resolve(aegisRoot, "aegis.config.json");

  if (!existsSync(configPath)) {
    errors.push(`aegis.config.json not found at ${configPath}`);
    return { valid: false, errors };
  }

  let config: AegisConfig;
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8")) as AegisConfig;
  } catch (e) {
    errors.push(`aegis.config.json is not valid JSON: ${String(e)}`);
    return { valid: false, errors };
  }

  if (!config.targetProjectRoot) {
    errors.push("aegis.config.json missing required field: targetProjectRoot");
  }

  if (!config.environments) {
    errors.push("aegis.config.json missing required field: environments");
  } else {
    const required = ["development", "testing", "staging", "production"];
    for (const env of required) {
      if (!(env in config.environments)) {
        errors.push(`aegis.config.json environments missing required env: ${env}`);
      }
    }
    if (config.environments["production"] && !config.environments["production"].readOnly) {
      errors.push('aegis.config.json: production environment must have readOnly: true');
    }
  }

  return { valid: errors.length === 0, errors };
}
