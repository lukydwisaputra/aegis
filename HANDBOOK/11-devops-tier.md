# Chapter 11 — CI and GitHub boundary

> _No agent writes to the target's GitHub repository or CI; CI setup is the owner's action, and flaky-test data comes from the run itself._

## 11.1 The rule

No agent writes to the target's GitHub repository or CI. No agent creates a branch, a commit, a pull request, an issue or a PR comment, edits a workflow file, or sets a repository secret. What reaches the target repository is decided by the owner and the developers, outside the run.

There is no DevOps tier. The seven agent definitions that once planned branches, opened pull requests and watched CI runs are kept for audit history in `agent-graveyard/`; nothing dispatches them.

## 11.2 What happens instead

| Need | Where it comes from |
|---|---|
| CI workflows for the target | The owner runs `/qa-ci-bootstrap` (Chapter 12). It writes only the QA-owned `qa-*.yml` workflow files, a named exception in the CLAUDE.md read/write table, and prints the Husky hook and the secrets guide for the developers to add. |
| Flaky-test data | The run's own retry and attempt data in `runs/<RUN-ID>/cases/*-result.json`, read by the metrics collector. |
| Committing the QA test suite | The developers commit `tests/qa/` through their own branch and review flow. |
| Repository secrets | The developers set them from the guide `/qa-ci-bootstrap` prints; local secrets are described in `secrets/README.md`. |

The rule binds the agents. A skill the owner invokes explicitly, such as `/qa-ci-bootstrap`, is the owner's own action.

## 11.3 ⚠ Pitfalls

- **Don't ask an agent to open a pull request or push a branch.** No agent has that role.
- **Don't put secrets in YAML workflows.** Use `${{ secrets.NAME }}` references, never an inline value.

## 11.4 → Deep dives

- [docs/D12-cicd-workflow.md](../docs/D12-cicd-workflow.md) — GitHub Actions workflow templates + safety
- [HANDBOOK/12-cicd-operations.md](12-cicd-operations.md) — stages, triggers, gates and commands
