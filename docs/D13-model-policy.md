# Model Policy

## Overview

All model assignments are centralized in `aegis/.claude/model-policy.yaml`. Agent definition files declare a `modelTier` — never a model name. A build step resolves tier → model and injects the `model:` field at install/update time.

**Why centralized?** Changing every SPV's model or effort is a one-line edit, not a 22-file change.

## The 4 tiers

Every tier runs the same model, `claude-sonnet-5-5`. A tier now decides the reasoning effort, set in the `efforts:` map of `model-policy.yaml` and stamped into each agent as `effort:`. Effort is never `low`: the floor is `medium`, and a test enforces it.

| Tier | Model | Effort | Agents |
|------|-------|--------|--------|
| `planning` | `claude-sonnet-5-5` | high | Orchestrator, test planner, executive reporter, curator, the 6 compliance reviewers. Errors here propagate to every downstream task. |
| `implementation` | `claude-sonnet-5-5` | medium | Phase agents and Tier-2 specialists. High call count, predictable patterns. |
| `validation` | `claude-sonnet-5-5` | high | SPVs, the shared compliance SPV, the developer-test reviewer. A missed SPV review lets a defect reach production. |
| `read-only` | `claude-sonnet-5-5` | medium | `qa-context-scanner` and `qa-metrics-collector`: scanning, extraction and metric rollups. |

An SPV now shares its worker's model, so it no longer brings an independent model's blind spots to the review. High effort is the compensation. If SPV rejection rates or escaped defects suggest the review has weakened, raise the validation tier's model or effort first.

## Book ingestion

The `ingestion` section of `model-policy.yaml` names a model per stage (metadata, skip-filter, per-chapter extraction, cross-book synthesis, audit). All stages currently run `claude-sonnet-5-5`. See `docs/D05-book-ingestion-model-strategy.md` for the stage breakdown.

## SPV model

SPVs run on the `validation` tier. There is no automatic Sonnet-first escalation: the former `spvFastPath` block and the `escalateOnFinding` brief flag were never implemented and are removed from `model-policy.yaml`.

## Build step

`pnpm aegis build-agents` (or `apps/cli/src/commands/build-agents.ts`) does:
1. Read `model-policy.yaml`
2. For each `.claude/agents/**/*.md`: parse frontmatter, find `modelTier`
3. Look up tier → model name
4. Inject `model: <name>` and `effort: <level>` (from `efforts:`) into frontmatter
5. Validate: every agent has a `modelTier`; every `modelTier` exists in policy; no agent appears in two assignment lists

Runs automatically on `aegis init` and `aegis update`.

## Cost monitoring

The `token.used` events in `runs/{runId}/events.jsonl` break down token use by model. Rates come from `tokenRates` in `model-policy.yaml`, mirrored in `MODEL_RATES` in `packages/@qa/metrics/src/index.ts`; a test fails when a tier or ingestion model has no rate in either. If the validation tier becomes the dominant cost, lower its effort:

```yaml
# aegis/.claude/model-policy.yaml
efforts:
  validation: medium   # never low
```

Then run `pnpm aegis build-agents` to apply.
