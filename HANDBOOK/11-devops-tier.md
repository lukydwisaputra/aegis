# Chapter 11 — DevOps Tier

> _GitHub and CI/CD masters: branch strategy, PR flow, workflow implementation, safety gates._

## 11.1 Why DevOps is its own tier

Most QA systems stop at "write tests, run tests, report results." Aegis extends into the delivery pipeline because quality gates only work if they're wired into the code review and deployment flows.

The DevOps tier (Tier-2.5) operates **continuously across multiple STLC phases** — not just at the end. It creates branches during execution, opens PRs for test artifacts, watches CI runs for flakes, and manages workflow files.

## 11.2 The 7 DevOps agents

| Agent | Role | Tier |
|-------|------|------|
| `qa-github-planner` | Plans branch/PR strategy; drafts PR descriptions | Planning (Opus) |
| `qa-github-implementer` | Creates branches, opens PRs, manages labels/reviewers | Implementation (Sonnet) |
| `qa-github-spv` | Reviews PR readiness, Conventional Commit format, CI green | Validation (Opus) |
| `qa-cicd-planner` | Designs CI workflow jobs, matrix, caching, gates | Planning (Opus) |
| `qa-cicd-implementer` | Writes `.github/workflows/*.yml`, configures secrets | Implementation (Sonnet) |
| `qa-cicd-spv` | Validates workflows: yamllint, actionlint, no secret leakage | Validation (Opus) |
| `qa-cicd-evaluator` | Watches `gh run list/view`, detects flakes, recommends fixes | Read-only (Haiku) |

## 11.3 When DevOps agents activate in the STLC

| Phase | DevOps activity |
|-------|----------------|
| Planning | `qa-cicd-planner` proposes workflow plan based on the test plan |
| Env Setup | `qa-cicd-implementer` writes initial workflows; `qa-github-planner` plans branch strategy |
| Execution | `qa-cicd-evaluator` watches CI runs; `qa-github-implementer` creates branches for test file commits |
| Defects | `qa-github-implementer` files GitHub issues for tracked defects (with reproduction + evidence links) |
| Closure | `qa-github-implementer` opens PR for cycle's test artifacts; `qa-cicd-evaluator` posts CI summary; `qa-github-spv` validates readiness |

## 11.4 Worktree isolation

DevOps agents run with `isolation: "worktree"` because they execute `git checkout`, `gh pr create`, and similar working-tree mutations. The orchestrator passes the worktree flag automatically for this tier.

Non-DevOps agents never need worktree isolation — they only write to `aegis/runs/` and `tests/`, never touching the git working tree.

## 11.5 Branch and commit conventions

**Branches** (Conventional Branch):
```
<type>/<TICKET-ID>-<kebab-summary>
  feat/STORY-AUTH-204-sso-plus-email
  fix/DEF-AUTH-0017-sso-callback-500
  test/TC-AUTH-031-add-sso-e2e
```

**Commits** (Conventional Commits 1.0):
```
test(auth): add SSO regression for plus-aliased emails
fix(auth): reject malformed SSO callback (closes DEF-AUTH-0017)
```

Commit footer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` (model name, never "Aegis").

## 11.6 Safety gates (prevent autonomous merge to main)

Three rules that cannot be overridden by DevOps agents:

1. **DevOps agents never merge to `main`.** They open PRs; merge is part of human Gate 3 (closure sign-off).
2. **`gh secret set` only from `secretsRef` config.** Secret values never come from agent context (prevents secrets being committed via memory).
3. **SPV reviews before any PR goes live.** `qa-github-spv` must issue `review.passed` before `qa-github-implementer` can mark a PR ready for review.

## 11.7 Secrets handling

DevOps agents reference secrets via `aegis.config.json.environments.{env}.secretsRef`:
```jsonc
"secretsRef": {
  "type": "github-actions-secrets",
  "prefix": "STAGING_"
}
```

`@qa/secrets.get(name, env)` resolves from the configured source. Secrets are never logged, never in lessons.json, never in events.jsonl.

## 11.8 ⚠ Pitfalls

- **Don't push to `main` directly from DevOps agents.** Even if branch protection is off, the audit trail depends on PRs.
- **Don't use `--no-verify` to bypass the pre-commit hook.** If Husky fails, diagnose the root cause.
- **CI flakes vs. real failures**: `qa-cicd-evaluator` distinguishes these by looking at run history. Don't disable a gate because of a single flaky run — quarantine the test first.
- **Don't put secrets in YAML workflows.** Use `${{ secrets.NAME }}` references; `qa-cicd-spv` will reject workflows that inline secret values.
- **Worktree cleanup**: if an agent crashes mid-PR, the worktree may be orphaned. Run `/qa-health --fix` to detect and clean up.

## 11.9 → Deep dives

- [docs/35-devops-tier-overview.md](../docs/35-devops-tier-overview.md) — purpose, sub-roles, activation gates
- [docs/36-github-workflow.md](../docs/36-github-workflow.md) — branch strategy, PR conventions, gh CLI usage
- [docs/37-cicd-workflow.md](../docs/37-cicd-workflow.md) — GitHub Actions workflow templates + safety
- [docs/38-worktree-isolation.md](../docs/38-worktree-isolation.md) — when/why worktree is used
