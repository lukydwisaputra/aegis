import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppDescriptor {
  name: string;
  path: string;
  url: string;
  framework: "vite-react-ts" | "vite-react-jsx" | "nextjs-app" | "nextjs-pages";
  language: "ts" | "jsx" | "tsx";
  roles: string[];
}

export interface AegisAppsConfig {
  apps: AppDescriptor[];
  targetRoot: string;
}

// ─── Config loading ───────────────────────────────────────────────────────────

/**
 * Load apps config from aegis.config.json.
 */
export function loadAppsConfig(aegisConfigPath: string): AegisAppsConfig {
  const raw = fs.readFileSync(aegisConfigPath, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  if (!Array.isArray(parsed["apps"])) {
    throw new Error(`aegis.config.json is missing 'apps' array`);
  }

  if (typeof parsed["targetRoot"] !== "string") {
    throw new Error(`aegis.config.json is missing 'targetRoot' string`);
  }

  return {
    apps: parsed["apps"] as AppDescriptor[],
    targetRoot: parsed["targetRoot"] as string,
  };
}

// ─── App resolution ───────────────────────────────────────────────────────────

/**
 * Resolve an app by name — throws if not found.
 */
export function resolveApp(config: AegisAppsConfig, name: string): AppDescriptor {
  const app = config.apps.find((a) => a.name === name);
  if (!app) {
    throw new Error(
      `App '${name}' not found in aegis.config.json. Available: ${config.apps.map((a) => a.name).join(", ")}`
    );
  }
  return app;
}

/**
 * Resolve multiple apps by name array.
 */
export function resolveApps(config: AegisAppsConfig, names: string[]): AppDescriptor[] {
  return names.map((name) => resolveApp(config, name));
}

// ─── SSO helpers ──────────────────────────────────────────────────────────────

/**
 * Cross-app SSO: build a URL with a sso_token query param.
 * Used when testing SSO flows that pass tokens via URL (<target-project> pattern).
 */
export function buildSsoUrl(targetAppUrl: string, ssoToken: string): string {
  return `${targetAppUrl}?sso_token=${encodeURIComponent(ssoToken)}`;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate that all configured apps exist on disk.
 */
export function validateAppsExist(config: AegisAppsConfig): {
  valid: boolean;
  missing: string[];
} {
  const missing: string[] = [];

  for (const app of config.apps) {
    const fullPath = path.join(config.targetRoot, app.path);
    if (!fs.existsSync(fullPath)) {
      missing.push(app.name);
    }
  }

  return { valid: missing.length === 0, missing };
}

// ─── Cycle label ──────────────────────────────────────────────────────────────

/**
 * Generate a cycle scope description for multi-app runs.
 * e.g. ["prospect", "bishan"] → "prospect + bishan cross-app cycle"
 */
export function multiAppCycleLabel(appNames: string[]): string {
  return `${appNames.join(" + ")} cross-app cycle`;
}
