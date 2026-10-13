import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NOT_EXECUTED, RESULT_FILE, descopedCases, outcomeOf, readJson, resultOutcome, scanChecks } from "./outcomes.js";
import { computeDefectRecordCounts } from "./defect-records.js";

/**
 * The five metric rollups other than coverage.json, computed in code from events.jsonl and the case, result and defect records, with the
 * definitions of .claude/agents/crosscutting/qa-metrics-collector.md copied into the comments below. Where that prose was ambiguous the
 * STRICTER reading was taken; each is listed in HANDBOOK/13 ("Metric rollups"). Nothing here is ever 0 for "unknown": a figure that cannot
 * be computed is null, and an input that was missing is named in `missingInputs`.
 */

export interface RollupFiles {
  "cycle-time.json": unknown;
  "defect-trend.json": unknown;
  "effectiveness.json": unknown;
  "agent-reliability.json": unknown;
  "flaky.json": unknown;
}

export interface RollupResult {
  files: RollupFiles;
  /** Inputs that were absent or unreadable, by run-relative name; the figures that need them are null or flagged noData. */
  missingInputs: string[];
  /** Facts a reader needs: malformed event lines skipped, records skipped, a reading chosen. */
  notes: string[];
}

type Ev = { type: string; ts: string; [k: string]: unknown };

const SEVERITIES = ["Sev1", "Sev2", "Sev3", "Sev4", "Sev5"] as const;
const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places;
const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length));
const ms = (ts: string): number => new Date(ts).getTime();
const isPlain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** The agent that works each phase (.claude/pipeline.yaml); a phase with no phase agent is the orchestrator's (it dispatches the rest). */
const PHASE_AGENT: Readonly<Record<string, string>> = {
  intake: "qa-orchestrator", scan: "qa-context-scanner", "dev-test-review": "qa-dev-test-reviewer", requirements: "qa-requirements-analyst",
  "env-auth": "qa-environment-engineer", explore: "qa-web-explorer", planning: "qa-test-planner", design: "qa-test-designer",
  "env-data": "qa-environment-engineer", execution: "qa-test-executor", triage: "qa-defect-manager", "closure-draft": "qa-closure-reporter",
  compliance: "qa-orchestrator", "closure-final": "qa-closure-reporter", executive: "qa-executive-reporter", curator: "qa-curator",
};

function readEvents(runDir: string, missing: string[], notes: string[]): Ev[] | null {
  const file = join(runDir, "events.jsonl");
  let text: string;
  try {
    text = readFileSync(file, "utf-8");
  } catch {
    missing.push("events.jsonl");
    return null;
  }
  const events: Ev[] = [];
  let bad = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const e = JSON.parse(line) as unknown;
      if (isPlain(e) && typeof e["type"] === "string" && typeof e["ts"] === "string") events.push(e as Ev);
      else bad++;
    } catch {
      bad++;
    }
  }
  if (bad > 0) notes.push(`${bad} line(s) of events.jsonl did not parse and were skipped`);
  return events;
}

function readDir<T>(dir: string, pick: (name: string) => boolean, read: (file: string) => T | undefined): Array<{ name: string; value: T }> | null {
  if (!existsSync(dir)) return null;
  const out: Array<{ name: string; value: T }> = [];
  for (const name of readdirSync(dir).filter(pick).sort()) {
    const value = read(join(dir, name));
    if (value !== undefined) out.push({ name, value });
  }
  return out;
}

/**
 * cycle-time.json = { phases: [{ phase, startedAt, completedAt, durationMs, agentName }], totalWallClockMs, bottleneckPhase }.
 * One entry per PASS of a phase: each run.phase.started opens one and the next run.phase.completed of that phase closes it (a phase run again
 * after a rejection or reissue has an entry per pass, as the earlier hand-written files had). durationMs = completedAt - startedAt; a pass
 * still running has no completedAt and no durationMs. totalWallClockMs runs from the first run.phase.started to the last completedAt, gate
 * waiting included, so it is not the sum of the durations. bottleneckPhase = the phase with the longest durationMs. With no completed pass the
 * file is { phases: [], totalWallClockMs: 0, bottleneckPhase: null, noData: true }.
 */
