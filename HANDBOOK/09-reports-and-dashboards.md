## Chapter 9 — Reports and Dashboards

> _Per-run reports, operational rollups, the live dashboard (Vite+React on port 3030), three executive PDFs, and the SSE event stream._

---

### 9.1 Report Hierarchy

The framework produces reports at three levels:

| Level | Audience | Produced when | Location |
|---|---|---|---|
| **Closure artefact** | QA team, developers | End of Closure | `runs/<RUN-ID>/reports/closure/closure.{md,json}` |
| **Operational rollup** | QA lead, team lead | Weekly or on demand | `runs/rollup-YYYYWNN.html` |
| **Executive PDFs** | Stakeholders, PM, board | End of Executive Report | `runs/<RUN-ID>/reports/executive/*.pdf` |

---

### 9.2 The `reports/` Folder Layout

Each run's reporting output is partitioned by owner under `runs/<RUN-ID>/reports/`:

```
runs/{runId}/reports/
  closure/      closure.md + closure.json                       (qa-closure-reporter)
  metrics/      coverage.json, defect-trend.json, cycle-time.json,
                effectiveness.json, flaky.json, agent-reliability.json,
                token-usage.jsonl                                (qa-metrics-collector — SOLE owner)
  executive/    technical-report.pdf, signoff.pdf,
                executive-deck.pdf                               (qa-executive-reporter)
  compliance/   {iso25010,iso5055,istqb,cmmi,gdpr,pdpa}.{md,json}
  exploratory/  {session-id}-notes.{md,json}
  work/         qa-*.json  (work reports read by SPVs)
```

The closure artefact (`closure.md` + `closure.json`) is the developer-facing summary, owned by `qa-closure-reporter`. It contains:

1. **Run metadata** — run ID, date, environment, profile, agent count
2. **Coverage summary** — cases planned vs executed, pass/fail/blocked/not-run counts
3. **Test results by type** — unit / API / UI / security / accessibility / performance / email
4. **Defect list** — all defects with severity, priority, status, and linked test cases
5. **RTM completeness** — requirements covered, partial, not-covered
6. **Compliance summary** — per-framework status (see Chapter 8)
7. **Execution timeline** — phase durations and gate wait times
8. **Artefact index** — links to all generated files

`qa-metrics-collector` is the **sole owner** of `reports/metrics/` — no other agent writes there.

`closure.json` is also the input to the collector repo's index (`scripts/gen-index.ts` → `manifest.json` + README tables). The index reads a fixed set of keys — `cycleDate`, flat `metrics.passed/failed/blocked/passRate`, and `defectMetrics.confirmedOpen` — and publishes **open** defects rather than the logged total. A run that stores those figures in some other shape still closes normally, but its row renders as em dashes and `export-run.sh` blocks the next export rather than overwrite good values. The authoritative contract, including why nested `metrics` values break the index, is in `.claude/agents/tier1-phase/qa-closure-reporter.md` under "closure.json keys the collector index reads".

---

### 9.3 The Executive PDFs

Three executive deliverables are produced per run into `reports/executive/` by `qa-executive-reporter` (which reads `closure.json` — it does not write the closure files):

| PDF | Contents |
|---|---|
| `technical-report.pdf` | Comprehensive technical report — full coverage, results, defects, compliance (Deliverable 1) |
| `signoff.pdf` | Formal sign-off attestation with approval block, built from gate decisions and closure data (Deliverable 2) |
| `executive-deck.pdf` | Minto-pyramid executive deck in business language, no jargon (Deliverable 3) |

PDFs are generated using a headless Chromium print pipeline. They respect the `dashboard.projectName` setting and contain no internal framework branding (see `CLAUDE.md#brand-exposure-rule`).

---

### 9.4 Operational Rollups

The weekly rollup aggregates data across all runs in the week. It shows:

- Defect escape rate (defects found post-merge / total defects)
- Mean time to resolution (MTTR) per severity level
- Test coverage trend (week-over-week)
- Top 5 recurring defect patterns
- Agent lesson adoption rate

Generate a rollup on demand:
```bash
/qa-dash-export --rollup --week 2026-W21
```

---

### 9.5 The Live Dashboard

