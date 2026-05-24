import {
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
} from "node:fs";
import { join, normalize } from "node:path";

export interface SandboxLifecycle {
  createdBy: string;  // agent name
  createdAt: string;  // ISO timestamp
  purpose: string;    // one-line description
  ttl: string;        // e.g. "7d"
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function parseTtlMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) {
    throw new Error(`Invalid TTL format "${ttl}". Expected e.g. "7d", "24h", "30m"`);
  }
  const [, amount, unit] = match;
  const n = parseInt(amount!, 10);
  switch (unit) {
    case "s":
      return n * 1_000;
    case "m":
      return n * 60 * 1_000;
    case "h":
      return n * 60 * 60 * 1_000;
    case "d":
      return n * 24 * 60 * 60 * 1_000;
    default:
      throw new Error(`Unknown TTL unit "${unit}"`);
  }
}

function sandboxDir(sandboxRoot: string, slug: string): string {
  return join(sandboxRoot, slug);
}

function lifecyclePath(sandboxRoot: string, slug: string): string {
  return join(sandboxDir(sandboxRoot, slug), "lifecycle.json");
}

function appendBusEvent(
  busPath: string,
  type: string,
  payload: Record<string, unknown>,
): void {
  const line =
    JSON.stringify({ type, ts: new Date().toISOString(), ...payload }) + "\n";
  appendFileSync(busPath, line, { encoding: "utf8" });
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Register a new sandbox directory.
// Creates `{sandboxRoot}/{YYYY-MM-DD}-{slug}/lifecycle.json`
// Returns the full path to the sandbox dir.
export async function registerSandbox(
  sandboxRoot: string,
  slug: string,
  lifecycle: Omit<SandboxLifecycle, "createdAt">,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const dateslug = `${today}-${slug}`;
  const dir = sandboxDir(sandboxRoot, dateslug);

  mkdirSync(dir, { recursive: true });

  const data: SandboxLifecycle = {
    ...lifecycle,
    createdAt: new Date().toISOString(),
  };

  writeFileSync(lifecyclePath(sandboxRoot, dateslug), JSON.stringify(data, null, 2), {
    encoding: "utf8",
  });

  return dir;
}

// Mark a sandbox as complete — immediately deletes it.
// Emits sandbox.experiment-completed (writes to busPath if provided).
export async function completeSandbox(
  sandboxRoot: string,
  slug: string,
  agentName: string,
  busPath?: string,
): Promise<void> {
  const lcPath = lifecyclePath(sandboxRoot, slug);
  if (!existsSync(lcPath)) {
    throw new Error(
      `Cannot complete sandbox "${slug}": lifecycle.json not found at ${lcPath}`,
    );
  }

  const dir = sandboxDir(sandboxRoot, slug);
  rmSync(dir, { recursive: true, force: true });

  if (busPath) {
    appendBusEvent(busPath, "sandbox.experiment-completed", {
      slug,
      agentName,
      sandboxRoot,
    });
  }
}

// Prune sandboxes older than TTL (default 7 days).
// Returns list of pruned paths.
export async function pruneExpiredSandboxes(
  sandboxRoot: string,
  busPath?: string,
): Promise<string[]> {
  if (!existsSync(sandboxRoot)) {
    return [];
  }

  const entries = readdirSync(sandboxRoot, { withFileTypes: true });
  const pruned: string[] = [];
  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const slug = entry.name;
    const lcPath = join(sandboxRoot, slug, "lifecycle.json");

    if (!existsSync(lcPath)) continue;

    let lifecycle: SandboxLifecycle;
    try {
      lifecycle = JSON.parse(readFileSync(lcPath, "utf8")) as SandboxLifecycle;
    } catch {
      continue;
    }

    let ttlMs: number;
    try {
      ttlMs = parseTtlMs(lifecycle.ttl ?? "7d");
    } catch {
      ttlMs = parseTtlMs("7d");
    }

    const createdAt = new Date(lifecycle.createdAt).getTime();
    if (isNaN(createdAt)) continue;

    if (now - createdAt > ttlMs) {
      const dir = join(sandboxRoot, slug);
      rmSync(dir, { recursive: true, force: true });
      pruned.push(dir);

      if (busPath) {
        appendBusEvent(busPath, "sandbox.pruned", {
          slug,
          createdAt: lifecycle.createdAt,
          ttl: lifecycle.ttl,
          createdBy: lifecycle.createdBy,
        });
      }
    }
  }

  return pruned;
}

// Check if a given path is inside the sandbox directory.
export function isSandboxPath(path: string, sandboxRoot: string): boolean {
  const normalizedPath = normalize(path);
  const normalizedRoot = normalize(sandboxRoot);
  return normalizedPath.startsWith(normalizedRoot + "/");
}
