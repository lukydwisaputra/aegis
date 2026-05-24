---
name: qa-doctor
description: Interactive diagnostic tool that identifies configuration and environment issues and suggests fix commands
---

# /qa-doctor

## Purpose
Runs a guided health check of the local QA pipeline setup: validates environment variables, checks tool versions, verifies directory structure, tests connectivity to configured integrations, and surfaces actionable fix commands for anything broken. The interactive mode walks through each check step-by-step and lets the user apply fixes in-session.

## Usage
```
/qa-doctor
```

## Key flags
*(No flags — always runs the full interactive diagnostic)*

## Behaviour
1. Check Node.js, pnpm, and git versions against minimum requirements in `config/requirements.yaml`.
2. Verify required environment variables are set (ANTHROPIC_API_KEY and any integration credentials).
3. Validate the QA pipeline directory structure: `runs/`, `artifacts/`, `config/`, `knowledge/`, `templates/`.
4. Check `config/environments.yaml` parses without error and at least one environment is defined.
5. Check `config/thresholds.yaml` exists and contains entries for each stage.
6. If integrations are configured (Jira, Linear, ClickUp), test authentication by making a lightweight API call.
7. Check for any orphan lock files and report them (with the fix command: `/qa-health --fix`).
8. Check `.gitignore` for required sensitive-file patterns.
9. For each failing check, print: what failed, why it matters, and the exact command to fix it.
10. Print a final score: `N/M checks passed` with a verdict of `healthy`, `degraded`, or `broken`.

## Events emitted
*(Read-only diagnostic — no events emitted)*

## Example
```
/qa-doctor
```
Sample output (abridged):
```
[PASS] Node.js 20.14.0 >= 20.0.0
[PASS] pnpm 9.1.0 >= 8.0.0
[FAIL] ANTHROPIC_API_KEY not set
       → Fix: export ANTHROPIC_API_KEY=<your-key>
[WARN] 1 orphan lock file found
       → Fix: /qa-health --fix
[PASS] Directory structure valid
[PASS] config/thresholds.yaml valid

Result: 4/5 checks passed — DEGRADED
```
