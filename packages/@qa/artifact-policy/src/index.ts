import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CaptureMode = "on-failure" | "always" | "manual";
export type ArtifactFormat = "screenshot" | "video" | "both";

export interface ArtifactsConfig {
  mode: CaptureMode;
  format: ArtifactFormat;
  videoTranscodeMp4?: boolean;
  videoQuality?: "low" | "medium" | "high";
  screenshotOnEveryStep?: boolean;
  retention: {
    onSuccess: "delete-current" | "replace-latest";
    onFailure: "preserve-history";
    historicalLimit: number;
    maxAgeRunsKept: number;
  };
}

// ─── Config loading ───────────────────────────────────────────────────────────

/**
 * Load artifacts config from aegis.config.json.
 */
export function loadArtifactsConfig(aegisConfigPath: string): ArtifactsConfig {
  const raw = fs.readFileSync(aegisConfigPath, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  if (!parsed["artifacts"] || typeof parsed["artifacts"] !== "object") {
    throw new Error(`aegis.config.json is missing 'artifacts' configuration`);
  }

  return parsed["artifacts"] as ArtifactsConfig;
}

// ─── Capture decision ─────────────────────────────────────────────────────────

/**
 * Determine if an artifact should be captured for a given test result.
 * - on-failure: capture only when !testPassed
 * - always: always capture
 * - manual: never capture (user controls via --capture-artifacts flag)
 */
export function shouldCapture(config: ArtifactsConfig, testPassed: boolean): boolean {
  switch (config.mode) {
    case "on-failure":
      return !testPassed;
    case "always":
      return true;
    case "manual":
      return false;
  }
}

// ─── Retention enforcement ────────────────────────────────────────────────────

/**
 * Enforce retention after a test completes.
 * - On success + delete-current: wipe evidenceDir immediately (no storage cost for passes)
 * - On success + replace-latest: keep current run's dir, delete all older runs' dirs for this TC
 * - On failure: keep + enforce historicalLimit across runs
 */
export async function enforceRetention(opts: {
  config: ArtifactsConfig;
  tcId: string;
  testPassed: boolean;
  evidenceDir: string;
  allRunsEvidenceDirs: string[];
}): Promise<{ deleted: string[]; kept: string[] }> {
  const { config, testPassed, evidenceDir, allRunsEvidenceDirs } = opts;

  const deleted: string[] = [];
  const kept: string[] = [];

  if (testPassed && config.retention.onSuccess === "delete-current") {
    // Delete all files in the current evidence dir
    if (fs.existsSync(evidenceDir)) {
      const files = fs.readdirSync(evidenceDir);
      for (const file of files) {
        const filePath = path.join(evidenceDir, file);
        try {
          fs.unlinkSync(filePath);
          deleted.push(filePath);
        } catch {
          // File may already be gone or be a directory — skip
        }
      }
    }
    return { deleted, kept };
  }

  if (testPassed && config.retention.onSuccess === "replace-latest") {
    // Keep current run's evidenceDir, delete same TC's evidence from all older runs
    const historical = await listHistoricalArtifacts(opts.tcId, allRunsEvidenceDirs);
    for (const artifact of historical) {
      const artifactDir = path.dirname(artifact.path);
      if (artifactDir === evidenceDir) {
        kept.push(artifact.path);
      } else {
        try {
          fs.unlinkSync(artifact.path);
          deleted.push(artifact.path);
        } catch {
          // Skip
        }
      }
    }
    return { deleted, kept };
  }

  // On failure: enforce historicalLimit
  if (!testPassed && config.retention.onFailure === "preserve-history") {
    const historical = await listHistoricalArtifacts(opts.tcId, allRunsEvidenceDirs);

    // Group by directory to determine which dirs are oldest
    const dirMtimes = new Map<string, Date>();
    for (const artifact of historical) {
      const dir = path.dirname(artifact.path);
      const existing = dirMtimes.get(dir);
      if (!existing || artifact.mtime > existing) {
        dirMtimes.set(dir, artifact.mtime);
      }
    }

    // Sort dirs by newest mtime desc
    const sortedDirs = [...dirMtimes.entries()].sort(
      ([, a], [, b]) => b.getTime() - a.getTime()
    );

    // Dirs beyond historicalLimit should be deleted
    const { historicalLimit } = config.retention;
    const dirsToDelete = sortedDirs.slice(historicalLimit).map(([dir]) => dir);

    for (const dir of dirsToDelete) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          try {
            fs.unlinkSync(filePath);
            deleted.push(filePath);
          } catch {
            // Skip
          }
        }
      }
    }

    // Everything else is kept
    for (const artifact of historical) {
      if (!deleted.includes(artifact.path)) {
        kept.push(artifact.path);
      }
    }
  }

  return { deleted, kept };
}

// ─── Historical artifact listing ──────────────────────────────────────────────

/**
 * List artifact files for a TC across all runs, sorted by mtime descending.
 */
export async function listHistoricalArtifacts(
  tcId: string,
  allRunsEvidenceDirs: string[]
): Promise<Array<{ path: string; mtime: Date }>> {
  const artifacts: Array<{ path: string; mtime: Date }> = [];

  for (const dir of allRunsEvidenceDirs) {
    if (!fs.existsSync(dir)) continue;

    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const stat = fs.statSync(filePath);
        artifacts.push({ path: filePath, mtime: stat.mtime });
      } catch {
        // Skip unreadable files
      }
    }
  }

  // Sort descending by mtime (newest first)
  artifacts.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return artifacts;
}