function cycleTime(events: Ev[] | null): unknown {
  const passes: Array<{ phase: string; startedAt: string; completedAt?: string; durationMs?: number; agentName: string }> = [];
  for (const e of events ?? []) {
    const phase = e["phase"];
    if (typeof phase !== "string") continue;
    if (e.type === "run.phase.started") passes.push({ phase, startedAt: e.ts, agentName: PHASE_AGENT[phase] ?? "qa-orchestrator" });
    else if (e.type === "run.phase.completed") {
      const open = [...passes].reverse().find((p) => p.phase === phase && p.completedAt === undefined);
      if (open !== undefined) {
        open.completedAt = e.ts;
        open.durationMs = Math.max(0, ms(e.ts) - ms(open.startedAt));
      }
    }
  }
  const done = passes.filter((p) => p.durationMs !== undefined);
  if (done.length === 0) return { phases: [], totalWallClockMs: 0, bottleneckPhase: null, noData: true };
  const first = Math.min(...passes.map((p) => ms(p.startedAt)));
  const last = Math.max(...done.map((p) => ms(p.completedAt!)));
  const bottleneck = done.reduce((a, b) => (b.durationMs! > a.durationMs! ? b : a));
  return { phases: passes, totalWallClockMs: last - first, bottleneckPhase: bottleneck.phase };
}

interface DefectRecord { phaseIntroduced?: unknown; foundIn?: unknown }

/**
 * Is a defect an escape (found after release)? STRICTER reading of "phaseIntroduced is after release": the phaseIntroduced enum has no
 * after-release value, so a defect escaped when its record says it was found in production (foundIn "Prod") or its phaseIntroduced names
 * a post-release phase (matching post-release, after release or production).
 */
const escaped = (r: DefectRecord | undefined): boolean =>
  r !== undefined && (r.foundIn === "Prod" || (typeof r.phaseIntroduced === "string" && /post.?release|after.?release|production/i.test(r.phaseIntroduced)));

/**
 * defect-trend.json = { totalOpened, totalClosed, totalReopened, bySeverity, byPhaseIntroduced, defectDensity, reopenRate, escapeRate,
 * mttdMs, mttrMs, openApplicationDefects?, fixed?, partiallyFixed?, reframed?, reportWithdrawn?, cannotVerify?, notFixed?, noData? }.
 * totalOpened/totalClosed/totalReopened count the defect.opened, defect.closed and defect.reopened events of this run (totalOpened is not the
 * number of open application defects). bySeverity has Sev1 to Sev5 from the opened events; byPhaseIntroduced counts the opened defects by the
 * record's phaseIntroduced ("Unknown" when the record is missing). defectDensity = opened per 100 designed test cases (no story points are
 * recorded), 2 decimals, null without designed cases. reopenRate = reopened / closed as a percentage (STRICTER: the 0-100 scale of
 * ClosureMetrics), 1 decimal, null without a closed defect. escapeRate = escaped / opened, percentage, 1 decimal, null without an opened
 * defect. mttdMs = mean over opened defects with a testCaseId of (defect.opened - the first earlier test.failed of that case);
 * mttrMs = mean of (the first later defect.closed - defect.opened); each null when no defect has both timestamps. The seven record-derived
 * fields come from computeDefectRecordCounts and are left out when the run has no defects directory. noData: true only without events.jsonl.
 */
