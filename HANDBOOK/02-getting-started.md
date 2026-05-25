## Chapter 2 — Getting Started

> _Three onboarding tracks: fresh installer (~30 min), teammate after clone (~5 min), and CI/CD wiring (~10 min). Every step has a verify command._

---

### 2.0 How the Framework Is Invoked

**Before reading any track, understand this:** every `/qa-*` command in this handbook is typed in the **Claude Code chat**, not in a terminal.

The framework is a set of Claude Code skills (stored in `aegis/.claude/skills/`). Claude Code only discovers `.claude/` at the root of the folder you have open. Because `aegis/` is a subdirectory of the target project, you must **open `aegis/` itself as your Claude Code project** — not the target project root.

```
<target-project>/                    ← open this for normal app development
└── aegis/                  ← open THIS in Claude Code for QA work
    ├── .claude/
    │   └── skills/         ← /qa-* commands live here
    └── aegis.config.json
        └── targetProjectRoot: ".."   ← agents read <target-project>/ via this path
```

You will typically have **two Claude Code windows open**: one on the target project for development, one on `aegis/` for QA. They do not interfere.

To use a `/qa-*` command:

1. Open **Claude Code** pointing to the `aegis/` folder inside your project
2. Type `/qa-smoke` (or any `/qa-*` command) in the Claude Code chat input

If you type `/qa-smoke` in a terminal you will get `command not found`. That is expected — it is not a shell command.

The only things you run in a terminal are `pnpm install`, `pnpm build`, and the `aegis` CLI (a Node.js program for one-time setup).

---

### 2.1 Choosing Your Track

| Track | Who | Time |
|---|---|---|
| **2.A — Fresh install** | First person to set up the framework on a project | ~30 min |
| **2.B — Teammate clone** | Every subsequent developer joining an already-configured project | ~5 min |
| **2.C — CI/CD wiring** | DevOps or tech lead connecting the automated pipeline | ~10 min |

Complete **2.A** before anyone runs **2.B**. Complete both before running **2.C**.

---

### 2.A — Fresh Installer

#### Step 1: Prerequisites

Ensure the following are available:

| Tool | Minimum version | Check command | Install if missing |
|---|---|---|---|
| Node.js | 20 | `node -v` | https://nodejs.org |
| pnpm | 9 | `pnpm -v` | `corepack enable` |
| git | any | `git --version` | https://git-scm.com |
| gh CLI | 2.x | `gh --version` | `brew install gh` |
| Claude Code | any | `claude --version` | https://claude.ai/code |

Verify all at once:
```bash
node -v && pnpm -v && git --version && gh --version && claude --version
```

Expected: five version strings, no errors.

Common fix — `corepack: command not found`:
```bash
npm install -g corepack
corepack enable
```

#### Step 2: Install dependencies

From the `aegis/` directory:

```bash
cd aegis
pnpm install
```

Verify:
```bash
pnpm --filter "@qa/contracts" build
# expect: no errors, dist/ created inside packages/@qa/contracts/
```

If `@qa/*` packages are not found, run `pnpm install` from the repo root first, then retry from `aegis/`.

#### Step 3: Configure `aegis.config.json`

Open `aegis/aegis.config.json`. At minimum set:

```jsonc
{
  "targetProjectRoot": "..",           // path to the app under test (relative to aegis/)
  "dashboard": {
    "projectName": "Your Project Name" // shown in all reports — no "Aegis" branding
  },
  "environments": {
    "development": {
      "url": "http://localhost:5173"   // your local dev server URL
    }
  },
  "compliance": ["iso25010", "istqb"]  // start with two; add more when ready
}
```

Verify:
```bash
cat aegis/aegis.config.json | grep projectName
# expect: your project name in quotes
```

#### Step 4: Set secrets

Copy the example and fill in real values:

```bash
cp aegis/secrets/.env.development.example aegis/secrets/.env.development
```

Open `.env.development` and populate at minimum:
```
APP_BASE_URL=http://localhost:5173
DATABASE_URL=postgres://...
```

For Supabase projects also set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Verify:
```bash
grep -c "^[A-Z_]*=.\+$" aegis/secrets/.env.development
# expect: a number > 0 (count of populated variables)
```

> Never commit `.env.development` — it is gitignored by `aegis/secrets/.gitignore`.

#### Step 5: Run a health check

Open **Claude Code** with your project directory open, then type in the chat:

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

If any check shows `FAIL`, the output includes the fix command. Apply it and re-run `/qa-health` before continuing.

#### Step 6: Run your first smoke cycle

In Claude Code chat:

```
/qa-smoke --env=development
```

This runs a short cycle (phases 0–3 only, no compliance, no SPV review in Lite mode). It validates that path-guard, environment config, and the test runner are all wired correctly.

Verify (in terminal):
```bash
ls aegis/runs/ | tail -1
# expect: RUN-YYYYMMDD-001
```

#### Step 7: Start the dashboard

In Claude Code chat:

```
/qa-dashboard start
```

Then visit `http://localhost:3030` in your browser. The run from Step 6 should appear.

Alternatively, start it from the terminal:
```bash
pnpm --filter dashboard dev
# visit http://localhost:3030
```

#### Step 8: Commit the configuration

Files to commit:
```
aegis/aegis.config.json
aegis/secrets/.env.development.example   ← template only, not the real file
aegis/.gitignore
```

Files that are gitignored and should NOT be committed:
```
aegis/secrets/.env.development           ← real secrets
aegis/books/raw/                         ← PDF books (copyright)
aegis/knowledge/                         ← chunked book content (default)
aegis/runs/                              ← per-cycle outputs
aegis/.aegis/                            ← machine-generated state
```

Verify:
```bash
git status --short | grep "aegis/secrets/.env.development$"
# expect: empty output (file is gitignored)
```

