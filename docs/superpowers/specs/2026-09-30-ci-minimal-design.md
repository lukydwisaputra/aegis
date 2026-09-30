# Slice 1a' — Minimal CI (design + plan)

> Temporary program document — delete with the matrix after P6.

**Goal:** every PR to `main` runs the internal suite, the multi-process smoke test and a guard
that stops the alignment baseline from growing silently. Fresh clones install and build.

## Decisions

| # | Decision | Why | Cost if wrong |
|---|----------|-----|---------------|
| C1 | One workflow `.github/workflows/ci.yml`, one job `build` → one aggregated required check `CI / build` | WerkDone CI standard (`/align-cicd`) | none |
| C2 | Inline workflow, adapted from the `/align-cicd` reference `ci.yml` | the reference is the blessed shape; Aegis is a personal repo outside the WerkDone org | a later move to a `shared-ci` caller |
| C3 | Drop the Postgres service, migrations, `test:rls` and `test:invariants` steps | Aegis has no database and no such scripts | none |
| C4 | Drop `pnpm lint` from CI; no package defines `lint`, so `pnpm lint` fails today. Tracked as CI-01 | adding ESLint is its own change with its own findings | the lint floor is missing until CI-01 lands |
| C5 | **Superseded by the first PR run (CI-02):** the call was refused, so the caller was removed from this PR. Original decision — security gates are called, not implemented: `.github/workflows/owasp-security-gates.yml` is a thin caller of `WerkDone-Pte-Ltd/shared-ci/.github/workflows/owasp-security-gates.yml@main`, with `run_rls_audit: false` because there is no Supabase | the `/align-cicd` checklist; a separate file keeps `CI / build` independent of whether a personal repo may call it | if the call is refused, it is reported as COULD NOT RUN (access), not as a finding |
| C6 | `pnpm-workspace.yaml` `allowBuilds.esbuild: true` | tsx and vite need esbuild; the unfilled placeholder breaks `pnpm install` on pnpm 11 | esbuild's postinstall runs; it is a well-known package |
| C7 | `package.json` `"packageManager": "pnpm@11.5.2"`; `pnpm/action-setup@v4` reads it, with no `version:` input | no double-pin | none |
| C8 | Baseline-growth guard: the PR fails when `baseline.yaml` gains keys versus the base branch, unless the PR carries the label `baseline-growth` | the ALIGN final review, Important #5 | labelled growth still depends on the reviewer |

## Workflow `ci.yml`

- **Trigger:** `pull_request` to `main` (types `opened`, `synchronize`, `reopened`, `labeled`, `unlabeled`, so that adding the label re-runs the guard), plus `push` to `main`.
- **Permissions:** `contents: read`.
- **Concurrency:** grouped per ref, cancelling in progress.

Steps, in order:
1. `actions/checkout@v4` with `fetch-depth: 0`, so the base ref is available.
2. `pnpm/action-setup@v4`.
3. `actions/setup-node@v4`, Node `22`, `cache: pnpm`.
4. `pnpm install --frozen-lockfile`.
5. Baseline-growth guard. PR events only; runs early for fast failure.
6. `pnpm build`. Workspace packages resolve each other's types from `dist/`, so this must run first; the first CI run showed typecheck failing on a fresh clone without it.
7. `pnpm typecheck`.
8. `pnpm test`.
9. `pnpm test:smoke`, which needs `apps/cli/dist`.
10. `pnpm aegis align`, which also proves the built CLI works.

## Guard

- `packages/@qa/alignment/src/growth.ts` exports `baselineGrowth(baseYaml: string | null, headYaml: string): string[]`.
  - It returns the keys present in head and absent in base, sorted.
  - `baseYaml === null` (the file is absent on base) returns `[]`: the guard is not applicable.
  - Parsing reuses the existing baseline schema loader where possible. Invalid YAML throws.
- `scripts/check-baseline-growth.ts` (run with `tsx`) takes `--base <ref>` and reads `git show <ref>:__internal-tests__/alignment/baseline.yaml` (null if that fails).
  - Added keys and `ALLOW_BASELINE_GROWTH` ≠ `true`: prints each key and a `::error title=Alignment baseline grew::…` line, then exits 1.
  - Added keys with the label: prints a `::warning` listing them and exits 0.
  - Nothing added: exits 0.
- The workflow step sets `ALLOW_BASELINE_GROWTH: ${{ contains(github.event.pull_request.labels.*.name, 'baseline-growth') }}` and passes `--base origin/${{ github.base_ref }}`.
- Tests in `__internal-tests__/alignment/growth.test.ts`:
  - added keys detected;
  - removed keys ignored;
  - identical → `[]`;
  - base null → `[]`;
  - invalid YAML throws.

## Docs sweep

- **HANDBOOK 14.11 baseline rules:** add the label rule.
- **CLAUDE.md Commands:** `pnpm lint` is not a working command. Mark it as not available yet (CI-01) and add `pnpm test:smoke`.
- **Matrix:**
  - add a `CI-01` row: lint floor missing, owner P5;
  - update the 1a' row;
  - fix CO-10's "no CI yet" wording once CI exists.
- **grep sweep:** reconcile every `.md` hit for `no CI`, `pnpm lint`, or a GitHub-Actions claim about Aegis itself. This does not include the target-app CI that `qa-cicd-*` agents generate.

## Verification

- **Local:** `pnpm install --frozen-lockfile` must work without `--config.verify-deps-before-run=false`. Then `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:smoke`, `pnpm aegis align`.
- **Guard mutation:** add a fake key → exit 1; set `ALLOW_BASELINE_GROWTH=true` → exit 0.
- **`actionlint`** on both workflows, if available through `pnpm dlx` or brew. Otherwise say so.
- **On the PR:**
  - `CI / build` must be green on Node 22;
  - the OWASP run is reported as FOUND, COULD NOT RUN, or green;
  - the required-check name is reported to the owner. Stage-0 has no rulesets, so it is set manually.
