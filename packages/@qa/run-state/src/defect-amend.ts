import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DefectG2TriageSchema, DefectIdSchema, DefectSchema, RequirementIdSchema, RetestVerdictSchema, StoryIdSchema, checkBrandExposure } from "@qa/contracts";
import { readdirSync } from "node:fs";
import { appendChained } from "@qa/event-bus";
import { assertCallerAllowed, OWNER } from "./caller.js";
import { RunStateError } from "./errors.js";
import { busPath, runDir } from "./paths.js";
import { readRun, withRunLock } from "./run.js";
import { atomicWrite, formatIssues, iso } from "./util.js";

/**
 * The fields `aegis defect amend` may change, by their dotted path in the defect record: everything under `retestVerdict` and
 * `g2Triage` (the object itself included, so a missing retest verdict can be added), `status.code` and
 * `status.transitionedAt`, and the requirement and story links `requirementId` and `userStory` (checked against their id formats, for a
 * record linked to the wrong requirement). Nothing else is amendable: not the severity, the evidence, the reproduction steps, and never the
 * record's `history`.
 */
export const AMENDABLE_DEFECT_FIELDS = "retestVerdict[.*], g2Triage[.*], status.code, status.transitionedAt, requirementId, userStory";

const SEGMENT = /^[A-Za-z][A-Za-z0-9]*$/;
const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);
const STATUS_FIELDS: ReadonlySet<string> = new Set(["code", "transitionedAt"]);

export interface DefectChange {
  path: string;
  value: unknown;
}

export interface AmendedField {
  path: string;
  oldValue: unknown;
  newValue: unknown;
  oldDigest: string;
  newDigest: string;
}

export interface AmendDefectResult {
  runId: string;
  defectId: string;
  /** Run-relative path of the record that was rewritten. */
  path: string;
  changes: AmendedField[];
  reason: string;
}

const isPlain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const digest = (v: unknown): string => createHash("sha256").update(v === undefined ? "absent" : JSON.stringify(v)).digest("hex");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The path's segments when it is amendable, else a refusal that names the allowed fields. */
export function amendablePath(path: string): string[] {
  const segments = path.split(".");
  const bad = (why: string): RunStateError => new RunStateError("invalid-input", `field "${path}" ${why}; amendable fields: ${AMENDABLE_DEFECT_FIELDS}`);
  if (segments.some((s) => !SEGMENT.test(s) || FORBIDDEN_SEGMENTS.has(s))) throw bad("is not a dotted field path");
  const root = segments[0]!;
  if (root === "requirementId" || root === "userStory") {
    if (segments.length !== 1) throw bad("is not amendable");
    return segments;
  }
  if (root === "status") {
    if (segments.length !== 2 || !STATUS_FIELDS.has(segments[1]!)) throw bad("is not amendable");
    return segments;
  }
  if (root !== "retestVerdict" && root !== "g2Triage") throw bad("is not amendable");
  return segments;
}

/** A command-line value: JSON when it parses as JSON (null, numbers, objects, quoted text), else the text itself. */
export function parseChangeValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function eachString(v: unknown, fn: (s: string) => void): void {
  if (typeof v === "string") fn(v);
  else if (Array.isArray(v)) v.forEach((x) => eachString(x, fn));
  else if (isPlain(v)) Object.values(v).forEach((x) => eachString(x, fn));
}

function getAt(record: Record<string, unknown>, segments: readonly string[]): unknown {
  let cur: unknown = record;
  for (const s of segments) {
    if (!isPlain(cur) || !(s in cur)) return undefined;
    cur = cur[s];
  }
  return cur;
}

function setAt(record: Record<string, unknown>, segments: readonly string[], value: unknown, path: string): void {
  let cur = record;
  for (const s of segments.slice(0, -1)) {
    const next = cur[s];
    if (next === undefined) {
      const made: Record<string, unknown> = {};
      cur[s] = made;
      cur = made;
    } else if (isPlain(next)) {
      cur = next;
    } else {
      throw new RunStateError("invalid-input", `field "${path}": "${s}" is not an object in the record, so nothing can be set under it`);
    }
  }
  cur[segments[segments.length - 1]!] = value;
}

