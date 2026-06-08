## Chapter 5 — Commands

> _All 28 user commands in 6 groups: each with purpose, flags table, and a worked example._

---

### 5.1 Command Groups

| Group | Prefix | Commands |
|---|---|---|
| Run lifecycle | `/qa-*` | start, smoke, resume, stop, status, close |
| Defect management | `/qa-defect-*` | report, triage, list, update, close |
| Knowledge | `/qa-*` | ingest, books, forget |
| CI/CD | `/qa-ci-*` | plan, implement, evaluate, status |
| Dashboard | `/qa-dash-*` | open, refresh, export |
| Improvement | `/qa-*` | promote, lessons, reset-agent |

All commands are invoked through the Claude Code slash-command interface or from a CI workflow via the `@qa/cli` package.

---

### 5.2 Group 1 — Run Lifecycle

#### `/qa-start`

Starts a full STLC run.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--feature` | string | (all) | Restrict scope to a named feature |
| `--env` | string | `testing` | Target environment |
| `--profile` | string | from config | `full` or `lite` |
| `--no-gates` | boolean | `false` | Skip all human gates (CI-only) |
| `--req` | filepath | — | Path to additional requirements file |

Example:
```bash
/qa-start --feature login --env testing
# Produces RUN-20260523-001 in aegis/runs/
```

---

#### `/qa-smoke`

Runs a fast smoke test: phases 1–3 only, reduced case set.

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

#### `/qa-close`

Manually closes a run at Gate 3 (overrides the recommendation).

| Flag | Type | Default | Description |
|---|---|---|---|
| `--run` | string | latest | Run ID |
| `--verdict` | string | — | `release-approved` or `release-blocked` |
| `--note` | string | — | Justification for override |

---

### 5.3 Group 2 — Defect Management

#### `/qa-defect-report`

Manually files a defect outside of an automated run.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--title` | string | required | Defect title |
| `--severity` | string | required | `critical/high/medium/low` |
| `--run` | string | latest | Run to attach to |
| `--tc` | string | — | Linked test case ID |

Example:
```bash
/qa-defect-report --title "SSO redirect fails" --severity critical --tc TC-AUTH-031
# Creates DEF-001-AUTH-UI
```

---

#### `/qa-defect-triage`

Opens the triage UI for all untriaged defects in the current run.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--run` | string | latest | Run ID |
| `--filter` | string | `untriaged` | `all`, `critical`, `open` |

---

#### `/qa-defect-list`

Lists defects with optional filters.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--run` | string | latest | Run ID |
| `--severity` | string | — | Filter by severity |
| `--status` | string | — | Filter by status |
| `--json` | boolean | `false` | JSON output |

---

#### `/qa-defect-update`

Updates a defect field.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--id` | string | required | Defect ID (e.g., `DEF-001-AUTH-UI`) |
| `--status` | string | — | New status |
| `--severity` | string | — | New severity |
| `--note` | string | — | Triage note |

---

#### `/qa-defect-close`

Closes a defect as fixed, duplicate, or won't-fix.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--id` | string | required | Defect ID |
| `--resolution` | string | required | `fixed/duplicate/wont-fix/not-a-bug` |

---

### 5.4 Group 3 — Knowledge

#### `/qa-ingest`

Ingests a product document (PRD, spec, API contract) into the knowledge base.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--file` | filepath | required | Path to document |
| `--type` | string | auto | `prd/api-spec/design/other` |
| `--book` | string | — | Name the book |

Example:
```bash
/qa-ingest --file docs/auth-spec.md --type prd --book auth-v2
```

---

#### `/qa-books`

Lists all ingested books with status and token cost.

---

#### `/qa-forget`

Removes a book from the knowledge base.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--book` | string | required | Book name |
| `--confirm` | boolean | `false` | Required to prevent accidental deletion |

---

### 5.5 Group 4 — CI/CD

#### `/qa-ci-plan`

Generates a CI/CD strategy document without implementing it.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--platform` | string | `github` | `github/gitlab/bitbucket` |
| `--environments` | string | from config | Comma-separated environment names |

---

#### `/qa-ci-implement`

Generates and writes workflow files based on the CI plan.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--approve-plan` | boolean | `false` | Auto-approve the plan before implementing |
| `--dry-run` | boolean | `false` | Print files without writing |

---

#### `/qa-ci-evaluate`

Reviews existing workflow files and reports issues.

---

#### `/qa-ci-status`

Reports the status of the last N CI pipeline runs.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--count` | number | 5 | Number of recent runs to show |
| `--workflow` | string | all | Filter by workflow name |

---

### 5.6 Group 5 — Dashboard

#### `/qa-dash-open`

Opens the dashboard at `http://localhost:3030` in the default browser.

---

#### `/qa-dash-refresh`

Forces a dashboard data refresh without restarting the server.

---

#### `/qa-dash-export`

Exports dashboard data to a static HTML file.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--out` | filepath | `./qa-dashboard.html` | Output path |

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

---

#### `/qa-lessons`

Lists pending lessons awaiting promotion.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--agent` | string | all | Filter by agent |
| `--status` | string | `pending` | `pending/promoted/rejected` |

---

#### `/qa-reset-agent`

Resets an agent's memory and lessons to factory defaults.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--agent` | string | required | Agent name |
| `--confirm` | boolean | `false` | Required safety flag |

---

### ⚠ Pitfalls

1. **Using `--no-gates` in development** — gates protect you from approving bad plans automatically. `--no-gates` is designed for fully automated nightly pipelines, not interactive development sessions.

2. **Running `/qa-start` without `--feature` on a large app** — without scoping, the framework tests everything it can discover. This is expensive and slow for daily use; reserve full-scope runs for nightly builds.

3. **Calling `/qa-close` with `--verdict release-approved` when Critical defects are open** — the system will warn but comply. The note becomes part of the audit trail. Make sure the justification is defensible.

4. **Forgetting `--confirm` with `/qa-reset-agent`** — this is intentional friction. Resetting an agent deletes accumulated lessons; it should be a deliberate, documented decision.

5. **Using `/qa-ingest` with untrimmed PDFs** — large raw PDFs consume significant tokens during ingestion. Pre-process documents to remove boilerplate, legal appendices, and changelog sections before ingesting.

---

### Further Reading

- `docs/D05-command-reference.md` — full CLI reference with all exit codes
- `docs/D05-ci-commands.md` — CI/CD command integration guide
- `docs/D05-knowledge-ingestion.md` — book ingestion pipeline and token budgets