---

### ⚠ Fresh Installer Pitfalls

1. **Running `/qa-smoke` in a terminal** — type it in the Claude Code chat, not in a shell. See Section 2.0.

2. **Committing `.env.development`** — the gitignore blocks it, but do not override with `git add --force`. Leaked credentials require rotation.

3. **Running a full cycle before the smoke passes** — a failed health check means some agents cannot reach the target. Start with `/qa-smoke`; run `/qa-start` only after smoke succeeds.

4. **Not setting `projectName`** — all reports default to "My Project". Set it in `aegis.config.json` before the first real run.

5. **`pnpm --filter "@qa/contracts" build` fails** — run `pnpm install` from the repo root (not just `aegis/`), then retry. Workspace dependencies must be resolved from the root.

6. **Health check shows `Gitignore FAIL`** — run `aegis doctor` in terminal to diagnose and auto-repair the gitignore layers.

---

### 2.B — Teammate After Clone

If the framework is already configured and committed (Track 2.A is done), teammates need only five steps.

#### Step 1: Install dependencies

```bash
pnpm install
```

Verify:
```bash
pnpm --filter "@qa/contracts" build
# expect: exits 0
```

Common fix — `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`:
```bash
pnpm install --frozen-lockfile=false
```

#### Step 2: Copy and fill secrets

```bash
cp aegis/secrets/.env.development.example aegis/secrets/.env.development
```

Fill in your own values (ask the installer for the required values — do not share them over chat).

Verify:
```bash
grep -c "^[A-Z_]*=.\+$" aegis/secrets/.env.development
# expect: > 0
```

#### Step 3: Run a health check

Open **Claude Code** with the project directory, then in the chat:

```
/qa-health
```

Expected: all checks green. If any fail, apply the suggested fix.

#### Step 4: Run a smoke cycle

In Claude Code chat:

```
/qa-smoke --env=development
```

Verify: `aegis/runs/` contains a new `RUN-...` directory.

#### Step 5: Optional — view the dashboard

In Claude Code chat:

```
/qa-dashboard start
```

Visit `http://localhost:3030`.

**You're done when `/qa-health` passes and a smoke run completes.**

---

### ⚠ Teammate Pitfalls

1. **Running `/qa-*` in a terminal** — they are Claude Code skills, not shell commands. See Section 2.0.

2. **Running `aegis init` again** — that is only for the initial installer. If the project already has `aegis/`, do not re-init. Use `aegis update` if you need to pull template changes.

3. **Committing your `.env.development`** — it is gitignored for a reason. Each developer keeps their own local copy.

4. **`Module not found @qa/*`** — packages need building: `pnpm --filter '@qa/*' build`.

5. **Books missing from knowledge/** — book content is gitignored by default (copyright). Ask the installer to share the books separately, then run `/qa-ingest-book` locally.

---

### 2.C — CI/CD Wiring

This track wires the framework into GitHub Actions. The DevOps agents can do this automatically via `/qa-ci-bootstrap`; these manual steps are the reference.

#### Step 1: Bootstrap with the CI skill

In Claude Code chat:

```
/qa-ci-bootstrap
```

This generates all workflow files, configures secrets via `gh secret set`, and installs the Husky pre-commit hook. If your repo is already set up, this command is idempotent.

Verify:
```bash
ls .github/workflows/ | grep qa-
# expect: qa-smoke.yml  qa-full.yml  qa-nightly.yml  qa-release.yml  qa-smoke-prod.yml
```

#### Step 2: Add repository secrets manually (if skipping Step 1)

In GitHub: **Settings → Secrets and variables → Actions**, add:

```
QA_SUPABASE_URL
QA_SUPABASE_ANON_KEY
QA_SUPABASE_SERVICE_ROLE_KEY
QA_GITHUB_TOKEN
```

Verify:
```bash
gh secret list | grep QA_
```

#### Step 3: Validate workflow files

```bash
pnpm exec actionlint .github/workflows/qa-*.yml
pnpm exec yamllint .github/workflows/qa-*.yml
```

Expect: no errors from either command.

#### Step 4: Push and watch

Push a branch, open a PR. The `qa-smoke.yml` workflow triggers automatically.

Verify:
```bash
gh run list --workflow=qa-smoke.yml | head -3
# expect: a run in "in_progress" or "completed" state
```

---

### ⚠ CI/CD Pitfalls

1. **Pushing to main before secrets are configured** — `qa-full.yml` triggers on every push to main and will fail if secrets are missing. Configure secrets before merging anything.

2. **Putting secrets in `aegis.config.json`** — use `gh secret set` or your vault. Never put real values in committed files.

3. **`actionlint` failing on `${{ secrets.X }}`** — secret names must match exactly what was set via `gh secret set`. Check for typos.

4. **Ephemeral testing env never reachable** — verify the `TESTING_PREVIEW_URL` secret is set per-PR in your deployment provider (Vercel/Netlify preview URL pattern).

---

### 2.4 Worked Example

During onboarding for `RUN-20260523-001`, the project had one misconfigured secret. Running `/qa-health` in Claude Code returned:

```
✗ Secrets FAIL: APP_BASE_URL is empty in .env.development
  Fix: open aegis/secrets/.env.development and set APP_BASE_URL
```

After setting the value and re-running `/qa-health`, all checks passed. `/qa-smoke --env=development` then completed in 8 minutes and produced `aegis/runs/RUN-20260523-001/`.

---

### Further Reading

- `docs/D02-teammate-onboarding.md` — standalone 5-minute checklist for teammates
- `docs/D05-cheat-sheet.md` — printable top-10 command reference
- Chapter 5 — All 28 commands with flags
- Chapter 12 — CI/CD pipeline in depth
