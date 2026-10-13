import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DefectG2TriageSchema, DefectIdSchema, DefectSchema, RequirementIdSchema, RetestVerdictSchema, StoryIdSchema, checkBrandExposure } from "@qa/contracts";
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
  /** The defect ids the requirement's row still links. */
  remaining: string[];
  /** The defectMap entries of this defect and requirement that were removed with the row link. */
  defectMapEntriesRemoved: number;
}

/**
 * `aegis rtm unlink`: remove one defect id from the `defectIds` of one requirement's row of rtm.json (qa-defect-manager and the
 * owner only), for a link that is no longer valid: a withdrawn or reframed defect, or one linked to the wrong requirement. It also
 * removes the `defectMap` entries of that defect and requirement pair (`{defectId, requirementId}`), so the map does not keep the
 * link; the rest of rtm.json is untouched. The row must exist and link the defect, else the command refuses. One `rtm.link-removed` event
 * records requirement, defect, reason and agent; a failed event puts the file back. Lock order: run.lock -> event-bus lock.
 */
export async function unlinkRtmDefect(root: string, runId: string, input: { requirementId: string; defectId: string; reason: string; now?: Date }, caller: string): Promise<UnlinkResult> {
  assertCallerAllowed(caller, "rtm.unlink");
  const reason = requireReason(input.reason);
  const req = RequirementIdSchema.safeParse(input.requirementId);
  if (!req.success) throw new RunStateError("invalid-input", `requirement id "${input.requirementId}" is not REQ-{MODULE}-{NN}`);
  if (!DefectIdSchema.safeParse(input.defectId).success) throw new RunStateError("invalid-input", `defect id "${input.defectId}" is not DEF-{NNN}-{MODULE}-{TYPE}`);
  const file = join(runDir(root, runId), "rtm.json");
  return withRunLock(root, runId, async () => {
    assertMayCorrect(root, runId, caller);
    if (!existsSync(file)) throw new RunStateError("invalid-input", `run ${runId} has no rtm.json`);
    const priorText = readFileSync(file, "utf-8");
    let doc: unknown;
    try {
      doc = JSON.parse(priorText);
    } catch (e) {
      throw new RunStateError("invalid-input", `rtm.json is not valid JSON: ${(e as Error).message}`);
    }
    const rows = isPlain(doc) ? doc["rows"] : undefined;
    if (!isPlain(doc) || !Array.isArray(rows)) throw new RunStateError("invalid-input", "rtm.json has no rows array");
    const row = rows.find((r): r is Record<string, unknown> => isPlain(r) && r["requirementId"] === req.data);
    if (row === undefined) throw new RunStateError("invalid-input", `rtm.json has no row for ${req.data}`);
    const linked = Array.isArray(row["defectIds"]) ? (row["defectIds"] as unknown[]) : [];
    if (!linked.includes(input.defectId)) {
      throw new RunStateError("invalid-input", `${input.defectId} is not linked to ${req.data} (it links: ${linked.length === 0 ? "no defect" : linked.join(", ")})`);
    }
    const remaining = linked.filter((d) => d !== input.defectId) as string[];
    row["defectIds"] = remaining;
    let mapEntriesRemoved = 0;
    if (Array.isArray(doc["defectMap"])) {
      const kept = (doc["defectMap"] as unknown[]).filter((e) => !(isPlain(e) && e["defectId"] === input.defectId && e["requirementId"] === req.data));
      mapEntriesRemoved = (doc["defectMap"] as unknown[]).length - kept.length;
      doc["defectMap"] = kept;
    }
    atomicWrite(file, JSON.stringify(doc, null, 2) + "\n");
    try {
      await appendChained(
        { type: "rtm.link-removed", ts: iso(input.now), requirementId: req.data, defectId: input.defectId, agent: caller, reason, ...(mapEntriesRemoved > 0 ? { defectMapEntriesRemoved: mapEntriesRemoved } : {}) },
        busPath(root, runId),
        { emittedBy: caller, runId }
      );
    } catch (e) {
      atomicWrite(file, priorText);
      throw e;
    }
    return { runId, requirementId: req.data, defectId: input.defectId, reason, remaining, defectMapEntriesRemoved: mapEntriesRemoved };
  });
}
