import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import lockfile from "proper-lockfile";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus =
  | "pending"
  | "in-progress"
  | "done"
  | "failed"
  | "skipped"
  | "blocked";

export interface Task {
  id: string;
  parentId?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  claimedBy?: string;
  claimedAt?: string;
  completedAt?: string;
  result?: string;
  subtasks?: Task[];
}

export interface TaskmasterClient {
  /** List all tasks (reads from .taskmaster/tasks/). */
  list(filter?: { status?: TaskStatus }): Promise<Task[]>;

  /** Get a single task by ID. */
  get(taskId: string): Promise<Task | null>;

  /**
   * Claim a task atomically: check pending → write in-progress + claimedBy.
   * Throws ClaimError if task is not in pending state.
   */
  claim(taskId: string, agentName: string): Promise<void>;

  /** Release a task (write done/failed + result). */
  release(
    taskId: string,
    result: "done" | "failed",
    resultNote?: string
  ): Promise<void>;

  /** Add a child task under a parent. Returns new task ID. */
  addTask(
    parentId: string,
    task: Omit<Task, "id" | "status">
  ): Promise<string>;

  /** Create a top-level task (no parent). Throws if the ID already exists. */
  addRootTask(task: Omit<Task, "status" | "parentId">): Promise<void>;

  /** Return a finished task to pending so it can be claimed again (SPV requested changes). */
  reopen(taskId: string): Promise<void>;

  /**
   * Roll a task file back to `task` (its content before a failed follow-up step), atomically and
   * under the task-file lock. With `ifStatus`, only when the file still holds that status, so a
   * rollback never overwrites a later change. Returns whether the file was written.
   */
  restore(task: Task, opts?: { ifStatus?: TaskStatus }): Promise<boolean>;

  /** Expand a task: replace it with subtasks. */
  expand(
    taskId: string,
    subtasks: Array<Omit<Task, "id" | "status">>
  ): Promise<void>;