/** Issues of a record as comparable keys: an amendment is refused for the issues it adds, not for ones the record already had. */
function issueKeys(record: unknown): Set<string> {
  const r = DefectSchema.safeParse(record);
  return new Set(r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
}

function defectFile(root: string, runId: string, defectId: string): string {
  if (!DefectIdSchema.safeParse(defectId).success) {
    throw new RunStateError("invalid-input", `defect id "${defectId}" is not DEF-{NNN}-{MODULE}-{TYPE}`);
  }
  return join(runDir(root, runId), "defects", `${defectId}.json`);
}

/** An agent corrects records only while the run is running; the owner may also correct a stopped, blocked or completed run. */
function assertMayCorrect(root: string, runId: string, caller: string): void {
  const state = readRun(root, runId);
  if (caller === OWNER) return;
  if (state.stopRequested) throw new RunStateError("stop-requested", `run ${runId} has a stop request; no record may be corrected`);
  if (state.status !== "running") throw new RunStateError("run-not-active", `run ${runId} is "${state.status}"; a record is corrected only while it is running`);
}

function requireReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed === "") throw new RunStateError("invalid-input", "a reason is required: say what the gate decision or finding demands and why the record is wrong");
  return trimmed;
}

/**
 * `aegis defect amend`: change allow-listed fields of one defect record after triage (qa-defect-manager and the owner only),
 * for corrections a gate decision demands: stale retest text, a missing retest verdict, a status timestamp. The amended record
 * must still parse against DefectSchema (no issue the record did not already have) and its retestVerdict and g2Triage against
 * their schemas; new text is brand-checked because defects/** is customer-facing. One `defect.record-amended` event carries the
 * defect, every changed path with its old and new value and digest, the reason and the agent. Events and the record's `history`
 * are never edited. Lock order: run.lock -> event-bus lock. If the event cannot be recorded the record is put back, so the file
 * never holds a change the log does not.
 */
