# plan-validation/

Outputs of **Phase A.B — Post-Ingest Validation & Refinement**, the bridge phase between book ingest (Phase A) and agent design (Phase B).

After all books are ingested, the temporary `qa-plan-validator` agent (Opus 4.7) cross-references every locked-decision row in the build plan against the books, producing structured findings YOU review before Phase B begins.

## Layout (populated during Phase A.B)

```
plan-validation/
├── post-ingest-delta.md               # human-readable summary report
├── decisions.json                     # machine-readable audit log
├── contradictions/                    # plan-vs-book contradictions
│   └── NN-{slug}.md
├── gaps/                              # techniques books cover that plan misses
│   └── NN-{slug}.md
├── over-engineering/                  # where plan is heavier than books prescribe
│   └── NN-{slug}.md
├── confirmations/                     # plan decisions validated by books
│   └── NN-{slug}.md
├── recommendations.md                 # numbered, prioritized change list (you approve each)
├── canonical-example/                 # Login/SSO worked example for HANDBOOK
│   ├── REQ-AUTH-04.md
│   ├── STORY-AUTH-204.md
│   ├── TC-AUTH-031.md
│   ├── DEF-AUTH-0017.md
│   └── ...
└── agent-prompt-drafts/               # top-10 agent prompts + SPV reviews
    ├── qa-orchestrator.draft.md
    ├── qa-orchestrator.spv-review.md
    └── ...
```

## Cost estimate

~$15-25 one-time. Capped in `aegis.config.json.budgets.validation.maxCostUsd`.

## Lifecycle

This folder is **populated once** per Aegis build. After Phase A.B completes and Phase B begins, these files become historical reference. They're not regenerated on every cycle.

If books are added later (post-v1), Phase A.B can be re-run on a delta basis — see `docs/72-phase-ab-validation.md`.
