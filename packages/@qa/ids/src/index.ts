import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, parse as parsePath, join } from "node:path";
import lockfile from "proper-lockfile";

// Find the aegis project root by walking up from cwd looking for a marker file
// (`aegis.config.json`). Falls back to cwd if no marker is found. This avoids any
// dependency on `__dirname`/`import.meta.url`, so it works identically whether the
// module is loaded as ESM (the built dist) or transpiled to CommonJS (ts-jest).
function findAegisRoot(): string {
  let dir = process.cwd();
  const { root } = parsePath(dir);
  while (true) {
    if (existsSync(join(dir, "aegis.config.json"))) return dir;
    if (dir === root) return process.cwd();
    dir = dirname(dir);
  }
}
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

// ─── Counter file location ────────────────────────────────────────────────────

// Resolved relative to the aegis/ root, two levels up from packages/@qa/ids/src
function getCountersPath(): string {
  const envPath = process.env["AEGIS_COUNTERS_PATH"];
  if (envPath) return resolve(envPath);
  // Default: <aegis-root>/.aegis/.counters.json, discovered by walking up from cwd.
  return resolve(findAegisRoot(), ".aegis", ".counters.json");
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

  // A4: the shared run-state budget (50 retries, 20-250 ms, ~11 s), longer than `stale`, so a crashed holder's lock
  // is reclaimed and a busy one waited out instead of leaking ELOCKED.
  const release = await lockfile.lock(countersPath, { stale: 10_000, retries: { retries: 50, minTimeout: 20, maxTimeout: 250 } });
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

export type DefectType = "UI" | "API" | "A11Y" | "SEC" | "PERF" | "DATA" | "UNIT" | "EXP";

export type AcCategory = "happy" | "rejection" | "edge";

const AC_LETTER: Record<AcCategory, "H" | "R" | "E"> = { happy: "H", rejection: "R", edge: "E" };

export async function nextId(kind: "TC", module: string): Promise<string>;
export async function nextId(kind: "DEF", module: string, defectType: DefectType): Promise<string>;
export async function nextId(kind: "STORY", module: string): Promise<string>;
export async function nextId(kind: "REQ", module: string): Promise<string>;
export async function nextId(kind: "RISK", module: string): Promise<string>;
export async function nextId(kind: "L", agentInitials: string): Promise<string>;
export async function nextId(kind: "WR", taskNumber: number | string): Promise<string>;
export async function nextId(kind: "RUN", yyyymmdd: string): Promise<string>;
export async function nextId(kind: "AC", storyId: string, category: AcCategory): Promise<string>;
export async function nextId(kind: IdKind, moduleOrArg: string | number, extra?: DefectType | AcCategory): Promise<string> {
  const kindParsed = IdKindSchema.parse(kind);
  const mod = String(moduleOrArg).toUpperCase();

  switch (kindParsed) {
    case "TC": {
      const n = await nextCounter("TC", mod);
      return `TC-${mod}-${pad(n, 3)}`;
    }
    case "DEF": {
      const type = String(extra ?? "UI").toUpperCase();
      // NNN is a single global counter per MODULE — leads the ID so files sort by discovery order
      const n = await nextCounter("DEF", mod);
      return `DEF-${pad(n, 3)}-${mod}-${type}`;
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
      // A full task id (T-42, T-design-1, T-GATE-G1) keeps its case; a bare task number becomes T-<n>.
      const raw = String(moduleOrArg);
      return WorkReportIdSchema.parse(raw.startsWith("T-") ? `WR-${raw}` : `WR-T-${raw}`);
    }
    case "RUN": {
      const n = await nextCounter("RUN", mod);
      return `RUN-${mod}-${pad(n, 3)}`;
    }
    case "AC": {
      const story = StoryIdSchema.parse(mod); // STORY-AUTH-003
      // Own keys only: an inherited key such as "constructor" is not a category.
      const letter = typeof extra === "string" && Object.hasOwn(AC_LETTER, extra) ? AC_LETTER[extra as AcCategory] : undefined;
      if (letter === undefined) {
        throw new Error(`nextId("AC"): category must be happy|rejection|edge, got "${String(extra)}"`);
      }
      const [, storyModule, storyNumber] = story.split("-") as [string, string, string];
      const n = await nextCounter("AC", `${story}:${letter}`);
      return `AC-${storyModule}-${storyNumber}-${letter}${n}`;
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

const ID_PATTERN = /\b(TC|STORY|REQ|RISK)-[A-Z]{2,8}-\d{2,5}\b|\bDEF-\d{3,4}-[A-Z]{2,8}-(UI|API|A11Y|SEC|PERF|DATA|UNIT|EXP)\b/g;

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
