# Chapter 13 — Mechanics

> _The load-bearing internals — read this when extending or debugging._

## 13.1 Event bus protocol

The event bus is an append-only JSONL file at `runs/{runId}/events.jsonl`.

**Append protocol (`appendChained` in `@qa/event-bus`, called by the aegis CLI and `@qa/reporters.writeArtifact`):**
1. Validate the event against `AegisEventSchema`; refuse undeclared fields and caller-set envelope fields (nothing is written on a refusal)
2. Acquire the `proper-lockfile` lock on the log (stale 5s)
3. Refuse a torn tail (an unterminated, unparseable last line); the owner cuts it with `aegis integrity repair-tail` (whatever the run status), which keeps the bytes in the run's integrity directory and records `integrity.tail-repaired`
4. Append one line with the envelope `seq`, `prevHash` (sha256 of the previous line), `emittedBy` and `runId`
5. Release the lock

Every event includes `ts: string` (ISO-8601 UTC). No agent overwrites another's events. Reads are unrestricted and concurrent; only writes are serialized.

**Reading:**
```typescript
import { readAll, tail, typeFilter } from '@qa/event-bus';
const events = readAll(busPath, typeFilter('task.claimed', 'task.released'));
for await (const evt of tail(busPath)) { /* stream */ }
```

## 13.2 Taskmaster task claim/release atomicity

Task files live at `runs/{runId}/taskmaster/tasks/{id}.json` and change only through the `aegis task` commands:

- `aegis task add --id <id> --title <text> --agent <qa-*>` — the dispatcher adds a task for one assignee, tagged with the phase in progress. The assignee is the only agent that may claim it; its paired SPV reviews it.
- `aegis task claim --task <id>` — the assignee takes a `pending` task (`not-assignee` for anyone else), under the task-file lock; the specialist cap and the environment rules apply. Records `task.claimed`.
- `aegis task release --task <id> --result done|failed` — after a work report from this claim. `done`: the task was carried out (failing tests are results of a `done` task). `failed`: the agent could not complete the task; the CLI opens an escalation for that attempt and blocks the run until the owner decides with `/qa-escalation`. Records `task.released`.
- `aegis task cancel --task <id> --reason <text>` — the task's creator withdraws a `pending` task nobody ever claimed. Records `task.cancelled`; the phase barrier ignores the task.
- `aegis task list [--run <id>] [--phase <id>]` — read-only, any caller: the run's tasks as JSON (id, title, phase, assignee, status, claimedBy, createdBy, latest attempt, the review state of that attempt — `none`, `passed`, `requested-changes`, `escalated` or `accepted-with-risk` — and the owner's escalation decision with its reason). Dispatchers use it to recover after an interruption. Takes no lock and writes nothing.

If an agent crashes after claiming but before releasing, the orphan lock is detected by `/qa-health --fix` (stale lock age > 5 minutes).

## 13.3 Path-guard enforcement

Writes are enforced by the PreToolUse hook `scripts/hooks/guard-writes.mjs` (H1). It applies the role table in
`packages/@qa/path-guard/src/roles.ts` to every `Write`, `Edit`, `MultiEdit`, `NotebookEdit` and `Bash` call and checks
every `Agent` dispatch. Exit 2 denies the call with the reason.

- A call that carries a non-empty `agent_id` (of any type) is a subagent's, and its `agent_type` names the caller; a
  call without one is the main thread (a `--agent` session included).
- Run files the CLI owns — `events.jsonl`, `run.json`, `gates/`, `reports/work/`, `reports/review/`, `taskmaster/`,
  `intake/`, `hooks/`, `integrity/`, lock files and the active-run pointer — are refused for every caller.
- Customer-facing files (`plan.*`, `rtm.*`, `cases/`, `defects/`, `reports/closure/`, `reports/executive/`) are refused
  when the written text matches a brand-exposure pattern.
