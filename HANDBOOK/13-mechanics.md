# Chapter 13 — Mechanics

> _The load-bearing internals — read this when extending or debugging._

## 13.1 Event bus protocol

The event bus is an append-only JSONL file at `runs/{runId}/events.jsonl`.

**Append protocol (`appendChained` in `@qa/event-bus`, called only by the aegis CLI):**
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

- The caller is the subagent's `agent_type`; a call without one is the main thread.
- Run files the CLI owns — `events.jsonl`, `run.json`, `gates/`, `reports/work/`, `reports/review/`, `taskmaster/`,
  `intake/`, `hooks/`, `integrity/`, lock files and the active-run pointer — are refused for every caller.
- Customer-facing files (`plan.*`, `rtm.*`, `cases/`, `defects/`, `reports/closure/`, `reports/executive/`) are refused
  when the written text matches a brand-exposure pattern.
- The main thread never writes a run directory or the target's `tests/`; a subagent whose name does not start with
  `qa-` never writes inside this repo either. Rollout exception: the direct run writes of the skills not yet rewritten
  onto the CLI (`LEGACY_MAIN_THREAD_RUN_WRITES` in `packages/@qa/path-guard/src/guard.ts`) are allowed from the main
  thread with a warning and a `legacy-write` hook-ledger entry; P0c/P3 remove each skill's entry when they rewrite it.
- The main thread never writes target source either: anything inside the target outside this repo, the tests
  directories and the two named exceptions (the target's Playwright config and its QA-owned workflow files).
- A `qa-*` agent writes only its role row's globs — {run} is the active run, {testsDir} is
  `aegis.config.json#testsDir`, {target} is `targetProjectRoot` — or the OS temp directory; never `packages/`, `apps/`,
  `.claude/`, a `package.json` or a lockfile, and nothing at all while the run's environment forbids it.
- A `pnpm aegis` call carries `AEGIS_AGENT=<caller>` (`owner` for the main thread) and must be a command that caller
  may run; `aegis align`, `init`, `update`, `doctor` and `reconfigure` are the owner's.
- A `qa-*` agent dispatches only `qa-*` agents, never `qa-orchestrator`.
- Paths are compared by realpath (the nearest existing parent for a path not created yet), so a symlink cannot carry a
  write past a rule.
- Without a build, or on a guard error, the hook fails closed for `qa-*` agents, for other subagents inside this repo
  and for main-thread calls that name the runs directory; anything else is allowed with a warning.

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

## 13.8 Knowledge librarian query resolution

`qa-knowledge-librarian` exposes a single operation: "what do the books say about X?"

1. Receive query string from worker agent
2. Load `knowledge/INDEX.md` to find which books/chapters cover the topic
3. Read the matching `knowledge/{slug}/ch-XX-*.md` files
4. Return a synthesized summary with source citations
5. Worker agent cites these sources in its work-report

This pattern keeps worker context lean — agents don't grep raw knowledge files themselves.

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

## 13.10 → Deep dives

- [docs/D13-concurrency-and-locking.md](../docs/D13-concurrency-and-locking.md)
- [docs/D13-event-bus-spec.md](../docs/D13-event-bus-spec.md)
- [docs/D13-spv-review-pattern.md](../docs/D13-spv-review-pattern.md)
- [docs/D13-work-report-schema.md](../docs/D13-work-report-schema.md)
- [docs/D13-model-policy.md](../docs/D13-model-policy.md)
- [docs/D13-prompt-caching.md](../docs/D13-prompt-caching.md)
- [docs/D13-spv-fast-path.md](../docs/D13-spv-fast-path.md)
