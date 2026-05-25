# Concurrency and Locking

## Overview

Aegis uses two coordination primitives for safe concurrent agent operation:
1. **Taskmaster task claims** — serialized via file locks; prevent two agents from working the same task
2. **Event bus append** — serialized via `proper-lockfile`; ensures no events are lost under concurrent writes

## Task claim protocol

```
1. Agent calls @qa/taskmaster-client.claim(taskId, agentName)
2. @qa/taskmaster-client acquires proper-lockfile on runs/{runId}/locks/task-{taskId}.lock
   (stale timeout: 5s, retries: 8, retry interval: 100ms)
3. Read .taskmaster/tasks/{taskId}.json — check status === "pending"
4. If pending: write status="in-progress", claimedBy=agentName, claimedAt=now
5. Release lock
6. If not pending: return WORK_TAKEN error — agent asks orchestrator for next task
```

## Task release protocol

```
1. Agent completes work, writes artifacts
2. Agent calls @qa/taskmaster-client.release(taskId, resultRef)
3. Acquires lock, writes status="done", result=resultRef
4. Releases lock
5. Emits task.released event to event bus
```

## Event bus append protocol

```
1. @qa/event-bus.append(event) called
2. Acquire proper-lockfile on {busPath}.lock (stale 5s, retries 8)
3. Zod-validate event against AegisEventSchema
4. appendFileSync(busPath, JSON.stringify(event) + '\n')
5. Release lock
6. On validation failure: write bus.error event (best-effort, ignores errors), throw
```

## Orphan lock detection

Locks older than 5 minutes without a heartbeat are considered stale/orphaned.
`/qa-resume` detects these and releases them:

```bash
/qa-resume --run=RUN-20260524-001
# Finds all tasks with status="in-progress" + lock age > 5min
# Releases locks, resets to status="pending"
# Resumes from last completed task
```

## Single-writer rule for shared resources

Shared mutable resources have exactly one agent that may write them:

| Resource | Single writer | How others interact |
|----------|--------------|---------------------|
| `events.jsonl` | `@qa/event-bus` library (serialized) | All agents read freely; never write directly |
| `rtm.json` | `qa-test-designer` | `qa-defect-manager` appends links via `rtm.append-link` event |
| `defects/` | `qa-defect-manager` | Other agents emit events that defect-manager processes |
| `.counters.json` | `@qa/ids` library (serialized) | All agents get IDs via `nextId()` — never write directly |

## Parallel reads

All reads are unrestricted and concurrent. Agents may read any file at any time without acquiring a lock. Only writes are serialized.

## Parallelism budget

The orchestrator limits how many Tier-2 specialist agents run simultaneously:
```jsonc
// aegis.config.json
"parallelism": { "maxSpecialists": 4 }
```

SPV agents run as soon as their paired worker emits `task.released` — they are naturally parallelizable with the next worker's task.

Compliance reviewers run 6-in-parallel at the end of the design phase (one lock per reviewer, no shared resource contention).