- The main thread never writes a run directory or the target's `tests/`; a subagent whose name does not start with
  `qa-` never writes inside this repo either. Rollout exception: the direct run writes of the skills not yet rewritten
  onto the CLI (`LEGACY_MAIN_THREAD_RUN_WRITES` in `packages/@qa/path-guard/src/guard.ts`) are allowed from the main
  thread with a warning and a `legacy-write` hook-ledger entry; P0c/P3 remove each skill's entry when they rewrite it.
  The two files git tracks in the runs directory, its `README.md` and `.gitkeep`, are framework files: the main thread
  may edit them, restore them with `git checkout`/`git restore` and `git rm` them.
- The main thread never writes target source either: anything inside the target outside this repo, the tests
  directories, the QA-owned `qa-*.yml` workflow files and the `/qa-push-reports` collector repo named by
  `aegis.config.json#collector.path` (with no such key there is no collector exception). The target's Playwright
  config is the environment engineer's alone.
- A `qa-*` agent writes only its role row's globs — {run} is the active run, {testsDir} is
  `aegis.config.json#testsDir`, {target} is `targetProjectRoot` — or the OS temp directory; never `packages/`, `apps/`,
  `.claude/`, a `package.json` or a lockfile, and nothing at all while the run's environment forbids it.
- No role row covers the copied QA helpers `{testsDir}/support/test-helpers.ts` and `{testsDir}/support/supabase.ts`.
  Only `aegis helpers vendor` writes them, and only `qa-environment-engineer` may run it (in Env-auth); it overwrites a
  hand-edited copy and reports it as drift.
- A `qa-*` agent never changes dependencies in this repo or the target: `pnpm`, `npm`, `yarn` or `bun` with `add`,
  `install`, `ci`, `remove`, `update`, `link`, `unlink` (or an alias) is refused when its directory (the command's
  cwd, or `-C`/`--dir`/`--prefix`/`--cwd`) is inside either and outside the sandbox. A global install (`-g`,
  `--global`) is allowed: the environment engineer's `npm install -g @playwright/cli` is one.
- A `task claim` is logged in the ledger of the run its `--run` names when that run exists, otherwise in the active
  run's; a `--run` naming no existing run logs nothing.
- A `pnpm aegis` call carries `AEGIS_AGENT=<caller>` (`owner` for the main thread) and must be a command that caller
  may run; `aegis align`, `init`, `update`, `doctor` and `reconfigure` are the owner's.
- A `qa-*` agent dispatches only `qa-*` agents, never `qa-orchestrator`.
- Paths are compared physically: each existing component is realpathed before a `..` climbs, and only the part not
  created yet is normalized as text, so a symlink cannot carry a write past a rule. A subagent may not climb with
  `..` out of a directory that does not exist yet, nor link (`ln`, symbolic or hard) into `runs/` or the framework.
- Without a build, or on a guard error, the hook fails closed for `qa-*` agents, for other subagents whose call names
  a path inside this repo, and for main-thread calls whose path fields or unquoted command text name the runs
  directory; anything else is allowed with a warning (a `systemMessage`).

Bash targets are parsed best-effort (redirections, `tee`, `cp`, `mv`, `rm`, `sed -i`, `rsync`, heredocs, `cd`,
`bash -c`); writes inside interpreters are not seen. The hash chain and `aegis integrity verify` make such writes
detectable (spec §4.4).

**Env-safety — `envVerdict(agent, phase, env, policy)`** (H1, the SubagentStart context and `aegis task claim`):
- Names match by short name (`SPECIALISTS` in `@qa/contracts`); agent names are normalised
- If the env is read-only (`readOnly: true` or `mutating: false`) AND the specialist's `mutates` flag is set → refused
- If the specialist is in `forbiddenSpecialists`, or `allowedSpecialists` lacks both `*` and the specialist → refused
- A non-specialist is refused on a read-only env in a phase where its role changes the environment (`mutatesEnvIn`,
  e.g. the environment engineer in Env-data)
- On a refused claim the CLI records `env.specialist-blocked` and the claim fails with `env-blocked`; H1 denies every
  write of a refused agent