export async function amendDefect(root: string, runId: string, defectId: string, input: { changes: readonly DefectChange[]; reason: string; now?: Date }, caller: string): Promise<AmendDefectResult> {
  assertCallerAllowed(caller, "defect.amend");
  const reason = requireReason(input.reason);
  if (input.changes.length === 0) throw new RunStateError("invalid-input", `nothing to amend: give at least one field to change; amendable fields: ${AMENDABLE_DEFECT_FIELDS}`);
  const targets = input.changes.map((c) => ({ ...c, segments: amendablePath(c.path) }));
  const seen = new Set<string>();
  for (const t of targets) {
    if (seen.has(t.path)) throw new RunStateError("invalid-input", `field "${t.path}" is given twice`);
    seen.add(t.path);
    // The refusal never echoes the matching pattern: it would print the very term the reports must not carry.
    let branded = false;
    eachString(t.value, (s) => { if (checkBrandExposure(s) !== null) branded = true; });
    if (branded) throw new RunStateError("invalid-input", `the new value of ${t.path} is quoted in the reports and must not name the framework or an agent: it matches a forbidden term`);
  }
  const file = defectFile(root, runId, defectId);
  return withRunLock(root, runId, async () => {
    assertMayCorrect(root, runId, caller);
    if (!existsSync(file)) throw new RunStateError("invalid-input", `defect ${defectId} has no record in run ${runId}`);
    const priorText = readFileSync(file, "utf-8");
    let before: unknown;
    try {
      before = JSON.parse(priorText);
    } catch (e) {
      throw new RunStateError("invalid-input", `defects/${defectId}.json is not valid JSON: ${(e as Error).message}`);
    }
    if (!isPlain(before)) throw new RunStateError("invalid-input", `defects/${defectId}.json is not a JSON object`);
    const next = clone(before);
    const changes: AmendedField[] = [];
    for (const t of targets) {
      const oldValue = getAt(before, t.segments);
      if (JSON.stringify(oldValue) === JSON.stringify(t.value)) continue;
      setAt(next, t.segments, clone(t.value), t.path);
      changes.push({ path: t.path, oldValue: oldValue === undefined ? null : oldValue, newValue: t.value, oldDigest: digest(oldValue), newDigest: digest(t.value) });
    }
    if (changes.length === 0) throw new RunStateError("invalid-input", `nothing changes: every given value already equals the record's`);
    const added = [...issueKeys(next)].filter((k) => !issueKeys(before).has(k));
    if (added.length > 0) throw new RunStateError("invalid-input", `the amended record would be invalid: ${added.join("; ")}`);
    for (const [field, schema] of [["requirementId", RequirementIdSchema], ["userStory", StoryIdSchema]] as const) {
      if (changes.some((c) => c.path === field)) {
        const id = schema.safeParse(next[field]);
        if (!id.success) throw new RunStateError("invalid-input", `${field} would be invalid: ${formatIssues(id.error.issues)}`);
      }
    }
    if (changes.some((c) => c.path.split(".")[0] === "retestVerdict") && next["retestVerdict"] !== undefined) {
      const rv = RetestVerdictSchema.safeParse(next["retestVerdict"]);
      if (!rv.success) throw new RunStateError("invalid-input", `retestVerdict would be invalid: ${formatIssues(rv.error.issues)}`);
    }
    if (changes.some((c) => c.path.split(".")[0] === "g2Triage") && next["g2Triage"] !== undefined) {
      const g2 = DefectG2TriageSchema.safeParse(next["g2Triage"]);
      if (!g2.success) throw new RunStateError("invalid-input", `g2Triage would be invalid: ${formatIssues(g2.error.issues)}`);
    }
    atomicWrite(file, JSON.stringify(next, null, 2) + "\n");
    try {
      await appendChained(
        { type: "defect.record-amended", ts: iso(input.now), defectId, agent: caller, reason, changes },
        busPath(root, runId),
        { emittedBy: caller, runId }
      );
    } catch (e) {
      atomicWrite(file, priorText);
      throw e;
    }
    return { runId, defectId, path: `defects/${defectId}.json`, changes, reason };
  });
}

export interface UnlinkResult {
  runId: string;
  requirementId: string;
  defectId: string;
  reason: string;
  /** The defect ids the requirement's row still links (empty when the requirement has no row). */
  remaining: string[];
  /** Whether the pair was linked in the requirement's row of rtm.json. */
  rowLinkRemoved: boolean;
  /** The defectMap entries of this defect and requirement that were removed. */
  defectMapEntriesRemoved: number;
  /** Whether the defect table of rtm.md was re-rendered from the defectMap. */
  rtmMdUpdated: boolean;
}

// ─── rtm.md: the defect-to-case table is rendered from rtm.json#defectMap ────────────────────────────────────────────────────────────

/**
 * rtm.md is hand-written by qa-test-designer (prose, execution waves, candidate map), so it is not rendered whole. Only its defect-to-case
 * table is deterministic: it is `rtm.json#defectMap` as a table under the heading `## Defect-to-case map`, and that table (with the count in
 * its heading) is the one part the CLI rewrites, so it cannot disagree with rtm.json after a correction. Everything else in rtm.md stays.
 */
const DEFECT_SECTION = /^## Defect-to-case map.*$/m;
const DEFECT_TABLE_HEADER = ["Defect", "Sev", "Retest case", "Origin of case", "Story", "Acceptance criteria", "Wave", "Fix PR", "Note"];

const cell = (v: unknown): string => {
  const text = Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "" : String(v);
  const one = text.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();
  return one === "" ? "-" : one;
};

