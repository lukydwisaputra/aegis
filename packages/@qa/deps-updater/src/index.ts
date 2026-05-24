import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PackageManager = "pnpm" | "npm";
export type UpdateTier = "patch" | "minor" | "major" | "security";

export interface PackageUpdate {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  tier: UpdateTier;
  isSecurity: boolean;
  cveIds?: string[];
}

export interface UpdateResult {
  applied: PackageUpdate[];
  listed: PackageUpdate[];
  skipped: PackageUpdate[];
  errors: Array<{ package: string; error: string }>;
}

// ─── Package manager detection ────────────────────────────────────────────────

/**
 * Detect which package manager is in use from lockfile.
 * Check for pnpm-lock.yaml → pnpm, else → npm.
 */
export function detectPackageManager(targetRoot: string): PackageManager {
  const pnpmLock = path.join(targetRoot, "pnpm-lock.yaml");
  if (fs.existsSync(pnpmLock)) {
    return "pnpm";
  }
  return "npm";
}

// ─── Semver helpers ───────────────────────────────────────────────────────────

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(version: string): SemVer {
  // Strip leading ^ ~ v and any pre-release suffix
  const cleaned = version.replace(/^[\^~v]/, "").split("-")[0] ?? "0.0.0";
  const parts = cleaned.split(".");
  return {
    major: parseInt(parts[0] ?? "0", 10),
    minor: parseInt(parts[1] ?? "0", 10),
    patch: parseInt(parts[2] ?? "0", 10),
  };
}

/**
 * Classify an update's tier from version strings.
 * If semver major differs → major; if minor differs → minor; else → patch.
 */
export function classifyTier(current: string, wanted: string, latest: string): UpdateTier {
  const cur = parseSemver(current);
  const wan = parseSemver(wanted);
  const lat = parseSemver(latest);

  // Use latest to classify the full upgrade tier
  if (lat.major !== cur.major) return "major";
  if (lat.minor !== cur.minor) return "minor";
  if (wan.major !== cur.major) return "major";
  if (wan.minor !== cur.minor) return "minor";
  return "patch";
}

// ─── List outdated ────────────────────────────────────────────────────────────

/**
 * Run `npm outdated --json` or `pnpm outdated --format json` and parse results.
 */
export async function listOutdated(
  targetRoot: string,
  pm: PackageManager
): Promise<PackageUpdate[]> {
  let stdout: string;

  try {
    if (pm === "pnpm") {
      stdout = execSync("pnpm outdated --format json", {
        cwd: targetRoot,
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf-8",
      });
    } else {
      stdout = execSync("npm outdated --json", {
        cwd: targetRoot,
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf-8",
      });
    }
  } catch (err) {
    // npm outdated exits with code 1 when there are outdated packages
    // The output is still valid JSON in stdout
    const execError = err as { stdout?: string; stderr?: string };
    stdout = execError.stdout ?? "{}";
  }

  if (!stdout.trim()) return [];

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return [];
  }

  const updates: PackageUpdate[] = [];

  for (const [name, info] of Object.entries(parsed)) {
    const pkg = info as Record<string, string>;
    const current = pkg["current"] ?? pkg["installed"] ?? "0.0.0";
    const wanted = pkg["wanted"] ?? pkg["latest"] ?? current;
    const latest = pkg["latest"] ?? wanted;

    const tier = classifyTier(current, wanted, latest);

    updates.push({
      name,
      current,
      wanted,
      latest,
      tier,
      isSecurity: false,
    });
  }

  return updates;
}

// ─── Apply patch updates ──────────────────────────────────────────────────────

/**
 * Apply patch updates automatically.
 * Runs `npm install pkg@{wanted}` or `pnpm add pkg@{wanted}` for each patch update.
 */
export async function applyPatchUpdates(
  targetRoot: string,
  pm: PackageManager,
  updates: PackageUpdate[]
): Promise<void> {
  const patchUpdates = updates.filter((u) => u.tier === "patch");

  for (const update of patchUpdates) {
    const spec = `${update.name}@${update.wanted}`;
    const cmd = pm === "pnpm" ? `pnpm add ${spec}` : `npm install ${spec}`;

    execSync(cmd, {
      cwd: targetRoot,
      stdio: "inherit",
    });
  }
}

// ─── Security audit ───────────────────────────────────────────────────────────

/**
 * Run security audit and return security-tier updates.
 * Runs `npm audit --json` or `pnpm audit --json` and maps CVEs to PackageUpdate entries.
 */
export async function runSecurityAudit(
  targetRoot: string,
  pm: PackageManager
): Promise<PackageUpdate[]> {
  let stdout: string;

  try {
    const cmd = pm === "pnpm" ? "pnpm audit --json" : "npm audit --json";
    stdout = execSync(cmd, {
      cwd: targetRoot,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    });
  } catch (err) {
    // audit exits with non-zero when vulnerabilities found
    const execError = err as { stdout?: string };
    stdout = execError.stdout ?? "{}";
  }

  if (!stdout.trim()) return [];

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return [];
  }

  const updates: PackageUpdate[] = [];

  // npm audit JSON structure: { vulnerabilities: { [name]: { via, fixAvailable, ... } } }
  const vulnerabilities =
    (parsed["vulnerabilities"] as Record<string, unknown> | undefined) ?? {};

  for (const [name, vuln] of Object.entries(vulnerabilities)) {
    const v = vuln as Record<string, unknown>;

    // Gather CVE IDs from nested `via` array
    const via = Array.isArray(v["via"]) ? (v["via"] as unknown[]) : [];
    const cveIds: string[] = [];
    for (const source of via) {
      if (typeof source === "object" && source !== null) {
        const src = source as Record<string, unknown>;
        if (typeof src["url"] === "string" && src["url"].includes("CVE-")) {
          const match = src["url"].match(/(CVE-\d{4}-\d+)/i);
          if (match?.[1]) cveIds.push(match[1]);
        }
        if (typeof src["cve"] === "string") cveIds.push(src["cve"]);
      }
    }

    const fixAvailable = v["fixAvailable"];
    let wanted = "latest";
    if (
      typeof fixAvailable === "object" &&
      fixAvailable !== null &&
      "version" in fixAvailable
    ) {
      wanted = (fixAvailable as Record<string, string>)["version"] ?? "latest";
    }

    updates.push({
      name,
      current: typeof v["version"] === "string" ? v["version"] : "unknown",
      wanted,
      latest: wanted,
      tier: "security",
      isSecurity: true,
      cveIds: cveIds.length > 0 ? cveIds : undefined,
    });
  }

  return updates;
}