**Stop check — H2 (`scripts/hooks/require-work-report.mjs`, SubagentStop):**
- Only a call that carries `agent_id` and a `qa-*` `agent_type` is checked; the main thread and other subagents stop
  freely. Exit 2 keeps the subagent working, with the reason on stderr. Every other outcome exits 0, and a warning
  goes to stdout as a `systemMessage`. A missing build or an internal error lets the stop through, because the phase
  barrier still refuses unreported or unreviewed work.
- A worker is judged only on the tasks its own instance claimed, from the hook ledger (the `hooks/agents.jsonl` file of
  the active run). H1 logs a claim before the CLI runs, so H2 acts on a claim only when the task file confirms it: the
  task is in progress under that agent type, and this instance's ledger claim is the latest one at or before the
  task's `claimedAt`. A refused claim, or `task claim --help`, neither blocks nor releases.
- Every allowed stop appends a `stopped` ledger entry. Once the holder has `stopped` or `stop-unresolved`, the claim
  passes to the latest instance of the same type that tried to claim the task after `claimedAt` and has not ended.
  That instance is a resumed worker, which the CLI told to continue without claiming. A live parallel duplicate never
  inherits the claim.
- **Claim race (known limit).** The ledger is matched to the claim by time, not by identity. Suppose two instances
  of one type try to claim the same task at once, and the first one's claim command starts later. H2 can then pick
  the wrong instance as holder. That instance is held or released in the other's place. The phase barrier still
  checks the work itself. Binding a claim to its instance waits for the P0c caller-ticket design.
- A claimed task without a work report from this claim blocks the stop. A fresh report that was never released is
  released `done` for the worker. "Fresh" is the same rule `aegis task release` applies (`freshAttempt` in
  `packages/@qa/run-state/src/tasks.ts`). An attempt with a review or an escalation decision is not fresh, so a
  retried task needs a new report. Only a missing report blocks. When the release on the worker's behalf is
  refused for another reason, H2 re-reads the task. It skips a task that is no longer held, and otherwise lets the
  stop through with a warning.
- An SPV may stop once it has submitted a review since its `start` ledger entry, or when no released report of a
  paired worker awaits review.
- One instance is blocked at most 3 times. After that the stop is allowed with a warning, and the ledger records
  `stop-unresolved`.
- **`token.used` limitation (AUD-042b).** SubagentStop passes the session transcript (`transcript_path`), not a
  per-agent one. H2 counts only transcript lines whose `agentId` equals the stopping `agent_id`. It also reads the
  per-agent file Claude Code keeps beside the session transcript (`subagents/agent-<agent_id>.jsonl` in the session's
  folder), under the same per-line rule. That file layout is observed, not documented. When no line can be
  attributed, H2 records no `token.used`, and appends a `token-unattributed` ledger note instead. Token totals are
  therefore a lower bound: an agent missing from them has no attributable usage, not zero usage. A message id counts
  once, with the largest numbers seen across its repeated stream lines. A continued agent is charged only for entries
  after its last `tokens-recorded` ledger entry. That entry is written only when at least one event was recorded.
  When the bus refuses every event, a `token-unattributed` note carries the error, and the next stop retries.

## 13.4 Agent-memory dedup algorithm

When `proposeLesson(candidate)` is called:
1. Normalize the candidate's `rootCause` string (lowercase, strip punctuation, split into token set)
2. For each existing entry: compute Jaccard similarity = |A∩B| / |A∪B| on token sets
3. If max similarity ≥ 0.7: this is a near-duplicate → increment `hitCount` + update `lastSeen` on the existing entry; discard candidate
4. If no match: proceed to conflict check
5. Conflict check: if new `correctiveRule` is semantically opposite to an existing rule → emit `lesson.conflict-flagged`; do NOT append; escalate to curator
6. Schema validation via Zod
7. Cap check: if active entries count ≥ 50 → evict lowest hitCount oldest entry to archive
8. Append; release lock; emit `lesson.appended`

## 13.5 SPV review pipeline

