import { basename } from "node:path";
import { parseBaseline } from "./growth.js";
import { contractRange, frontmatterLite } from "./markdown.js";

/** One file of a `git diff --unified=0 --no-renames` patch. Line numbers are 1-based. */
export interface DiffFile {
  file: string;
  deleted: boolean;
  binary: boolean;
  removed: Array<{ line: number; text: string }>;
  added: Array<{ line: number; text: string }>;
}

/** The evidence one changed file gives the shrink guard. */
export interface FileChange {
  file: string;
  /** A non-blank removed line outside the base contract block, or added line outside the head one. */
  linesOutsideContract: boolean;
  deleted: boolean;
}

export interface SubjectIndex {
  /** Unit name → repo-relative file, from the head and base trees. */
  units: Readonly<Record<string, string>>;
  /** Every tracked path in the head and base trees. */
  files: ReadonlySet<string>;
}

export interface ShrinkFinding {
  key: string;
  subject: string;
  /** The files whose change would have justified the removal ([] = none can). */
  files: string[];
}

/** Units whose prose anchors `.claude/pipeline.yaml` (spec §4.5). */
export const PIPELINE_ANCHOR_UNITS: readonly string[] = ["qa-test-executor", "qa-test-designer", "qa-orchestrator"];
const PIPELINE_SUBJECTS: ReadonlySet<string> = new Set(["pipeline", "testType", "testTechnique", "target"]);

function unquote(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"')) return p;
  try {
    return JSON.parse(p) as string;
  } catch {
    return p.slice(1, -1);
  }
}

export function parseUnifiedDiff(patch: string): DiffFile[] {
  const out: DiffFile[] = [];
  const lines = patch.split("\n");
  let cur: DiffFile | null = null;
  let oldPath: string | null = null;
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.startsWith("diff --git ")) {
      cur = { file: "", deleted: false, binary: false, removed: [], added: [] };
      out.push(cur);
      oldPath = null;
      // --no-renames: both sides name the same path, "a/P b/P" (binary diffs have no ---/+++ lines).
      const rest = l.slice("diff --git ".length);
      if (!rest.startsWith('"')) cur.file = rest.slice(2, 2 + (rest.length - 5) / 2);
      i++;
      continue;
    }
    if (cur === null) {
      i++;
      continue;
    }
    if (l.startsWith("deleted file mode")) cur.deleted = true;
    else if (l.startsWith("Binary files ")) cur.binary = true;
    else if (l.startsWith("--- ")) {
      const p = unquote(l.slice(4));
      if (p !== "/dev/null") oldPath = p.replace(/^a\//, "");
    } else if (l.startsWith("+++ ")) {
      const p = unquote(l.slice(4));
      cur.file = p === "/dev/null" ? (oldPath ?? cur.file) : p.replace(/^b\//, "");
    } else {
      const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
      if (h !== null) {
        let oldLine = Number(h[1]);
        let remOld = h[2] === undefined ? 1 : Number(h[2]);
        let newLine = Number(h[3]);
        let remNew = h[4] === undefined ? 1 : Number(h[4]);
        i++;
        // Consume exactly the hunk's lines, so a removed "-- x" line ("--- x") is never read as a header.
        while (i < lines.length && (remOld > 0 || remNew > 0)) {
          const c = lines[i]!;
          if (c.startsWith("-") && remOld > 0) {
            cur.removed.push({ line: oldLine++, text: c.slice(1) });
            remOld--;
          } else if (c.startsWith("+") && remNew > 0) {
            cur.added.push({ line: newLine++, text: c.slice(1) });
            remNew--;
          } else if (!c.startsWith("\\")) break;
          i++;
        }
        continue;
      }
    }
    i++;
  }
  return out;
}

const inRange = (r: { start: number; end: number } | null, line: number) => r !== null && line >= r.start && line <= r.end;

export function fileChanges(diff: readonly DiffFile[], source: (file: string, side: "base" | "head") => string | null): FileChange[] {
  return diff.map((d) => {
    const base = source(d.file, "base");
    const head = d.deleted ? null : source(d.file, "head");
    const baseRange = base === null ? null : contractRange(base);
    const headRange = head === null ? null : contractRange(head);
    const outside =
      d.binary ||
      d.removed.some((l) => l.text.trim() !== "" && !inRange(baseRange, l.line)) ||
      d.added.some((l) => l.text.trim() !== "" && !inRange(headRange, l.line));
    return { file: d.file, linesOutsideContract: outside, deleted: d.deleted };
  });
}

/** The unit a tracked path defines, named the way the loader names it; null for any other file. */
export function unitNameOf(file: string, source: string | null): string | null {
  const skill = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(file);
  if (skill !== null) return skill[1]!;
  if (!/^\.claude\/agents\/.+\.md$/.test(file)) return null;
  return (source !== null ? frontmatterLite(source).name : undefined) ?? basename(file, ".md");
}

/** Subject of `RULE:subject:detail:reason`: the longest known subject, so ":" inside a subject or detail maps correctly. */
export function subjectOf(key: string, index: SubjectIndex): string {
  const rest = key.slice(key.indexOf(":") + 1);
  const cut = rest.indexOf(":");
  let subject = cut === -1 ? rest : rest.slice(0, cut);
  let best = -1;
  for (const s of [...Object.keys(index.units), ...index.files, ...PIPELINE_SUBJECTS]) {
    if (s.length > best && rest.startsWith(`${s}:`)) {
      subject = s;
      best = s.length;
    }
  }
  return subject;
}

type Evidence = { file: string; mode: "outside-contract" | "any" };

function evidenceFor(rule: string, subject: string, index: SubjectIndex): Evidence[] {
  if (rule === "ROUTE" || rule === "ENV" || PIPELINE_SUBJECTS.has(subject)) {
    const anchors: Evidence[] = PIPELINE_ANCHOR_UNITS.flatMap((u) => {
      const file = index.units[u];
      return file === undefined ? [] : [{ file, mode: "outside-contract" as const }];
    });
    return rule === "ENV" ? [...anchors, { file: "aegis.config.json", mode: "any" }] : anchors;
  }
  const unit = index.units[subject];
  if (unit !== undefined) return [{ file: unit, mode: "outside-contract" }];
  if (index.files.has(subject)) {
    const isUnitFile = Object.values(index.units).includes(subject);
    return [{ file: subject, mode: isUnitFile ? "outside-contract" : "any" }];
  }
  return [];
}

/** Removed baseline keys whose subject has no prose evidence in the PR (spec §2). */
export function baselineShrink(baseYaml: string | null, headYaml: string, changes: readonly FileChange[], index: SubjectIndex): ShrinkFinding[] {
  const head = new Set(parseBaseline(headYaml, "head").entries.map((e) => e.key));
  if (baseYaml === null) return [];
  const removed = [...new Set(parseBaseline(baseYaml, "base").entries.map((e) => e.key))].filter((k) => !head.has(k)).sort();
  const byFile = new Map(changes.map((c) => [c.file, c]));
  const out: ShrinkFinding[] = [];
  for (const key of removed) {
    const rule = key.slice(0, key.indexOf(":"));
    const subject = subjectOf(key, index);
    const evidence = evidenceFor(rule, subject, index);
    const justified = evidence.some(({ file, mode }) => {
      const c = byFile.get(file);
      return c !== undefined && (c.deleted || mode === "any" || c.linesOutsideContract);
    });
    if (!justified) out.push({ key, subject, files: evidence.map((e) => e.file) });
  }
  return out;
}
