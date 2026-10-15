import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ComplianceTagSchema, PHASE_IDS, complianceAgent, type RunState } from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { createTaskmasterClient } from "@qa/taskmaster-client";
import { assertCallerAllowed } from "./caller.js";
import { relevantRegulations } from "./compliance.js";
import { readRunConfig } from "./config.js";
import { RunStateError } from "./errors.js";
import { lintFileFindings } from "./lint/run-lint.js";
import { verifyRunIntegrity } from "./integrity.js";
import { busPath, runDir, taskmasterDir } from "./paths.js";
import { completePhaseCore, describeStep, nextStep } from "./phases.js";
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

/** Symbolic links met while hashing: a link is never followed, and its presence among the inputs makes the probe answer full. */
type Links = string[];

/** Every regular file below `dir` (relative paths, sorted) whose name passes `keep`. A link is not followed (lstat): it is recorded in `links`. Never throws. */
function filesUnder(dir: string, keep: (rel: string) => boolean, links: Links, rel = ""): string[] {
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
      st = lstatSync(join(dir, r));
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) links.push(join(dir, r));
    else if (st.isDirectory()) out.push(...filesUnder(dir, keep, links, r));
    else if (st.isFile() && keep(r)) out.push(r);
  }
  return out;
}

/** One hash over a set of files: the path and the content hash of each, in path order. A missing file counts as absent; a link is recorded and counts as absent. */
function hashFiles(base: string, rels: readonly string[], links: Links): string {
  const h = createHash("sha256");
  for (const rel of [...rels].sort()) {
    let content: Buffer | null = null;
    try {
      if (lstatSync(join(base, rel)).isSymbolicLink()) links.push(join(base, rel));
      else content = readFileSync(join(base, rel));
    } catch {
      content = null;
    }
    h.update(`${rel}\0${content === null ? "absent" : sha(content)}\n`);
  }
  return h.digest("hex");
}

const COMPLIANCE_AGENT_DIR = ".claude/agents/compliance";
const COMPLIANCE_SPV_FILE = ".claude/agents/spv/qa-compliance-spv.md";
const SPV_NAME = "qa-compliance-spv";

/** The agent definition files the relevant regulations' reviews and their SPV run from, root-relative. */
const agentFiles = (regulations: readonly string[]): string[] => [...regulations.map((r) => `${COMPLIANCE_AGENT_DIR}/${complianceAgent(r)}.md`), COMPLIANCE_SPV_FILE];

/** The frontmatter `knowledge_refs` and the non-run `reads` of the contract block of one agent file: the files outside the run it declares it reads. */
function declaredReads(root: string, file: string): string[] {
  let text: string;
  try {
    text = readFileSync(join(root, file), "utf-8");
  } catch {
    return [];
  }
  const out: string[] = [];
  const front = /^---\n([\s\S]*?)\n---/.exec(text);
  if (front !== null) {
    try {
      const refs = (parseYaml(front[1]!) as { knowledge_refs?: unknown } | null)?.knowledge_refs;
      if (Array.isArray(refs)) out.push(...refs.filter((r): r is string => typeof r === "string"));
    } catch {
      // an unreadable frontmatter declares nothing; the agent file itself is hashed
    }
  }
  const block = /## Contract \(machine-checked\)[\s\S]*?```yaml\n([\s\S]*?)```/.exec(text);
  if (block !== null) {
    try {
      const reads = (parseYaml(block[1]!) as { reads?: unknown } | null)?.reads;
      if (Array.isArray(reads)) {
        for (const r of reads) {
          const path = typeof r === "string" ? r : (r as { path?: unknown } | null)?.path;
          if (typeof path === "string") out.push(path);
        }
      }
    } catch {
      // see above
    }
  }
  return out.filter((p) => !p.includes("{"));
}

/**
 * Every root-relative file outside the run that changes what the reviews of `regulations` and their SPV do: the agent definitions, what each
 * declares in knowledge_refs and in its contract reads (lessons files and the clause catalogue among them), and both lessons file forms of each
 * agent. Derived from the agent files, so a new declared reference is hashed without a code change.
 */
export function complianceInputFiles(root: string, regulations: readonly string[]): string[] {
  const files = new Set<string>();
  for (const f of agentFiles(regulations)) {
    files.add(f);
    for (const r of declaredReads(root, f)) files.add(r);
  }
  for (const agent of [...regulations.map(complianceAgent), SPV_NAME]) {
    files.add(`agent-memory/${agent}/lessons.json`);
    files.add(`agent-memory/${agent}/lessons.md`);
  }
  files.add("knowledge/synthesis/compliance-and-regulations.md");
  return [...files].sort();
}