function defectTrend(events: Ev[] | null, designed: number | null, records: Map<string, DefectRecord> | null, runDir: string): unknown {
  const evs = events ?? [];
  const opened = evs.filter((e) => e.type === "defect.opened");
  const closed = evs.filter((e) => e.type === "defect.closed");
  const reopened = evs.filter((e) => e.type === "defect.reopened");
  const bySeverity: Record<string, number> = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  const byPhase: Record<string, number> = {};
  let escapes = 0;
  const mttd: number[] = [];
  const mttr: number[] = [];
  for (const e of opened) {
    const sev = isPlain(e["severity"]) && typeof e["severity"]["code"] === "string" ? (e["severity"]["code"] as string) : null;
    if (sev !== null) bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    const id = e["defectId"] as string;
    const rec = records?.get(id);
    const phase = typeof rec?.phaseIntroduced === "string" ? rec.phaseIntroduced : "Unknown";
    byPhase[phase] = (byPhase[phase] ?? 0) + 1;
    if (escaped(rec)) escapes++;
    const tc = e["testCaseId"];
    if (typeof tc === "string") {
      const failed = evs.find((f) => f.type === "test.failed" && f["testCaseId"] === tc && ms(f.ts) <= ms(e.ts));
      if (failed !== undefined) mttd.push(ms(e.ts) - ms(failed.ts));
    }
    const close = closed.find((c) => c["defectId"] === id && ms(c.ts) >= ms(e.ts));
    if (close !== undefined) mttr.push(ms(close.ts) - ms(e.ts));
  }
  const counts = computeDefectRecordCounts(runDir);
  return {
    totalOpened: opened.length,
    totalClosed: closed.length,
    totalReopened: reopened.length,
    bySeverity,
    byPhaseIntroduced: byPhase,
    defectDensity: designed === null || designed === 0 ? null : round((100 * opened.length) / designed, 2),
    reopenRate: closed.length === 0 ? null : round((100 * reopened.length) / closed.length, 1),
    escapeRate: opened.length === 0 ? null : round((100 * escapes) / opened.length, 1),
    mttdMs: mean(mttd),
    mttrMs: mean(mttr),
    ...(counts === null
      ? {}
      : {
          openApplicationDefects: counts.openApplicationDefects, fixed: counts.fixed, partiallyFixed: counts.partiallyFixed, reframed: counts.reframed,
          reportWithdrawn: counts.reportWithdrawn, cannotVerify: counts.cannotVerify, notFixed: counts.notFixed,
        }),
    ...(events === null ? { noData: true } : {}),
  };
}

/**
 * effectiveness.json = { dre, testsThatFoundDefects, testsExecuted, byTestType, noData? }. testsExecuted = designed, in-scope cases whose
 * outcome ran to a verdict (not blocked, skipped or undeterminable, and with a result file). testsThatFoundDefects = distinct test cases
 * named by a defect.opened event. byTestType counts those tests by the testType of their case file (a case with several types counts once
 * under each; "Unknown" when the case file or its testType is missing). dre = (opened - escaped) / opened x 100, 1 decimal, null without an
 * opened defect (defects found before release over found-before-release plus escaped; escaped as in defect-trend). noData: true without
 * events.jsonl.
 */
function effectiveness(events: Ev[] | null, runDir: string, records: Map<string, DefectRecord> | null, executed: number | null): unknown {
  const opened = (events ?? []).filter((e) => e.type === "defect.opened");
  const tests = new Set(opened.map((e) => e["testCaseId"]).filter((t): t is string => typeof t === "string"));
  const byType: Record<string, number> = {};
  for (const tc of [...tests].sort()) {
    const doc = readJson(join(runDir, "cases", `${tc}.json`));
    const raw = isPlain(doc) ? doc["testType"] : undefined;
    const types = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : typeof raw === "string" ? [raw] : [];
    for (const t of types.length > 0 ? new Set(types) : ["Unknown"]) byType[t] = (byType[t] ?? 0) + 1;
  }
  const escapes = opened.filter((e) => escaped(records?.get(e["defectId"] as string))).length;
  return {
    dre: opened.length === 0 ? null : round((100 * (opened.length - escapes)) / opened.length, 1),
    testsThatFoundDefects: tests.size,
    testsExecuted: executed ?? 0,
    byTestType: byType,
    ...(events === null || executed === null ? { noData: true } : {}),
  };
}

