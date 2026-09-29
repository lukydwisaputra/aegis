import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { RunIdSchema } from "@qa/contracts";
import { RunStateError } from "./errors.js";

export function findAegisRoot(start: string = process.cwd()): string {
  let dir = start;
  const { root } = parse(dir);
  for (;;) {
    if (existsSync(join(dir, "aegis.config.json"))) return dir;
    if (dir === root) throw new RunStateError("not-in-aegis", `aegis.config.json not found at or above ${start}`);
    dir = dirname(dir);
  }
}

export const runsDir = (root: string): string => join(root, "runs");
export const runDir = (root: string, runId: string): string => join(runsDir(root), runId);
export const runJsonPath = (root: string, runId: string): string => join(runDir(root, runId), "run.json");
export const busPath = (root: string, runId: string): string => join(runDir(root, runId), "events.jsonl");
export const taskmasterDir = (root: string, runId: string): string => join(runDir(root, runId), "taskmaster");

const activePointer = (root: string): string => join(runsDir(root), ".active");

/** The active run, or null when the pointer is missing, malformed or points to a deleted run. */
export function readActiveRun(root: string): string | null {
  const pointer = activePointer(root);
  if (!existsSync(pointer)) return null;
  let id: string;
  try {
    id = readFileSync(pointer, "utf-8").trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  if (!RunIdSchema.safeParse(id).success) return null;
  if (!existsSync(runJsonPath(root, id))) return null;
  return id;
}

export function writeActiveRun(root: string, runId: string): void {
  mkdirSync(runsDir(root), { recursive: true });
  const tmp = join(runsDir(root), `.active.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, runId + "\n", "utf-8");
    renameSync(tmp, activePointer(root));
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export function clearActiveRun(root: string): void {
  rmSync(activePointer(root), { force: true });
}

export function resolveRunId(root: string, explicit: string | undefined): string {
  if (explicit !== undefined) {
    if (!RunIdSchema.safeParse(explicit).success) {
      throw new RunStateError("invalid-input", `"${explicit}" is not a run id (RUN-YYYYMMDD-NNN)`);
    }
    if (!existsSync(runJsonPath(root, explicit))) throw new RunStateError("run-not-found", `run ${explicit} not found`);
    return explicit;
  }
  const active = readActiveRun(root);
  if (active === null) {
    throw new RunStateError("no-active-run", "no active run: pass --run <id> or start one with `aegis run create`");
  }
  return active;
}