```
Worker: aegis work-report submit, then aegis task release (the CLI records task.released)
  ↓
SPV (dispatched by the dispatcher after task.released):
  1. Read the worker's latest work report (reports/work/{agent}.{taskId}.{attempt}.json)
  2. Read actual artifact files
  3. Read worker's lessons.md (what should the worker already know?)
  4. Read relevant knowledge synthesis files
  5. Write verdict: passed | passed-with-notes | requested-changes
  6. Submit the verdict with aegis review submit, including correctiveInstructions on a non-clean pass
  7. The CLI appends the lesson through @qa/agent-memory; the SPV never writes lessons.json
  ↓
Dispatcher (qa-orchestrator for phase agents, qa-test-executor for specialists):
  • passed: the task is done, advance
  • passed-with-notes: done; aegis review submit already appended the lesson
  • requested-changes: the CLI reopened the task; re-dispatch the worker with the correction
  • 3rd rejection on the same task: the CLI records task.escalated and blocks the run; the owner decides with /qa-escalation
```

## 13.6 Model-policy resolution at build time

`apps/cli/build-agents.ts` reads `model-policy.yaml`, then for each `.claude/agents/**/*.md`:
1. Parse frontmatter; extract `modelTier`
2. Look up tier → model name in policy
3. Inject `model: <name>` into frontmatter
4. Write updated file

This runs as part of `aegis init` and on `aegis update`. No agent has a hardcoded model name — all assignments go through the policy file.

## 13.7 Compliance tag regex validation

Tags are validated in `@qa/contracts/tags.ts`. Each regulation has a named regex:

| Regulation | Regex |
|------------|-------|
| WCAG | `/^WCAG-\d+\.\d+-[\d.]+$/` |
| WSTG | `/^WSTG-v\d+-[A-Z]+-\d{2}$/` |
| CWE | `/^CWE-\d+$/` |
| ISO 25010 | `/^ISO25010-[A-Za-z]+-[A-Za-z]+$/` |
| ISO 5055 | `/^ISO5055-[A-Za-z]+-CWE-\d+$/` |
| ISTQB | `/^ISTQB-[A-Za-z]+-[\d.]+$/` |
| CMMI | `/^CMMI-[A-Za-z&]+-SP[\d.]+$/` |
| GDPR | `/^GDPR-Art\d+$/` |
| PDPA | `/^PDPA-Sec\d+$/` |

The `@qa/reporters.writeArtifact` pipeline runs tag validation at step 3. Malformed tags reject the entire write and emit `compliance.tag.invalid`.

## 13.8 Knowledge references

There is no query service. Each agent's `knowledge_refs` frontmatter lists the `knowledge/synthesis/*.md` topics it reads, plus its own lessons file:

1. The agent reads its `knowledge_refs` files at the start of its task
2. It cites what it used in its work report (`evidence[]`)
3. `knowledge/INDEX.md` records which books and chapters feed each synthesis topic, for whoever maintains the corpus

The synthesis files keep worker context lean: agents read the cross-book summary, not the raw chapters.

## 13.9 Crash recovery (`/qa-resume`)

```
/qa-resume --run=RUN-20260523-001
```

1. Read the Taskmaster task tree for the run
2. Find all tasks with `status === "in-progress"` that have no recent event (stale > 5min)
3. Release orphan locks on those tasks (reset to `status === "pending"`)
4. Find the last `status === "done"` task (last completed step)
5. Resume from the next pending task in the dependency order
6. Emit `run.resumed` event

If a lock file is stale but the task is still running (e.g., the agent is just slow), `/qa-resume` will not interrupt it — it only releases locks with no heartbeat activity for > 5 minutes.

**Orphan run directory.** `aegis run create` appends `run.created` before it writes `run.json` and points `runs/.active` at the run. A crash in between leaves a `RUN-*` directory with no `run.json`: it is inert (no command treats it as a run, `runs/.active` still names the previous run, and the next `run create` takes a new id) and safe to delete.

## 13.10 Reissuing a phase of a completed run (`/qa-reissue`)

