---
name: qa-ci-bootstrap
description: Generate GitHub Actions workflows, Husky hooks, and secrets setup for CI/CD integration
---

# /qa-ci-bootstrap

## Purpose
Scaffolds the CI/CD integration layer for the automated QA pipeline: GitHub Actions workflow files that trigger smoke and regression runs on pull requests and merges, Husky pre-commit hooks for local gate checks, and a secrets setup guide for storing API keys and environment credentials. Designed for a pnpm monorepo structure.

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
5. Generate `.husky/pre-commit` hook that calls `/qa-smoke --budget=5m` for local validation.
6. Generate `docs/ci-secrets-setup.md` listing required repository secrets and how to populate them.
7. If `--dry-run`, print all file contents to terminal and exit without writing.
8. Otherwise, write files to disk and report which files were created or updated.

## Events emitted
- `ci.bootstrap.started` — provider, detected apps
- `ci.file.written` — per generated file
- `ci.bootstrap.completed` — file list, next-steps instructions

## Example
```
/qa-ci-bootstrap --dry-run
```
Previews all generated CI/CD files without writing them, allowing review before committing.
