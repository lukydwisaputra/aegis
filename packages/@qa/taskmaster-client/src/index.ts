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

function writeTaskFile(filePath: string, task: Task): void {
  fs.writeFileSync(filePath, JSON.stringify(task, null, 2), "utf-8");
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
