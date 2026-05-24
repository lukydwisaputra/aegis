# Per-Agent Auto-Learning

## Storage layout

```
aegis/agent-memory/{agent-name}/
  lessons.json          # source of truth (Zod-validated, machine-readable)
  lessons.md            # auto-rendered from JSON (human-readable)
  archive/              # evicted entries (audit trail; never deleted)
    2026-05.json
    2026-06.json
```

All three are committed to git. Lessons survive across machines and team members.

## lessons.json schema

```jsonc
{
  "agent": "qa-test-designer",
  "schemaVersion": "1.0",
  "lastUpdatedAt": "2026-05-24T10:00:00.000Z",
  "entries": [
    {
      "id": "L-TD-001",
      "polarity": "negative",
      "trigger": "spv-rejection",
      "mistake": "Generated test cases for happy path only; missed boundary inputs",
      "rootCause": "Forgot to apply BVA after determining equivalence classes",
      "correctiveRule": "Always apply BVA after EP — for every equivalence class, test the boundary values explicitly",
      "evidence": ["RUN-20260523-001#evt-42"],
      "firstSeen": "2026-05-23T14:30:00Z",
      "lastSeen": "2026-05-23T14:30:00Z",
      "hitCount": 1,
      "appliesWhen": "Numeric or date input test case design"
    }
  ]
}
```

## Append protocol (in `@qa/agent-memory`)

```
proposeLesson(agent, candidate):
1. Acquire proper-lockfile on agent-memory/{agent}/.lock
2. Normalize candidate.rootCause (lowercase, strip punctuation, tokenize)
3. For each existing entry: Jaccard(candidate.rootCause, entry.rootCause)
   ≥ 0.7 → DEDUP: increment hitCount + update lastSeen; discard candidate
4. Conflict check: if new correctiveRule is semantically opposite to any existing rule
   → emit lesson.conflict-flagged; do NOT append; escalate to curator
5. Zod.parse(candidate, LessonEntrySchema) — throw on failure
6. If entries.length ≥ 50:
   → sort by hitCount ASC, firstSeen ASC
   → evict entries[0] to archive/{YYYY-MM}.json
7. Push candidate to entries
8. Update lastUpdatedAt
9. Write lessons.json
10. Re-render lessons.md
11. Release lock
12. Emit lesson.appended event
```

## Pruning (end of every cycle)

Called by `qa-metrics-collector` at cycle close:
- Entries with no hitCount increment in last 10 runs → archived
- Entries older than 90 days with hitCount === 1 → archived
- Entries with hitCount ≥ 5 → protected from age-based pruning

Archived entries go to `archive/{YYYY-MM}.json` — never deleted (audit trail).

## Jaccard similarity calculation

```typescript
function jaccard(a: string, b: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  const setA = new Set(normalize(a));
  const setB = new Set(normalize(b));
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}
```

Threshold: ≥ 0.7 = near-duplicate → increment hitCount instead of appending.

## Reading protocol

Agent definition files include:
```yaml
knowledge_refs:
  - agent-memory/qa-{name}/lessons.md
```

Claude Code loads this file into context automatically at session start. The agent's system prompt instructs:
> "At the start of every task, read your lessons file. Apply the corrective rules — they represent learnings from past mistakes in this exact role."

## lessons.md format (auto-rendered)

```markdown
# Lessons — qa-test-designer
_Last updated: 2026-05-24 | 3 active lessons_

## L-TD-001 · negative · hitCount: 2 · last seen: 2026-05-24
**Mistake:** Generated test cases for happy path only; missed boundary inputs
**Root cause:** Forgot to apply BVA after determining equivalence classes
**Rule:** Always apply BVA after EP — for every equivalence class, test the boundary values explicitly
_Applies when: Numeric or date input test case design_

---
```

Entries sorted by `hitCount DESC`, then `lastSeen DESC` so the highest-impact lessons are read first.
