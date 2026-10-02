# sandbox/

AI experimentation space. Agents try new approaches, investigate edge cases, evaluate alternative implementations **here** — never in production code paths.

## ⚠ Strict isolation rules

1. **Entirely gitignored** except this README and `.gitignore`. Experiments are local-only by default.
2. **Path-guard refuses imports** from `sandbox/` into non-sandbox paths. Production code cannot accidentally depend on experimental code.
3. **`@qa/eslint-plugin/no-sandbox-import`** lint rule mirrors the runtime guard.
4. **Removed by its agent** at task end; nothing prunes it automatically.

## Layout

```
sandbox/
├── README.md                          # this file
├── .gitignore                         # nested protective rules
└── {YYYY-MM-DD}-{slug}/                # one folder per experiment
    └── (experiment files)
```

## Lifecycle

```
Agent creates sandbox/{date}-{slug}/

Agent runs experiment...

Agent removes it at task end (rm -rf sandbox/{date}-{slug})
  → records `sandbox.experiment-completed` with `aegis event append`

If an agent crashes or forgets, the directory stays until someone deletes it
(it is gitignored scratch; nothing prunes it automatically).
```

## Why this exists

When an agent is unsure how to solve a problem, it can scratch in `sandbox/` without contaminating real artifacts. Tests, prototypes, alternative implementations — all here.

## Sandbox-first mandate (writing specialists)

Exploration here is no longer optional for the writing specialists. Every Tier-2 specialist that commits a final spec under `tests/qa/**` (UI, API, database, accessibility, responsive, realtime, email, performance) must first prototype it in `sandbox/{date}-{slug}/` and emit a `sandbox.explored` event referencing the scratch artifact and the spec it produced, before the spec is written. The matching SPV rejects any committed spec with no matching `sandbox.explored` event. This does not force an artifact on a legitimate no-op run (e.g. `specialist.no-op`) — only on runs that actually commit a spec. The durable proof of exploration is the `sandbox.explored` event recorded in `events.jsonl` (permanent), carrying `artifactPath` and `targetSpecRef` — not the scratch directory itself. The scratch directory may be pruned as normal per the lifecycle above (removed by its agent at task end) once the spec is committed; the SPV verifies sandbox-first compliance via the event, not by inspecting the artifact on disk.
