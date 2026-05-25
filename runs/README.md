# runs/

Per-cycle outputs. Each QA cycle (`/qa-start`, `/qa-smoke`, `/qa-rerun-failed`, etc.) creates a new `RUN-{date}-{NNN}/` folder here with all artifacts, evidence, and reports.

## ⚠ Gitignored

This entire folder is gitignored (the `.gitkeep` keeps the folder itself in git). Runs are local-only by default; the dashboard reads them from the filesystem. For long-term retention, configure CI to upload `runs/{runId}/` as artifacts to S3 / GitHub Actions artifact storage.

## Layout (per run)

```
runs/
└── RUN-20260524-001/
    ├── plan.md            plan.json           # IEEE 829 test plan
    ├── cases/                                 # one .md + .json per test case
    │   ├── TC-AUTH-031.md
    │   └── TC-AUTH-031.json
    ├── rtm.md             rtm.json            # Requirements Traceability Matrix
    ├── defects/                               # per-defect artifacts
    │   ├── DEF-AUTH-0017.md
    │   └── DEF-AUTH-0017.json
    ├── risk-register.md   risk-register.json
    ├── reviews/                               # SPV reviews per task
    ├── reports/
    │   ├── work/                              # worker WorkReport.json per task
    │   ├── closure.md     closure.json
    │   ├── token-usage.jsonl
    │   ├── cycle-time.json
    │   ├── defect-trend.json
    │   ├── coverage.json
    │   ├── effectiveness.json
    │   ├── flaky.json
    │   ├── agent-reliability.json
    │   ├── knowledge-coverage.json
    │   ├── compliance/
    │   │   ├── iso25010.json
    │   │   ├── iso5055.json
    │   │   ├── istqb.json
    │   │   ├── cmmi.json
    │   │   ├── gdpr.json
    │   │   └── pdpa.json
    │   └── executive/                         # 3 PDFs produced by qa-executive-reporter
    │       ├── technical-report.pdf
    │       ├── signoff.pdf
    │       └── executive-slides.pdf
    ├── evidence/                              # per-TC screenshots/video/HAR/logs
    │   └── TC-AUTH-031/
    │       ├── TC-AUTH-031_step3_20260524T1430Z.png
    │       └── TC-AUTH-031_failure_20260524T1430Z.webm
    ├── events.jsonl                           # append-only event bus log
    ├── locks/                                 # active task claims (proper-lockfile)
    └── pending-promotions/                    # curator proposals (review via /qa-promote)
```

## Run ID format

`RUN-{YYYYMMDD}-{NNN}` — date + per-day counter. Atomic increment via `@qa/ids.nextRunId()`.

## Retention

- **Local default:** keep last 30 runs (configurable via `aegis.config.json.artifacts.retention.maxAgeRunsKept`)
- **Per-run artifact retention:** pass → replace previous run's screenshot with current (one screenshot per TC at all times); fail → keep current + preserve up to `historicalLimit` previous failure runs per TC
- **CI/staging deploys:** typically upload to S3 / GitHub artifacts with 30-90 day retention

## Reading a run

- **Humans:** open `reports/closure.md` for the summary, then drill into specific defects
- **Dashboard:** browse via `/qa-dashboard start` → `http://localhost:3030/runs/{runId}`
- **Machine:** all `.json` files are Zod-schema-stable; consume via `apps/dashboard-api/`