/** The defect table of rtm.md text rebuilt from the defectMap, or null when the text has no `## Defect-to-case map` section. */
export function renderDefectSection(md: string, defectMap: readonly unknown[]): string | null {
  const heading = DEFECT_SECTION.exec(md);
  if (heading === null) return null;
  const start = heading.index;
  const afterHeading = start + heading[0].length;
  const next = md.slice(afterHeading).search(/^## /m);
  const end = next < 0 ? md.length : afterHeading + next;
  const entries = defectMap.filter(isPlain).sort((a, b) => String(a["defectId"]).localeCompare(String(b["defectId"])));
  const table = [
    `| ${DEFECT_TABLE_HEADER.join(" | ")} |`,
    `|${DEFECT_TABLE_HEADER.map(() => "---").join("|")}|`,
    ...entries.map((e) => `| ${[e["defectId"], e["severity"], e["retestCaseId"], e["caseOrigin"], e["storyId"], e["acIds"], e["wave"], e["fixPr"], e["note"]].map(cell).join(" | ")} |`),
  ].join("\n");
  const newHeading = /\(\d+ reported defects?\)/.test(heading[0]) ? heading[0].replace(/\(\d+ reported defects?\)/, `(${entries.length} reported defect${entries.length === 1 ? "" : "s"})`) : heading[0];
  const body = md.slice(afterHeading, end);
  const lines = body.split("\n");
  const first = lines.findIndex((l) => l.startsWith("|"));
  let rebuilt: string;
  if (first < 0) rebuilt = `${body.replace(/\s+$/, "")}\n\n${table}\n\n`;
  else {
    let last = first;
    while (last + 1 < lines.length && lines[last + 1]!.startsWith("|")) last++;
    rebuilt = [...lines.slice(0, first), table, ...lines.slice(last + 1)].join("\n");
  }
  return md.slice(0, start) + newHeading + rebuilt + md.slice(end);
}

function readRtm(file: string, runId: string): { text: string; doc: Record<string, unknown> } {
  if (!existsSync(file)) throw new RunStateError("invalid-input", `run ${runId} has no rtm.json`);
  const text = readFileSync(file, "utf-8");
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new RunStateError("invalid-input", `rtm.json is not valid JSON: ${(e as Error).message}`);
  }
  if (!isPlain(doc) || !Array.isArray(doc["rows"])) throw new RunStateError("invalid-input", "rtm.json has no rows array");
  return { text, doc };
}

/** Re-render rtm.md's defect table in place when the file and its section exist; returns the prior text to restore, or null when nothing was written. */
function rerenderMd(mdFile: string, defectMap: unknown): string | null {
  if (!existsSync(mdFile) || !Array.isArray(defectMap)) return null;
  const prior = readFileSync(mdFile, "utf-8");
  const next = renderDefectSection(prior, defectMap);
  if (next === null || next === prior) return null;
  atomicWrite(mdFile, next);
  return prior;
}

/**
 * `aegis rtm unlink`: remove one defect-to-requirement link from rtm.json (qa-defect-manager and the owner only), for a link that is no
 * longer valid: a withdrawn or reframed defect, or one linked to the wrong requirement. The pair may be in the requirement row's
 * `defectIds`, in a `defectMap` entry ({defectId, requirementId}), or both: each is removed, and a pair that exists only in the defectMap
 * succeeds. A pair present nowhere is refused, naming what the requirement's row does link. The defect table of rtm.md is re-rendered from
 * the defectMap; the rest of rtm.json and rtm.md is untouched. One `rtm.link-removed` event records requirement, defect, reason and agent
 * (and defectMapEntriesRemoved); a failed event puts both files back. Lock order: run.lock -> event-bus lock.
 */
