## Chapter 5 — Commands

> _The core user commands in 6 groups: each with purpose, flags table, and a worked example._

---

### 5.1 Command Groups

| Group | Prefix | Commands |
|---|---|---|
| Run lifecycle | `/qa-*` | start, smoke, resume, reissue, stop, status |
| Defect management | `/qa-*` | triage, export, impact |
| Knowledge | `/qa-*` | ingest-book |
| CI/CD | `/qa-ci-*` | bootstrap |
| Dashboard | `/qa-dashboard` | start, stop, status, build, preview |
| Improvement | `/qa-*` | promote |

All commands are invoked through the Claude Code slash-command interface or from a CI workflow via the `@qa/cli` package.

---

### 5.2 Group 1 — Run Lifecycle

#### `/qa-start`

Starts a full STLC run.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--module` | string | `ALL` | Limit the run to one module (e.g. AUTH) |
| `--env` | string | `testing` | Target environment |
| `--scope` | string | (none) | Narrow scope to a single feature or user story |
| `--type` | string | `Functional,Regression` | Comma-separated test types to include |
| `--intake` | glob | `aegis.config.json#intake.sources` | Target-relative globs of requirement documents to copy into the run |
| `--apps` | string | `all` | Comma-separated apps in the monorepo to include |

The three human gates (G1 Plan approval, G2 Defect triage, G3 Closure) cannot be skipped; decide each with `/qa-gate-decide`. For a PR-gate smoke cycle use `/qa-smoke`.

Example:
```bash
/qa-start --module AUTH --scope login --env testing
# Produces RUN-20260523-001 in aegis/runs/
```

---

#### `/qa-smoke`

Runs a fast smoke test: Intake, Scan, Env-auth, Env-data, Execution and Triage only, reduced case set. There is no human gate; G2 is auto-decided from `thresholds.yaml#smoke`.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--env` | string | `development` | Target environment |
| `--budget` | number | 10 | Time budget in minutes |
| `--cases` | string | `smoke` | Case tag filter |

Example:
```bash
/qa-smoke --env development --budget 5
```

---

#### `/qa-resume`

Resumes a paused or interrupted run.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--run` | string | latest | Run ID to resume |
| `--from-phase` | number | — | Force resume from a specific phase |

Example:
```bash
/qa-resume --run RUN-20260523-001
```

---

#### `/qa-reissue`

Reopens a phase after Gate 1 of a completed full run, and every phase after it; every gate after that phase is decided again by the owner. Gate 1 and earlier phases are untouched.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--phase` | string | — | A phase after Gate 1: `design` through `curator` |
| `--reason` | string | — | Why the phase is reissued (recorded in the log; reports may quote it) |
| `--cases` | string | every case | Comma-separated test case ids a reissued Execution re-runs |
| `--run` | string | active run | Run ID; must be completed |

Example:
```bash
/qa-reissue --phase=execution --reason="Re-run the checks the test environment blocked" --cases=TC-ATT-002,TC-ATT-005
```

---

#### `/qa-descope`

Records a test case as out of scope for a run, with the owner's reason; counts and reports state it apart instead of as a gap.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--case` | string | — | A test case id; repeat `--case` for several (validated all or nothing) |
| `--reason` | string | — | Why it is out of scope; quoted in reports, so it names no tool or agent |
| `--run` | string | active run | Run ID; any status |

Example:
```bash
/qa-descope --case=TC-REG-012 --reason="Depends on Singpass login, which this release does not cover"
```

---

#### `/qa-stop`

Gracefully stops the current run, writes partial artefacts.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--run` | string | latest | Run ID to stop |
| `--force` | boolean | `false` | Kill immediately, skip partial write |

---

#### `/qa-status`

Prints the status of the current or specified run.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--run` | string | latest | Run ID |
| `--json` | boolean | `false` | Output as JSON |

Example output:
```
RUN-20260523-001  phase=5  gate=defect-triage  status=waiting
Open defects: 1 Critical, 0 High
```

---

### 5.3 Group 2 — Defect Management

Defects are raised during a run and managed by `qa-defect-manager`; apart from `/qa-rollback`'s incident defect, no command files, lists, updates or closes one by hand.