The dashboard is a Vite + React app served on port 3030 with a companion API on port 3031.

Start the dashboard:
```bash
pnpm --filter @qa/dashboard dev
# or, to start automatically with every run:
# set "dashboard.autoStart": true in aegis.config.json
```

Dashboard tabs:

| Tab | Contents |
|---|---|
| **Overview** | Current run status, active agents, gate state |
| **Runs** | Run history with status badges |
| **Coverage** | Coverage metrics per module, test type, and environment |
| **Defects** | Defect kanban: Open / In-Progress / Fixed / Closed |
| **Compliance** | Per-regulation coverage heatmap |
| **Lessons** | Pending and promoted lessons per agent |
| **Config** | Read-only view of `aegis.config.json` |

---

### 9.6 The SSE Event Stream

The event stream at `http://localhost:3031/events` emits Server-Sent Events for every state change in the current run. CI/CD systems and the dashboard both subscribe to this stream.

Event types (partial list):

```
run.started          { runId, profile, environment }
phase.started        { runId, phase, phaseName }
task.claimed         { runId, taskId, agentName }
task.completed       { runId, taskId, agentName, score }
gate.opened          { runId, gate, summary }
gate.approved        { runId, gate, approvedBy }
defect.created       { runId, defectId, severity }
run.completed        { runId, verdict, summary }
```

Subscribe from a shell:
```bash
curl -N http://localhost:3031/events
```

Subscribe from CI:
```yaml
- name: Wait for gate
  run: npx @qa/cli wait-gate --gate plan-approval --timeout 300
```

---

### 9.7 Worked Example — RUN-20260523-001 Report

The closure artefact for `RUN-20260523-001` showed:

```
Run:        RUN-20260523-001
Date:       2026-05-23
Environment: testing
Profile:    full
Duration:   34 minutes

Coverage:
  Planned:    18 cases
  Executed:   18 cases
  Pass:       17
  Fail:       1 (TC-AUTH-031)
  Blocked:    0
  Not-run:    0

Defects:
  Critical:   0
  High:       1 (DEF-001-AUTH-UI)
  Medium:     0
  Low:        0

Compliance:
  ISO 25010:  PASS
  ISO 5055:   WARNING (1 gap)
  GDPR:       PASS

Recommendation: release-blocked (1 High open defect)
```

The executive PDF for this run was shared with the product manager to justify delaying the release.

---

### 9.8 Reading Coverage Metrics Correctly

The dashboard shows several coverage metrics. Their definitions:

| Metric | Definition | Healthy range |
|---|---|---|
| **Case coverage** | (executed / planned) × 100 | ≥ 98% |
| **Pass rate** | (pass / executed) × 100 | ≥ 95% (varies by phase) |
| **RTM coverage** | (covered requirements / total requirements) × 100 | ≥ 80% |
| **Compliance coverage** | (tagged cases / total cases) × 100 | ≥ 90% |
| **Defect density** | defects / 100 test cases | < 5 is healthy |

These ranges are defaults. Set project-specific thresholds in `aegis/thresholds.yaml`.

---

### ⚠ Pitfalls

1. **Treating a 100% pass rate as "all good"** — 100% pass with low RTM coverage means you are passing tests that do not cover requirements. Look at RTM coverage alongside pass rate.

2. **Not opening the closure artefact before approving Gate 3** — the closure gate is most useful when you have read `closure.md` in full. Approving without reading means you are relying on the executive deck alone.

3. **Letting the dashboard fall behind** — the dashboard shows a stale state if the API server is not running. Run `pnpm --filter @qa/dashboard dev` before starting a run, or set `autoStart: true`.

4. **Sharing the executive PDFs before the run completes** — the PDFs are rendered in the final Executive Report phase. If you share them mid-execution, they will be incomplete and will not show defects.

5. **Conflating "defect escape rate" with "pass rate"** — escape rate measures defects found after release divided by all defects found. Pass rate measures test execution. They are different and should not be used interchangeably in stakeholder communications.

---

### Further Reading

- `docs/D09-report-schema.md` — full schema for run-report data
- `docs/D09-dashboard-api.md` — dashboard API endpoints and SSE event catalogue
- `docs/D09-executive-pdf.md` — PDF template customisation
