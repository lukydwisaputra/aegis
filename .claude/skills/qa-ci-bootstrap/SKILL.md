---
name: qa-ci-bootstrap
description: Generate the QA GitHub Actions workflows and print the Husky hook and secrets setup for CI/CD integration
---

# /qa-ci-bootstrap

## Purpose
Scaffolds the CI/CD integration layer for the automated QA pipeline: GitHub Actions workflow files that trigger smoke and regression runs on pull requests and merges, a Husky pre-commit hook for local gate checks, and a secrets setup guide for storing API keys and environment credentials. It writes only the QA-owned workflow files (`qa-*.yml` in the target's GitHub workflows directory, a named exception in the CLAUDE.md read/write table); the hook and the guide change shared developer files, so the command prints them for the developers to add. Designed for a pnpm monorepo structure.

## Usage
```
/qa-ci-bootstrap [--provider=github-actions] [--dry-run]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--provider` | `github-actions` | CI provider to generate for (currently only `github-actions` is supported) |
| `--dry-run` | `false` | Print generated file contents to terminal without writing to disk |

## Behaviour
1. Read project structure from `package.json` and `pnpm-workspace.yaml` to identify apps and packages.
2. Generate `.github/workflows/qa-smoke.yml` — triggers on pull_request, runs `/qa-smoke` via the Claude Code agent action.
3. Generate `.github/workflows/qa-regression.yml` — triggers on push to main/release branches, runs `/qa-regression`.
4. Generate `.github/workflows/qa-gate.yml` — runs `/qa-gate-check` after test workflows complete; blocks merge on failure.
5. Print the `.husky/pre-commit` hook that calls `/qa-smoke --budget=5m` for local validation, for the developers to add; never write it.
6. Print the repository secrets the workflows need and how to populate them (the secrets setup guide); never write it into the target's docs.
7. If `--dry-run`, print the three workflow files too and exit without writing.
8. Otherwise, write the three workflow files and report which were created or updated.

## Events emitted
- `ci.bootstrap.started` — provider, detected apps
- `ci.file.written` — per written workflow file
- `ci.bootstrap.completed` — file list, next-steps instructions

## Example
```
/qa-ci-bootstrap --dry-run
```
Previews all generated CI/CD files without writing them, allowing review before committing.

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
kind: execution
dispatchedBy: []
reads:
  - "package.json"
  - "pnpm-workspace.yaml"
writes:
  - "{target}/.github/workflows/qa-smoke.yml"
  - "{target}/.github/workflows/qa-regression.yml"
  - "{target}/.github/workflows/qa-gate.yml"
emits:
  - {event: ci.bootstrap.started, via: append}
  - {event: ci.file.written, via: append}
  - {event: ci.bootstrap.completed, via: append}
awaits: []
cli: []
runs: []
dispatches: []
config: []
```
