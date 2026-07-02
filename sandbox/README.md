# sandbox/

AI experimentation space. Agents try new approaches, investigate edge cases, evaluate alternative implementations **here** — never in production code paths.

## ⚠ Strict isolation rules

1. **Entirely gitignored** except this README and `.gitignore`. Experiments are local-only by default.
2. **Path-guard refuses imports** from `sandbox/` into non-sandbox paths. Production code cannot accidentally depend on experimental code.
3. **`@qa/eslint-plugin/no-sandbox-import`** lint rule mirrors the runtime guard.
4. **Auto-pruned** after the agent that created an experiment marks it complete (immediate delete) OR after 7 days (TTL fallback if the agent forgets).

## Layout

```
sandbox/
├── README.md                          # this file
├── .gitignore                         # nested protective rules
└── {YYYY-MM-DD}-{slug}/                # one folder per experiment
    ├── lifecycle.json                 # {createdBy, createdAt, purpose, ttl}
    └── (experiment files)
```

## Lifecycle

```
Agent creates sandbox/{date}-{slug}/
  ├─ lifecycle.json registered with @qa/sandbox-manager
  ├─ ttl: "7d" by default
  └─ purpose: free-text reason for the experiment

Agent runs experiment...

Agent calls sandboxManager.complete(slug):
  → immediate delete
  → emit `sandbox.experiment-completed` event

OR if agent crashes/forgets:
  → TTL pruner cron checks age
  → after 7 days: delete + emit `sandbox.ttl-prune`
```

## Why this exists

When an agent is unsure how to solve a problem, it can scratch in `sandbox/` without contaminating real artifacts. Tests, prototypes, alternative implementations — all here. Pruning ensures the folder doesn't accumulate cruft.

## Sandbox-first mandate (writing specialists)

Exploration here is no longer optional for the writing specialists. Every Tier-2 specialist that commits a final spec under `tests/qa/**` (UI, API, database, accessibility, responsive, realtime, email, performance) must first prototype it in `sandbox/{date}-{slug}/` and emit a `SandboxExplored` event referencing the scratch artifact and the spec it produced, before the spec is written. The matching SPV rejects any committed spec with no matching `SandboxExplored` event or sandbox artifact. This does not force an artifact on a legitimate no-op run (e.g. `SpecialistNoOp`) — only on runs that actually commit a spec. Coordinate with the auto-prune rule above: an artifact backing a committed spec should not be marked complete/deleted until the SPV has had a chance to verify it against `targetSpecRef`.

## See also

- `@qa/sandbox-manager` package