A completed full run is not final after Gate 1. `/qa-reissue --phase=<id> --reason="..." [--cases=...]` runs `aegis run reissue`, which only the owner can run. It accepts a completed full run and a phase after Gate 1's phase (Design through Curator); Planning and every earlier phase, Gate 1 and the event history stay as they are.

1. The CLI verifies the event log, then records every work-report attempt on the tasks of the reissued phase and of every later phase as superseded in `run.json`, so only new work passes their barriers.
2. Those tasks go back to `pending` when they were `done` or `failed`; the reissued phase and every later phase go to `pending` (a completed phase after a reset gate is never reused), and the run to `running`.
3. Every gate after the reissued phase becomes `reset`: decided before, it needs a new owner decision. It is neither open nor approved, so the earlier phases run first, and when its phase completes the orchestrator opens it again. Its decision count is kept, so the new decision takes the next sequence.
4. One `run.reissued` (run id, phase, reason, reopened phases and gates, and the case list when given) is recorded, `run.json` keeps the same facts as its `reissue` record (replaced by the next reissue; the log keeps every one), and the run becomes the active run, because path-guard resolves the run folder through the active-run pointer.
5. The current decision file of each reset gate moves to `gates/gate-<N>-decision.<sequence>.json`, so the sign-off script and the orchestrator find no current decision until the owner decides again. A move that fails leaves the file, which the next decision archives anyway.
6. `/qa-reissue` dispatches the orchestrator, which re-runs the reopened phases, stops at each reset gate for `/qa-gate-decide`, and closes the run again with `aegis run complete`: the log then holds a second `run.completed`.

`--cases` scopes a reissued Execution: the executor dispatches only the listed cases, every other case keeps its recorded result, and each reopened specialist task outside the list gets a short carry-forward attempt. The case list applies only until a gate rejection or a completed run: after the owner rejects a gate that follows the reissue, the rejection note governs the scope, and once the reissued run has completed nothing is carried forward by scope. A reissue of a run that is not completed (a second one before the first finishes), of a smoke run, of a phase that is not completed in the run, of a phase at or before Gate 1, with `--cases` for a phase after Execution or naming a descoped case, with a malformed or unknown case id, or of a run whose log fails verification is refused. Every reopened phase overwrites its artefacts in place: copy the closure report and the PDFs first when they must be compared. To republish the corrected reports to the collector repo, run `/qa-push-reports --project=<name> --force` (`<name>` is the project's directory name under the QA folder). `--force` re-exports every run of that project (one export each), and the collector keeps one entry per run id, so the corrected run replaces its earlier copy. To republish only the reissued run, run the collector's export script for that single run from the Aegis repo root: `scripts/export-run.sh --project <name> --run <runId> --source <QA folder>/<name>/aegis/runs` (it commits and pushes, as `/qa-push-reports` does).

**Descoping a case (`/qa-descope`).** `/qa-descope --case=TC-... --reason="..."` runs `aegis run descope` (owner only, any run status; `--case` repeats for several cases, validated all or nothing): it appends the case and the owner's reason to `descoped` in `run.json` and records `run.descoped`; a second call for the same case changes nothing. The reports quote the reason, so the CLI refuses one that names the framework or an agent. `aegis metrics coverage` then leaves the case out of every count and out of the uncovered checks, reports it under `outOfScope` and `descoped` with its reason, and drops a requirement row whose cases are all descoped from the requirements coverage; the closure and executive reports state out-of-scope checks apart, with their reason.

## 13.11 → Deep dives

- [docs/D13-concurrency-and-locking.md](../docs/D13-concurrency-and-locking.md)
- [docs/D13-event-bus-spec.md](../docs/D13-event-bus-spec.md)
- [docs/D13-spv-review-pattern.md](../docs/D13-spv-review-pattern.md)
- [docs/D13-work-report-schema.md](../docs/D13-work-report-schema.md)
- [docs/D13-model-policy.md](../docs/D13-model-policy.md)
- [docs/D13-prompt-caching.md](../docs/D13-prompt-caching.md)
- [docs/D13-spv-fast-path.md](../docs/D13-spv-fast-path.md)