/**
 * agent-reliability.json = { agents: { <agent>: { reviewPassRate, requestedChangesCount, meanTaskDurationMs, lessonAppendCount } } }.
 * reviewPassRate = (review.passed + review.passed-with-notes) / (those + review.requested-changes) as a percentage, 1 decimal, per
 * target agent; null for an agent with no review. requestedChangesCount = its review.requested-changes events. meanTaskDurationMs = mean of
 * (task.released - the latest earlier task.claimed of the same task and agent), null when none. lessonAppendCount = its lesson.appended
 * events (aegis review submit pipes lessons without recording that event, so 0 means none recorded). noData: true without events.jsonl.
 */
function agentReliability(events: Ev[] | null): unknown {
  const agents: Record<string, { pass: number; changes: number; durations: number[]; lessons: number }> = {};
  const get = (a: string) => (agents[a] ??= { pass: 0, changes: 0, durations: [], lessons: 0 });
  const claims = new Map<string, string>();
  for (const e of events ?? []) {
    const target = isPlain(e["target"]) ? (e["target"]["agent"] as string | undefined) : undefined;
    if (e.type === "review.passed" || e.type === "review.passed-with-notes") { if (target !== undefined) get(target).pass++; }
    else if (e.type === "review.requested-changes") { if (target !== undefined) get(target).changes++; }
    else if (e.type === "task.claimed") claims.set(`${e["agent"]}|${e["taskId"]}`, e.ts);
    else if (e.type === "task.released") {
      const key = `${e["agent"]}|${e["taskId"]}`;
      const at = claims.get(key);
      if (at !== undefined) { get(e["agent"] as string).durations.push(Math.max(0, ms(e.ts) - ms(at))); claims.delete(key); }
    } else if (e.type === "lesson.appended" && typeof e["agent"] === "string") get(e["agent"]).lessons++;
  }
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(agents).sort()) {
    const a = agents[name]!;
    out[name] = {
      reviewPassRate: a.pass + a.changes === 0 ? null : round((100 * a.pass) / (a.pass + a.changes), 1),
      requestedChangesCount: a.changes,
      meanTaskDurationMs: mean(a.durations),
      lessonAppendCount: a.lessons,
    };
  }
  return { agents: out, ...(events === null ? { noData: true } : {}) };
}

const NON_APPLICATION = new Set(["test-side", "environment", "flaky"]);
const normaliseOrigin = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().toLowerCase().replace(/[\s_]+/g, "-") : null);

/**
 * flaky.json = [{ testRef, flakeRate, retryCount }], [] when nothing is flaky. Per test case (ONE row per TC; its per-viewport result files
 * win over the plain file, as in the coverage rollup) from the attempt data of its result files: a file's attempts are its priorResults[]
 * entries (each with a status) followed by its own status; retryCount = the file's retryCount (else retries) when a non-negative integer,
 * else the number of priorResults entries, and the TC's retryCount is the maximum over its files; flakeRate = failing attempts before the
 * final one / all attempts, over the same files, 0 to 1, 4 decimals. A test is flaky-shaped when it failed and then passed (final status pass,
 * an earlier attempt failed). RULE (documented, STRICTER than "failed then passed on a retry"): it is reported as flaky only if EVERY earlier
 * failing attempt records a non-application cause in its `origin` or `failureOrigin` (test-side, environment or flaky); a failing attempt
 * that records no origin, or an application origin, makes it SUSPECTED (the failure may be a real defect that was fixed): then the file is
 * { flaky: [...], suspectedFlaky: [{ testRef, flakeRate, retryCount, reason }] }. Without a suspect the file is the plain array.
 */