export async function unlinkRtmDefect(root: string, runId: string, input: { requirementId: string; defectId: string; reason: string; now?: Date }, caller: string): Promise<UnlinkResult> {
  assertCallerAllowed(caller, "rtm.unlink");
  const reason = requireReason(input.reason);
  const req = RequirementIdSchema.safeParse(input.requirementId);
  if (!req.success) throw new RunStateError("invalid-input", `requirement id "${input.requirementId}" is not REQ-{MODULE}-{NN}`);
  if (!DefectIdSchema.safeParse(input.defectId).success) throw new RunStateError("invalid-input", `defect id "${input.defectId}" is not DEF-{NNN}-{MODULE}-{TYPE}`);
  const file = join(runDir(root, runId), "rtm.json");
  const mdFile = join(runDir(root, runId), "rtm.md");
  return withRunLock(root, runId, async () => {
    assertMayCorrect(root, runId, caller);
    const { text: priorText, doc } = readRtm(file, runId);
    const rows = doc["rows"] as unknown[];
    const row = rows.find((r): r is Record<string, unknown> => isPlain(r) && r["requirementId"] === req.data);
    const linked = row !== undefined && Array.isArray(row["defectIds"]) ? (row["defectIds"] as unknown[]) : [];
    const inRow = linked.includes(input.defectId);
    const map = Array.isArray(doc["defectMap"]) ? (doc["defectMap"] as unknown[]) : [];
    const kept = map.filter((e) => !(isPlain(e) && e["defectId"] === input.defectId && e["requirementId"] === req.data));
    const mapEntriesRemoved = map.length - kept.length;
    if (!inRow && mapEntriesRemoved === 0) {
      throw new RunStateError(
        "invalid-input",
        row === undefined
          ? `rtm.json has no row for ${req.data} and its defectMap has no ${input.defectId} entry for it`
          : `${input.defectId} is not linked to ${req.data} (its row links: ${linked.length === 0 ? "no defect" : linked.join(", ")}; its defectMap has no such entry)`
      );
    }
    const remaining = linked.filter((d) => d !== input.defectId) as string[];
    if (inRow && row !== undefined) row["defectIds"] = remaining;
    if (mapEntriesRemoved > 0) doc["defectMap"] = kept;
    atomicWrite(file, JSON.stringify(doc, null, 2) + "\n");
    let priorMd: string | null = null;
    try {
      priorMd = mapEntriesRemoved > 0 ? rerenderMd(mdFile, kept) : null;
      await appendChained(
        { type: "rtm.link-removed", ts: iso(input.now), requirementId: req.data, defectId: input.defectId, agent: caller, reason, ...(mapEntriesRemoved > 0 ? { defectMapEntriesRemoved: mapEntriesRemoved } : {}) },
        busPath(root, runId),
        { emittedBy: caller, runId }
      );
    } catch (e) {
      atomicWrite(file, priorText);
      if (priorMd !== null) atomicWrite(mdFile, priorMd);
      throw e;
    }
    return { runId, requirementId: req.data, defectId: input.defectId, reason, remaining, rowLinkRemoved: inRow, defectMapEntriesRemoved: mapEntriesRemoved, rtmMdUpdated: priorMd !== null };
  });
}

export interface SyncResult {
  runId: string;
  /** false: the defectMap and the rows already matched the records; nothing was written and no event recorded. */
  changed: boolean;
  added: string[];
  updated: string[];
  removed: string[];
  /** Extra entries of a defect that already had one (one entry per defect record is kept). */
  duplicatesRemoved: number;
  /** Row links added from the records' requirementId. */
  rowLinksAdded: Array<{ requirementId: string; defectId: string }>;
  /** Records whose requirementId has no row in rtm.json, or that name none: not linked, for the defect manager to decide. */
  unlinked: Array<{ defectId: string; requirementId: string | null }>;
  rtmMdUpdated: boolean;
  reason: string;
}

