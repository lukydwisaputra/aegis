import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import lockfile from "proper-lockfile";
import {
  IdKindSchema,
  type IdKind,
  TestCaseIdSchema,
  DefectIdSchema,
  StoryIdSchema,
  RequirementIdSchema,
  RiskIdSchema,
  LessonIdSchema,
  WorkReportIdSchema,
} from "@qa/contracts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Counter file location ────────────────────────────────────────────────────

// Resolved relative to the aegis/ root, two levels up from packages/@qa/ids/src
function getCountersPath(): string {
  const envPath = process.env["AEGIS_COUNTERS_PATH"];
  if (envPath) return resolve(envPath);
  return resolve(__dirname, "../../../../.aegis/.counters.json");
}

type Counters = Record<string, Record<string, number>>;

function readCounters(path: string): Counters {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Counters;
  } catch {
    return {};
  }
}

function writeCounters(path: string, counters: Counters): void {
  writeFileSync(path, JSON.stringify(counters, null, 2) + "\n", "utf-8");
}

// ─── Atomic counter increment ─────────────────────────────────────────────────

async function nextCounter(kind: IdKind, module: string): Promise<number> {
  const countersPath = getCountersPath();

  // Ensure file exists before locking
  if (!existsSync(countersPath)) {
    const dir = dirname(countersPath);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(countersPath, "{}\n", "utf-8");
  }

  const release = await lockfile.lock(countersPath, { retries: { retries: 5, minTimeout: 50 } });
  try {
    const counters = readCounters(countersPath);
    if (!counters[kind]) counters[kind] = {};
    const current = counters[kind]![module] ?? 0;
    const next = current + 1;
    counters[kind]![module] = next;
    writeCounters(countersPath, counters);
    return next;
  } finally {
    await release();
  }
}

// ─── ID format helpers ────────────────────────────────────────────────────────

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

// ─── nextId — the public API ──────────────────────────────────────────────────

export type NextIdOptions = { module?: string };

export async function nextId(kind: "TC", module: string): Promise<string>;
export async function nextId(kind: "DEF", module: string): Promise<string>;
export async function nextId(kind: "STORY", module: string): Promise<string>;
export async function nextId(kind: "REQ", module: string): Promise<string>;
export async function nextId(kind: "RISK", module: string): Promise<string>;
export async function nextId(kind: "L", agentInitials: string): Promise<string>;
export async function nextId(kind: "WR", taskNumber: number | string): Promise<string>;
export async function nextId(kind: IdKind, moduleOrArg: string | number): Promise<string> {
  const kindParsed = IdKindSchema.parse(kind);
  const mod = String(moduleOrArg).toUpperCase();

  switch (kindParsed) {
    case "TC": {
      const n = await nextCounter("TC", mod);
      return `TC-${mod}-${pad(n, 3)}`;
    }
    case "DEF": {
      const n = await nextCounter("DEF", mod);
      return `DEF-${mod}-${pad(n, 4)}`;
    }
    case "STORY": {
      const n = await nextCounter("STORY", mod);
      return `STORY-${mod}-${pad(n, 3)}`;
    }
    case "REQ": {
      const n = await nextCounter("REQ", mod);
      return `REQ-${mod}-${pad(n, 2)}`;
    }
    case "RISK": {
      const n = await nextCounter("RISK", mod);
      return `RISK-${mod}-${pad(n, 3)}`;
    }
    case "L": {
      // agentInitials e.g. "TD" for qa-test-designer
      const n = await nextCounter("L", mod);
      return `L-${mod}-${pad(n, 3)}`;
    }
    case "WR": {
      // taskNumber is passed as module arg
      return `WR-T-${mod}`;
    }
    case "RUN": {
      const n = await nextCounter("RUN", mod);
      return `RUN-${mod}-${pad(n, 3)}`;
    }
    default:
      throw new Error(`nextId: unsupported kind "${kindParsed}"`);
  }
}

// ─── Format validators (convenience re-exports) ───────────────────────────────

export { TestCaseIdSchema, DefectIdSchema, StoryIdSchema, RequirementIdSchema, RiskIdSchema, LessonIdSchema, WorkReportIdSchema };

// ─── Duplicate ID scanner (used by pre-commit hook) ──────────────────────────

export type DuplicateScanResult = {
  hasDuplicates: boolean;
  duplicates: Array<{ id: string; paths: string[] }>;
};

const ID_PATTERN = /\b(TC|DEF|STORY|REQ|RISK|RISK)-[A-Z]{2,8}-\d{2,5}\b/g;

export async function scanForDuplicateIds(rootDir: string): Promise<DuplicateScanResult> {
  const { globby } = await import("globby");
  const { readFileSync } = await import("node:fs");

  const files = await globby(["**/*.{json,md}", "!node_modules", "!dist", "!books/raw"], {
    cwd: rootDir,
    absolute: true,
  });

  const idToFiles = new Map<string, Set<string>>();

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const matches = content.match(ID_PATTERN) ?? [];
    for (const id of new Set(matches)) {
      if (!idToFiles.has(id)) idToFiles.set(id, new Set());
      idToFiles.get(id)!.add(file);
    }
  }

  const duplicates: DuplicateScanResult["duplicates"] = [];
  for (const [id, paths] of idToFiles) {
    if (paths.size > 1) {
      duplicates.push({ id, paths: Array.from(paths) });
    }
  }

  return { hasDuplicates: duplicates.length > 0, duplicates };
}