  /** Get the next claimable task (status=pending, no unfinished deps). */
  next(filter?: { agentName?: string }): Promise<Task | null>;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class ClaimError extends Error {
  constructor(taskId: string, currentStatus: TaskStatus) {
    super(
      `Cannot claim task "${taskId}": status is "${currentStatus}" (expected "pending")`
    );
    this.name = "ClaimError";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function taskFilePath(tasksDir: string, taskId: string): string {
  return path.join(tasksDir, `${taskId}.json`);
}

function readTaskFile(filePath: string): Task {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Task;
}

/**
 * Write a task file so a concurrent get()/list() never sees it torn: the full content goes to a
 * unique temp file (".tmp", so list() skips it), then replaces the target by rename, or with
 * `exclusive` is hard-linked into place and fails with EEXIST if the task already exists.
 */
function writeTaskFile(filePath: string, task: Task, opts: { exclusive?: boolean } = {}): void {
  const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(task, null, 2), { encoding: "utf-8", flag: "wx" });
    if (opts.exclusive === true) fs.linkSync(tmp, filePath);
    else fs.renameSync(tmp, filePath);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Count direct children of a parent task by scanning the tasks directory for
 * files whose name matches `{parentId}.{N}.json`.
 */
function countChildren(tasksDir: string, parentId: string): number {
  const entries = fs.readdirSync(tasksDir);
  const prefix = `${parentId}.`;
  return entries.filter(
    (e) =>
      e.startsWith(prefix) &&
      e.endsWith(".json") &&
      // Only immediate children: no further dots after the N
      !e.slice(prefix.length, -".json".length).includes(".")
  ).length;
}

// ─── Lock options ─────────────────────────────────────────────────────────────

const LOCK_OPTIONS = {
  retries: { retries: 5, minTimeout: 50, maxTimeout: 300 },
  stale: 10_000,
};

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createTaskmasterClient(taskmasterDir: string): TaskmasterClient {
  const tasksDir = path.join(taskmasterDir, "tasks");

  // Ensure tasks directory exists
  fs.mkdirSync(tasksDir, { recursive: true });

  return {
    async list(filter) {
      const entries = fs.readdirSync(tasksDir).filter((e) => e.endsWith(".json"));
      const tasks: Task[] = [];
      for (const entry of entries) {
        try {
          const task = readTaskFile(path.join(tasksDir, entry));
          if (filter?.status === undefined || task.status === filter.status) {
            tasks.push(task);
          }
        } catch {
          // Skip unreadable/malformed files
        }
      }
      return tasks;
    },

    async get(taskId) {
      const filePath = taskFilePath(tasksDir, taskId);
      if (!fs.existsSync(filePath)) return null;
      try {
        return readTaskFile(filePath);
      } catch {
        return null;
      }
    },

    async claim(taskId, agentName) {
      const filePath = taskFilePath(tasksDir, taskId);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Task "${taskId}" not found`);
      }

      const release = await lockfile.lock(filePath, LOCK_OPTIONS);
      try {
        const task = readTaskFile(filePath);
        if (task.status !== "pending") {
          throw new ClaimError(taskId, task.status);
        }
        const updated: Task = {
          ...task,
          status: "in-progress",
          claimedBy: agentName,
          claimedAt: nowIso(),
        };
        writeTaskFile(filePath, updated);
      } finally {
        await release();
      }
    },

    async release(taskId, result, resultNote) {
      const filePath = taskFilePath(tasksDir, taskId);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Task "${taskId}" not found`);
      }

      const release = await lockfile.lock(filePath, LOCK_OPTIONS);
      try {
        const task = readTaskFile(filePath);
        const updated: Task = {
          ...task,
          status: result,
          completedAt: nowIso(),
          ...(resultNote !== undefined ? { result: resultNote } : {}),
        };
        writeTaskFile(filePath, updated);
      } finally {
        await release();
      }
    },

    async addTask(parentId, taskData) {
      // Verify parent exists
      const parentPath = taskFilePath(tasksDir, parentId);
      if (!fs.existsSync(parentPath)) {
        throw new Error(`Parent task "${parentId}" not found`);
      }

      const childCount = countChildren(tasksDir, parentId);
      const newId = `${parentId}.${childCount + 1}`;
      const newTask: Task = {
        ...taskData,
        id: newId,
        status: "pending",
        parentId,
      };
      writeTaskFile(taskFilePath(tasksDir, newId), newTask);
      return newId;
    },

    async addRootTask(taskData) {
      const filePath = taskFilePath(tasksDir, taskData.id);
      const task: Task = { ...taskData, status: "pending" };
      try {
        writeTaskFile(filePath, task, { exclusive: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error(`Task "${taskData.id}" already exists`);
        }
        throw e;
      }
    },

    async reopen(taskId) {
      const filePath = taskFilePath(tasksDir, taskId);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Task "${taskId}" not found`);
      }
      const release = await lockfile.lock(filePath, LOCK_OPTIONS);
      try {
        const {
          completedAt: _completedAt,
          result: _result,
          claimedBy: _claimedBy,
          claimedAt: _claimedAt,
          ...task
        } = readTaskFile(filePath);
        if (task.status !== "done" && task.status !== "failed") {
          throw new Error(`Task "${taskId}" is ${task.status}; only done or failed tasks can be reopened`);
        }
        writeTaskFile(filePath, { ...task, status: "pending" });
      } finally {
        await release();
      }
    },

    async restore(task, opts = {}) {
      const filePath = taskFilePath(tasksDir, task.id);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Task "${task.id}" not found`);
      }
      const release = await lockfile.lock(filePath, LOCK_OPTIONS);
      try {
        if (opts.ifStatus !== undefined && readTaskFile(filePath).status !== opts.ifStatus) return false;
        writeTaskFile(filePath, task);
        return true;
      } finally {
        await release();
      }
    },

    async expand(taskId, subtasks) {
      const filePath = taskFilePath(tasksDir, taskId);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Task "${taskId}" not found`);
      }

      const release = await lockfile.lock(filePath, LOCK_OPTIONS);
      try {
        const parent = readTaskFile(filePath);
        // Mark parent as in-progress
        const updatedParent: Task = { ...parent, status: "in-progress" };
        writeTaskFile(filePath, updatedParent);

        // Write each subtask
        subtasks.forEach((sub, i) => {
          const subId = `${taskId}.${i + 1}`;
          const subTask: Task = {
            ...sub,
            id: subId,
            status: "pending",
            parentId: taskId,
          };
          writeTaskFile(taskFilePath(tasksDir, subId), subTask);
        });
      } finally {
        await release();
      }
    },

    async next(_filter) {
      const pending = await this.list({ status: "pending" });
      return pending[0] ?? null;
    },
  };
}
