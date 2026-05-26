import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AegisEnvName = "development" | "testing" | "staging" | "production";

export type AppUrlMap = Partial<Record<AegisEnvName, string>>;

export interface AppDescriptor {
  name: string;
  rootDir: string;
  url: AppUrlMap;
  framework?: "vite-react-ts" | "vite-react-jsx" | "nextjs-app" | "nextjs-pages";
  language?: "ts" | "jsx" | "tsx";
  roles?: string[];
}

export interface AegisAppsConfig {
  /** Apps as declared under `target.apps` in aegis.config.json. */
  apps: AppDescriptor[];
  /** Absolute path the apps' `rootDir` is resolved against (the aegis config's directory). */
  configDir: string;
  /** Value of `targetProjectRoot` (relative to configDir), defaults to "..". */
  targetProjectRoot: string;
}

// ─── Config loading ───────────────────────────────────────────────────────────

/**
 * Load the multi-app section from aegis.config.json.
 *
 * Reads `target.apps[]` per the documented schema in
 * docs/D12-monorepo-multi-app.md. An empty array (or missing `target`)
 * means single-app mode — callers should treat that as "no apps configured"
 * and fall back to the top-level `environments.{env}.url`.
 */
export function loadAppsConfig(aegisConfigPath: string): AegisAppsConfig {
  const raw = fs.readFileSync(aegisConfigPath, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const target = (parsed["target"] ?? {}) as Record<string, unknown>;
  const apps = Array.isArray(target["apps"]) ? (target["apps"] as unknown[]) : [];

  const descriptors: AppDescriptor[] = apps.map((entry, idx) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`target.apps[${idx}] is not an object`);
    }
    const a = entry as Record<string, unknown>;
    if (typeof a["name"] !== "string") {
      throw new Error(`target.apps[${idx}].name must be a string`);
    }
    if (typeof a["rootDir"] !== "string") {
      throw new Error(`target.apps[${idx}].rootDir must be a string (app: ${a["name"]})`);
    }
    if (typeof a["url"] !== "object" || a["url"] === null) {
      throw new Error(`target.apps[${idx}].url must be an object keyed by env name (app: ${a["name"]})`);
    }
    const descriptor: AppDescriptor = {
      name: a["name"] as string,
      rootDir: a["rootDir"] as string,
      url: a["url"] as AppUrlMap,
    };
    if (typeof a["framework"] === "string") {
      descriptor.framework = a["framework"] as NonNullable<AppDescriptor["framework"]>;
    }
    if (typeof a["language"] === "string") {
      descriptor.language = a["language"] as NonNullable<AppDescriptor["language"]>;
    }
    if (Array.isArray(a["roles"])) {
      descriptor.roles = a["roles"] as string[];
    }
    return descriptor;
  });

  const targetProjectRoot =
    typeof parsed["targetProjectRoot"] === "string" ? (parsed["targetProjectRoot"] as string) : "..";

  return {
    apps: descriptors,
    configDir: path.dirname(path.resolve(aegisConfigPath)),
    targetProjectRoot,
  };
}

// ─── Mode detection ───────────────────────────────────────────────────────────

/** True when `target.apps` is empty — single-app mode. */
export function isSingleAppMode(config: AegisAppsConfig): boolean {
  return config.apps.length === 0;
}

// ─── App resolution ───────────────────────────────────────────────────────────

/**
 * Resolve an app by name — throws if not found.
 */
export function resolveApp(config: AegisAppsConfig, name: string): AppDescriptor {
  const app = config.apps.find((a) => a.name === name);
  if (!app) {
    const available = config.apps.map((a) => a.name).join(", ") || "(none)";
    throw new Error(`App '${name}' not found in aegis.config.json target.apps. Available: ${available}`);
  }
  return app;
}

/**
 * Resolve multiple apps by name array.
 */
export function resolveApps(config: AegisAppsConfig, names: string[]): AppDescriptor[] {
  return names.map((name) => resolveApp(config, name));
}

/**
 * Resolve an app's URL for a given environment.
 * Throws if the app exists but has no URL configured for that env —
 * surfacing the misconfiguration loudly rather than silently falling back.
 */
export function resolveAppUrl(app: AppDescriptor, env: AegisEnvName): string {
  const url = app.url[env];
  if (!url) {
    throw new Error(`App '${app.name}' has no URL configured for environment '${env}'`);
  }
  return url;
}

// ─── SSO helpers ──────────────────────────────────────────────────────────────

/**
 * Cross-app SSO: build a URL with a sso_token query param.
 * Used when testing SSO flows that pass tokens across apps via URL.
 */
export function buildSsoUrl(targetAppUrl: string, ssoToken: string): string {
  return `${targetAppUrl}?sso_token=${encodeURIComponent(ssoToken)}`;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate that every configured app's rootDir exists on disk.
 * `rootDir` is resolved relative to the aegis config's directory.
 */
export function validateAppsExist(config: AegisAppsConfig): {
  valid: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  for (const app of config.apps) {
    const fullPath = path.resolve(config.configDir, app.rootDir);
    if (!fs.existsSync(fullPath)) {
      missing.push(app.name);
    }
  }
  return { valid: missing.length === 0, missing };
}

// ─── Cycle label ──────────────────────────────────────────────────────────────

/**
 * Generate a cycle scope description for multi-app runs.
 * e.g. ["web", "api"] → "web + api cross-app cycle"
 */
export function multiAppCycleLabel(appNames: string[]): string {
  return `${appNames.join(" + ")} cross-app cycle`;
}
