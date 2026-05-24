import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import lockfile from "proper-lockfile";
import {
  LessonEntrySchema,
  LessonsFileSchema,
  type LessonEntry,
  type LessonsFile,
  type LessonPolarity,
  type LessonTrigger,
  CorrectiveInstructionSchema,
  type CorrectiveInstruction,
} from "@qa/contracts";
import { nextId } from "@qa/ids";

// ─── Hard caps ────────────────────────────────────────────────────────────────

const MAX_ACTIVE_ENTRIES = 50;
const AGE_PRUNE_DAYS = 90;
const PRUNE_MIN_HIT_COUNT = 2;
const NO_RECUR_RUNS = 10;

// ─── Candidate type ───────────────────────────────────────────────────────────

export interface LessonCandidate {
  polarity: LessonPolarity;
  trigger: LessonTrigger;
  mistake: string;
  rootCause: string;
  correctiveRule: string;
  evidence?: string[];
  appliesWhen?: string;
}

// ─── Similarity check (simple token-set ratio) ───────────────────────────────

function tokenSet(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean));
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  const intersection = new Set([...setA].filter((t) => setB.has(t)));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

const DEDUP_THRESHOLD = 0.7;

// ─── File paths ───────────────────────────────────────────────────────────────

function agentMemoryDir(aegisRoot: string, agentName: string): string {
  return resolve(aegisRoot, "agent-memory", agentName);
}

function lessonsJsonPath(aegisRoot: string, agentName: string): string {
  return resolve(agentMemoryDir(aegisRoot, agentName), "lessons.json");
}

function lessonsMdPath(aegisRoot: string, agentName: string): string {
  return resolve(agentMemoryDir(aegisRoot, agentName), "lessons.md");
}

function archiveDir(aegisRoot: string, agentName: string): string {
  return resolve(agentMemoryDir(aegisRoot, agentName), "archive");
}

// ─── Read / write helpers ─────────────────────────────────────────────────────

function readLessonsFile(path: string, agentName: string): LessonsFile {
  if (!existsSync(path)) {
    return {
      agent: agentName,
      schemaVersion: "1.0",
      lastUpdatedAt: new Date().toISOString(),
      entries: [],
    };
  }
  return LessonsFileSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
}

function writeLessonsFile(path: string, file: LessonsFile): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n", "utf-8");
}

// ─── MD renderer ─────────────────────────────────────────────────────────────

