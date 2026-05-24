# Model Policy

## Overview

All model assignments are centralized in `aegis/.claude/model-policy.yaml`. Agent definition files declare a `modelTier` — never a model name. A build step resolves tier → model and injects the `model:` field at install/update time.

**Why centralized?** Changing all SPVs to Sonnet (for cost) is a one-line edit, not a 22-file change.

## The 4 tiers

| Tier | Model | When to use |
|------|-------|-------------|
| `planning` | `claude-opus-4-7` | Deep synthesis, strategy, cross-artifact reasoning. Few invocations, high stakes. |
| `implementation` | `claude-sonnet-4-6` | High-volume writing and coding. Strong reasoning at much lower cost. |
| `validation` | `claude-opus-4-7` | SPV review. High leverage — a missed defect by an SPV propagates downstream. |
| `read-only` | `claude-haiku-4-5-20251001` | Pure extraction, classification, aggregation. No novel synthesis needed. |

## Assignment rationale

**Planning tier (Opus):** These agents set strategy that everyone else follows. Errors here propagate to 50+ downstream tasks. Examples: `qa-orchestrator`, `qa-test-planner`, `qa-executive-reporter`, all 6 compliance reviewers.

**Implementation tier (Sonnet):** High call count, predictable patterns. `qa-test-designer` may generate 100+ test cases per cycle — Opus at that volume is cost-prohibitive.

**Validation tier (Opus — upgraded from default):** Reviewing requires holding the rules + the artifact + the lessons file simultaneously. The cost of a missed SPV review is a defect that reaches production. Worth upgrading.

**Read-only tier (Haiku):** `qa-context-scanner` lists files and detects frameworks. `qa-knowledge-librarian` returns relevant book chunks by query match. No synthesis needed — just fast retrieval.

## Book ingestion uses multiple models per book

The `ingestion` section of `model-policy.yaml` defines a multi-stage strategy:
- Metadata + skip-filter: Haiku (cheap ~$0.03)
- Per-chapter extraction (with prompt caching): Sonnet (~$0.32 cached)
- Cross-book synthesis: Opus (~$0.30 for 5 triggers)
- Quality audit: Opus (optional, ~$0.10)

See `docs/71-book-ingestion-model-strategy.md` for full cost breakdown.

## SPV fast-path

First-pass review on Sonnet; escalate to Opus only when:
- Verdict is `requested-changes` or `passed-with-notes`
- Work touches security/compliance/auth
- Novel pattern not seen in lessons

Controlled by `aegis.config.json.spv.fastPath: true` (default). Estimated 40-60% SPV token reduction.

## Build step

`pnpm aegis build-agents` (or `apps/cli/src/commands/build-agents.ts`) does:
1. Read `model-policy.yaml`
2. For each `.claude/agents/**/*.md`: parse frontmatter, find `modelTier`
3. Look up tier → model name
4. Inject `model: <name>` field into frontmatter
5. Validate: every agent has a `modelTier`; every `modelTier` exists in policy; no agent appears in two assignment lists

Runs automatically on `aegis init` and `aegis update`.

## Cost monitoring

The token-usage report (`runs/{runId}/reports/token-usage.jsonl`) breaks down spend by `modelTier`. If validation tier becomes the dominant cost, switch SPVs back to Sonnet by editing:

```yaml
# aegis/.claude/model-policy.yaml
tiers:
  validation: claude-sonnet-4-6   # downgrade from claude-opus-4-7
```

Then run `pnpm aegis build-agents` to apply.
