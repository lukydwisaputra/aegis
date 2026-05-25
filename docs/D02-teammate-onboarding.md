# Teammate Onboarding — After Cloning

_You've just cloned a project that has the QA framework already installed. This guide gets you running in ~5 minutes._

---

## Before you start: how slash commands work

Every `/qa-*` command in this guide is typed in **Claude Code chat** — not in a terminal.

The QA skills live in `aegis/.claude/skills/`. Claude Code only discovers `.claude/` at the **root of the folder you open**, so you must open the `aegis/` subfolder directly — not the parent project folder.

```
your-project/
└── aegis/          ← open THIS folder in Claude Code for QA work
    └── .claude/
        └── skills/ ← /qa-* commands are found here
```

1. Install Claude Code if you haven't: https://claude.ai/code
2. Open Claude Code and navigate to the **`aegis/` folder** inside your project (not the project root)
3. Type `/qa-health` (or any `/qa-*` command) in the Claude Code chat input

You will likely have two Claude Code windows: one on the project root for development, one on `aegis/` for QA. They do not interfere with each other.

Typing `/qa-health` in a terminal will give `command not found`. That is expected.

---

## Prerequisites check

Run all of these in a terminal. If any fail, install the missing tool before continuing.

```bash
node --version          # expect v20.x.x or newer
pnpm --version          # expect 9.x or newer  (if missing: corepack enable)
gh auth status          # expect "Logged in to github.com"
claude --version        # expect a version string
```

---

## Step 1 — Install dependencies

```bash
pnpm install
```

Verify:
```bash
pnpm --filter "@qa/contracts" build
# expect: exits 0, no errors
```

Common fix — `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`:
```bash
pnpm install --frozen-lockfile=false
# then commit the updated lockfile
```

---

## Step 2 — Local env setup

```bash
cp aegis/secrets/.env.development.example aegis/secrets/.env.development
```

Open `aegis/secrets/.env.development` and fill in:
- `APP_BASE_URL` — your local dev server URL (e.g. `http://localhost:5173`)
- `DATABASE_URL` — local database connection string
- Any other vars marked `# REQUIRED` in the example file

Ask your team installer for the required values. Do not share secrets over Slack or email — use a password manager or vault.

Verify:
```bash
grep -c "^[A-Z_]*=.\+$" aegis/secrets/.env.development
# expect: a number > 0
```

---

## Step 3 — Run a health check

Open **Claude Code** with the project folder, then in the chat:

```
/qa-health
```

Expected output:
```
✓ Path guard OK
✓ Schemas OK
✓ Module codes OK
✓ Event bus OK
✓ Gitignore OK
```

If any check shows `FAIL`, the output includes the fix command. Apply it and re-run `/qa-health`.

---

## Step 4 — Run a smoke cycle

In Claude Code chat:

```
/qa-smoke --env=development
```

Verify in terminal:
```bash
ls aegis/runs/ | tail -1
# expect: RUN-YYYYMMDD-NNN
```

---

## Step 5 — Optional: view the dashboard

In Claude Code chat:

```
/qa-dashboard start
```

Visit `http://localhost:3030`. The smoke run from Step 4 should appear.

---

## Day-1 checklist

- [ ] `node --version` ≥ 20
- [ ] `pnpm install` succeeds
- [ ] `pnpm --filter "@qa/contracts" build` exits 0
- [ ] `.env.development` populated
- [ ] `/qa-health` — all checks green
- [ ] `/qa-smoke --env=development` — produces a run directory

**You're done when `/qa-health` passes and a smoke run completes.**

---

## Common daily workflows

| What you want to do | Type in Claude Code chat |
|---|---|
| Run a full QA cycle for your feature | `/qa-start --env=development --scope=<feature>` |
| Quick smoke (fast, lower cost) | `/qa-smoke --env=development` |
| Re-run only failures from last run | `/qa-rerun-failed` |
| Check if a defect is fixed | `/qa-triage --severity=Sev1,Sev2` |
| Read the closure report | `cat aegis/runs/RUN-.../reports/closure.md` |
| Tail a running cycle live | `/qa-status --watch` |
| Stop a cycle cleanly | `/qa-stop --reason="..."` |
| Check gate before promoting | `/qa-gate-check --stage=testing` |
| Promote to staging | `/qa-promote-stage --to-stage=staging` |
| Export defects to Linear | `/qa-export --tracker=linear --what=defects` |
| Start the dashboard | `/qa-dashboard start` |

---

## Where to find what

| Thing | Location |
|---|---|
| Agent definitions | `aegis/.claude/agents/{tier}/` |
| Skills (slash commands) | `aegis/.claude/skills/` |
| Artifact templates | `aegis/packages/@qa/templates/` |
| Run reports | `aegis/runs/{run-id}/reports/` |
| Agent lessons | `aegis/agent-memory/{agent-name}/lessons.md` |
| CI/CD workflows | `.github/workflows/qa-*.yml` |
| Main config | `aegis/aegis.config.json` |
| Per-env config | `aegis/aegis.config.{env}.json` |
| Quality thresholds | `aegis/thresholds.yaml` |
| Module codes registry | `aegis/module-codes.md` |
| Books (local only) | `aegis/books/raw/` |
| Knowledge chunks | `aegis/knowledge/` |

---

## Permissions and access

| What | What you need |
|---|---|
| `gh` CLI operations | `repo`, `workflow`, `read:org` scopes — run `gh auth refresh -s repo,workflow,read:org` |
| Secrets (DB, Supabase, etc.) | Ask the installer — do not store in chat or email |
| Dashboard (if hosted) | URL + auth token from installer |
| Claude Code agent permissions | `aegis/.claude/settings.json` controls which tools agents can call; defaults are safe |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/qa-health` fails with `Path guard FAIL` | `aegis.config.json` has wrong `targetProjectRoot` | Check the path resolves to your app's root |
| `/qa-smoke` hangs at a gate | Gate is waiting for your input | Read the prompt in Claude Code chat and type `approve` or your feedback |
| `Module not found @qa/*` | Packages not built | `pnpm --filter '@qa/*' build` |
| `pnpm install` lockfile error | Lockfile mismatch | `pnpm install --frozen-lockfile=false` |
| Books missing from `knowledge/` | Knowledge is gitignored (default) | Ask installer for books → `/qa-ingest-book` locally |
| Pre-commit hook slow | Running all unit tests on every commit | Check `.husky/pre-commit` — should only run changed-file tests |
| Dashboard blank at localhost:3030 | No runs exist yet | Run `/qa-smoke` first to create a run |

For more: [HANDBOOK Chapter 15 — FAQ & Troubleshooting](../HANDBOOK/15-faq-and-troubleshooting.md)