function flakyTests(runDir: string, missing: string[]): unknown {
  type Row = { testRef: string; flakeRate: number; retryCount: number };
  const dir = join(runDir, "cases");
  if (!existsSync(dir)) { missing.push("cases/"); return []; }
  const groups = new Map<string, { plain: unknown[]; viewport: unknown[] }>();
  for (const name of readdirSync(dir).sort()) {
    const m = RESULT_FILE.exec(name);
    if (m === null) continue;
    const g = groups.get(m[1]!) ?? { plain: [], viewport: [] };
    (m[2] === undefined ? g.plain : g.viewport).push(readJson(join(dir, name)));
    groups.set(m[1]!, g);
  }
  const flaky: Row[] = [];
  const suspected: Array<Row & { reason: string }> = [];
  for (const [testRef, g] of groups) {
    const docs = (g.viewport.length > 0 ? g.viewport : g.plain).filter(isPlain);
    let attempts = 0;
    let failsBefore = 0;
    let retry = 0;
    let flakyShaped = false;
    let unexplained = 0;
    for (const doc of docs) {
      const prior = Array.isArray(doc["priorResults"]) ? (doc["priorResults"] as unknown[]) : [];
      const explicit = [doc["retryCount"], doc["retries"]].find((v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0);
      retry = Math.max(retry, explicit ?? prior.length);
      attempts += prior.length + 1;
      const failed = prior.filter((p) => isPlain(p) && outcomeOf(p["status"]) === "fail") as Array<Record<string, unknown>>;
      failsBefore += failed.length;
      if (failed.length > 0 && resultOutcome(doc) === "pass") {
        flakyShaped = true;
        for (const f of failed) {
          const origin = normaliseOrigin(f["origin"]) ?? normaliseOrigin(f["failureOrigin"]);
          if (origin === null || !NON_APPLICATION.has(origin)) unexplained++;
        }
      }
    }
    if (!flakyShaped) continue;
    const row = { testRef, flakeRate: round(failsBefore / attempts, 4), retryCount: retry };
    if (unexplained === 0) flaky.push(row);
    else suspected.push({ ...row, reason: `${unexplained} earlier failing attempt(s) record no non-application cause (origin test-side, environment or flaky)` });
  }
  return suspected.length === 0 ? flaky : { flaky, suspectedFlaky: suspected };
}

/** Pure: compute the five rollups of the run in `runDir`; writes nothing. A malformed case-of-record declaration throws CaseOfRecordError. */
export function computeRollups(runDir: string): RollupResult {
  const missingInputs: string[] = [];
  const notes: string[] = [];
  const events = readEvents(runDir, missingInputs, notes);
  const descoped = descopedCases(runDir);
  const checks = existsSync(join(runDir, "cases")) ? scanChecks(runDir, descoped) : null;
  if (checks === null) missingInputs.push("cases/");
  const designed = checks === null ? null : checks.size;
  const executed = checks === null ? null : [...checks.values()].filter((c) => c.outcome !== undefined && !NOT_EXECUTED.has(c.outcome)).length;
  const recordList = readDir(join(runDir, "defects"), (n) => /^DEF-.*\.json$/.test(n), (f) => {
    const doc = readJson(f);
    return isPlain(doc) ? (doc as DefectRecord & { id?: unknown }) : undefined;
  });
  if (recordList === null) missingInputs.push("defects/");
  const records = recordList === null ? null : new Map(recordList.map((r) => [typeof (r.value as { id?: unknown }).id === "string" ? ((r.value as { id: string }).id) : r.name.replace(/\.json$/, ""), r.value as DefectRecord]));
  return {
    files: {
      "cycle-time.json": cycleTime(events),
      "defect-trend.json": defectTrend(events, designed, records, runDir),
      "effectiveness.json": effectiveness(events, runDir, records, executed),
      "agent-reliability.json": agentReliability(events),
      "flaky.json": flakyTests(runDir, missingInputs),
    },
    missingInputs: [...new Set(missingInputs)],
    notes,
  };
}
