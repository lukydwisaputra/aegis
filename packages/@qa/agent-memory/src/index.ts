import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
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

/**
 * A4: the shared run-state lock budget (50 retries, 20-250 ms, ~11 s). It outlasts `stale` (5 s), so a crashed
 * holder's lock is reclaimed and a busy one waited out instead of leaking ELOCKED.
 */
const LOCK_OPTIONS = { stale: 5_000, retries: { retries: 50, minTimeout: 20, maxTimeout: 250 } };

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

// ─── Lesson ids ───────────────────────────────────────────────────────────────

/**
 * The AGENT-INITIALS of a lesson id (`L-{AGENT-INITIALS}-{NNN}`, two to four capital letters), derived from the agent
 * name alone so that every caller gets the same answer and no one supplies an id:
 *   1. drop the `qa-` prefix and split the rest on `-`;
 *   2. take the first letter of each word, in order, at most four (`qa-compliance-spv` CS, `qa-defect-manager-spv` DMS,
 *      `qa-dev-test-reviewer-spv` DTRS, `qa-web-explorer` WE);
 *   3. a one-word name (`qa-orchestrator`, `qa-curator`) gives one letter, so its first two letters are used instead
 *      (OR, CU); a name that still yields fewer than two letters is padded with X.
 * Two agents may share initials; ids are unique inside one agent's lessons file, which is the only place they live.
 */
export function lessonInitials(agentName: string): string {
  const words = agentName.replace(/^qa-/, "").split("-").map((w) => w.replace(/[^A-Za-z]/g, "")).filter((w) => w.length > 0);
  let initials = words.map((w) => w[0]!.toUpperCase()).join("").slice(0, 4);
  if (initials.length < 2) initials = ((words[0] ?? "").slice(0, 2).toUpperCase() + "XX").slice(0, 2);
  return initials;
}

/**
 * The next free lesson id of `agentName`: one above the highest `L-{INITIALS}-{NNN}` held by its active entries or its
 * archive (an evicted id is never reused). Past 999 the lowest unused number is taken; with none left the caller gets an
 * error rather than an id the schema would refuse.
 */
function nextLessonId(agentName: string, file: LessonsFile, archivePath: string): { id: string; error?: undefined } | { id: null; error: string } {
  const initials = lessonInitials(agentName);
  const re = new RegExp(`^L-${initials}-(\\d{3})$`);
  const used = new Set<number>();
  const note = (id: unknown): void => {
    const m = typeof id === "string" ? re.exec(id) : null;
    if (m !== null) used.add(Number(m[1]));
  };
  for (const e of file.entries) note(e.id);
  if (existsSync(archivePath)) {
    for (const name of readdirSync(archivePath).filter((n) => n.endsWith(".json"))) {
      try {
        const archived: unknown = JSON.parse(readFileSync(resolve(archivePath, name), "utf-8"));
        if (Array.isArray(archived)) for (const e of archived) note((e as { id?: unknown } | null)?.id);
      } catch { /* an unreadable archive month only loses the no-reuse guarantee for that month */ }
    }
  }
  let next = Math.max(0, ...used) + 1;
  if (next > 999) next = Array.from({ length: 999 }, (_, i) => i + 1).find((n) => !used.has(n)) ?? 0;
  if (next === 0) return { id: null, error: `all 999 lesson ids L-${initials}-NNN of ${agentName} are in use; run /qa-promote or prune its lessons` };
  return { id: `L-${initials}-${String(next).padStart(3, "0")}` };
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
  const jsonPath = lessonsJsonPath(aegisRoot, agentName);
  const dir = dirname(jsonPath);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(jsonPath)) writeLessonsFile(jsonPath, readLessonsFile(jsonPath, agentName));

  const release = await lockfile.lock(jsonPath, LOCK_OPTIONS);

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
    const assigned = nextLessonId(agentName, file, archiveDir(aegisRoot, agentName));
    if (assigned.id === null) return { outcome: "schema-rejected", error: assigned.error };
    const id = assigned.id;
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
        .filter((e: LessonEntry) => e.hitCount < PRUNE_MIN_HIT_COUNT)
        .sort((a: LessonEntry, b: LessonEntry) => {
          if (a.hitCount !== b.hitCount) return a.hitCount - b.hitCount;
          return a.lastSeen.localeCompare(b.lastSeen);
        });

      if (evictable.length === 0) {
        // All entries are high-value; evict oldest by lastSeen
        file.entries.sort((a: LessonEntry, b: LessonEntry) => a.lastSeen.localeCompare(b.lastSeen));
        evictable.push(file.entries[0]!);
      }

      const toEvict = evictable[0]!;
      file.entries = file.entries.filter((e: LessonEntry) => e.id !== toEvict.id);

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
      ...(validated.data.appliesWhen !== undefined && { appliesWhen: validated.data.appliesWhen }),
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

  const release = await lockfile.lock(jsonPath, LOCK_OPTIONS);
  try {
    const file = readLessonsFile(jsonPath, agentName);
    const now = Date.now();
    const cutoff = now - AGE_PRUNE_DAYS * 24 * 60 * 60 * 1000;
    const toEvict = file.entries.filter((e: LessonEntry) => {
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

    const evictIds = new Set(toEvict.map((e: LessonEntry) => e.id));
    file.entries = file.entries.filter((e: LessonEntry) => !evictIds.has(e.id));
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