#### `/qa-triage`

Re-evaluates open defects against the latest codebase and updates their status, severity and fix recommendation.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--severity` | string | `Sev1,Sev2,Sev3,Sev4` | Severities to re-evaluate |
| `--module` | string | `ALL` | Module code filter |
| `--age` | string | — | Defect age filter, e.g. `>7d` |

Example:
```bash
/qa-triage --severity=Sev1,Sev2 --age=>7d
```

---

#### `/qa-export`

Pushes defects and test cases from a run into Jira, Linear or ClickUp.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--tracker` | string | required | `jira`, `linear` or `clickup` |
| `--what` | string | `defects` | `defects`, `test-cases`, or both, comma-separated |
| `--since` | string | — | Only items newer than this run |
| `--run` | string | latest | Run ID |

---

#### `/qa-impact`

Traces a requirement ID to its test cases, defects and RTM rows.

| Flag | Type | Default | Description |
|---|---|---|---|
| `<REQ-id>` | string | required | Requirement ID, e.g. `REQ-AUTH-007` |
| `--module` | string | auto | Module code |

---

### 5.4 Group 3 — Knowledge

#### `/qa-ingest-book`

Chunks a QA reference book or document into `knowledge/`, for agents to read through `knowledge_refs`.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--book` | filepath | required | Path to the book or document |
| `--auto-chapters` | boolean | `false` | Detect chapter boundaries automatically |

Example:
```bash
/qa-ingest-book --book=books/raw/istqb-foundation.pdf --auto-chapters
```

No command lists or removes an ingested book; each book is a directory under `knowledge/`.

---

### 5.5 Group 4 — CI/CD

#### `/qa-ci-bootstrap`

Generates the QA GitHub Actions workflows for the target repo and prints the Husky hook and the secrets guide, which the developers add themselves.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--provider` | string | `github-actions` | CI provider (only value supported) |
| `--dry-run` | boolean | `false` | Preview without writing files |

No agent plans, writes or watches the target's CI (Chapter 11). For recent CI runs use `gh run list`.

---

### 5.6 Group 5 — Dashboard

#### `/qa-dashboard`

Starts, stops and builds the dashboard (UI on port 3030, API on port 3031).

| Argument / flag | Type | Default | Description |
|---|---|---|---|
| `start` / `stop` / `status` | subcommand | — | Run, stop or check the dev server; `start` opens the browser |
| `build` / `preview` | subcommand | — | Build a static export and serve it |
| `--port` | number | `3030` | Dashboard port |
| `--api-port` | number | `3031` | Dashboard API port |
| `--no-open` | boolean | `false` | Do not open the browser |
| `--host` | string | `localhost` | Bind host |

Example:
```bash
/qa-dashboard start --no-open
```

---

### 5.7 Group 6 — Improvement

#### `/qa-promote`

Promotes validated lessons to agent instructions. See Chapter 10 for the full lifecycle.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--agent` | string | all | Promote lessons for a specific agent |
| `--dry-run` | boolean | `false` | Show what would be promoted without writing |

Example:
```bash
/qa-promote --agent qa-ui-specialist
# Applies lesson: "always include teardown step in UI test cases"
```

Lessons live under `agent-memory/<agent>/`; no command lists or resets them. The curator queues proposals, and `/qa-promote` reviews them (Chapter 10).

---

### ⚠ Pitfalls

1. **Expecting a full cycle to run unattended** — a full cycle always pauses at G1, G2 and G3 until the owner decides each with `/qa-gate-decide`. There is no switch to skip gates; use `/qa-smoke` for an unattended PR-gate run.

2. **Running `/qa-start` without `--module` or `--scope` on a large app** — without scoping, the framework tests everything it can discover. This is expensive and slow for daily use; scope interactive runs.

3. **Using `/qa-ingest-book` with untrimmed PDFs** — large raw PDFs consume significant tokens during ingestion. Pre-process documents to remove boilerplate, legal appendices, and changelog sections before ingesting.

---

### Further Reading

- `docs/D05-commands-reference.md` — full reference for every user command
- `docs/D05-cheat-sheet.md` — one-page cheat sheet
