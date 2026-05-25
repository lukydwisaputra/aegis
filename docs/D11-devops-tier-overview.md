# DevOps Tier Overview

Spec-level reference for the DevOps tier (Tier-2.5) — purpose, agent sub-roles, and activation gates.
See [HANDBOOK chapter 11](../HANDBOOK/11-devops-tier.md) for the narrative walkthrough.

---

## Purpose

The DevOps tier wires QA results into the delivery pipeline. It owns:

- Branch and PR creation for test artifacts
- GitHub Actions workflow generation and validation
- CI run monitoring and flake detection
- Secrets configuration (via `gh secret set`)
- Worktree isolation for git-mutating operations

Without the DevOps tier, quality gates exist only inside Aegis. With it, they block merges and deployments in GitHub.

---

## The 7 agents

| Agent | Model tier | Role |
|-------|-----------|------|
| `qa-github-planner` | planning (Opus) | Plans branch/PR strategy; drafts PR descriptions from RTM and defect context |
| `qa-github-implementer` | implementation (Sonnet) | Creates branches, opens PRs, manages labels and reviewers, links GitHub issues to defects |
| `qa-github-spv` | validation (Opus) | Reviews PR readiness: Conventional Commit format, CI green, brand-clean, description completeness |
| `qa-cicd-planner` | planning (Opus) | Designs CI workflow jobs, matrix strategy, parallelism, caching, gate triggers from `target-profile.json` |
| `qa-cicd-implementer` | implementation (Sonnet) | Writes `.github/workflows/*.yml`, configures GitHub secrets, validates with actionlint + yamllint |
| `qa-cicd-spv` | validation (Opus) | Reviews workflow YAML: no secret leakage, idempotent steps, branch protection compatibility, threshold coverage |
| `qa-cicd-evaluator` | read-only (Haiku) | Watches `gh run list/view`, parses results, detects flaky tests from retry patterns — never modifies code |

---

## Activation gates per STLC phase

| STLC phase | Activated agents | Trigger condition |
|-----------|-----------------|-------------------|
| Planning | `qa-cicd-planner` | Test plan approved at Gate 1 |
| Env Setup | `qa-cicd-implementer`, `qa-github-planner` | Environment bootstrap starts |
| Execution | `qa-cicd-evaluator`, `qa-github-implementer` | Test executor dispatches specialists |
| Defects | `qa-github-implementer` | `defect.opened` event with `tracker: github` |
| Closure | `qa-github-implementer`, `qa-cicd-evaluator`, `qa-github-spv` | Gate 2 (defect triage) passed |

---

## Planner → Implementer → SPV pattern

Each DevOps domain follows the same three-agent pattern:

```
qa-{domain}-planner   → produces a plan artifact (JSON/markdown)
qa-{domain}-implementer → reads plan, writes files / makes API calls
qa-{domain}-spv       → validates implementer's output; blocks or passes
```

The planner and implementer never run concurrently. The SPV always runs after the implementer, before any output is used downstream.

---

## Safety invariants

These rules cannot be overridden by any DevOps agent:

1. **Never merge to `main` autonomously.** Agents open PRs only; merge requires human action at Gate 3.
2. **Secret values never come from agent context.** `gh secret set` uses values from `aegis.config.json.environments.{env}.secretsRef` only.
3. **SPV must issue `review.passed` before a PR can be marked ready for review.**
4. **`qa-cicd-evaluator` is read-only.** It never modifies workflows, code, or test results.

---

## Worktree isolation

DevOps agents that mutate the git working tree run with `isolation: "worktree"`. The orchestrator sets this automatically for:

- `qa-github-implementer` (branch creation, commits)
- `qa-cicd-implementer` (workflow file writes)

Non-DevOps agents never require worktree isolation.

Orphaned worktrees (agent crash mid-PR) are detected and cleaned by `/qa-health --fix`.

---

## Related docs

- [D11-github-workflow.md](D11-github-workflow.md)
- [D12-cicd-workflow.md](D12-cicd-workflow.md)
- [D11-worktree-isolation.md](D11-worktree-isolation.md)
- [HANDBOOK/11-devops-tier.md](../HANDBOOK/11-devops-tier.md)