function renderLessonsMd(file: LessonsFile): string {
  const sorted = [...file.entries].sort((a, b) => {
    if (b.hitCount !== a.hitCount) return b.hitCount - a.hitCount;
    return b.lastSeen.localeCompare(a.lastSeen);
  });

  const lines: string[] = [
    `# Lessons — ${file.agent}`,
    "",
    `_Last updated: ${file.lastUpdatedAt} · ${sorted.length} active entries_`,
    "",
  ];

  for (const entry of sorted) {
    const polarityIcon = entry.polarity === "negative" ? "⚠" : "✓";
    lines.push(`## ${polarityIcon} ${entry.id} · hits: ${entry.hitCount}`);
    lines.push("");
    lines.push(`**Trigger:** \`${entry.trigger}\``);
    lines.push("");
    lines.push(`**Mistake:** ${entry.mistake}`);
    lines.push("");
    lines.push(`**Root cause:** ${entry.rootCause}`);
    lines.push("");
    lines.push(`**Rule:** ${entry.correctiveRule}`);
    if (entry.appliesWhen) {
      lines.push("");
      lines.push(`**Applies when:** ${entry.appliesWhen}`);
    }
    lines.push("");
    lines.push(`_First seen: ${entry.firstSeen} · Last seen: ${entry.lastSeen}_`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ─── proposeLesson ────────────────────────────────────────────────────────────

export type ProposeResult =
  | { outcome: "appended"; lessonId: string }
  | { outcome: "deduped"; existingId: string }
  | { outcome: "conflict"; description: string }
  | { outcome: "schema-rejected"; error: string };

/**
 * Propose a new lesson entry for the given agent.
 * Handles dedup, conflict detection, cap enforcement, and MD re-render.
 * This function is the ONLY writer to lessons.json — all others use read paths.
 */
export async function proposeLesson(
  agentName: string,
  candidate: LessonCandidate,
  aegisRoot: string
): Promise<ProposeResult> {
  // Derive agent initials for ID generation (first 2 uppercase chars of each word)
  const initials = agentName
    .replace(/^qa-/, "")
    .split("-")
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 4) || "XX";

  const jsonPath = lessonsJsonPath(aegisRoot, agentName);
  const dir = dirname(jsonPath);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(jsonPath)) writeLessonsFile(jsonPath, readLessonsFile(jsonPath, agentName));

  const release = await lockfile.lock(jsonPath, {
    stale: 5_000,
    retries: { retries: 6, minTimeout: 50 },
  });

  try {
    const file = readLessonsFile(jsonPath, agentName);
    const now = new Date().toISOString();

    // 1. Dedup check
    for (const existing of file.entries) {
      const sim = jaccardSimilarity(existing.rootCause, candidate.rootCause);
      if (sim >= DEDUP_THRESHOLD) {
        existing.hitCount += 1;
        existing.lastSeen = now;
        file.lastUpdatedAt = now;
        writeLessonsFile(jsonPath, file);
        writeFileSync(lessonsMdPath(aegisRoot, agentName), renderLessonsMd(file), "utf-8");
        return { outcome: "deduped", existingId: existing.id };
      }
    }

    // 2. Conflict check — look for contradictory rules
    const ruleWords = tokenSet(candidate.correctiveRule);
    for (const existing of file.entries) {
      const existingWords = tokenSet(existing.correctiveRule);
      // Simple heuristic: one says "always X" while another says "never X"
      const candidateNever = /\bnever\b/.test(candidate.correctiveRule.toLowerCase());
      const candidateAlways = /\balways\b/.test(candidate.correctiveRule.toLowerCase());
      const existingNever = /\bnever\b/.test(existing.correctiveRule.toLowerCase());
      const existingAlways = /\balways\b/.test(existing.correctiveRule.toLowerCase());

      if ((candidateNever && existingAlways) || (candidateAlways && existingNever)) {
        const topicOverlap = jaccardSimilarity(candidate.correctiveRule, existing.correctiveRule);
        if (topicOverlap >= 0.4) {
          return {
            outcome: "conflict",
            description: `New rule "${candidate.correctiveRule}" conflicts with existing "${existing.correctiveRule}" (id: ${existing.id})`,
          };
        }
      }
    }

    // 3. Schema validation
    const now2 = new Date().toISOString();
    const id = await nextId("L", initials);
    const entryRaw: LessonEntry = {
      id,
      polarity: candidate.polarity,
      trigger: candidate.trigger,
      mistake: candidate.mistake,
      rootCause: candidate.rootCause,
      correctiveRule: candidate.correctiveRule,
      evidence: candidate.evidence ?? [],
      firstSeen: now2,
      lastSeen: now2,
      hitCount: 1,
      appliesWhen: candidate.appliesWhen,
    };

    const parsed = LessonEntrySchema.safeParse(entryRaw);
    if (!parsed.success) {
      return { outcome: "schema-rejected", error: parsed.error.message };
    }

    // 4. Cap enforcement — evict oldest + lowest hitCount if over cap
    if (file.entries.length >= MAX_ACTIVE_ENTRIES) {
      const evictable = file.entries
        .filter((e) => e.hitCount < PRUNE_MIN_HIT_COUNT)
        .sort((a, b) => {
          if (a.hitCount !== b.hitCount) return a.hitCount - b.hitCount;
          return a.lastSeen.localeCompare(b.lastSeen);
        });

      if (evictable.length === 0) {
        // All entries are high-value; evict oldest by lastSeen
        file.entries.sort((a, b) => a.lastSeen.localeCompare(b.lastSeen));
        evictable.push(file.entries[0]!);
      }

      const toEvict = evictable[0]!;
      file.entries = file.entries.filter((e) => e.id !== toEvict.id);

      // Write to archive
      const archivePath = resolve(archiveDir(aegisRoot, agentName), `${now2.slice(0, 7)}.json`);
      mkdirSync(dirname(archivePath), { recursive: true });
      let archive: LessonEntry[] = [];
      if (existsSync(archivePath)) {
        try { archive = JSON.parse(readFileSync(archivePath, "utf-8")); } catch { /* empty */ }
      }
      archive.push(toEvict);
      writeFileSync(archivePath, JSON.stringify(archive, null, 2) + "\n", "utf-8");
    }

    file.entries.push(parsed.data);
    file.lastUpdatedAt = now2;
    writeLessonsFile(jsonPath, file);
    writeFileSync(lessonsMdPath(aegisRoot, agentName), renderLessonsMd(file), "utf-8");

    return { outcome: "appended", lessonId: id };
  } finally {
    await release();
  }
}

/**
 * Auto-pipe a CorrectiveInstruction from an SPV review into the worker's lessons file.
 */
export async function pipeCorrectiveInstruction(
  workerAgent: string,
  instruction: CorrectiveInstruction,
  trigger: LessonTrigger,
  evidence: string[],
  aegisRoot: string
): Promise<ProposeResult> {
  const validated = CorrectiveInstructionSchema.safeParse(instruction);
  if (!validated.success) {
    return { outcome: "schema-rejected", error: validated.success === false ? validated.error.message : "" };
  }

  return proposeLesson(
    workerAgent,
    {
      polarity: "negative",
      trigger,
      mistake: validated.data.mistake,
      rootCause: validated.data.rootCause,
      correctiveRule: validated.data.correctiveRule,
      appliesWhen: validated.data.appliesWhen,
      evidence,
    },
    aegisRoot
  );
}

/**
 * Prune aged-out entries from a lessons file.
 * Entries with hitCount < PRUNE_MIN_HIT_COUNT and lastSeen > AGE_PRUNE_DAYS days ago are archived.
 */
export async function pruneAgedEntries(
  agentName: string,
  aegisRoot: string
): Promise<{ pruned: number }> {
  const jsonPath = lessonsJsonPath(aegisRoot, agentName);
  if (!existsSync(jsonPath)) return { pruned: 0 };

  const release = await lockfile.lock(jsonPath, { stale: 5_000, retries: { retries: 5, minTimeout: 50 } });
  try {
    const file = readLessonsFile(jsonPath, agentName);
    const now = Date.now();
    const cutoff = now - AGE_PRUNE_DAYS * 24 * 60 * 60 * 1000;
    const toEvict = file.entries.filter((e) => {
      return e.hitCount < PRUNE_MIN_HIT_COUNT && new Date(e.lastSeen).getTime() < cutoff;
    });

    if (toEvict.length === 0) return { pruned: 0 };

    const archivePath = resolve(
      archiveDir(aegisRoot, agentName),
      `${new Date().toISOString().slice(0, 7)}.json`
    );
    mkdirSync(dirname(archivePath), { recursive: true });
    let archive: LessonEntry[] = [];
    if (existsSync(archivePath)) {
      try { archive = JSON.parse(readFileSync(archivePath, "utf-8")); } catch { /* empty */ }
    }
    archive.push(...toEvict);
    writeFileSync(archivePath, JSON.stringify(archive, null, 2) + "\n", "utf-8");

    const evictIds = new Set(toEvict.map((e) => e.id));
    file.entries = file.entries.filter((e) => !evictIds.has(e.id));
    file.lastUpdatedAt = new Date().toISOString();

    writeLessonsFile(jsonPath, file);
    writeFileSync(lessonsMdPath(aegisRoot, agentName), renderLessonsMd(file), "utf-8");

    return { pruned: toEvict.length };
  } finally {
    await release();
  }
}

/**
 * Read the lessons file for a given agent (read-only, no lock needed).
 */
export function readLessons(agentName: string, aegisRoot: string): LessonsFile {
  return readLessonsFile(lessonsJsonPath(aegisRoot, agentName), agentName);
}

export type { LessonCandidate, LessonEntry, LessonsFile, ProposeResult };
