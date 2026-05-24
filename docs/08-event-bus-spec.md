# Event Bus Specification

## Overview

The event bus is an append-only JSONL file at `runs/{runId}/events.jsonl`.
Every agent emits structured events; other agents read by tailing the file.
No agent ever overwrites another's events.

## Library

```typescript
import { append, tail, subscribe, readAll, typeFilter } from '@qa/event-bus';

// Write
await append(event, busPath);

// Read all (sync)
const events = readAll(busPath, typeFilter('task.claimed', 'task.released'));

// Stream (async generator)
for await (const evt of tail(busPath)) { ... }

// Subscribe with polling
const { unsubscribe } = subscribe(busPath, typeFilter('review.requested-changes'), handler);
```

## Append protocol

1. Acquire `proper-lockfile` on `{busPath}.lock` (stale 5s, retries 8)
2. Zod-validate the event against `AegisEventSchema`
3. Append single JSON line to the file
4. Release lock
5. On schema failure: write `bus.error` event (best-effort), throw

## Event type catalog

All event types are defined in `@qa/contracts` as a Zod discriminated union on the `type` field.
Every event includes `ts: string` (ISO-8601 UTC).

### Task lifecycle
| Type | Key fields |
|------|-----------|
| `task.claimed` | taskId, agent |
| `task.released` | taskId, agent, result |
| `task.failed` | taskId, agent, error |
| `task.blocked` | taskId, agent, blockedBy |

### Artifact lifecycle
| Type | Key fields |
|------|-----------|
| `artifact.created` | kind, path, schemaVersion |
| `artifact.captured` | tcId, kind, path, sizeBytes |
| `artifact.pruned-success` | tcId, path, reason |
| `artifact.preserved` | tcId, path, reason, historicalCount |

### Review lifecycle
| Type | Key fields |
|------|-----------|
| `review.passed` | target.agent, target.taskId |
| `review.passed-with-notes` | target, findings[] |
| `review.requested-changes` | target, findings[], correctiveInstructions[] |

### Defect lifecycle
| Type | Key fields |
|------|-----------|
| `defect.opened` | defectId, severity, title |
| `defect.updated` | defectId, field, from, to |
| `defect.closed` | defectId, resolution |

### Gate & stage
| Type | Key fields |
|------|-----------|
| `gate.requested` | gate |
| `gate.evaluated` | stage, runId, passed, metrics[] |
| `gate.failed` | stage, runId, violations[] |
| `stage.promoted` | fromStage, toStage, runId |

### Compliance & security
| Type | Key fields |
|------|-----------|
| `compliance.flagged` | regulation, ref, severity |
| `brand.violation` | artifactKind, path, matchedPattern |
| `env.write-blocked` | env, agent, action |
| `env.specialist-blocked` | env, specialist |
| `aegis.territory.violated` | agent, attemptedPath |

### Discovery & auth
| Type | Key fields |
|------|-----------|
| `page.discovered` | url, route, role |
| `pom.generated` | path, page |
| `discovery.completed` | runId, pageCount, defectCount |
| `logout.completed` | role |

### Lessons
| Type | Key fields |
|------|-----------|
| `lesson.appended` | agent, lessonId, trigger |
| `lesson.conflict-flagged` | agent, candidateRule, conflictingId |
| `lesson.schema-rejected` | agent, error |

### Tokens & metrics
| Type | Key fields |
|------|-----------|
| `token.used` | agent, model, input, output, cached |

### Sandbox
| Type | Key fields |
|------|-----------|
| `sandbox.pruned` | path, ageDays |
| `sandbox.experiment-completed` | path, agent |

### DevOps
| Type | Key fields |
|------|-----------|
| `devops.branch-created` | branchName, ticketId |
| `devops.pr-opened` | prNumber, branch |
| `devops.ci-run-watched` | runId, status, conclusion |
| `devops.flake-detected` | testRef, flakeRate |

### Change request
| Type | Key fields |
|------|-----------|
| `change-request.impact` | reqId, affectedTCs, affectedDefects |

## Usage in agent prompts

```
When you complete a task, emit task.released with your result.
Listen for review.requested-changes to know when your work needs revision.
```