/**
 * `aegis rtm sync-defects --reason <text>` (qa-defect-manager and the owner only): make rtm.json#defectMap consistent with the defect
 * records. One entry per defect record: severity (the record's severity.code), title, requirementId and storyId (the record's userStory)
 * are taken from the record; retestCaseId, caseOrigin, acIds, wave, fixPr, verdictOracle, note and any other key of an existing entry are
 * kept; a new entry gets retestCaseId from the record's testCaseId, empty acIds and verdictOracle, a null wave and fixPr, and a note saying
 * those were not recorded. An entry whose defect has no record is removed (and a second entry of one defect). A record that names no
 * requirement (an untraced defect) keeps an existing entry's requirement and story. The `defectIds` of the requirement row named by a
 * record's requirementId gain the defect when it is missing: that is the record's own explicit link, so nothing is guessed; a link in
 * another row is never removed (use `rtm unlink`: a defect may legitimately sit on several rows). Nothing else in rtm.json changes. The
 * defect table of rtm.md is re-rendered. One `rtm.defect-map-synced` event carries the counts and defect ids. Lock order: run.lock -> bus.
 */
export async function syncRtmDefectMap(root: string, runId: string, input: { reason: string; now?: Date }, caller: string): Promise<SyncResult> {
  assertCallerAllowed(caller, "rtm.sync-defects");
  const reason = requireReason(input.reason);
  const file = join(runDir(root, runId), "rtm.json");
  const mdFile = join(runDir(root, runId), "rtm.md");
  const defectsDir = join(runDir(root, runId), "defects");
  return withRunLock(root, runId, async () => {
    assertMayCorrect(root, runId, caller);
    const { text: priorText, doc } = readRtm(file, runId);
    const rows = doc["rows"] as unknown[];
    const records = new Map<string, Record<string, unknown>>();
    for (const name of existsSync(defectsDir) ? readdirSync(defectsDir).filter((n) => /^DEF-.*\.json$/.test(n)).sort() : []) {
      let rec: unknown;
      try {
        rec = JSON.parse(readFileSync(join(defectsDir, name), "utf-8"));
      } catch {
        continue;
      }
      const id = isPlain(rec) && typeof rec["id"] === "string" ? rec["id"] : name.replace(/\.json$/, "");
      if (isPlain(rec) && DefectIdSchema.safeParse(id).success) records.set(id, rec);
    }
    const oldMap = Array.isArray(doc["defectMap"]) ? (doc["defectMap"] as unknown[]) : [];
    const byId = new Map<string, Record<string, unknown>>();
    let duplicatesRemoved = 0;
    const removed: string[] = [];
    for (const e of oldMap) {
      if (!isPlain(e) || typeof e["defectId"] !== "string") continue;
      if (!records.has(e["defectId"])) { removed.push(e["defectId"]); continue; }
      if (byId.has(e["defectId"])) { duplicatesRemoved++; continue; }
      byId.set(e["defectId"], e);
    }
    const added: string[] = [];
    const updated: string[] = [];
    const rowLinksAdded: Array<{ requirementId: string; defectId: string }> = [];
    const unlinked: Array<{ defectId: string; requirementId: string | null }> = [];
    const sev = (r: Record<string, unknown>): string | undefined => (isPlain(r["severity"]) && typeof r["severity"]["code"] === "string" ? (r["severity"]["code"] as string) : typeof r["severity"] === "string" ? r["severity"] : undefined);
    for (const [id, rec] of records) {
      const wanted: Record<string, unknown> = {
        ...(sev(rec) !== undefined ? { severity: sev(rec) } : {}),
        ...(typeof rec["title"] === "string" ? { title: rec["title"] } : {}),
        ...(typeof rec["requirementId"] === "string" ? { requirementId: rec["requirementId"] } : {}),
        ...(typeof rec["userStory"] === "string" ? { storyId: rec["userStory"] } : {}),
      };
      const existing = byId.get(id);
      if (existing === undefined) {
        byId.set(id, {
          defectId: id, severity: wanted["severity"] ?? null, title: wanted["title"] ?? null, retestCaseId: typeof rec["testCaseId"] === "string" ? rec["testCaseId"] : null,
          caseOrigin: "new defect", storyId: wanted["storyId"] ?? null, requirementId: wanted["requirementId"] ?? null, acIds: [], wave: null, fixPr: null, verdictOracle: [],
          note: "Added from the defect record; acceptance criteria, wave and fix are not recorded.",
        });
        added.push(id);
      } else if (Object.entries(wanted).some(([k, v]) => existing[k] !== v)) {
        Object.assign(existing, wanted);
        updated.push(id);
      }
      const reqId = typeof rec["requirementId"] === "string" ? rec["requirementId"] : null;
      const row = reqId === null ? undefined : rows.find((r): r is Record<string, unknown> => isPlain(r) && r["requirementId"] === reqId);
      if (reqId === null || row === undefined) unlinked.push({ defectId: id, requirementId: reqId });
      else {
        const ids = Array.isArray(row["defectIds"]) ? (row["defectIds"] as unknown[]) : [];
        if (!ids.includes(id)) {
          row["defectIds"] = [...ids, id];
          rowLinksAdded.push({ requirementId: reqId, defectId: id });
        }
      }
    }
    const newMap = [...byId.values()].sort((a, b) => String(a["defectId"]).localeCompare(String(b["defectId"])));
    const changed = added.length + updated.length + removed.length + duplicatesRemoved + rowLinksAdded.length > 0;
    const base = { runId, added, updated, removed, duplicatesRemoved, rowLinksAdded, unlinked, reason };
    if (!changed) return { ...base, changed: false, rtmMdUpdated: false };
    doc["defectMap"] = newMap;
    atomicWrite(file, JSON.stringify(doc, null, 2) + "\n");
    let priorMd: string | null = null;
    try {
      priorMd = rerenderMd(mdFile, newMap);
      await appendChained(
        { type: "rtm.defect-map-synced", ts: iso(input.now), agent: caller, reason, added, updated, removed, duplicatesRemoved, rowLinksAdded, rtmMdUpdated: priorMd !== null },
        busPath(root, runId),
        { emittedBy: caller, runId }
      );
    } catch (e) {
      atomicWrite(file, priorText);
      if (priorMd !== null) atomicWrite(mdFile, priorMd);
      throw e;
    }
    return { ...base, changed: true, rtmMdUpdated: priorMd !== null };
  });
}

