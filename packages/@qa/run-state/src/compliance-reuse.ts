import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ComplianceTagSchema, PHASE_IDS, complianceAgent, type PhaseId, type RunState } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { assertCallerAllowed } from "./caller.js";
import { relevantRegulations } from "./compliance.js";
import { readRunConfig } from "./config.js";
import { RunStateError } from "./errors.js";
import { lintFileFindings } from "./lint/run-lint.js";
import { busPath, runDir, taskmasterDir } from "./paths.js";
import { commitRun, readRun, withRunLock } from "./run.js";
import { reviewDir, workDir } from "./submit.js";
import { atomicWrite, iso } from "./util.js";

/**
 * Compliance once. The six compliance reviews read the cases, the defect records, the traceability matrix, the plan, the target profile and
 * (CMMI) the work reports and reviews of the cycle up to Triage. When none of that changed since the last completed Compliance round of the
 * run, that round's reports are carried: `aegis compliance probe` completes the phase with them. Anything doubtful is a full round.
 * The record of the last completed round is reports/reuse/compliance.json (CLI-written; run.json forgets a phase record when a rejection
 * reopens the phase, this file does not).
 */

export const COMPLIANCE_REUSE_REL = "reports/reuse/compliance.json";
const COMPLIANCE_DIR = "reports/compliance";
const RECORD_VERSION = 1;

/** Phases whose work reports and reviews are process evidence of the cycle the reviews audit: everything up to and including Triage. */
const EVIDENCE_PHASES: ReadonlySet<string> = new Set(PHASE_IDS.slice(0, PHASE_IDS.indexOf("triage") + 1));
const REPORT_FILE = /^(qa-[a-z0-9-]+)\.(.+)\.(\d+)\.json$/;

const sha = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

/** Every regular file below `dir` (relative paths, sorted) whose name passes `keep`; no link is followed. Never throws. */
function filesUnder(dir: string, keep: (rel: string) => boolean, rel = ""): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(join(dir, rel)).sort();
  } catch {
    return out;
  }
  for (const name of names) {
    const r = rel === "" ? name : `${rel}/${name}`;
    let st;
    try {
      st = statSync(join(dir, r));
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...filesUnder(dir, keep, r));
    else if (st.isFile() && keep(r)) out.push(r);
  }
  return out;
}

/** One hash over a set of files: the path and the content hash of each, in path order. A missing file counts as absent, not as an error. */
function hashFiles(base: string, rels: readonly string[]): string {
  const h = createHash("sha256");
  for (const rel of [...rels].sort()) {
    let content: Buffer | null = null;
    try {
      content = readFileSync(join(base, rel));
    } catch {
      content = null;
    }
    h.update(`${rel}\0${content === null ? "absent" : sha(content)}\n`);
  }
  return h.digest("hex");
}

export interface ComplianceFingerprint {
  /** The hash of all groups. */
  fingerprint: string;
  /** One hash per input group, so a probe can name what changed. */
  groups: Record<string, string>;
  /** The regulations the round reviews. */
  regulations: string[];
}

/** The relevant regulations of the run (the Scan snapshot decides personal data), in configured order. */
export function relevantComplianceIds(root: string, state: RunState): string[] {
  return relevantRegulations(readRunConfig(root).compliance, state.phases.scan?.personalData);
}

/**
 * What the compliance reviews read, as one fingerprint. Reads files only. The groups: regulations (which reviews run), targetProfile,
 * plan, rtm, cases (designed cases and results), defects, descoped (the owner's out-of-scope cases), evidence (work reports and reviews of
 * tasks up to Triage; a report of an unknown task counts), agents (the compliance agent definitions: a changed framework re-reviews).
 * Not read by the reviews, so not hashed: the requirement intake, the closure, the executive reports and the work of the phases after Triage.
 */