/** The model policy of the agents (tier, model and effort), as text: a changed model or effort changes what a review produces. */
function policyText(root: string, regulations: readonly string[]): string {
  try {
    const policy = parseYaml(readFileSync(join(root, ".claude", "model-policy.yaml"), "utf-8")) as {
      tiers?: Record<string, unknown>; efforts?: Record<string, unknown>; assignments?: Record<string, unknown>;
    } | null;
    const out: Record<string, unknown> = {};
    for (const agent of [...regulations.map(complianceAgent), SPV_NAME]) {
      const tier = Object.entries(policy?.assignments ?? {}).find(([, list]) => Array.isArray(list) && list.includes(agent))?.[0] ?? null;
      out[agent] = { tier, model: tier === null ? null : policy?.tiers?.[tier] ?? null, effort: tier === null ? null : policy?.efforts?.[tier] ?? null };
    }
    return JSON.stringify(out);
  } catch {
    return "unreadable";
  }
}

export interface ComplianceFingerprint {
  /** The hash of all groups. */
  fingerprint: string;
  /** One hash per input group, so a probe can name what changed. */
  groups: Record<string, string>;
  /** The regulations the round reviews. */
  regulations: string[];
  /** Symbolic links met among the inputs (never followed). */
  links: string[];
}

/** The relevant regulations of the run (the Scan snapshot decides personal data), in configured order. */
export function relevantComplianceIds(root: string, state: RunState): string[] {
  return relevantRegulations(readRunConfig(root).compliance, state.phases.scan?.personalData);
}

/**
 * What the compliance reviews read, as one fingerprint. Reads files only. The groups: regulations (the configured list, which reviews run),
 * targetProfile, plan, rtm, execution (execution-summary.json), cases (designed cases and results), defects, descoped (the owner's out-of-scope
 * cases), evidence (work reports and reviews of tasks up to Triage; a report of an unknown task counts), guidance (the agent definitions of the
 * reviews and their SPV, every file they declare in knowledge_refs and contract reads, their lessons and the clause catalogue), policy (their
 * model tier, model and effort). Not read by the reviews, so not hashed: the requirement intake, the closure, the executive reports and the
 * work of the phases after Triage.
 */
