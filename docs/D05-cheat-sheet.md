# QA Command Cheat Sheet

_Top 10 commands. Print this, stick it somewhere._

> **All commands below are typed in the Claude Code chat**, not in a terminal.
> Open Claude Code → navigate to your project folder → type in the chat input.

---

## Starting cycles

| Command | What it does |
|---------|-------------|
| `/qa-start` | Full STLC cycle from scratch |
| `/qa-smoke --env=testing` | 10-min PR-gate cycle |
| `/qa-regression` | Regression-only run |
| `/qa-rerun-failed` | Re-run only failed test cases |
| `/qa-resume` | Continue an interrupted cycle |
| `/qa-reissue --phase=execution --reason="..." [--cases=TC-...]` | Reopen a phase after Gate 1 of a completed run; its later gates are decided again |
| `/qa-descope --case=TC-... --reason="..."` | Record a test case as out of scope for a run |

## Checking & fixing

| Command | What it does |
|---------|-------------|
| `/qa-status --watch` | Live view of active cycle |
| `/qa-health` | Verify system integrity |
| `/qa-gate-check --stage=staging` | Is this cycle ready to promote? |
| `/qa-triage` | Re-evaluate open defects |
| `/qa-stop --reason="..."` | Abort cleanly |

## Owner decisions (in addition to the top 10)

| Command | What it does |
|---------|-------------|
| `/qa-gate-decide --gate=1 --decision=approved --note="..."` | Decide an open human gate (G1-G3) |
| `/qa-escalation --task=T-... --decision=retry --reason="..."` | Decide a task rejected three times |

---

## Common flags

```
--env=development|testing|staging|production
--module=AUTH          (scope to one module)
--run=RUN-20260523-001 (target a specific run)
--dry-run              (preview without spending tokens)
--json                 (machine-readable output)
```

---

## Promote through stages

```bash
/qa-gate-check --stage=testing --run=RUN-...   # check gate
/qa-promote-stage --to-stage=staging            # promote if gate passes
/qa-gate-check --stage=staging --run=RUN-...   # check staging gate
/qa-promote-stage --to-stage=production         # promote to prod
```

---

## Dashboard

```bash
/qa-dashboard start    # launches on port 3030
/qa-dashboard stop
/qa-dashboard status
```

---

## Getting help

```bash
/qa-help     # renders this cheat sheet in terminal
/qa-doctor   # interactive diagnostic with fix commands
```