export interface RenderResult {
  runId: string;
  changed: boolean;
  entries: number;
}

/**
 * `aegis rtm render` (qa-defect-manager and the owner only): rewrite the defect-to-case table of rtm.md from rtm.json#defectMap, the one
 * part of rtm.md that is deterministic (see renderDefectSection). Refuses when rtm.md has no `## Defect-to-case map` section. Records
 * `rtm.rendered` only when the file changed.
 */
export async function renderRtmDefects(root: string, runId: string, caller: string, now?: Date): Promise<RenderResult> {
  assertCallerAllowed(caller, "rtm.render");
  const file = join(runDir(root, runId), "rtm.json");
  const mdFile = join(runDir(root, runId), "rtm.md");
  return withRunLock(root, runId, async () => {
    assertMayCorrect(root, runId, caller);
    const { doc } = readRtm(file, runId);
    const map = Array.isArray(doc["defectMap"]) ? (doc["defectMap"] as unknown[]) : [];
    if (!existsSync(mdFile)) throw new RunStateError("invalid-input", `run ${runId} has no rtm.md`);
    const prior = readFileSync(mdFile, "utf-8");
    const next = renderDefectSection(prior, map);
    if (next === null) throw new RunStateError("invalid-input", "rtm.md has no '## Defect-to-case map' section to render into");
    if (next === prior) return { runId, changed: false, entries: map.length };
    atomicWrite(mdFile, next);
    try {
      await appendChained({ type: "rtm.rendered", ts: iso(now), agent: caller, file: "rtm.md", section: "defect-to-case map", entries: map.length }, busPath(root, runId), { emittedBy: caller, runId });
    } catch (e) {
      atomicWrite(mdFile, prior);
      throw e;
    }
    return { runId, changed: true, entries: map.length };
  });
}