export async function complianceFingerprint(root: string, runId: string, state: RunState): Promise<ComplianceFingerprint> {
  const dir = runDir(root, runId);
  const regulations = relevantComplianceIds(root, state);
  const links: Links = [];
  const groups: Record<string, string> = {};
  groups["regulations"] = sha(JSON.stringify({ configured: readRunConfig(root).compliance, regulations, personalData: state.phases.scan?.personalData ?? null }));
  groups["targetProfile"] = hashFiles(dir, ["target-profile.json"], links);
  groups["plan"] = hashFiles(dir, ["plan.json", "plan.md"], links);
  groups["rtm"] = hashFiles(dir, ["rtm.json"], links);
  groups["execution"] = hashFiles(dir, ["execution-summary.json"], links);
  groups["cases"] = hashFiles(join(dir, "cases"), filesUnder(join(dir, "cases"), (r) => r.endsWith(".json"), links), links);
  groups["defects"] = hashFiles(join(dir, "defects"), filesUnder(join(dir, "defects"), (r) => r.endsWith(".json"), links), links);
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
    for (const f of filesUnder(base, () => true, links)) {
      const m = REPORT_FILE.exec(f);
      if (m === null) continue; // an escalation decision file or anything else that is not a report
      const phase = phaseOf.get(m[2]!);
      if (phase !== undefined && !EVIDENCE_PHASES.has(phase)) continue;
      evidence.push(`${tag}/${f}`);
    }
  }
  groups["evidence"] = hashFiles(join(dir, "reports"), evidence, links);
  groups["guidance"] = hashFiles(root, complianceInputFiles(root, regulations), links);
  groups["policy"] = sha(policyText(root, regulations));
  groups["links"] = sha(JSON.stringify([...new Set(links)].map((l) => l.slice(root.length)).sort()));
  const fingerprint = sha(Object.entries(groups).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}:${v}`).join("\n"));
  return { fingerprint, groups, regulations, links: [...new Set(links)] };
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
  const links: Links = [];
  for (const f of filesUnder(base, (r) => /^[a-z0-9]+\.(json|md)$/.test(r), links)) out[f] = hashFiles(base, [f], links);
  return out;
}

const recordFile = (root: string, runId: string): string => join(runDir(root, runId), COMPLIANCE_REUSE_REL);

/**
 * Records the Compliance round that just completed, with the fingerprint its probe took when the round started (what the reviews read, not what
 * the inputs became while they ran). The record is written only when the inputs are still those of the probe: otherwise, or when no probe ran in
 * the round, the earlier record is removed and the next probe answers full. Called after the completion committed; never throws.
 */
export async function recordComplianceRound(root: string, runId: string, completedAt: string | undefined, probed: string | undefined): Promise<void> {
  try {
    const state = readRun(root, runId);
    const fp = await complianceFingerprint(root, runId, state);
    if (probed === undefined || probed !== fp.fingerprint || fp.links.length > 0) {
      rmSync(recordFile(root, runId), { force: true });
      return;
    }
    const record: ReuseRecord = {
      version: RECORD_VERSION, completedAt: completedAt ?? iso(), fingerprint: fp.fingerprint, groups: fp.groups, regulations: fp.regulations, reports: reportHashes(root, runId),
    };
    mkdirSync(join(runDir(root, runId), "reports", "reuse"), { recursive: true });
    atomicWrite(recordFile(root, runId), JSON.stringify(record, null, 2) + "\n");
  } catch {
    // see above
  }
}

function readRecord(root: string, runId: string): ReuseRecord | null {
  try {
    const raw = JSON.parse(readFileSync(recordFile(root, runId), "utf-8")) as Partial<ReuseRecord> | null;
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

/**
 * The owner reopened Compliance on purpose after `since`: a Gate rejection whose reopen point is Compliance, or a reissue of Compliance. The
 * owner asked for that review to be done again, so its reports are never carried. A reopen from an earlier phase (a Closure-draft rejection,
 * a reissue of Execution) is decided by the fingerprint alone. Reads the event log; an unreadable log answers false.
 */
function reopenedOnPurpose(root: string, runId: string, since: string): string | null {
  let lines: string[];
  try {
    lines = readFileSync(busPath(root, runId), "utf-8").split("\n");
  } catch {
    return null;
  }
  for (const line of lines) {
    if (line.trim() === "") continue;
    let e: { type?: unknown; ts?: unknown; reopenPhase?: unknown; decision?: unknown; phase?: unknown; gate?: unknown };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof e.ts !== "string" || e.ts < since) continue;
    if (e.type === "gate.decided" && e.decision === "rejected" && e.reopenPhase === "compliance") return `the owner reopened Compliance at the ${String(e.gate)} rejection: the review is done again`;
    if (e.type === "run.reissued" && e.phase === "compliance") return "the owner reissued Compliance: the review is done again";
  }
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
  /** Run the six reviews whatever the fingerprint says; sticks until the phase completes. */
  force?: boolean;
  now?: Date;
}

/** The refusal phase completion gives: the run must be running and Compliance the phase in progress (not stopped, blocked or at a gate). */
function assertProbeAllowed(state: RunState): void {
  if (state.cycleType !== "full") throw new RunStateError("invalid-input", "a smoke cycle has no Compliance phase");
  if (state.phases["compliance"]?.status !== "in-progress") {
    throw new RunStateError("invalid-input", "the compliance probe runs while Compliance is in progress: start the phase, then run the probe before adding any task");
  }
  const step = nextStep(state);
  if (step.kind !== "continue-phase" || step.phase !== "compliance") throw new RunStateError("out-of-order", `cannot probe Compliance: ${describeStep(step)}`);
}

/**
 * Decides whether the Compliance phase in progress completes with the earlier round's reports (reuse) or runs the six reviews (full), and on
 * reuse completes it through the one completion path every phase uses (integrity check, stop and block refusals, gate order). Nothing unknown
 * is an error: no record, a changed input, a report that fails today's rules, a link among the inputs, an owner-targeted reopen, a task of this
 * round already under way, or `force` all answer full with the reason. A full answer is kept with the phase (the fingerprint taken now, and
 * whether it was forced): a second probe in the same round answers full again, and the round is recorded with that fingerprint.
 */
export async function probeCompliance(root: string, runId: string, caller: string, opts: ComplianceProbeOptions = {}): Promise<ComplianceProbeResult> {
  assertCallerAllowed(caller, "compliance.probe");
  const first = readRun(root, runId);
  assertProbeAllowed(first);
  const integrity = await verifyRunIntegrity(root, runId, caller, opts.now);
  if (!integrity.ok) throw new RunStateError("integrity-failed", `event log does not verify: ${integrity.errors.join("; ")}`);
  // Hashed before run.lock is taken; the commit below checks the state again.
  const current = await complianceFingerprint(root, runId, first);
  const earlier = first.phases["compliance"]!.probed;
  const record = readRecord(root, runId);
  const tasks = (await createTaskmasterClient(taskmasterDir(root, runId)).list()).filter((t) => t.phase === "compliance" && t.status !== "cancelled");
  let reason: string | null = null;
  let changed: string[] = [];
  if (opts.force === true) reason = "a full re-run was asked for";
  else if (earlier !== undefined) reason = earlier.forced ? "a full re-run was asked for earlier in this round" : "an earlier probe of this round already answered full";
  else if (record === null) reason = "no Compliance round of this run left a record to compare with";
  else if (tasks.some((t) => t.status !== "pending")) reason = "a review of this round has already begun";
  else {
    const purposeful = reopenedOnPurpose(root, runId, record.completedAt);
    changed = Object.keys({ ...record.groups, ...current.groups }).filter((k) => record.groups[k] !== current.groups[k]).sort();
    if (purposeful !== null) reason = purposeful;
    else if (changed.length > 0) reason = `what the reviews read changed since the earlier round (${changed.join(", ")})`;
    else if (record.fingerprint !== current.fingerprint) reason = "what the reviews read differs from the earlier round";
    else if (current.links.length > 0) reason = "a symbolic link is among what the reviews read; it is never followed";
    else reason = reportProblem(root, runId, record, current.regulations);
  }
  const decision: "reuse" | "full" = reason === null ? "reuse" : "full";
  const ts = iso(opts.now);
  const result: ComplianceProbeResult = {
    runId, decision, reason, fingerprint: current.fingerprint, changed: decision === "reuse" ? [] : changed, carriedFrom: decision === "reuse" ? record!.completedAt : null,
  };
  const event = { type: "compliance.probed" as const, ts, agent: caller, decision, reason, fingerprint: current.fingerprint, forced: opts.force === true, carriedFrom: result.carriedFrom, changed: result.changed };
  if (decision === "reuse") {
    await completePhaseCore(root, runId, "compliance", caller, { ...(opts.now !== undefined ? { now: opts.now } : {}), reuse: { carriedFrom: record!.completedAt, event } });
    return result;
  }
  if (earlier !== undefined && opts.force !== true) return result; // the answer was given and kept earlier in this round: nothing new to record
  return withRunLock(root, runId, async () => {
    const state = readRun(root, runId);
    assertProbeAllowed(state);
    const record0 = state.phases["compliance"]!;
    const next: RunState = { ...state, phases: { ...state.phases, compliance: { ...record0, probed: { fingerprint: earlier?.fingerprint ?? current.fingerprint, forced: opts.force === true || earlier?.forced === true } } }, updatedAt: ts };
    await commitRun(root, state, next, () => appendChained(event, busPath(root, runId), { emittedBy: caller, runId }));
    return result;
  });
}

/**
 * The Closure-final barrier's guard: a closure must not fold in compliance reports older than what they reviewed. When Compliance completed
 * (not not-applicable) and left a record, the current fingerprint must equal it; otherwise the problem names the changed groups. Null when
 * there is no record (a run in flight, an older run), when Compliance did not complete, or when nothing changed. Reads files only.
 */
export async function staleComplianceProblem(root: string, runId: string, state: RunState): Promise<string | null> {
  if (state.cycleType !== "full" || state.phases["compliance"]?.status !== "completed") return null;
  const record = readRecord(root, runId);
  if (record === null) return null;
  const current = await complianceFingerprint(root, runId, state);
  const changed = Object.keys({ ...record.groups, ...current.groups }).filter((k) => record.groups[k] !== current.groups[k]).sort();
  if (changed.length === 0 && record.fingerprint === current.fingerprint) return null;
  return `what the compliance reviews read changed since Compliance completed (${changed.join(", ") || "inputs"}), so the compliance reports are stale and a closure must not fold them in: reopen Compliance (a Gate 3 rejection with --reopen-phase compliance, or closure-draft when records are corrected; then aegis compliance probe decides) or the owner records reportRules.disable with compliance-fresh as the exception`;
}