export async function complianceFingerprint(root: string, runId: string, state: RunState): Promise<ComplianceFingerprint> {
  const dir = runDir(root, runId);
  const regulations = relevantComplianceIds(root, state);
  const groups: Record<string, string> = {};
  groups["regulations"] = sha(JSON.stringify({ regulations, personalData: state.phases.scan?.personalData ?? null }));
  groups["targetProfile"] = hashFiles(dir, ["target-profile.json"]);
  groups["plan"] = hashFiles(dir, ["plan.json", "plan.md"]);
  groups["rtm"] = hashFiles(dir, ["rtm.json"]);
  groups["cases"] = hashFiles(join(dir, "cases"), filesUnder(join(dir, "cases"), (r) => r.endsWith(".json")));
  groups["defects"] = hashFiles(join(dir, "defects"), filesUnder(join(dir, "defects"), (r) => r.endsWith(".json")));
  groups["descoped"] = sha(JSON.stringify((state.descoped ?? []).map((d) => d.caseId).sort()));
  // Process evidence: the phase of a report's task decides, from the task file (a gate task belongs to its gated phase).
  const phaseOf = new Map<string, string | undefined>();
  try {
    for (const t of await createTaskmasterClient(taskmasterDir(root, runId)).list()) phaseOf.set(t.id, t.phase);
  } catch {
    // an unreadable task tree leaves every report counted
  }
  const evidence: string[] = [];
  for (const [base, tag] of [[workDir(root, runId), "work"], [reviewDir(root, runId), "review"]] as const) {
    for (const f of filesUnder(base, () => true)) {
      const m = REPORT_FILE.exec(f);
      if (m === null) continue; // an escalation decision file or anything else that is not a report
      const phase = phaseOf.get(m[2]!);
      if (phase !== undefined && !EVIDENCE_PHASES.has(phase)) continue;
      evidence.push(`${tag}/${f}`);
    }
  }
  groups["evidence"] = hashFiles(join(dir, "reports"), evidence);
  const agentFiles = [...regulations.map((r) => `${complianceAgent(r)}.md`).map((f) => `.claude/agents/compliance/${f}`), ".claude/agents/spv/qa-compliance-spv.md"];
  groups["agents"] = hashFiles(root, agentFiles);
  const fingerprint = sha(Object.entries(groups).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}:${v}`).join("\n"));
  return { fingerprint, groups, regulations };
}

interface ReuseRecord {
  version: number;
  completedAt: string;
  fingerprint: string;
  groups: Record<string, string>;
  regulations: string[];
  /** File name (in reports/compliance) to content hash, for every report file the round left. */
  reports: Record<string, string>;
}

function reportHashes(root: string, runId: string): Record<string, string> {
  const base = join(runDir(root, runId), COMPLIANCE_DIR);
  const out: Record<string, string> = {};
  for (const f of filesUnder(base, (r) => /^[a-z0-9]+\.(json|md)$/.test(r))) out[f] = hashFiles(base, [f]);
  return out;
}

/**
 * Records what the Compliance round that just completed read and produced. Called after the completion committed; never throws (a round
 * without a record is simply not reusable: the next probe answers full).
 */
export async function recordComplianceRound(root: string, runId: string, completedAt: string | undefined): Promise<void> {
  try {
    const state = readRun(root, runId);
    const fp = await complianceFingerprint(root, runId, state);
    const record: ReuseRecord = {
      version: RECORD_VERSION, completedAt: completedAt ?? iso(), fingerprint: fp.fingerprint, groups: fp.groups, regulations: fp.regulations, reports: reportHashes(root, runId),
    };
    mkdirSync(join(runDir(root, runId), "reports", "reuse"), { recursive: true });
    atomicWrite(join(runDir(root, runId), COMPLIANCE_REUSE_REL), JSON.stringify(record, null, 2) + "\n");
  } catch {
    // see above
  }
}

function readRecord(root: string, runId: string): ReuseRecord | null {
  try {
    const raw = JSON.parse(readFileSync(join(runDir(root, runId), COMPLIANCE_REUSE_REL), "utf-8")) as Partial<ReuseRecord> | null;
    if (raw === null || typeof raw !== "object" || raw.version !== RECORD_VERSION) return null;
    if (typeof raw.completedAt !== "string" || typeof raw.fingerprint !== "string" || raw.groups === null || typeof raw.groups !== "object") return null;
    if (!Array.isArray(raw.regulations) || raw.reports === null || typeof raw.reports !== "object") return null;
    return raw as ReuseRecord;
  } catch {
    return null;
  }
}

/** Why the stored reports cannot be carried as they are (the wording rules and tag formats of today), or null. */
function reportProblem(root: string, runId: string, record: ReuseRecord, regulations: readonly string[]): string | null {
  const base = join(runDir(root, runId), COMPLIANCE_DIR);
  const now = reportHashes(root, runId);
  const disabled = new Set(readRunConfig(root).reportRules.disable);
  for (const id of regulations) {
    const json = `${id}.json`;
    if (!existsSync(join(base, json))) return `the report of ${id} is missing`;
    if (record.reports[json] === undefined || now[json] !== record.reports[json]) return `the report of ${id} is not the one the earlier round left`;
    if (record.reports[`${id}.md`] !== now[`${id}.md`]) return `the written report of ${id} is not the one the earlier round left`;
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(join(base, json), "utf-8"));
    } catch {
      return `the report of ${id} is not valid JSON`;
    }
    const o = doc !== null && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : null;
    if (o === null || o["regulation"] !== id) return `the report of ${id} does not name its regulation`;
    const gaps = Array.isArray(o["gaps"]) ? o["gaps"] : null;
    if (gaps === null) return `the report of ${id} has no gaps list`;
    if (!disabled.has("compliance-tag-invalid")) {
      const bad = gaps.map((g) => (g !== null && typeof g === "object" ? (g as { tag?: unknown }).tag : g)).filter((t) => typeof t !== "string" || !ComplianceTagSchema.safeParse(t).success);
      if (bad.length > 0) return `the report of ${id} has ${bad.length} gap tag(s) that match no tag format`;
    }
  }
  const lint = lintFileFindings(root, runId, regulations.flatMap((id) => [`${COMPLIANCE_DIR}/${id}.json`, `${COMPLIANCE_DIR}/${id}.md`]));
  const errors = lint.findings.filter((f) => f.severity === "error");
  if (errors.length > 0) return `the carried reports fail the current wording rules (${errors.length} error(s), first: ${errors[0]!.rule})`;
  return null;
}

export interface ComplianceProbeResult {
  runId: string;
  decision: "reuse" | "full";
  reason: string | null;
  fingerprint: string;
  /** Input groups that differ from the earlier round; empty on reuse. */
  changed: string[];
  /** Completion time of the round whose reports are carried; null on full. */
  carriedFrom: string | null;
}

export interface ComplianceProbeOptions {
  /** Run the six reviews whatever the fingerprint says. */
  force?: boolean;
  now?: Date;
}

/**
 * Decides whether the Compliance phase in progress completes with the earlier round's reports (reuse) or runs the six reviews (full), and on
 * reuse completes it in one commit. Nothing unknown is an error: no record, a changed input, a report that fails today's rules, a task of
 * this round already under way, or `force` all answer full with the reason. Reads files only apart from the one commit.
 */
export async function probeCompliance(root: string, runId: string, caller: string, opts: ComplianceProbeOptions = {}): Promise<ComplianceProbeResult> {
  assertCallerAllowed(caller, "compliance.probe");
  const first = readRun(root, runId);
  assertProbeAllowed(first);
  // Hashed before run.lock is taken; the commit below checks the state again.
  const current = await complianceFingerprint(root, runId, first);
  const record = readRecord(root, runId);
  const tasks = (await createTaskmasterClient(taskmasterDir(root, runId)).list()).filter((t) => t.phase === "compliance" && t.status !== "cancelled");
  let reason: string | null = null;
  let changed: string[] = [];
  if (opts.force === true) reason = "a full re-run was asked for";
  else if (record === null) reason = "no Compliance round of this run left a record to compare with";
  else if (tasks.some((t) => t.status !== "pending")) reason = "a review of this round has already begun";
  else {
    changed = Object.keys({ ...record.groups, ...current.groups }).filter((k) => record.groups[k] !== current.groups[k]).sort();
    if (changed.length > 0) reason = `what the reviews read changed since the earlier round (${changed.join(", ")})`;
    else if (record.fingerprint !== current.fingerprint) reason = "what the reviews read differs from the earlier round";
    else reason = reportProblem(root, runId, record, current.regulations);
  }
  const decision: "reuse" | "full" = reason === null ? "reuse" : "full";
  const ts = iso(opts.now);
  const result: ComplianceProbeResult = {
    runId, decision, reason, fingerprint: current.fingerprint, changed: decision === "reuse" ? [] : changed, carriedFrom: decision === "reuse" ? record!.completedAt : null,
  };
  const event = { type: "compliance.probed" as const, ts, agent: caller, decision, reason, fingerprint: current.fingerprint, forced: opts.force === true, carriedFrom: result.carriedFrom, changed: result.changed };
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    assertProbeAllowed(state);
    if (decision === "full") {
      await appendChained(event, busPath(root, runId), { emittedBy: caller, runId });
      return result;
    }
    const next: RunState = { ...state, phases: { ...state.phases, compliance: { ...state.phases["compliance"]!, status: "completed", completedAt: ts, reusedFrom: record!.completedAt } }, updatedAt: ts };
    await commitRun(root, state, next, async () => {
      await appendChained(event, busPath(root, runId), { emittedBy: caller, runId });
      await appendChained({ type: "run.phase.completed", ts, runId, phase: "compliance" as PhaseId, result: "done" }, busPath(root, runId), { emittedBy: caller, runId });
    });
    return result;
  });
}

function assertProbeAllowed(state: RunState): void {
  if (state.cycleType !== "full") throw new RunStateError("invalid-input", "a smoke cycle has no Compliance phase");
  if (state.phases["compliance"]?.status !== "in-progress") {
    throw new RunStateError("invalid-input", "the compliance probe runs while Compliance is in progress: start the phase, then run the probe before adding any task");
  }
}
