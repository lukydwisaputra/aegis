# P2a Roster and Review Coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Temporary working document** — part of the audit remediation program. Delete together with the program specs once P6 is closed.

**Goal:** Retire the 11 orphan agents to `agent-graveyard/`, give every reachable worker a reviewer or a stated reason for none (a shared `qa-compliance-spv`, a strict Scan barrier, owner review of the curator), fix the AUD-049 checker false positive, close the special-phase vocabulary, and purge Lite from the docs. Baseline −60.

**Architecture:** Docs stop naming an agent before (or in the same commit as) its file moves, because the alignment checker reports every leftover name. Code changes are small: `ScanProfileSchema` becomes the strict `TargetProfileSchema`, `SPV_NONE` shrinks to two agents, `spvRule` accepts a self-dispatched SPV, `SPECIAL_PHASES` drops `devops`/`tooling`, and SPV pairing reads only P0b-2's path-guard role table. Tasks 1–7 run now on `feat/p2-roster`; Task 8 rebases onto `main` after P0b-2 merges; Tasks 9–13 need P0b-2's files.

**Tech Stack:** Node ≥ 20 ESM, TypeScript 5 (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), zod 3, jest + ts-jest (`__internal-tests__`, CommonJS transform, `@qa/*` mapped to package sources), pnpm 11 workspaces, the `@qa/alignment` checker (`pnpm aegis align`).

**Spec:** `docs/superpowers/specs/2026-10-02-p2-roster-design.md` (approved 2026-10-02). This plan covers slice **P2a** only (spec §8: §4.1–4.7 and the docs half of §4.8). P2b and P2c get their own plans. Program matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`. P0b-2 plan (the dependency): `docs/superpowers/plans/2026-10-02-p0b-2-hooks-chain.md` on branch `feat/p0b-2-hooks-chain`.

## Decisions

Owner decisions in the spec's Decisions table (AUD-046 … AUD-054, NEW-06) and technical decisions T1–T11 are binding and not repeated. This plan adds:

1. **Ruling on the spec's open question (§11), coordinator 2026-10-02.** "Aegis never writes to the target's GitHub or CI" binds autonomous agents. A skill the owner invokes explicitly is the owner's own action, so P0b-2 decision 12 stands: `/qa-ci-bootstrap` writes only the `qa-*.yml` workflows (named exception) and prints the Husky hook and the secrets guide; `/qa-promote-stage` and `/qa-rollback` are left to P3 (AUD-065). HANDBOOK/11 says so (Task 2).
2. **Split by dependency.** Tasks 1–7 touch no file P0b-2 creates and only regions of shared files that P0b-2 does not edit (table in File Structure). Tasks 9–13 need a P0b-2 file (`roles.ts`, `role-table.test.ts`), P0b-2's 4 transient AUD-050 baseline keys, or the matrix cells P0b-2 Task 14 edits.
3. **The UI-designer pair retires after the rebase** (Task 9), so the same commit deletes P0b-2's 4 `WRITE-POLICY:qa-ui-designer:…` keys and the agent. Retiring it earlier would leave those keys stale after the rebase.
4. **`SPECIAL_PHASES` closes after the UI-designer retirement** (Task 10): `qa-ui-designer`'s contract says `phase: tooling`.
5. **The librarian and the event-bus agent retire in one task** (Task 4). Retiring only one leaves 4 cross-cutting files, which matches the CLAUDE.md row's stale "4" and turns its baseline key stale.
6. **HANDBOOK/03 §3.6 and HANDBOOK/06 §6.5 are replaced by a two-sentence "CI and GitHub" note** instead of being deleted, so §3.7, §6.7 and the cross-references to them keep their numbers. All names the spec wants gone still go.
7. **Counts.** Only the CLAUDE.md tier table is machine-checked (`countRule`). Each task that changes a tier directory sets its row to the then-true count: SPVs stay 24 through Task 8, become 23 in Task 9 and 24 again in Task 11. Every other edited doc line is written without a total (HANDBOOK/06 header, pitfall 2, HANDBOOK.md row 6).
8. **`qa-compliance-spv` lists the six worker lessons files one by one** (contract `reads`, `knowledge_refs`, Inputs), not as `agent-memory/qa-compliance-*/lessons.md`: the checker treats a repo-source glob as a missing file (`missingRepoSource` → `pathExists` is literal).
9. **The Lite purge also covers HANDBOOK/01:11,73,111,115, HANDBOOK/02:167 and HANDBOOK/16:130.** The spec lists only CLAUDE.md:73, HANDBOOK.md:41 and HANDBOOK/06, but the owner said "everywhere" and a new test checks the whole DOC-REF scope.
10. **The orchestrator's Worker → SPV table gains a `qa-orchestrator` row in the AUD-049 task** (Task 5). It documents the self-dispatched reviewer and is the prose change the shrink guard needs for that key in the same commit.
11. **`SPV_NONE` loses `qa-metrics-collector` and `qa-cicd-evaluator` in Task 7, and the six compliance agents in Task 11** (when `qa-compliance-spv` is paired). Task 3 does not touch `phase-map.ts`.
12. **`spvPairs` is `{}` between Task 3 and Task 11.** The DevOps pairs leave with the agents; the six compliance pairs arrive with the role-table pairing.
13. **P2c hand-off (coordinator, P0b-2 pre-flight).** P0b-2 deletes `@qa/sandbox-manager`, and its new `__internal-tests__/legacy-writers.test.ts` imports `@qa/reporters`, so reporters has a consumer and stays (wired in P0c). P2a edits neither the AUD-054 row nor any package doc; P2c records both facts.

## Owner questions

None open.

## Global Constraints

Copied from the spec; every task implicitly includes them.

- Owner rules: Aegis never modifies its own framework at runtime; agents never modify the target app's source; no agent writes to the target's GitHub or CI; production is never used for mutating tests; one target project per cycle (HANDBOOK/17).
- Retirement protocol (spec §4.1): `git mv .claude/agents/<tier>/<name>.md agent-graveyard/<name>.md`; add `retiredAt: 2026-10-02` and `reason: "<AUD>, owner decision 2026-10-02: …"` to its frontmatter; leave the body (old contract included) unchanged; leave `agent-memory/<name>/` in place; remove it from `.claude/model-policy.yaml#assignments`; remove every `pipeline.yaml#escapes` entry with `unit: <name>`.
- The reasons, verbatim: DevOps ×7 `"AUD-046, owner decision 2026-10-02: Aegis never writes to the target's GitHub or CI; never dispatched"`; librarian `"AUD-047, owner decision 2026-10-02: agents read knowledge/synthesis directly through knowledge_refs"`; event bus `"AUD-048, owner decision 2026-10-02: events are appended only through the aegis CLI and @qa/event-bus"`; UI-designer pair `"AUD-050, owner decision 2026-10-02: dashboard work is framework development"`.
- `packages/@qa/contracts/src/forbidden-strings.ts` keeps the retired names: they must still never reach customer-facing output.
- The `devops.*` event schemas stay declared, with a comment (T8).
- P0b-2 changes P2 must keep: `pipeline.yaml#hookEmits` exists; `CLAUDE.md`'s write table and `pipeline.yaml#writePolicy.writable` no longer list `packages/@qa/**`, `apps/**` or `agent-memory/**` (never re-add them); the H4 cheat-sheet lives in `packages/@qa/run-state/src/hook-context.ts`. P2a edits none of these.
- Never write a wrong count on an edited line: it creates a new baseline key.
- TypeScript is `strict` with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Avoid `Array.prototype.at` in test code.
- Customer-facing files never contain "Aegis" or internal agent names (CLAUDE.md brand exposure rule).

## Review Focus

Failure modes the spec implies but no requirement names, most likely first. Each line names the task whose test pins it.

1. **A retired name surviving where the checker does not look** — a `.claude/skills/**` file, `.claude/settings.json`, or a `qa-x.md`-style mention (DOC-REF skips a name followed by `.md`). Expected: no DOC-REF-scope doc and no `.claude/**` file names a retired agent. Pinned by `p2-roster.test.ts` "no doc in the DOC-REF scope and no .claude/** file names a retired agent" (Tasks 3, 4, 9).
2. **A real scanner profile the strict barrier refuses** — an extra top-level key (`tsxFileCount`) or a missing one (`scannedAt`). Expected: Scan refuses and the message names the field, so the scanner can fix it. Pinned in Task 6.
3. **A compliance review by the wrong SPV, or a compliance task never reviewed** — including a run already in Compliance when P2a lands. Expected: `aegis review submit` refuses any SPV but `qa-compliance-spv`; the Compliance barrier names each unreviewed task, and the orchestrator's continue-phase loop dispatches the SPV. Pinned in Task 11 (`run-state-submit`, `run-state-phases`).
4. **Historical sibling-project logs with `devops.*` events** (e.g. `onecare-schedule` RUN-20260628-001). Expected: they still parse. Pinned in Task 3 (`p2-roster.test.ts`, T8 test).
5. **A Markdown link to a deleted D11 doc outside the DOC-REF scope** (`secrets/README.md`, `test-data/README.md`, `docs/D12-*`). Expected: no tracked Markdown file links `D11-*.md`. Pinned in Task 2.

## Process conventions

- **Setup, once per worktree:** `pnpm install --frozen-lockfile` (the worktree has no `node_modules`), then `pnpm --filter "@aegis-qa/cli..." run build`.
- **Before `pnpm aegis align` and before `cli-cycle-e2e`, build:** `pnpm --filter "@aegis-qa/cli..." run build`. Jest itself reads package sources and needs no build.
- Every task states **Baseline: −N** and lists the keys it deletes from `__internal-tests__/alignment/baseline.yaml`, plus the expected entry count afterwards (`grep -c '^  - key:' __internal-tests__/alignment/baseline.yaml`). Counts assume 281 at `e71d838` and, after Task 8, the count on `main` after P0b-2 (278 per its plan); if `main` differs, every later count shifts by the same amount.
- A removed key needs a non-blank prose change in its subject file in the same slice (moving the file counts, because the guard diffs with `--no-renames`). No task here needs `contract-only-fix`.
- Escapes growth: Task 11 adds one escape (`qa-compliance-spv reviewedBy.none`), so the PR needs the `baseline-growth` label. No baseline key is added.
- A new violation caused by new doc text is fixed by rewording, never by baselining it.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage by explicit path only. Never stage `secrets/.env.*`, `test-data/credentials/*.env.local`, `sandbox/*` (except `sandbox/README.md`), `books/raw/*` or `.superpowers/`.
- Never push, never touch a real environment, never modify the target app.

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `__internal-tests__/p2-roster.test.ts` (new) | Lite docs, DevOps docs, retired agents, model policy, config, T8, `SPV_NONE`, tier counts, compliance docs | 1, 2, 3, 4, 7, 9, 11, 12 |
| `HANDBOOK/06-agents.md` | roster chapter: Lite purge, §6.5 note, retired rows; `qa-compliance-spv` row | 1, 12 |
| `HANDBOOK/11-devops-tier.md` | rewritten: Chapter 11 — CI and GitHub boundary | 2 |
| `HANDBOOK/01,02,03,05,12,13,14,15,16`, `HANDBOOK.md`, `CLAUDE.md` | line edits listed per task | 1–5, 9–12 |
| `docs/D11-*.md` (4) | deleted | 2 |
| `docs/README.md`, `docs/D07,D12-*,D13-*,D14` | line edits | 2, 4 |
| `secrets/README.md`, `test-data/README.md` | D11 link repointed | 2 |
| `.claude/agents/**` (11 files) → `agent-graveyard/` | retirement moves | 3, 4, 9 |
| `agent-graveyard/README.md` | protocol for a roster retirement | 3 |
| `.claude/model-policy.yaml` | −11 assignments, +`qa-compliance-spv` | 3, 4, 9, 11 |
| `.claude/pipeline.yaml` | `spvPairs`, `nonAgentNames`, `escapes` | 3, 4, 6, 7, 9, 11 |
| `aegis.config.json` | `github` and `environments.*.secretsRef` deleted | 3 |
| `packages/@qa/contracts/src/events.ts` | T8 comments on the `devops.*` schemas | 3 |
| `.claude/agents/crosscutting/qa-metrics-collector.md` | flaky source, `awaits`, `reviewedBy` reason | 3, 7 |
| `packages/@qa/alignment/src/rules/structure.ts` | `spvRule` self-dispatch (AUD-049) | 5 |
| `__internal-tests__/alignment/rules-structure.test.ts` | AUD-049, T9, shared-pair fixtures | 5, 10, 11 |
| `.claude/agents/orchestrator/qa-orchestrator.md` | Worker → SPV table, contract `dispatches` | 5, 11 |
| `packages/@qa/run-state/src/phase-map.ts` | `ScanProfileSchema`, `SPV_NONE` | 6, 7, 11 |
| `.claude/agents/crosscutting/qa-context-scanner.md`, `qa-curator.md` | Task Protocol step 5, `reviewedBy` reason | 6, 7 |
| `__internal-tests__/helpers/pipeline.ts`, `target-profile.test.ts`, `cli-cycle-e2e.test.ts`, `run-state-phases.test.ts` | full `PROFILE`; Scan, Curator, Compliance barrier tests | 6, 7, 11 |
| `packages/@qa/alignment/src/types.ts` | `SPECIAL_PHASES` (T9) | 10 |
| `packages/@qa/path-guard/src/roles.ts` (P0b-2) | compliance `spv`, SPV row, comments | 9, 11 |
| `__internal-tests__/role-table.test.ts` (P0b-2) | `RETIRING` removed; `SPV_NONE` consistency | 9, 11 |
| `packages/@qa/run-state/src/caller.ts` | `SHARED_SPV` deleted, `pairedSpv` | 11 |
| `.claude/agents/spv/qa-compliance-spv.md` (new) | shared compliance reviewer | 11 |
| `.claude/agents/compliance/qa-compliance-*.md` (6) | step 5, `reviewedBy` | 11 |
| `__internal-tests__/run-state-core.test.ts`, `run-state-submit.test.ts`, `p0a-final-fix.test.ts` | pairing tests | 11 |
| `HANDBOOK/08-compliance.md` | names the shared reviewer (AUD-052 key) | 12 |
| `__internal-tests__/alignment/baseline.yaml` | −60 keys | 1–5, 9, 12 |
| `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md` | row statuses | 13 |

**Shared with P0b-2 — the region each slice edits** (keeps the rebase mechanical):

| File | P0b-2 edits | P2a edits |
|------|-------------|-----------|
| `CLAUDE.md` | Commands block (prepare, T12); Execution flow item 6 (T9–T11); Territory rule; Read / write policy rows (T5, T9); "Adding a new agent" step 5 (T6) | Configuration `profile` bullet (Task 1); Agent tiers table rows (Tasks 2, 4, 9, 11); Knowledge pipeline paragraph (Task 4) |
| `.claude/pipeline.yaml` | `writePolicy` (comment, `writable`, `units`); `sources.cli`; new `hookEmits` block after `externalScripts` | `spvPairs` (Tasks 3, 11); the `qa-automated` line of `nonAgentNames` (Task 3); `escapes` entries (Tasks 3, 4, 6, 7, 9, 11) |
| `.claude/agents/crosscutting/qa-metrics-collector.md` | one line under `### Token Usage` | `### Flaky Tests` (Task 3); contract `awaits` (Task 3) and `reviewedBy` (Task 7) |
| `packages/@qa/run-state/src/caller.ts` | `CLI_COMMANDS`/`OWNER_*` (repair-tail); `roleOf` import; `pairedSpv` body | `SHARED_SPV` and `pairedSpv` — after the rebase only (Task 11) |
| `packages/@qa/contracts/src/events.ts` | `IntegrityTailRepairedEventSchema` after `IntegrityAcknowledgedEventSchema`; one union entry | two comment lines at the DevOps schemas (Task 3) |
| `HANDBOOK/02-getting-started.md` | :328 | :167 (Task 1), :318 (Task 2) |
| `HANDBOOK/05-commands.md` | :177 | :157 (Task 4), :184 (Task 2) |
| `HANDBOOK/12-cicd-operations.md` | :94 | :164, :173 (Task 2) |
| `HANDBOOK/13-mechanics.md` | §13.1, §13.3 | §13.8 (Task 4) |
| `HANDBOOK/14-extending.md` | §14.2 new item 9 (after line 39) | :12, :21, :60 (Task 2); §14.11 "Other graph checks" (Task 5); :149 (Task 10); §14.3 step 3 and the `spvPairs` row (Task 12) |
| `HANDBOOK/16-glossary.md` | :127 (Sandbox) | :130 (SPV, Task 1) — two unchanged lines apart |
| `__internal-tests__/alignment/baseline.yaml` | −7 keys, +4 AUD-050 keys | −60 keys. Entries are adjacent (e.g. `WRITE-POLICY:qa-ci-bootstrap:…` next to `WRITE-POLICY:qa-cicd-implementer:…`), so Task 8 resolves conflicts with a script |
| `packages/@qa/path-guard/src/roles.ts`, `__internal-tests__/role-table.test.ts` | created | Tasks 9, 11 only |
| matrix | Task 14 status cells | Task 13 only |

---

## Tasks executable now (on `feat/p2-roster`, before P0b-2 merges)

### Task 1: Roster chapter and the Lite docs (AUD-053 docs half, AUD-075, AUD-076)

Baseline: **−8** (273 entries afterwards). Deletes:
- `DOC-REF:HANDBOOK/06-agents.md:63 agents:count-mismatch` (AUD-075)
- `DOC-REF:HANDBOOK/06-agents.md:qa-cicd-planner-spv:unknown`, `…:qa-deployment-monitor:unknown`, `…:qa-env-provisioner:unknown`, `…:qa-github-planner-spv:unknown`, `…:qa-sandbox-manager:unknown`, `…:qa-secrets-auditor:unknown`, `…:qa-worktree-manager:unknown` (AUD-076)

**Files:**
- Create: `__internal-tests__/p2-roster.test.ts`
- Modify: `HANDBOOK/06-agents.md` (whole file), `CLAUDE.md:73`, `HANDBOOK.md` (rows 6 and the regenerated TOC row 6), `HANDBOOK/01-what-is-this.md:11,66,73,111,115`, `HANDBOOK/02-getting-started.md:167`, `HANDBOOK/16-glossary.md:130`
- Modify: `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Produces: `__internal-tests__/p2-roster.test.ts` with the helpers `tracked(): string[]`, `read(f: string): string` and `inDocScope(f: string): boolean`, which Tasks 2–12 extend.

- [ ] **Step 1: Write the failing test** — create `__internal-tests__/p2-roster.test.ts`:

```ts
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// P2a — roster and review coverage (docs/superpowers/specs/2026-10-02-p2-roster-design.md §7).
const ROOT = path.join(__dirname, '..');

/** Git-tracked files that exist in the working tree. */
function tracked(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' })
    .split('\0')
    .filter((f) => f !== '' && fs.existsSync(path.join(ROOT, f)));
}
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
/** The alignment checker's DOC-REF scope (packages/@qa/alignment/src/load.ts). */
const inDocScope = (f: string): boolean =>
  f.startsWith('HANDBOOK/') || ['HANDBOOK.md', 'CLAUDE.md', 'README.md'].includes(f) || /^docs\/[^/]+\.md$/.test(f);

describe('Lite profile docs (AUD-053, docs half)', () => {
  it('no doc in the DOC-REF scope describes a Lite mode or profile', () => {
    expect(tracked().filter(inDocScope).filter((f) => /\blite\b/i.test(read(f)))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest p2-roster`
Expected: FAIL, listing `CLAUDE.md`, `HANDBOOK.md`, `HANDBOOK/01-what-is-this.md`, `HANDBOOK/02-getting-started.md`, `HANDBOOK/06-agents.md` and `HANDBOOK/16-glossary.md`.

- [ ] **Step 3: Replace `HANDBOOK/06-agents.md`** with exactly this content:

```markdown
## Chapter 6 — Agent Roster

> _Every agent by tier: the orchestrator, Tier-1 phase managers, Tier-2 specialists, SPVs, compliance agents and cross-cutting agents._

---

### 6.1 How to Read This Roster

Each entry shows the agent name, its model and its primary output. Every full cycle runs the whole roster; `/qa-smoke` is the fast, cheap cycle for local iteration and PR gates.

---

### 6.2 The Orchestrator

| Agent | Tier | Model | Output |
|---|---|---|---|
| `qa-orchestrator` | Orchestrator | Opus | Run plan, phase dispatch, gate management, SPV dispatch (Tier-1), run summary |

The Orchestrator is always active.

---

### 6.3 Tier-1 — Domain Managers

| Agent | Model | Primary Output |
|---|---|---|
| `qa-dev-test-reviewer` | Opus | Developer-test review (`dev-test-review.json`), Stryker mutation scores |
| `qa-requirements-analyst` | Sonnet | Source-grounded requirements, RTM skeleton |
| `qa-test-planner` | Sonnet | Test strategy doc, risk matrix, test case plan |
| `qa-test-designer` | Sonnet | Test design coordination |
| `qa-test-executor` | Sonnet | Execution coordination, Tier-2 fan-out, SPV dispatch (Tier-2) |
| `qa-defect-manager` | Sonnet | Defect lifecycle coordination |
| `qa-environment-engineer` | Sonnet | `playwright.config.ts`, fixtures, data factories |
| `qa-curator` | Sonnet | Lesson queue management, promotion proposals |

> Compliance and reporting are **not** single Tier-1 managers: compliance is six `qa-compliance-*` agents (§6.7), and reporting is split between `qa-closure-reporter` and `qa-executive-reporter` (§6.4). There is no DevOps tier (§6.5).

---

### 6.4 Tier-2 — Specialist Workers

| Agent | Model | Primary Output |
|---|---|---|
| `qa-unit-specialist` | Sonnet | Unit test cases, Vitest scripts |
| `qa-api-specialist` | Sonnet | API test cases, HTTP client scripts |
| `qa-ui-specialist` | Sonnet | UI/E2E Playwright scripts |
| `qa-security-specialist` | Sonnet | OWASP-aligned security test cases |
| `qa-accessibility-specialist` | Sonnet | WCAG 2.2 accessibility test cases |
| `qa-performance-specialist` | Sonnet | k6 performance scripts |
| `qa-email-specialist` | Sonnet | Email flow test cases (Mailpit) |
| `qa-exploratory-specialist` | Sonnet | Exploratory charters (Playwright MCP, runs first) |
| `qa-database-specialist` | Sonnet | Database / data-integrity test cases |
| `qa-responsive-specialist` | Sonnet | Responsive / viewport test cases |
| `qa-feature-flag-specialist` | Sonnet | Feature-flag matrix test cases |
| `qa-realtime-specialist` | Sonnet | Realtime / websocket test cases |
| `qa-defect-reporter` | Sonnet | Structured defect reports |
| `qa-rtm-builder` | Haiku | RTM JSON/CSV updates |
| `qa-closure-reporter` | Sonnet | `closure.md` + `closure.json` |
| `qa-executive-reporter` | Opus | Three executive PDFs |

---

### 6.5 CI and GitHub

There is no DevOps tier. No agent writes to the target's GitHub repository or CI: Chapter 11 states the boundary, and Chapter 12 describes the owner-run `/qa-ci-bootstrap`.

---

### 6.6 SPVs — Supervisors

SPVs score worker output on a 0–100 scale. Output below threshold triggers revision requests. SPVs are Tier-A model by default (quality matters more than cost here).

SPV names follow the pattern `qa-{worker-name}-spv` — each SPV mirrors the worker it reviews.

| SPV | Reviews | Threshold |
|---|---|---|
| `qa-dev-test-reviewer-spv` | Developer-test review | 85 |
| `qa-requirements-analyst-spv` | Source-grounded requirements | 80 |
| `qa-test-planner-spv` | Strategy docs, risk matrices, test case plans | 80 |
| `qa-test-designer-spv` | Test case design | 85 |
| `qa-unit-specialist-spv` | Unit test cases | 85 |
| `qa-api-specialist-spv` | API test cases | 85 |
| `qa-ui-specialist-spv` | UI/E2E test cases | 85 |
| `qa-security-specialist-spv` | Security test cases | 88 |
| `qa-accessibility-specialist-spv` | Accessibility test cases | 88 |
| `qa-performance-specialist-spv` | Performance test cases | 82 |
| `qa-email-specialist-spv` | Email test cases | 80 |
| `qa-exploratory-specialist-spv` | Exploratory charters | 78 |
| `qa-database-specialist-spv` | Database test cases | 85 |
| `qa-responsive-specialist-spv` | Responsive test cases | 82 |
| `qa-feature-flag-specialist-spv` | Feature-flag test cases | 82 |
| `qa-realtime-specialist-spv` | Realtime test cases | 82 |
| `qa-defect-manager-spv` | Defect reports | 90 |
| `qa-rtm-builder-spv` | RTM completeness | 88 |
| `qa-environment-engineer-spv` | Config, fixtures, factories | 82 |
| `qa-closure-reporter-spv` | Closure artefact | 85 |
| `qa-executive-reporter-spv` | Executive PDFs | 85 |
| `qa-test-executor-spv` | Test result fidelity | 88 |

SPVs are read-only (`tools: [Read, Bash]`): they submit their verdict with `aegis review submit` and never edit worker artefacts or lessons. The **CLI** stores the review and pipes any corrective instruction into the worker's lessons; the dispatcher (orchestrator for Tier-1, `qa-test-executor` for Tier-2) dispatches the SPV and acts on the verdict.

---

### 6.7 Compliance Agents

Six compliance agents run in parallel during every full cycle. Each produces a compliance annotation file.

| Agent | Regulation | Output |
|---|---|---|
| `qa-compliance-iso25010` | ISO 25010 (software quality) | Quality characteristic coverage report |
| `qa-compliance-iso5055` | ISO 5055 (structural quality) | Structural weakness findings |
| `qa-compliance-istqb` | ISTQB testing standards | Testing process conformance notes |
| `qa-compliance-cmmi` | CMMI Level 3 | Process maturity checklist |
| `qa-compliance-gdpr` | GDPR | Data handling test coverage |
| `qa-compliance-pdpa` | PDPA (Thailand) | Personal data processing test coverage |

---

### 6.8 Cross-Cutting Agents

Cross-cutting agents operate across the whole run. `qa-context-scanner` and `qa-metrics-collector` are Haiku-tier utilities; the Discovery and curation agents run at specific phases:

| Agent | Role |
|---|---|
| `qa-context-scanner` | Static source analysis → `target-profile.json#sourceInventory` |
| `qa-web-explorer` | Observation-driven crawl, route/auth matrix (Discovery) |
| `qa-metrics-collector` | Sole owner of `reports/metrics/*` (coverage, trend, cost) |
| `qa-curator` | Reviews accumulated lessons for promotion |

Agents read the knowledge corpus directly: each agent's `knowledge_refs` frontmatter lists the `knowledge/synthesis/*.md` topics it reads.

---

### 6.9 Worked Example — Login Feature Agent Activation

For `RUN-20260523-001` (full cycle, Login/SSO feature), the following agents were active:

1. `qa-orchestrator` — created run, dispatched phase tasks
2. `qa-context-scanner` + `qa-web-explorer` — Discovery: source inventory + route/auth matrix
3. `qa-test-planner` — produced strategy and the test case plan
4. `qa-ui-specialist` — authored `TC-AUTH-031`
5. `qa-ui-specialist-spv` — reviewed, returned with revision request (missing teardown)
6. `qa-ui-specialist` — revised and resubmitted; score 91/100
7. `qa-environment-engineer` — wrote `playwright.config.ts`, the user factory, and auth fixtures
8. `qa-test-executor` — ran `TC-AUTH-031` against testing environment (after exploratory-first pass)
9. `qa-defect-reporter` — created `DEF-001-AUTH-UI`
10. `qa-defect-manager-spv` — reviewed defect report; scored 93/100
11. `qa-compliance-gdpr` — flagged that the SSO callback stores a session cookie; required GDPR tag `[GDPR-SESSION]`
12. `qa-closure-reporter` — assembled `closure.md` + `closure.json`; `qa-executive-reporter` rendered the PDFs
13. `qa-curator` — at end-of-cycle, captured lesson from `qa-ui-specialist` ("always include teardown step")

---

### ⚠ Pitfalls

1. **Confusing SPV scores with business priority** — a low SPV score means the artefact needs improvement, not that the underlying risk is low. A badly written defect report for a Critical issue is still a Critical issue.

2. **Running every agent on every PR** — scope runs with `--feature`, and use `/qa-smoke` as the PR gate. Running all agents on all code on every PR is expensive and slow.

3. **Manually editing agent instruction files without going through `/qa-promote`** — direct edits to agent instructions bypass the lesson tracking system. The curator will not know about your changes, and they may be overwritten in the next promotion cycle.

---

### Further Reading

- `docs/D06-agent-roster.md` — full agent specification with input/output schemas
- `docs/D06-spv-rubrics.md` — scoring rubric dimensions per SPV
```

(The `qa-defect-reporter`, `qa-rtm-builder` and `qa-rtm-builder-spv` rows and the "PDPA (Thailand)" cell are AUD-076 drift owned by P5; they stay.)

- [ ] **Step 4: Edit the other Lite lines** — run from the worktree root:

```bash
node - <<'EOF'
const fs = require('fs');
function edit(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: expected 1 match, found ${n}: ${from.slice(0, 70)}`);
    s = s.replace(from, () => to);
  }
  fs.writeFileSync(file, s);
}
edit('CLAUDE.md', [
  ['- `profile` — `"full"` (66 agents) or `"lite"`\n', ''],
]);
edit('HANDBOOK.md', [
  ['| 6 | Sixty-three agents run in full mode; Lite mode drops to 14 agents, disabling SPVs, compliance, and lesson capture. |',
   '| 6 | One orchestrator dispatches phase managers, specialists, compliance and cross-cutting agents; every reviewed worker has its SPV. |'],
]);
edit('HANDBOOK/01-what-is-this.md', [
  ['If you need something more freeform, you can disable gates or restrict to Lite mode; but the default profile is designed to produce board-quality evidence.',
   'If you need something shorter, `/qa-smoke` runs a fast cycle; the full cycle and its three locked gates are designed to produce board-quality evidence.'],
  ['- **Tier-1 phase agents** — eight agents that own each STLC phase: `qa-requirements-analyst`,',
   '- **Tier-1 phase agents** — nine agents that own each STLC phase: `qa-dev-test-reviewer`, `qa-requirements-analyst`,'],
  ['\nIn **Lite mode** (set `profile: "lite"` in `aegis.config.json`), only the Orchestrator plus a reduced set of workers run. SPV review, compliance, and lesson capture are disabled. Lite mode is useful for fast local smoke runs where cost is a concern.\n', ''],
  ['3. **Running in full-profile mode against production**', '3. **Running a full cycle against production**'],
  ['5. **Skipping Lite mode for local iteration** — a full-profile run costs more tokens and takes longer. Use `profile: "lite"` and `/qa-smoke` for rapid feedback loops during development.',
   '5. **Skipping `/qa-smoke` for local iteration** — a full cycle costs more tokens and takes longer. Use `/qa-smoke` for rapid feedback loops during development.'],
]);
edit('HANDBOOK/02-getting-started.md', [
  ['This runs a short cycle (phases 0–3 only, no compliance, no SPV review in Lite mode).',
   'This runs a short cycle (no compliance phase and no human gates).'],
]);
edit('HANDBOOK/16-glossary.md', [
  [' If a score is below threshold, the worker must revise. All SPVs are disabled in Lite mode.', ' If a score is below threshold, the worker must revise.'],
]);
console.log('Task 1 docs edited');
EOF
pnpm qa-build-toc
```

Expected: `Task 1 docs edited`, then `Regenerated TOC with 17 chapters in HANDBOOK.md`. `git diff HANDBOOK.md` changes only TOC row 6 (the new HANDBOOK/06 blurb) and TL;DR row 6.

- [ ] **Step 5: Delete the 8 baseline keys**

```bash
node - <<'EOF'
const fs = require('fs');
const f = '__internal-tests__/alignment/baseline.yaml';
const keys = new Set([
  'DOC-REF:HANDBOOK/06-agents.md:63 agents:count-mismatch',
  'DOC-REF:HANDBOOK/06-agents.md:qa-cicd-planner-spv:unknown',
  'DOC-REF:HANDBOOK/06-agents.md:qa-deployment-monitor:unknown',
  'DOC-REF:HANDBOOK/06-agents.md:qa-env-provisioner:unknown',
  'DOC-REF:HANDBOOK/06-agents.md:qa-github-planner-spv:unknown',
  'DOC-REF:HANDBOOK/06-agents.md:qa-sandbox-manager:unknown',
  'DOC-REF:HANDBOOK/06-agents.md:qa-secrets-auditor:unknown',
  'DOC-REF:HANDBOOK/06-agents.md:qa-worktree-manager:unknown',
]);
const lines = fs.readFileSync(f, 'utf8').split('\n');
const out = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^  - key: "(.*)"$/.exec(lines[i]);
  if (m && keys.delete(m[1])) { while (/^    \S/.test(lines[i + 1] ?? '')) i++; continue; }
  out.push(lines[i]);
}
if (keys.size > 0) { console.error('not in baseline: ' + [...keys].join(', ')); process.exit(1); }
fs.writeFileSync(f, out.join('\n'));
console.log('deleted');
EOF
grep -c '^  - key:' __internal-tests__/alignment/baseline.yaml
```

Expected: `deleted`, then `273`.

- [ ] **Step 6: Run the tests and the checker**

Run: `pnpm -F @aegis/internal-tests exec jest p2-roster`
Expected: PASS.

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm aegis align && pnpm test`
Expected: `ratchet: ok`; all suites pass. A new `DOC-REF … unknown` key means the new text names a non-agent: reword it.

Run: `pnpm exec tsx scripts/check-baseline-growth.ts --base main`
Expected: `no new baseline keys` and `every removed key is justified by a prose change`.

- [ ] **Step 7: Commit**

```bash
git add __internal-tests__/p2-roster.test.ts HANDBOOK/06-agents.md CLAUDE.md HANDBOOK.md HANDBOOK/01-what-is-this.md \
  HANDBOOK/02-getting-started.md HANDBOOK/16-glossary.md __internal-tests__/alignment/baseline.yaml
git commit -F - <<'EOF'
docs(p2a): roster chapter without Lite or phantom DevOps agents (AUD-053 docs, AUD-075, AUD-076)

HANDBOOK/06 loses every Lite column and section, the phantom DevOps
rows (§6.5 becomes a CI and GitHub note) and the retired agents' rows;
the Lite wording leaves CLAUDE.md, HANDBOOK.md, 01, 02 and 16. Baseline -8.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: DevOps docs — the CI and GitHub boundary (AUD-046 docs, decision 1)

Baseline: **−6** (267 entries afterwards). Deletes:
- `DOC-REF:CLAUDE.md:tier2-5-devops=6:count-mismatch` (AUD-075)
- `DOC-REF:HANDBOOK/03-architecture.md:qa-deployment-monitor:unknown`, `…:qa-env-provisioner:unknown`, `…:qa-sandbox-manager:unknown`, `…:qa-secrets-auditor:unknown`, `…:qa-worktree-manager:unknown` (AUD-076)

**Files:**
- Modify: `HANDBOOK/11-devops-tier.md` (whole file; the file name stays so cross-references hold)
- Delete: `docs/D11-devops-tier-overview.md`, `docs/D11-github-workflow.md`, `docs/D11-worktree-isolation.md`, `docs/D11-secrets-handling.md`
- Modify: `CLAUDE.md` (tier table: DevOps row, SPV row text), `HANDBOOK.md` (TL;DR row 11, regenerated TOC row 11), `HANDBOOK/01-what-is-this.md:68`, `HANDBOOK/02-getting-started.md:318`, `HANDBOOK/03-architecture.md` (diagram, :79, §3.6), `HANDBOOK/05-commands.md:184`, `HANDBOOK/12-cicd-operations.md:164,173`, `HANDBOOK/14-extending.md:12,21,60`, `HANDBOOK/15-faq-and-troubleshooting.md:85`, `docs/README.md` (D11 section), `docs/D07-brand-exposure-rules.md:25`, `docs/D13-spv-review-pattern.md:5`, `docs/D14-extending-the-system.md:42`, `docs/D12-cicd-stage-map.md:122`, `docs/D12-env-safety-and-prod.md:5,101,110`, `docs/D12-environments-overview.md:183`, `docs/D12-cicd-workflow.md:3,79,87,93,102,114-116,166-171,182-185`, `secrets/README.md:54`, `test-data/README.md:46`
- Modify: `__internal-tests__/p2-roster.test.ts`, `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: `tracked`, `read`, `inDocScope` (Task 1).
- Produces: `names(text: string, name: string): boolean` and `DEVOPS: string[]` in `p2-roster.test.ts` (Task 3 uses both).

- [ ] **Step 1: Write the failing test** — append to `__internal-tests__/p2-roster.test.ts`:

```ts
/** `name` as a whole agent name, not part of a longer one (qa-ui-designer vs qa-ui-designer-spv). */
const names = (text: string, name: string): boolean => new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(text);

const DEVOPS = ['qa-github-planner', 'qa-github-implementer', 'qa-cicd-planner', 'qa-cicd-implementer', 'qa-cicd-evaluator', 'qa-cicd-spv', 'qa-github-spv'];

describe('DevOps docs (AUD-046)', () => {
  it('no doc in the DOC-REF scope names a DevOps agent', () => {
    const hits = tracked().filter(inDocScope).flatMap((f) => DEVOPS.filter((n) => names(read(f), n)).map((n) => `${f}: ${n}`));
    expect(hits).toEqual([]);
  });

  it('the D11 DevOps docs are gone and no Markdown file links them', () => {
    const files = tracked();
    expect(files.filter((f) => f.startsWith('docs/D11-'))).toEqual([]);
    const linking = files.filter(
      (f) => f.endsWith('.md') && !/^(docs\/superpowers|knowledge|plan-validation|agent-graveyard)\//.test(f) && /D11-[a-z-]+\.md/.test(read(f)),
    );
    expect(linking).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest p2-roster`
Expected: FAIL — the first test lists CLAUDE.md, HANDBOOK/03, 05, 11, 12, 14, 15 and the `docs/D11-*`/`D12-cicd-workflow.md` names; the second lists the four D11 files and the linking files.

- [ ] **Step 3: Replace `HANDBOOK/11-devops-tier.md`** with exactly this content:

```markdown
# Chapter 11 — CI and GitHub boundary

> _No agent writes to the target's GitHub repository or CI; CI setup is the owner's action, and flaky-test data comes from the run itself._

## 11.1 The rule

No agent writes to the target's GitHub repository or CI. No agent creates a branch, a commit, a pull request, an issue or a PR comment, edits a workflow file, or sets a repository secret. What reaches the target repository is decided by the owner and the developers, outside the run.

There is no DevOps tier. The seven agent definitions that once planned branches, opened pull requests and watched CI runs are kept for audit history in `agent-graveyard/`; nothing dispatches them.

## 11.2 What happens instead

| Need | Where it comes from |
|---|---|
| CI workflows for the target | The owner runs `/qa-ci-bootstrap` (Chapter 12). It writes only the QA-owned `qa-*.yml` workflow files, a named exception in the CLAUDE.md read/write table, and prints the Husky hook and the secrets guide for the developers to add. |
| Flaky-test data | The run's own retry and attempt data in `runs/<RUN-ID>/cases/*-result.json`, read by the metrics collector. |
| Committing the QA test suite | The developers commit `tests/qa/` through their own branch and review flow. |
| Repository secrets | The developers set them from the guide `/qa-ci-bootstrap` prints; local secrets are described in `secrets/README.md`. |

The rule binds the agents. A skill the owner invokes explicitly, such as `/qa-ci-bootstrap`, is the owner's own action.

## 11.3 ⚠ Pitfalls

- **Don't ask an agent to open a pull request or push a branch.** No agent has that role.
- **Don't put secrets in YAML workflows.** Use `${{ secrets.NAME }}` references, never an inline value.

## 11.4 → Deep dives

- [docs/D12-cicd-workflow.md](../docs/D12-cicd-workflow.md) — GitHub Actions workflow templates + safety
- [HANDBOOK/12-cicd-operations.md](12-cicd-operations.md) — stages, triggers, gates and commands
```

- [ ] **Step 4: Delete the D11 docs and edit the rest** — run from the worktree root:

```bash
git rm -q docs/D11-devops-tier-overview.md docs/D11-github-workflow.md docs/D11-worktree-isolation.md docs/D11-secrets-handling.md
node - <<'EOF'
const fs = require('fs');
function edit(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: expected 1 match, found ${n}: ${from.slice(0, 70)}`);
    s = s.replace(from, () => to);
  }
  fs.writeFileSync(file, s);
}
edit('CLAUDE.md', [
  ['| 2.5 — DevOps | 6 | Sonnet/Opus | GitHub, CI/CD planning & implementation |\n', ''],
  ['| 3 — SPVs | 24 | Opus | Mirror of Tier 1/2; validate work reports (the 2 DevOps SPVs, `qa-cicd-spv` and `qa-github-spv`, sit in tier 2.5: 26 SPV files in all) |',
   '| 3 — SPVs | 24 | Opus | Mirror of Tier 1/2; validate work reports |'],
]);
edit('HANDBOOK.md', [
  ['| 11 | The DevOps tier generates CI/CD workflow files and PR descriptions but never merges to `main` — that is always a human action. |',
   '| 11 | No agent writes to the target\'s GitHub repository or CI; the owner runs `/qa-ci-bootstrap` for the QA workflows, and merging is always a human action. |'],
]);
edit('HANDBOOK/01-what-is-this.md', [
  ['- **Tier-2.5 DevOps** — seven agents that own CI/CD, branch strategy, environment provisioning, and secrets\n', ''],
]);
edit('HANDBOOK/02-getting-started.md', [
  ['This track wires the framework into GitHub Actions. The DevOps agents can do this automatically via `/qa-ci-bootstrap`; these manual steps are the reference.',
   'This track wires the framework into GitHub Actions. `/qa-ci-bootstrap` does this for you; these manual steps are the reference.'],
]);
edit('HANDBOOK/03-architecture.md', [
  ['Tier-2 Workers\n  |\nTier-2.5 DevOps\n```', 'Tier-2 Workers\n```'],
  ['> Compliance, DevOps, and reporting are not single Tier-1 managers. Compliance is six separate `qa-compliance-*` agents (see §6.7); DevOps is the `qa-cicd-*` / `qa-github-*` agents (§3.6); reporting is split between `qa-closure-reporter` and `qa-executive-reporter`.',
   '> Compliance and reporting are not single Tier-1 managers. Compliance is six separate `qa-compliance-*` agents (see §6.7); reporting is split between `qa-closure-reporter` and `qa-executive-reporter`. There is no DevOps tier (§3.6).'],
  [`### 3.6 Tier-2.5: DevOps Agents

DevOps agents handle infrastructure and CI/CD concerns (GitHub planning, CI/CD planning and implementation, plus environment/secrets/sandbox utilities):

| Agent | Responsibility |
|---|---|
| \`qa-github-planner\` | Branch strategy, PR descriptions, merge gates |
| \`qa-cicd-planner\` | Workflow file planning and evaluation |
| \`qa-cicd-implementer\` | Workflow file generation |
| \`qa-env-provisioner\` | Ephemeral environment creation and teardown |
| \`qa-worktree-manager\` | Git worktree isolation for parallel runs |
| \`qa-secrets-auditor\` | Secrets leak detection in artefacts |
| \`qa-sandbox-manager\` | Sandbox environment lifecycle |
| \`qa-deployment-monitor\` | Deployment health polling |
`,
   `### 3.6 CI and GitHub

There is no DevOps tier. No agent writes to the target's GitHub repository or CI: Chapter 11 states the boundary, and Chapter 12 describes the owner-run \`/qa-ci-bootstrap\`.
`],
]);
edit('HANDBOOK/05-commands.md', [
  ['CI planning, implementation and evaluation are agents, not commands: `qa-cicd-planner`, `qa-cicd-implementer` and `qa-cicd-evaluator` (Chapter 11). For recent CI runs use `gh run list`.',
   'No agent plans, writes or watches the target\'s CI (Chapter 11). For recent CI runs use `gh run list`.'],
]);
edit('HANDBOOK/12-cicd-operations.md', [
  ['- **Don\'t put secrets in YAML workflows** — always `${{ secrets.NAME }}`; `qa-cicd-spv` will reject inline values.',
   '- **Don\'t put secrets in YAML workflows** — always `${{ secrets.NAME }}`, never an inline value.'],
  ['- [docs/D11-secrets-handling.md](../docs/D11-secrets-handling.md)', '- [secrets/README.md](../secrets/README.md)'],
]);
edit('HANDBOOK/14-extending.md', [
  ['4. Open a PR via the standard flow; `qa-github-spv` will verify the registry update', '4. Open a PR via the standard flow; the reviewer checks the registry update'],
  ['1. Choose a tier: Tier-1 (STLC phase), Tier-2 (specialist), Tier-2.5 (DevOps), Tier-3 (cross-cutting)', '1. Choose a tier: Tier-1 (STLC phase), Tier-2 (specialist), compliance, or cross-cutting'],
  ['5. If the specialist uses worktree isolation (rare for non-DevOps specialists), add the `isolation: "worktree"` annotation', '5. If the specialist uses worktree isolation (rare), add the `isolation: "worktree"` annotation'],
]);
edit('HANDBOOK/15-faq-and-troubleshooting.md', [
  ['        qa-cicd-spv will flag it as a relaxation from industry default (informational)', '        and record the reason under the thresholds.yaml overrides[] entry'],
]);
edit('docs/README.md', [
  [`### D11 — DevOps Tier ([HANDBOOK/11](../HANDBOOK/11-devops-tier.md))
| File | Topic |
|------|-------|
| [D11-devops-tier-overview.md](D11-devops-tier-overview.md) | Purpose, sub-roles, activation gates |
| [D11-github-workflow.md](D11-github-workflow.md) | Branch strategy, PR conventions, gh CLI usage |
| [D11-worktree-isolation.md](D11-worktree-isolation.md) | When/why worktree isolation is used |
| [D11-secrets-handling.md](D11-secrets-handling.md) | Secret resolution, naming, scanning |

`, ''],
]);
edit('docs/D07-brand-exposure-rules.md', [
  ['- PR descriptions and commit messages from DevOps agents\n', ''],
]);
edit('docs/D13-spv-review-pattern.md', [
  ['Every Tier-1, Tier-2, and Tier-2.5 worker agent has a paired Supervisor (SPV) reviewer.', 'Every Tier-1 and Tier-2 worker agent has a paired Supervisor (SPV) reviewer.'],
]);
edit('docs/D14-extending-the-system.md', [
  ['Tiers: `orchestrator/`, `tier1/`, `tier2/`, `tier2.5-devops/`, `spv/`, `compliance/`, `cross-cutting/`', 'Tiers: `orchestrator/`, `tier1-phase/`, `tier2-specialist/`, `spv/`, `compliance/`, `crosscutting/`'],
]);
edit('docs/D12-cicd-stage-map.md', [
  ['- [D11-secrets-handling.md](D11-secrets-handling.md)', '- [secrets/README.md](../secrets/README.md)'],
]);
edit('docs/D12-env-safety-and-prod.md', [
  ['See [D11-secrets-handling.md](D11-secrets-handling.md) for secrets management.', 'See [secrets/README.md](../secrets/README.md) for secrets management.'],
  ['Secrets for each environment are prefixed by environment (see [D11-secrets-handling.md](D11-secrets-handling.md)).', 'Secrets for each environment are prefixed by environment (see [secrets/README.md](../secrets/README.md)).'],
  ['- [D11-secrets-handling.md](D11-secrets-handling.md)\n', '- [secrets/README.md](../secrets/README.md)\n'],
]);
edit('docs/D12-environments-overview.md', [
  ['check `aegis.config.json#environments.staging.secretsRef`', 'check the repository secrets with the `STAGING_` prefix'],
]);
edit('docs/D12-cicd-workflow.md', [
  ['Spec for the 6 workflow files, their structure, and the safety rules enforced by `qa-cicd-spv`.', 'Spec for the 6 workflow files, their structure, and the safety rules every workflow must pass.'],
  ['where `ENV_PREFIX` is configured in `aegis.config.json.environments.{env}.secretsRef.prefix`.', 'where `ENV_PREFIX` is the environment prefix (`TESTING_`, `STAGING_`, `PROD_`).'],
  ['`qa-cicd-spv` rejects any workflow where a secret reference is dynamically constructed.', 'A workflow where a secret reference is dynamically constructed is rejected.'],
  ['`qa-cicd-implementer` reads `target-profile.json` (written by `qa-context-scanner`) to determine the Node version. It writes the version to `.nvmrc`', 'The Node version comes from `target-profile.json` (written by `qa-context-scanner`). It is written to `.nvmrc`'],
  ['- Flake pattern detection by `qa-cicd-evaluator`', '- Flake pattern detection from retry history'],
  ['## `qa-cicd-spv` validation rules\n\nBefore any workflow file is committed, `qa-cicd-spv` verifies:', '## Workflow validation rules\n\nBefore any workflow file is committed, it must pass:'],
  [`1. \`qa-context-scanner\` writes \`target-profile.json\` (stack, Node version, env vars)
2. \`qa-cicd-planner\` produces a workflow plan from \`target-profile.json\` + test plan
3. \`qa-cicd-implementer\` writes all 6 workflow files using the plan
4. \`qa-cicd-implementer\` runs \`gh secret set\` for each secret in \`secretsRef\`
5. \`qa-cicd-spv\` validates all files
6. Husky pre-commit hook is installed (\`pnpm husky install\`)`,
   `1. \`qa-context-scanner\` writes \`target-profile.json\` (stack, Node version, env vars)
2. \`/qa-ci-bootstrap\` writes the QA workflow files (\`qa-*.yml\`) and checks them with actionlint and yamllint
3. It prints the repository secrets to set and the Husky pre-commit hook for the developers to add`],
  [`- [D11-devops-tier-overview.md](D11-devops-tier-overview.md)
- [D11-worktree-isolation.md](D11-worktree-isolation.md)
- [D12-cicd-stage-map.md](D12-cicd-stage-map.md)
- [D11-secrets-handling.md](D11-secrets-handling.md)`,
   `- [D12-cicd-stage-map.md](D12-cicd-stage-map.md)
- [secrets/README.md](../secrets/README.md)`],
]);
edit('secrets/README.md', [
  ['## What lives here (full list — see docs/D11-secrets-handling.md)', '## What lives here (full list)'],
]);
edit('test-data/README.md', [
  ['- `docs/D11-secrets-handling.md`', '- `secrets/README.md`'],
]);
console.log('Task 2 docs edited');
EOF
pnpm qa-build-toc
```

Expected: `Task 2 docs edited`, then `Regenerated TOC with 17 chapters in HANDBOOK.md` (row 11 now reads "CI and GitHub boundary"). `docs/D12-cicd-workflow.md`'s `qa-results-${{ github.run_id }}` line stays, so `pipeline.yaml#nonAgentNames` keeps `qa-results`. The rest of `secrets/README.md` (its `@qa/secrets` and `secretsRef` paragraph) is P2c's.

- [ ] **Step 5: Delete the 6 baseline keys**

```bash
node - <<'EOF'
const fs = require('fs');
const f = '__internal-tests__/alignment/baseline.yaml';
const keys = new Set([
  'DOC-REF:CLAUDE.md:tier2-5-devops=6:count-mismatch',
  'DOC-REF:HANDBOOK/03-architecture.md:qa-deployment-monitor:unknown',
  'DOC-REF:HANDBOOK/03-architecture.md:qa-env-provisioner:unknown',
  'DOC-REF:HANDBOOK/03-architecture.md:qa-sandbox-manager:unknown',
  'DOC-REF:HANDBOOK/03-architecture.md:qa-secrets-auditor:unknown',
  'DOC-REF:HANDBOOK/03-architecture.md:qa-worktree-manager:unknown',
]);
const lines = fs.readFileSync(f, 'utf8').split('\n');
const out = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^  - key: "(.*)"$/.exec(lines[i]);
  if (m && keys.delete(m[1])) { while (/^    \S/.test(lines[i + 1] ?? '')) i++; continue; }
  out.push(lines[i]);
}
if (keys.size > 0) { console.error('not in baseline: ' + [...keys].join(', ')); process.exit(1); }
fs.writeFileSync(f, out.join('\n'));
console.log('deleted');
EOF
grep -c '^  - key:' __internal-tests__/alignment/baseline.yaml
```

Expected: `deleted`, then `267`.

- [ ] **Step 6: Run the tests and the checker**

Run: `pnpm -F @aegis/internal-tests exec jest p2-roster`
Expected: PASS.

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm aegis align && pnpm test && pnpm exec tsx scripts/check-baseline-growth.ts --base main`
Expected: `ratchet: ok`; all suites pass; no new baseline keys; every removed key justified.

- [ ] **Step 7: Commit**

```bash
# The four D11 deletions are already staged by git rm (Step 4); staging a deleted path again fails.
git add HANDBOOK/11-devops-tier.md CLAUDE.md HANDBOOK.md HANDBOOK/01-what-is-this.md HANDBOOK/02-getting-started.md \
  HANDBOOK/03-architecture.md HANDBOOK/05-commands.md HANDBOOK/12-cicd-operations.md HANDBOOK/14-extending.md \
  HANDBOOK/15-faq-and-troubleshooting.md docs/README.md docs/D07-brand-exposure-rules.md docs/D13-spv-review-pattern.md \
  docs/D14-extending-the-system.md docs/D12-cicd-stage-map.md docs/D12-env-safety-and-prod.md docs/D12-environments-overview.md \
  docs/D12-cicd-workflow.md secrets/README.md test-data/README.md __internal-tests__/p2-roster.test.ts \
  __internal-tests__/alignment/baseline.yaml
git commit -F - <<'EOF'
docs(p2a): Chapter 11 states the CI and GitHub boundary; D11 docs deleted (AUD-046)

No agent writes to the target's GitHub or CI; /qa-ci-bootstrap is the
owner's action (writes only qa-*.yml, prints Husky and secrets). The
DevOps tier leaves HANDBOOK 01-15, CLAUDE.md and docs/; D11 links go to
secrets/README.md. Baseline -6.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Retire the 7 DevOps agents (AUD-046, AUD-011, AUD-074)

Baseline: **−29** (238 entries afterwards). Deletes all 26 `[AUD-046]` / `[AUD-112, AUD-046]` keys, the 2 AUD-074 keys and the 1 AUD-011 key (list in Step 6).

**Files:**
- Move: `.claude/agents/tier2-5-devops/{qa-github-planner,qa-github-implementer,qa-cicd-planner,qa-cicd-implementer,qa-cicd-evaluator,qa-cicd-spv,qa-github-spv}.md` → `agent-graveyard/`
- Modify: `agent-graveyard/README.md`, `.claude/model-policy.yaml`, `.claude/pipeline.yaml` (`spvPairs`, `nonAgentNames`, 3 escapes), `.claude/agents/crosscutting/qa-metrics-collector.md` (Flaky Tests, `awaits`), `aegis.config.json`, `packages/@qa/contracts/src/events.ts` (two comments)
- Modify: `__internal-tests__/p2-roster.test.ts`, `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: `tracked`, `read`, `inDocScope`, `names`, `DEVOPS` (Tasks 1–2).
- Produces: in `p2-roster.test.ts`, `RETIRED: Array<{ name: string; aud: string }>` (Tasks 4 and 9 append to it) and `agentNames(): string[]`.
- `pipeline.yaml#spvPairs` is `{}` until Task 11. `caller.ts#SHARED_SPV` keeps its DevOps entries until Task 11 (they pair no existing agent).

- [ ] **Step 1: Write the failing tests** — in `__internal-tests__/p2-roster.test.ts`, replace the import block (the first three lines) with:

```ts
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { AegisEventSchema } from '@qa/contracts';
```

and append:

```ts
// Retired by owner decision 2026-10-02 (spec §4.1); each retirement task appends its agents.
const RETIRED: Array<{ name: string; aud: string }> = [
  ...DEVOPS.map((name) => ({ name, aud: 'AUD-046' })),
];

/** Frontmatter names of every agent file under .claude/agents/. */
function agentNames(): string[] {
  const dir = path.join(ROOT, '.claude', 'agents');
  return fs.readdirSync(dir).flatMap((tier) =>
    fs
      .readdirSync(path.join(dir, tier))
      .filter((f) => f.endsWith('.md') && f !== 'README.md')
      .map((f) => /^name:\s*(\S+)/m.exec(fs.readFileSync(path.join(dir, tier, f), 'utf-8'))?.[1] ?? f),
  );
}

describe('retired agents (spec §4.1)', () => {
  it.each(RETIRED)('$name lives only in agent-graveyard/, with retiredAt and reason', ({ name, aud }) => {
    expect(agentNames()).not.toContain(name);
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(read(`agent-graveyard/${name}.md`))![1]!;
    expect(fm).toMatch(new RegExp(`^name: ${name}$`, 'm'));
    expect(fm).toMatch(/^retiredAt: 2026-10-02$/m);
    expect(fm).toMatch(new RegExp(`^reason: "${aud}, owner decision 2026-10-02: .+"$`, 'm'));
  });

  it('no doc in the DOC-REF scope and no .claude/** file names a retired agent', () => {
    const hits = tracked()
      .filter((f) => inDocScope(f) || f.startsWith('.claude/'))
      .flatMap((f) => RETIRED.filter(({ name }) => names(read(f), name)).map(({ name }) => `${f}: ${name}`));
    expect(hits).toEqual([]);
  });

  it('model-policy.yaml assigns exactly the agent files', () => {
    const policy = parse(read('.claude/model-policy.yaml')) as { assignments: Record<string, string[]> };
    expect(Object.values(policy.assignments).flat().sort()).toEqual(agentNames().sort());
  });

  it('aegis.config.json has no github block and no environment secretsRef (spec §4.2.2)', () => {
    const config = JSON.parse(read('aegis.config.json')) as { github?: unknown; environments: Record<string, Record<string, unknown>> };
    expect(config.github).toBeUndefined();
    expect(Object.entries(config.environments).filter(([, e]) => 'secretsRef' in e).map(([env]) => env)).toEqual([]);
  });

  it('historical devops.* events still parse (T8)', () => {
    expect(AegisEventSchema.safeParse({ type: 'devops.flake-detected', ts: '2026-06-28T08:00:00.000Z', testRef: 'TC-AUTH-031', flakeRate: 0.2 }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest p2-roster`
Expected: FAIL — the 7 `lives only in agent-graveyard/` cases (the files are still under `.claude/agents/`), the `.claude/**` names test (model-policy, pipeline), and the `aegis.config.json` test. The T8 test already passes: it guards the schemas, which this task must not delete.

- [ ] **Step 3: Move the agents**

```bash
for n in qa-github-planner qa-github-implementer qa-cicd-planner qa-cicd-implementer qa-cicd-evaluator qa-cicd-spv qa-github-spv; do
  git mv ".claude/agents/tier2-5-devops/$n.md" "agent-graveyard/$n.md"
done
rmdir .claude/agents/tier2-5-devops 2>/dev/null || true
ls .claude/agents
```

Expected: `compliance crosscutting orchestrator spv tier1-phase tier2-specialist` (no `tier2-5-devops`). `agent-memory/qa-cicd-*` and `agent-memory/qa-github-*` stay in place.

- [ ] **Step 4: Frontmatter, policy, pipeline, metrics collector, config, events, graveyard README** — run from the worktree root:

```bash
node - <<'EOF'
const fs = require('fs');
function edit(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: expected 1 match, found ${n}: ${from.slice(0, 70)}`);
    s = s.replace(from, () => to);
  }
  fs.writeFileSync(file, s);
}
const DEVOPS = ['qa-github-planner', 'qa-github-implementer', 'qa-cicd-planner', 'qa-cicd-implementer', 'qa-cicd-evaluator', 'qa-cicd-spv', 'qa-github-spv'];
const REASON = "AUD-046, owner decision 2026-10-02: Aegis never writes to the target's GitHub or CI; never dispatched";
// Graveyard frontmatter: retiredAt and reason before the closing ---; the body stays unchanged.
for (const name of DEVOPS) {
  const file = `agent-graveyard/${name}.md`;
  const s = fs.readFileSync(file, 'utf8');
  const end = s.indexOf('\n---\n', 4);
  if (!s.startsWith('---\n') || end < 0) throw new Error(`${file}: no frontmatter`);
  fs.writeFileSync(file, `${s.slice(0, end)}\nretiredAt: 2026-10-02\nreason: "${REASON}"${s.slice(end)}`);
}
edit('.claude/model-policy.yaml', [
  ['    # DevOps planner roles\n    - qa-github-planner\n    - qa-cicd-planner\n', ''],
  ['    # DevOps implementer roles\n    - qa-github-implementer\n    - qa-cicd-implementer\n', ''],
  ['    # DevOps SPVs\n    - qa-github-spv\n    - qa-cicd-spv\n', ''],
  ['    # DevOps read-only\n    - qa-cicd-evaluator\n', ''],
]);
edit('.claude/pipeline.yaml', [
  ['spvPairs:\n  qa-cicd-planner: qa-cicd-spv\n  qa-cicd-implementer: qa-cicd-spv\n  qa-cicd-evaluator: qa-cicd-spv\n  qa-github-planner: qa-github-spv\n  qa-github-implementer: qa-github-spv\n', 'spvPairs: {}\n'],
  ['  - qa-automated # GitHub label (qa-github-planner.md:40)\n', ''],
  ['  - {unit: qa-cicd-evaluator, field: reviewedBy.none, reason: "SPV not required — evaluator is read-only; curator monitors for recurring patterns"}\n', ''],
  ['  - {unit: qa-cicd-spv, field: reviewedBy.none, reason: "not stated in prose"}\n', ''],
  ['  - {unit: qa-github-spv, field: reviewedBy.none, reason: "not stated in prose"}\n', ''],
]);
// AUD-011 line: flaky data now comes from the run's own retries (aegis rollup takes over flaky.json in P0c).
edit('.claude/agents/crosscutting/qa-metrics-collector.md', [
  ['### Flaky Tests (from `devops.flake-detected` events)\n- Per test: `{ testRef, flakeRate, retryCount }`\n',
   '### Flaky Tests (from retry and attempt data)\n- Per test: `{ testRef, flakeRate, retryCount }`, from the retry and attempt data in `runs/{runId}/cases/*-result.json` (a test that failed and then passed on a retry counts as a flake)\n'],
  ['  - run.phase.started\n  - devops.flake-detected\n', '  - run.phase.started\n'],
]);
// Spec §4.2.2: github (read only by the GitHub agents) and secretsRef (read only by qa-cicd-implementer).
edit('aegis.config.json', [
  ['  "github": { "defaultReviewers": [], "labels": ["qa-automated", "ready-for-review"] },\n', ''],
  ['      "secretsRef": { "type": "github-actions-secrets", "prefix": "TESTING_" },\n', ''],
  ['      "secretsRef": { "type": "github-actions-secrets", "prefix": "STAGING_" },\n', ''],
  ['      "secretsRef": { "type": "github-actions-secrets", "prefix": "PROD_" },\n', ''],
]);
// T8: the devops.* schemas stay declared.
edit('packages/@qa/contracts/src/events.ts', [
  ['// ─── DevOps tier ──────────────────────────────────────────────────────────────\n',
   '// ─── DevOps tier ──────────────────────────────────────────────────────────────\n// Emitters retired in P2 (agent-graveyard/); kept so historical logs parse.\n'],
  ['export const DevopsGithubPlanCompletedEventSchema', '// Emitters retired in P2 (agent-graveyard/); kept so historical logs parse.\nexport const DevopsGithubPlanCompletedEventSchema'],
]);
edit('agent-graveyard/README.md', [
  ['1. Move `.claude/agents/temp/{name}.md` → `agent-graveyard/{name}.md`', '1. Move `.claude/agents/<tier>/<name>.md` → `agent-graveyard/<name>.md` (`git mv`)'],
  ['3. Emit `agent.retired` event with the agent name + reason', '3. Record the retirement in the remediation matrix and in the commit message (a framework change happens outside any run, so no event records it)'],
  ['Permanent roster agents (the 63 in full mode) are not retired during normal operation.', 'Permanent roster agents are retired only by an owner decision recorded in the remediation matrix (2026-10-02: 11 agents, P2).'],
]);
console.log('Task 3 edits applied');
EOF
git grep -n 'qa-automated' -- ':!docs/superpowers' ':!agent-graveyard' || echo 'no qa-automated left'
```

Expected: `Task 3 edits applied`, then `no qa-automated left` (spec §4.2.1: `qa-automated` leaves `nonAgentNames` once no tracked doc names it).

- [ ] **Step 5: Run the tests**

Run: `pnpm -F @aegis/internal-tests exec jest p2-roster agent-frontmatter run-state-core run-state-submit alignment`
Expected: PASS except `alignment.test.ts` "matches the ratchet baseline", which lists the 29 now-stale keys of Step 6. `run-state-core` and `run-state-submit` still pass: `SHARED_SPV` is untouched until Task 11.

- [ ] **Step 6: Delete the 29 baseline keys**

```bash
node - <<'EOF'
const fs = require('fs');
const f = '__internal-tests__/alignment/baseline.yaml';
const keys = new Set([
  'CONSUMER:qa-cicd-evaluator:{run}/devops/ci-summary.json:unread',
  'CONSUMER:qa-cicd-implementer:{run}/devops/cicd-results.json:unread',
  'CONSUMER:qa-cicd-implementer:{target}/.husky/**:unread',
  'DISPATCH:qa-cicd-evaluator:-:undispatched',
  'DISPATCH:qa-cicd-evaluator:qa-orchestrator:not-reciprocal',
  'DISPATCH:qa-cicd-implementer:-:undispatched',
  'DISPATCH:qa-cicd-planner:-:undispatched',
  'DISPATCH:qa-cicd-planner:qa-orchestrator:not-reciprocal',
  'DISPATCH:qa-cicd-spv:-:undispatched',
  'DISPATCH:qa-github-implementer:-:undispatched',
  'DISPATCH:qa-github-implementer:qa-orchestrator:not-reciprocal',
  'DISPATCH:qa-github-planner:-:undispatched',
  'DISPATCH:qa-github-planner:qa-orchestrator:not-reciprocal',
  'DISPATCH:qa-github-spv:-:undispatched',
  'EVENT:qa-metrics-collector:devops.flake-detected:unreachable-emitter',
  'PRODUCER:qa-cicd-evaluator:{run}/devops/github-results.json:unreachable-producer',
  'PRODUCER:qa-cicd-implementer:templates/github-workflows/**:unreachable-producer',
  'PRODUCER:qa-cicd-implementer:{run}/devops/cicd-plan.json:unreachable-producer',
  'PRODUCER:qa-cicd-spv:agent-memory/qa-cicd-spv/lessons.md:missing-source',
  'PRODUCER:qa-github-implementer:{run}/devops/github-plan.json:unreachable-producer',
  'PRODUCER:qa-github-spv:agent-memory/qa-github-spv/lessons.md:missing-source',
  'PRODUCER:qa-github-spv:{run}/devops/github-plan.json:unreachable-producer',
  'PRODUCER:qa-github-spv:{run}/devops/github-results.json:unreachable-producer',
  'SPV:qa-cicd-implementer:qa-cicd-spv:not-dispatched-together',
  'SPV:qa-cicd-planner:qa-cicd-spv:not-dispatched-together',
  'SPV:qa-github-implementer:qa-github-spv:not-dispatched-together',
  'SPV:qa-github-planner:qa-github-spv:not-dispatched-together',
  'WRITE-POLICY:qa-cicd-implementer:{target}/.github/workflows/qa-*.yml:target-source',
  'WRITE-POLICY:qa-cicd-implementer:{target}/.husky/**:target-source',
]);
const lines = fs.readFileSync(f, 'utf8').split('\n');
const out = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^  - key: "(.*)"$/.exec(lines[i]);
  if (m && keys.delete(m[1])) { while (/^    \S/.test(lines[i + 1] ?? '')) i++; continue; }
  out.push(lines[i]);
}
if (keys.size > 0) { console.error('not in baseline: ' + [...keys].join(', ')); process.exit(1); }
fs.writeFileSync(f, out.join('\n'));
console.log('deleted');
EOF
grep -c '^  - key:' __internal-tests__/alignment/baseline.yaml
```

Expected: `deleted`, then `238`.

- [ ] **Step 7: Run the suite and the checker**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align`
Expected: all pass; `ratchet: ok`. `pnpm aegis align --json` lists no `CONFIG … unused` key (the `github` keys are gone with their readers) and no `DOC-REF … qa-cicd*`/`qa-github*` key.

Run: `pnpm exec tsx scripts/check-baseline-growth.ts --base main`
Expected: no growth; every removed key justified (the moved agent files count as deleted subjects; `qa-metrics-collector.md` has a prose change).

- [ ] **Step 8: Commit**

```bash
# git mv (Step 3) already staged the removal of the old paths; stage the moved files' frontmatter edits and the rest.
git add agent-graveyard/qa-github-planner.md agent-graveyard/qa-github-implementer.md agent-graveyard/qa-cicd-planner.md \
  agent-graveyard/qa-cicd-implementer.md agent-graveyard/qa-cicd-evaluator.md agent-graveyard/qa-cicd-spv.md agent-graveyard/qa-github-spv.md \
  agent-graveyard/README.md .claude/model-policy.yaml .claude/pipeline.yaml .claude/agents/crosscutting/qa-metrics-collector.md \
  aegis.config.json packages/@qa/contracts/src/events.ts __internal-tests__/p2-roster.test.ts __internal-tests__/alignment/baseline.yaml
git commit -F - <<'EOF'
feat(p2a): retire the 7 DevOps agents to agent-graveyard/ (AUD-046)

Owner decision 2026-10-02: Aegis never writes to the target's GitHub or
CI. qa-github-planner, qa-github-implementer, qa-cicd-planner,
qa-cicd-implementer, qa-cicd-evaluator, qa-cicd-spv and qa-github-spv
move with retiredAt/reason; model policy, spvPairs, escapes, github and
secretsRef config go. Flaky data comes from the run's retries (AUD-011);
devops.* schemas stay so old logs parse (T8). Baseline -29.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Retire the knowledge librarian and the event-bus agent (AUD-047, AUD-048)

Baseline: **−7** (231 entries afterwards). Deletes the 2 `[AUD-047]` keys, the 4 `[AUD-048…]` keys and `DOC-REF:CLAUDE.md:crosscutting=4:count-mismatch` (AUD-075).

**Files:**
- Move: `.claude/agents/crosscutting/qa-knowledge-librarian.md`, `.claude/agents/crosscutting/qa-event-bus.md` → `agent-graveyard/`
- Modify: `.claude/model-policy.yaml`, `.claude/pipeline.yaml` (2 escapes), `CLAUDE.md` (Cross-cutting row, Knowledge pipeline paragraph), `HANDBOOK/01-what-is-this.md` (cross-cutting line), `HANDBOOK/03-architecture.md` (§3.4), `HANDBOOK/05-commands.md:157`, `HANDBOOK/13-mechanics.md` §13.8, `docs/D13-model-policy.md:26`
- Modify: `__internal-tests__/p2-roster.test.ts`, `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: `RETIRED` (Task 3). The `@qa/event-bus` library is untouched (P0b-2 owns its legacy `append()`, CO-01).

- [ ] **Step 1: Write the failing test** — in `__internal-tests__/p2-roster.test.ts` replace

```ts
  ...DEVOPS.map((name) => ({ name, aud: 'AUD-046' })),
];
```

with

```ts
  ...DEVOPS.map((name) => ({ name, aud: 'AUD-046' })),
  { name: 'qa-knowledge-librarian', aud: 'AUD-047' },
  { name: 'qa-event-bus', aud: 'AUD-048' },
];
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest p2-roster`
Expected: FAIL, 3 tests — the two new `lives only in agent-graveyard/` cases and the names test (CLAUDE.md, HANDBOOK/03, HANDBOOK/13, `docs/D13-model-policy.md`, model-policy, pipeline).

- [ ] **Step 3: Move, policy, escapes and prose** — run from the worktree root:

```bash
git mv .claude/agents/crosscutting/qa-knowledge-librarian.md agent-graveyard/qa-knowledge-librarian.md
git mv .claude/agents/crosscutting/qa-event-bus.md agent-graveyard/qa-event-bus.md
node - <<'EOF'
const fs = require('fs');
function edit(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: expected 1 match, found ${n}: ${from.slice(0, 70)}`);
    s = s.replace(from, () => to);
  }
  fs.writeFileSync(file, s);
}
const REASONS = {
  'qa-knowledge-librarian': 'AUD-047, owner decision 2026-10-02: agents read knowledge/synthesis directly through knowledge_refs',
  'qa-event-bus': 'AUD-048, owner decision 2026-10-02: events are appended only through the aegis CLI and @qa/event-bus',
};
for (const [name, reason] of Object.entries(REASONS)) {
  const file = `agent-graveyard/${name}.md`;
  const s = fs.readFileSync(file, 'utf8');
  const end = s.indexOf('\n---\n', 4);
  if (!s.startsWith('---\n') || end < 0) throw new Error(`${file}: no frontmatter`);
  fs.writeFileSync(file, `${s.slice(0, end)}\nretiredAt: 2026-10-02\nreason: "${reason}"${s.slice(end)}`);
}
edit('.claude/model-policy.yaml', [
  ['    - qa-context-scanner\n    - qa-knowledge-librarian\n    - qa-metrics-collector\n    - qa-event-bus\n', '    - qa-context-scanner\n    - qa-metrics-collector\n'],
]);
edit('.claude/pipeline.yaml', [
  ['  - {unit: qa-event-bus, field: reviewedBy.none, reason: "not stated in prose"}\n', ''],
  ['  - {unit: qa-knowledge-librarian, field: reviewedBy.none, reason: "not stated in prose"}\n', ''],
]);
edit('CLAUDE.md', [
  ['| Cross-cutting | 4 | Haiku | context-scanner, librarian, event-bus, metrics-collector |', '| Cross-cutting | 3 | Haiku / Opus | context-scanner, metrics-collector (Haiku); curator (Opus) |'],
  ['The `qa-knowledge-librarian` agent resolves worker queries against this corpus — workers query the librarian rather than grepping raw markdown.',
   'Agents read `knowledge/synthesis/*.md` directly through their `knowledge_refs` frontmatter.'],
]);
edit('HANDBOOK/01-what-is-this.md', [
  ['- **Cross-cutting agents** — five agents handling knowledge ingestion, self-improvement, and metrics', '- **Cross-cutting agents** — three agents: the context scanner, the curator (self-improvement) and the metrics collector'],
]);
edit('HANDBOOK/03-architecture.md', [
  ['Eight managers coordinate domain work:', 'Managers coordinate domain work:'],
  ['| `qa-knowledge-librarian` | Book ingestion, knowledge base maintenance, query resolution |\n', ''],
]);
edit('HANDBOOK/05-commands.md', [
  ['Chunks a QA reference book or document into `knowledge/` for the librarian to serve.', 'Chunks a QA reference book or document into `knowledge/`, for agents to read through `knowledge_refs`.'],
]);
edit('HANDBOOK/13-mechanics.md', [
  [`## 13.8 Knowledge librarian query resolution

\`qa-knowledge-librarian\` exposes a single operation: "what do the books say about X?"

1. Receive query string from worker agent
2. Load \`knowledge/INDEX.md\` to find which books/chapters cover the topic
3. Read the matching \`knowledge/{slug}/ch-XX-*.md\` files
4. Return a synthesized summary with source citations
5. Worker agent cites these sources in its work-report

This pattern keeps worker context lean — agents don't grep raw knowledge files themselves.`,
   `## 13.8 Knowledge references

There is no query service. Each agent's \`knowledge_refs\` frontmatter lists the \`knowledge/synthesis/*.md\` topics it reads, plus its own lessons file:

1. The agent reads its \`knowledge_refs\` files at the start of its task
2. It cites what it used in its work report (\`evidence[]\`)
3. \`knowledge/INDEX.md\` records which books and chapters feed each synthesis topic, for whoever maintains the corpus

The synthesis files keep worker context lean: agents read the cross-book summary, not the raw chapters.`],
]);
edit('docs/D13-model-policy.md', [
  ['`qa-knowledge-librarian` returns relevant book chunks by query match. No synthesis needed — just fast retrieval.', '`qa-metrics-collector` tails the event log into metric files. No synthesis needed — just fast, cheap passes.'],
]);
console.log('Task 4 edits applied');
EOF
```

Expected: `Task 4 edits applied`. No worker gains the Agent tool.

- [ ] **Step 4: Delete the 7 baseline keys**

```bash
node - <<'EOF'
const fs = require('fs');
const f = '__internal-tests__/alignment/baseline.yaml';
const keys = new Set([
  'CONSUMER:qa-event-bus:{run}/events.jsonl.lock:unread',
  'DISPATCH:qa-event-bus:-:undispatched',
  'DISPATCH:qa-knowledge-librarian:-:undispatched',
  'DISPATCH:qa-knowledge-librarian:qa-orchestrator:not-reciprocal',
  'DOC-REF:CLAUDE.md:crosscutting=4:count-mismatch',
  'EVENT:qa-event-bus:-:appends-without-cli',
  'WRITE-POLICY:qa-event-bus:{run}/events.jsonl:cli-only',
]);
const lines = fs.readFileSync(f, 'utf8').split('\n');
const out = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^  - key: "(.*)"$/.exec(lines[i]);
  if (m && keys.delete(m[1])) { while (/^    \S/.test(lines[i + 1] ?? '')) i++; continue; }
  out.push(lines[i]);
}
if (keys.size > 0) { console.error('not in baseline: ' + [...keys].join(', ')); process.exit(1); }
fs.writeFileSync(f, out.join('\n'));
console.log('deleted');
EOF
grep -c '^  - key:' __internal-tests__/alignment/baseline.yaml
```

Expected: `deleted`, then `231`.

- [ ] **Step 5: Run the suite and the checker**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm test && pnpm aegis align && pnpm exec tsx scripts/check-baseline-growth.ts --base main`
Expected: all pass; `ratchet: ok`; no growth; every removed key justified.

- [ ] **Step 6: Commit**

```bash
# git mv (Step 3) already staged the removal of the old paths.
git add agent-graveyard/qa-knowledge-librarian.md agent-graveyard/qa-event-bus.md .claude/model-policy.yaml .claude/pipeline.yaml CLAUDE.md HANDBOOK/01-what-is-this.md \
  HANDBOOK/03-architecture.md HANDBOOK/05-commands.md HANDBOOK/13-mechanics.md docs/D13-model-policy.md \
  __internal-tests__/p2-roster.test.ts __internal-tests__/alignment/baseline.yaml
git commit -F - <<'EOF'
feat(p2a): retire qa-knowledge-librarian and the qa-event-bus agent (AUD-047, AUD-048)

Agents read knowledge/synthesis through knowledge_refs (HANDBOOK 13.8
retitled); events are appended only through the CLI and @qa/event-bus,
which stays. CLAUDE.md cross-cutting row is 3. Baseline -7.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: AUD-049 — a self-dispatched SPV is dispatched together with its worker

Baseline: **−1** (230 entries afterwards). Deletes `SPV:qa-orchestrator:qa-orchestrator-spv:not-dispatched-together` (AUD-049).

**Files:**
- Modify: `packages/@qa/alignment/src/rules/structure.ts` (`spvRule`)
- Modify: `__internal-tests__/alignment/rules-structure.test.ts` (one new test, appended)
- Modify: `HANDBOOK/14-extending.md` §14.11 "Other graph checks"
- Modify: `.claude/agents/orchestrator/qa-orchestrator.md` (Worker → SPV table: one row)
- Modify: `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Produces: `spvRule` reports `SPV:<w>:<spv>:not-dispatched-together` only when `spv.dispatchedBy` neither contains `w` itself nor shares a dispatcher with `w`.

- [ ] **Step 1: Write the failing test** — append to `__internal-tests__/alignment/rules-structure.test.ts`:

```ts
it('AUD-049: a worker that dispatches its own SPV is dispatched together with it; disjoint dispatchers still fail', () => {
  const t = makeRepo({
    agents: {
      'qa-boss': cc({ reviewedBy: 'qa-boss-spv', dispatches: ['qa-boss-spv', 'qa-w'] }),
      'qa-boss-spv': { dir: 'spv', contract: { contract: 1, phase: 'spv', dispatchedBy: ['qa-boss'], reviewedBy: none, reviews: ['qa-boss'] } },
      'qa-w': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: ['qa-boss'], reviewedBy: 'qa-w-spv' } },
      'qa-other': cc({ dispatches: ['qa-w-spv'] }),
      'qa-w-spv': { dir: 'spv', contract: { contract: 1, phase: 'spv', dispatchedBy: ['qa-other'], reviewedBy: none, reviews: ['qa-w'] } },
    },
  });
  expect(keys(spvRule(loadModel(t.root)))).toEqual(['SPV:qa-w:qa-w-spv:not-dispatched-together']);
  t.cleanup();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest alignment/rules-structure`
Expected: FAIL — received also contains `SPV:qa-boss:qa-boss-spv:not-dispatched-together`.

- [ ] **Step 3: Implement** — in `packages/@qa/alignment/src/rules/structure.ts`, inside `spvRule`, replace

```ts
    const wBy = new Set(w.contract.dispatchedBy);
    if (!spv.contract.dispatchedBy.some((d) => wBy.has(d))) {
```

with

```ts
    const wBy = new Set(w.contract.dispatchedBy);
    // AUD-049: a worker that dispatches its own SPV (qa-orchestrator → qa-orchestrator-spv) is dispatched together with it.
    const together = spv.contract.dispatchedBy.includes(w.name) || spv.contract.dispatchedBy.some((d) => wBy.has(d));
    if (!together) {
```

- [ ] **Step 4: Prose** — run from the worktree root:

```bash
node - <<'EOF'
const fs = require('fs');
function edit(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: expected 1 match, found ${n}: ${from.slice(0, 70)}`);
    s = s.replace(from, () => to);
  }
  fs.writeFileSync(file, s);
}
edit('HANDBOOK/14-extending.md', [
  ['Other graph checks: dispatching needs the\n`Agent`/`Skill` tool and writing needs `Write`/`Edit`;',
   'Other graph checks: dispatching needs the\n`Agent`/`Skill` tool and writing needs `Write`/`Edit`; an SPV is dispatched together with its worker when they share a\ndispatcher or when the worker dispatches its SPV itself (`qa-orchestrator` → `qa-orchestrator-spv`);'],
]);
edit('.claude/agents/orchestrator/qa-orchestrator.md', [
  ['   | `qa-dev-test-reviewer` | `qa-dev-test-reviewer-spv` |\n',
   '   | `qa-dev-test-reviewer` | `qa-dev-test-reviewer-spv` |\n   | `qa-orchestrator` (your gate tasks `T-GATE-G<N>`, step 5) | `qa-orchestrator-spv`, which you dispatch yourself |\n'],
]);
console.log('Task 5 prose edited');
EOF
```

- [ ] **Step 5: Delete the baseline key**

```bash
node - <<'EOF'
const fs = require('fs');
const f = '__internal-tests__/alignment/baseline.yaml';
const keys = new Set([
  'SPV:qa-orchestrator:qa-orchestrator-spv:not-dispatched-together',
]);
const lines = fs.readFileSync(f, 'utf8').split('\n');
const out = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^  - key: "(.*)"$/.exec(lines[i]);
  if (m && keys.delete(m[1])) { while (/^    \S/.test(lines[i + 1] ?? '')) i++; continue; }
  out.push(lines[i]);
}
if (keys.size > 0) { console.error('not in baseline: ' + [...keys].join(', ')); process.exit(1); }
fs.writeFileSync(f, out.join('\n'));
console.log('deleted');
EOF
grep -c '^  - key:' __internal-tests__/alignment/baseline.yaml
```

Expected: `deleted`, then `230`.

- [ ] **Step 6: Run the tests and the checker**

Run: `pnpm -F @aegis/internal-tests exec jest alignment/rules-structure`
Expected: PASS (all SPV tests, the new one included).

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm test && pnpm aegis align && pnpm exec tsx scripts/check-baseline-growth.ts --base main`
Expected: all pass; `ratchet: ok`; no growth; the key is justified by the `qa-orchestrator.md` prose change. The orchestrator's new table row names `qa-orchestrator-spv`, which its contract `dispatches` already lists, so no `DRIFT … dispatch-not-in-contract` appears.

- [ ] **Step 7: Commit**

```bash
git add packages/@qa/alignment/src/rules/structure.ts __internal-tests__/alignment/rules-structure.test.ts HANDBOOK/14-extending.md \
  .claude/agents/orchestrator/qa-orchestrator.md __internal-tests__/alignment/baseline.yaml
git commit -F - <<'EOF'
fix(alignment): a self-dispatched SPV counts as dispatched together (AUD-049)

qa-orchestrator dispatches qa-orchestrator-spv for every gate task (P0a-1);
spvRule now accepts a reviewer the worker dispatches itself, and the
orchestrator's Worker -> SPV table says so. Baseline -1.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: The strict profile schema is the scanner's review (AUD-052, spec §4.6.2)

Baseline: **0** (230 entries).

**Files:**
- Modify: `packages/@qa/run-state/src/phase-map.ts` (`ScanProfileSchema`, import, comment)
- Modify: `.claude/agents/crosscutting/qa-context-scanner.md` (Task Protocol step 5, contract `reviewedBy`)
- Modify: `.claude/pipeline.yaml` (the `qa-context-scanner reviewedBy.none` escape reason)
- Modify: `__internal-tests__/helpers/pipeline.ts` (`PROFILE` becomes a full profile), `__internal-tests__/target-profile.test.ts`, `__internal-tests__/run-state-phases.test.ts`, `__internal-tests__/cli-cycle-e2e.test.ts`

**Interfaces:**
- Produces: `ScanProfileSchema = TargetProfileSchema` (the full `.strict()` `ZodObject` from `@qa/contracts`; P2 adds no `superRefine`, so P4's `.extend` keeps working). The Scan barrier, `preflightProblem` and `scanExistingTestsCount` all read through it.
- Produces: `PROFILE` in `__internal-tests__/helpers/pipeline.ts` is a valid full `TargetProfile`. P2b adds three required fields to `TargetProfileSchema` and must extend `PROFILE`; the new `target-profile.test.ts` case pins that.

- [ ] **Step 1: Write the failing tests**

Replace the `PROFILE` constant and its comment in `__internal-tests__/helpers/pipeline.ts` with:

```ts
/** A full target-profile.json: the Scan barrier validates it against the strict TargetProfileSchema (AUD-052). */
export const PROFILE = {
  scannedAt: TS,
  targetIsSingleProject: true,
  packageManager: 'pnpm',
  framework: { name: 'vite-react', version: '5.x', appRouter: null },
  language: { typescript: true, tsxFiles: 0, jsxFiles: 0, hasMixedJsxTsx: false },
  monorepo: { tool: 'none', workspaces: [] as string[] },
  apps: [] as Array<{ name: string; path: string; framework: string; language: string }>,
  platform: 'generic',
  roles: [] as string[],
  existingTests: { files: [] as string[], frameworks: [] as string[], locations: [] as string[], count: 0, unitTestStyle: 'none' },
  ci: { provider: 'none', workflowFiles: [] as string[] },
  apiSurface: [] as string[],
  envVarNames: [] as string[],
  hasAuth: false,
  authProvider: null,
  nodeVersion: null,
  hasRealtimeFeatures: false,
  hasFeatureFlags: false,
  sourceInventory: {},
};
```

In `__internal-tests__/target-profile.test.ts`, add `import { PROFILE } from './helpers/pipeline';` after the `@qa/contracts` import, and insert before `it('the core schema reads the three preflight fields from a full profile', …`:

```ts
  it('the pipeline-test PROFILE fixture is a valid full profile', () =>
    expect(TargetProfileSchema.safeParse(PROFILE).error?.issues ?? []).toEqual([]));
```

In `__internal-tests__/run-state-phases.test.ts`, insert before `describe('tasks belong to their phase', () => {`:

```ts
describe('the strict profile schema is the scanner\'s review (AUD-052)', () => {
  beforeEach(passIntake);

  it('refuses an extra top-level field and names it', async () => {
    await expect(passScan({ ...PROFILE, tsxFileCount: 3 })).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/target-profile.json is invalid: .*tsxFileCount/) });
  });

  it('refuses a missing field and names it', async () => {
    const { scannedAt: _s, ...rest } = PROFILE;
    await expect(passScan(rest)).rejects.toMatchObject({ code: 'barrier', message: expect.stringMatching(/target-profile.json is invalid: scannedAt: Required/) });
  });

  it('completes Scan on a full profile without an SPV review', async () => {
    await expect(passScan()).resolves.toMatchObject({ phases: { scan: { status: 'completed' } } });
  });
});
```

In `__internal-tests__/cli-cycle-e2e.test.ts`, delete the line

```ts
const PROFILE = { targetIsSingleProject: true, sourceInventory: {}, existingTests: { files: [], frameworks: [], locations: [], count: 0, unitTestStyle: 'none' } };
```

and add `import { PROFILE } from './helpers/pipeline';` after the `./helpers/p0a2-fixtures` import.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-phases target-profile`
Expected: FAIL — exactly "refuses an extra top-level field and names it" and "refuses a missing field and names it" (the core schema is not strict and does not require `scannedAt`).

- [ ] **Step 3: Implement** — run from the worktree root:

```bash
node - <<'EOF'
const fs = require('fs');
function edit(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: expected 1 match, found ${n}: ${from.slice(0, 70)}`);
    s = s.replace(from, () => to);
  }
  fs.writeFileSync(file, s);
}
edit('packages/@qa/run-state/src/phase-map.ts', [
  ['  PHASE_IDS,\n  TargetProfileCoreSchema,\n', '  PHASE_IDS,\n  TargetProfileSchema,\n'],
  [`// The one schema the Scan barrier, preflight and not-applicable use for target-profile.json.
// The barrier checks only the core fields they read; strict validation of the full profile belongs to the scanner's SPV.
export const ScanProfileSchema = TargetProfileCoreSchema;`,
   `// The one schema the Scan barrier, preflight and not-applicable use for target-profile.json: the full, top-level
// strict TargetProfileSchema. The strict schema is the scanner's review (AUD-052); a refusal names the field to fix.
export const ScanProfileSchema = TargetProfileSchema;`],
]);
edit('.claude/agents/crosscutting/qa-context-scanner.md', [
  ['5. **No review yet.** No SPV reviews your task yet; the phase barrier accepts your released work report without one.',
   '5. **No SPV.** The Scan barrier validates `target-profile.json` against the strict `TargetProfileSchema`: every field of the example above is required and no other top-level field is allowed. A refusal names the field. When you are re-dispatched with one, correct `target-profile.json` and tell your dispatcher; the task stays released.'],
  ['reviewedBy: {none: "(no SPV — cross-cutting profiler)"}', 'reviewedBy: {none: "the Scan barrier validates the profile against the strict TargetProfileSchema"}'],
]);
edit('.claude/pipeline.yaml', [
  ['  - {unit: qa-context-scanner, field: reviewedBy.none, reason: "(no SPV — cross-cutting profiler)"}', '  - {unit: qa-context-scanner, field: reviewedBy.none, reason: "the Scan barrier validates the profile against the strict TargetProfileSchema"}'],
]);
console.log('Task 6 implementation applied');
EOF
```

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-phases target-profile run-state-final-wave run-state-gates run-state-outputs p0a-contracts`
Expected: PASS.

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest cli-cycle-e2e`
Expected: PASS and not skipped (the built CLI now refuses a core-only profile, so the e2e uses the full `PROFILE`).

Run: `pnpm typecheck && pnpm test && pnpm aegis align`
Expected: all pass; `ratchet: ok`; 230 entries, no key change.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src/phase-map.ts .claude/agents/crosscutting/qa-context-scanner.md .claude/pipeline.yaml \
  __internal-tests__/helpers/pipeline.ts __internal-tests__/target-profile.test.ts __internal-tests__/run-state-phases.test.ts \
  __internal-tests__/cli-cycle-e2e.test.ts
git commit -F - <<'EOF'
feat(run-state): the Scan barrier validates the full strict profile (AUD-052)

ScanProfileSchema is TargetProfileSchema: a missing field or an extra
top-level field fails Scan and the refusal names it. The strict schema
replaces an SPV for qa-context-scanner; test fixtures are full profiles.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: The curator's reviewer is the owner; `SPV_NONE` drops the task-less and the retired (spec §4.6.3–4.6.4, T1)

Baseline: **0** (230 entries).

**Files:**
- Modify: `packages/@qa/run-state/src/phase-map.ts` (`SPV_NONE` and its comment)
- Modify: `.claude/agents/crosscutting/qa-curator.md` (step 5, contract `reviewedBy`), `.claude/agents/crosscutting/qa-metrics-collector.md` (contract `reviewedBy`)
- Modify: `.claude/pipeline.yaml` (two escape reasons)
- Modify: `__internal-tests__/p2-roster.test.ts`, `__internal-tests__/run-state-phases.test.ts`

**Interfaces:**
- Produces: `SPV_NONE = {qa-context-scanner, qa-compliance-iso25010, qa-compliance-iso5055, qa-compliance-istqb, qa-compliance-cmmi, qa-compliance-gdpr, qa-compliance-pdpa, qa-curator}` (interim; Task 11 removes the six compliance agents).

- [ ] **Step 1: Write the failing tests**

In `__internal-tests__/p2-roster.test.ts`, add `import { SPV_NONE } from '@qa/run-state';` after the `@qa/contracts` import, and append:

```ts
describe('review coverage (spec §4.6.4)', () => {
  it('SPV_NONE holds only agents with a task and a stated reason', () => {
    expect([...SPV_NONE].sort()).toEqual([
      'qa-compliance-cmmi', 'qa-compliance-gdpr', 'qa-compliance-iso25010', 'qa-compliance-iso5055', 'qa-compliance-istqb', 'qa-compliance-pdpa',
      'qa-context-scanner', 'qa-curator',
    ]);
  });
});
```

In `__internal-tests__/run-state-phases.test.ts`, change the helpers import to `import { escalationDecision, fastForward, ORCH, PROFILE, workReport, workTask, writeRunFile } from './helpers/pipeline';` and insert before `describe('tasks belong to their phase', () => {`:

```ts
describe('the owner reviews the curator through /qa-promote (AUD-052)', () => {
  it('Curator completes on a released work report with no SPV review', async () => {
    const approved = { status: 'approved', decisions: 1 };
    fastForward(t.root, runId, 'curator', { G1: approved, G2: approved, G3: approved });
    await startPhase(t.root, runId, 'curator', ORCH);
    await workTask(t.root, runId, 'T-curator-1', 'qa-curator', null);
    await expect(completePhase(t.root, runId, 'curator', ORCH)).resolves.toMatchObject({ phases: { curator: { status: 'completed' } } });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest p2-roster run-state-phases`
Expected: FAIL — only "SPV_NONE holds only agents with a task and a stated reason" (it still holds `qa-cicd-evaluator` and `qa-metrics-collector`). The curator test passes already: it pins behaviour this task must keep.

- [ ] **Step 3: Implement** — run from the worktree root:

```bash
node - <<'EOF'
const fs = require('fs');
function edit(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: expected 1 match, found ${n}: ${from.slice(0, 70)}`);
    s = s.replace(from, () => to);
  }
  fs.writeFileSync(file, s);
}
edit('packages/@qa/run-state/src/phase-map.ts', [
  [`// Agents with no SPV yet (spec §4.5: \`spv: none (P2)\`); the barrier accepts their work report without a review.
export const SPV_NONE: ReadonlySet<string> = new Set([
  "qa-context-scanner",
  "qa-compliance-iso25010",
  "qa-compliance-iso5055",
  "qa-compliance-istqb",
  "qa-compliance-cmmi",
  "qa-compliance-gdpr",
  "qa-compliance-pdpa",
  "qa-curator",
  "qa-cicd-evaluator",
  "qa-metrics-collector",
]);`,
   `// Agents the barrier accepts without an SPV review, each for a stated reason (P2 spec §4.6.4):
// qa-context-scanner — the Scan barrier validates target-profile.json against the strict TargetProfileSchema;
// qa-compliance-* — until qa-compliance-spv is paired in the path-guard role table (P2a, after the P0b-2 rebase);
// qa-curator — the owner reviews its proposals through /qa-promote.
// qa-metrics-collector runs without a task, so the barrier never looks it up.
export const SPV_NONE: ReadonlySet<string> = new Set([
  "qa-context-scanner",
  "qa-compliance-iso25010",
  "qa-compliance-iso5055",
  "qa-compliance-istqb",
  "qa-compliance-cmmi",
  "qa-compliance-gdpr",
  "qa-compliance-pdpa",
  "qa-curator",
]);`],
]);
edit('.claude/agents/crosscutting/qa-curator.md', [
  ['5. **No review yet.** No SPV reviews your task yet; the phase barrier accepts your released work report without one.',
   '5. **Owner review.** No SPV reviews your task: the owner reviews your proposals through `/qa-promote`. The phase barrier accepts your released work report.'],
  ['reviewedBy: {none: "not stated in prose"}', 'reviewedBy: {none: "the owner reviews its proposals through /qa-promote"}'],
]);
edit('.claude/agents/crosscutting/qa-metrics-collector.md', [
  ['reviewedBy: {none: "not stated in prose"}', 'reviewedBy: {none: "runs without a task; no work report to review"}'],
]);
edit('.claude/pipeline.yaml', [
  ['  - {unit: qa-curator, field: reviewedBy.none, reason: "not stated in prose"}', '  - {unit: qa-curator, field: reviewedBy.none, reason: "the owner reviews its proposals through /qa-promote"}'],
  ['  - {unit: qa-metrics-collector, field: reviewedBy.none, reason: "not stated in prose"}', '  - {unit: qa-metrics-collector, field: reviewedBy.none, reason: "runs without a task; no work report to review"}'],
]);
console.log('Task 7 implementation applied');
EOF
```

`qa-metrics-collector` keeps a `reviewedBy: {none: …}` contract field because the alignment checker requires it.

- [ ] **Step 4: Run the suite and the checker**

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align && pnpm exec tsx scripts/check-baseline-growth.ts --base main`
Expected: all pass (no hook or e2e suite skipped); `ratchet: ok`; 230 entries; no growth (escape reason changes are not growth).

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state/src/phase-map.ts .claude/agents/crosscutting/qa-curator.md .claude/agents/crosscutting/qa-metrics-collector.md \
  .claude/pipeline.yaml __internal-tests__/p2-roster.test.ts __internal-tests__/run-state-phases.test.ts
git commit -F - <<'EOF'
feat(run-state): SPV_NONE states a reason per agent; curator reviewed by the owner (AUD-052)

qa-curator's proposals are reviewed by the owner through /qa-promote;
qa-metrics-collector (no task) and the retired qa-cicd-evaluator leave
SPV_NONE. Compliance stays until qa-compliance-spv is paired.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## After rebase onto P0b-2

Start Task 8 only after `feat/p0b-2-hooks-chain` has merged into `main`. Tasks 9–13 assume these P0b-2 interfaces, copied from its plan (Task 6 and decision 14–15):

- `packages/@qa/path-guard/src/roles.ts`:
  - `export type RoleKind = "orchestrator" | "phase" | "specialist" | "spv" | "crosscutting" | "compliance";`
  - `export interface Role { readonly agent: string; readonly kind: RoleKind; readonly writes: readonly string[]; /** The SPV that reviews this agent; null for an SPV, or for an agent with no SPV yet (spec §4.5, \`spv: none (P2)\`). */ readonly spv: string | null; readonly mutatesEnvIn: readonly PhaseId[] | "any"; }`
  - `function row(agent: string, kind: RoleKind, writes: readonly string[], spv: string | null, mutatesEnvIn: Role["mutatesEnvIn"] = []): Role`
  - `const COMPLIANCE = ["iso25010", "iso5055", "istqb", "cmmi", "gdpr", "pdpa"] as const;`
  - `const SPVS = [ "qa-orchestrator-spv", …, "qa-ui-specialist-spv", "qa-unit-specialist-spv" ] as const;` (23 entries)
  - in `ROLES`: `...COMPLIANCE.map((c) => row(\`qa-compliance-${c}\`, "compliance", [\`{run}/reports/compliance/${c}.*\`], null)),` and `...SPVS.map((s) => row(s, "spv", [], null)),`
  - `export const ROLES: readonly Role[]`, `export function roleOf(agent: string): Role | undefined`, re-exported from `@qa/path-guard`.
  - the file comment ends "The agents P2 retires have no row."
- `packages/@qa/run-state/src/caller.ts`: `import { roleOf } from "@qa/path-guard";` and `export function pairedSpv(agent: string): string { return roleOf(agent)?.spv ?? SHARED_SPV[agent] ?? \`${agent}-spv\`; }`, with `SHARED_SPV` unchanged (the 5 DevOps pairs).
- `__internal-tests__/role-table.test.ts`: a `RETIRING` set of the 11 names, used by the tests "every agent file has exactly one row, except the agents P2 retires; every row has an agent file" and "every contract write of an agent lies inside its role globs" (`if (RETIRING.has(agent)) continue;`); it imports `{ isSpecialist, pairedSpv } from '@qa/run-state'`.
- `__internal-tests__/alignment/baseline.yaml` on `main`: 278 entries, including the 4 `WRITE-POLICY:qa-ui-designer:…:not-writable` keys under `[AUD-050]` (P0b-2 Task 9, conditional).

If P0b-2's merged code differs in wording, make the equivalent change at the named construct; the tests in each task pin the result.

### Task 8: Rebase onto `main` after P0b-2

Baseline: **0** (expected `main` count − 51 = **227** entries).

**Files:** none edited by hand except conflict resolution in `__internal-tests__/alignment/baseline.yaml` (and, rarely, a doc listed in the shared-file table).

- [ ] **Step 1: Rebase**

```bash
git fetch -q origin main
git log --oneline -1 origin/main     # must contain the P0b-2 merge
git rebase origin/main
```

- [ ] **Step 2: Resolve a `baseline.yaml` conflict mechanically** — whenever the rebase stops on `__internal-tests__/alignment/baseline.yaml`, run:

```bash
node - <<'EOF'
const { execFileSync } = require('child_process');
const fs = require('fs');
const f = '__internal-tests__/alignment/baseline.yaml';
const show = (ref) => execFileSync('git', ['show', `${ref}:${f}`], { encoding: 'utf8' });
const keysOf = (text) => new Set([...text.matchAll(/^  - key: "(.*)"$/gm)].map((m) => m[1]));
const commit = execFileSync('git', ['rev-parse', 'REBASE_HEAD'], { encoding: 'utf8' }).trim();
const before = keysOf(show(`${commit}^`));
const after = keysOf(show(commit));
const added = [...after].filter((k) => !before.has(k));
if (added.length > 0) throw new Error(`commit ${commit} adds baseline keys; stop and report: ${added.join(', ')}`);
const drop = new Set([...before].filter((k) => !after.has(k)));
const lines = show('HEAD').split('\n');
const out = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^  - key: "(.*)"$/.exec(lines[i]);
  if (m && drop.has(m[1])) { while (/^    \S/.test(lines[i + 1] ?? '')) i++; continue; }
  out.push(lines[i]);
}
fs.writeFileSync(f, out.join('\n'));
console.log(`baseline: kept main's entries, dropped the ${drop.size} keys ${commit.slice(0, 7)} deletes`);
EOF
git add __internal-tests__/alignment/baseline.yaml
git rebase --continue
```

This keeps `main`'s version (P0b-2's deletions and its 4 AUD-050 additions) and re-applies the replayed commit's deletions by key, whatever their `ids:` line says on `main` (P0b-2 may have re-tagged `WRITE-POLICY:qa-event-bus:…`, `[AUD-048, CO-01]`).

- [ ] **Step 3: Any other conflict** — open the file; the shared-file table says which region each side edits. Keep both sides' edits. `HANDBOOK/16-glossary.md` is the likeliest (P0b-2 line 127, Task 1 line 130). If both sides changed the same line, stop and report the conflict to the coordinator instead of choosing.

- [ ] **Step 4: Verify the rebased branch**

```bash
pnpm install --frozen-lockfile
pnpm --filter "@aegis-qa/cli..." run build
pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align
grep -c '^  - key:' __internal-tests__/alignment/baseline.yaml
grep -c 'key: "WRITE-POLICY:qa-ui-designer:' __internal-tests__/alignment/baseline.yaml
git log --oneline origin/main..HEAD
```

Expected: everything passes, no hook or e2e suite skipped; `ratchet: ok`; the count is `main`'s count minus 51 (227 when `main` has 278); 4 `qa-ui-designer` WRITE-POLICY keys (0 if P0b-2 merged without them); the log lists the spec, this plan and Tasks 1–7. `role-table.test.ts` passes with its `RETIRING` set, because none of the retired files has a row.

No commit: the rebase rewrote Tasks 1–7 in place.

---

### Task 9: Retire the UI designer pair (AUD-050) and drop `RETIRING`

Baseline: **−8** (219 entries when `main` had 278). Deletes the 3 `[AUD-050]` keys from e71d838, P0b-2's 4 `[AUD-050]` WRITE-POLICY keys and `DOC-REF:CLAUDE.md:tier2-specialist=16:count-mismatch` (AUD-075).

**Files:**
- Move: `.claude/agents/tier2-specialist/qa-ui-designer.md`, `.claude/agents/spv/qa-ui-designer-spv.md` → `agent-graveyard/`
- Modify: `.claude/model-policy.yaml`, `.claude/pipeline.yaml` (1 escape), `CLAUDE.md` (rows 2 and 3 of the tier table), `HANDBOOK/01-what-is-this.md` (Tier-2 line)
- Modify (P0b-2 files): `__internal-tests__/role-table.test.ts` (`RETIRING` removed), `packages/@qa/path-guard/src/roles.ts` (file comment)
- Modify: `__internal-tests__/p2-roster.test.ts`, `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes (P0b-2): `ROLES`, `roleOf`, the `RETIRING` set and the two role-table tests that use it.
- `dashboard.showFrameworkBranding` stays "read" (`apps/cli/src/commands/init.ts` names it). `@qa/dashboard-ui` is P2c's.

- [ ] **Step 1: Write the failing tests** — in `__internal-tests__/p2-roster.test.ts` replace

```ts
  { name: 'qa-event-bus', aud: 'AUD-048' },
];
```

with

```ts
  { name: 'qa-event-bus', aud: 'AUD-048' },
  { name: 'qa-ui-designer', aud: 'AUD-050' },
  { name: 'qa-ui-designer-spv', aud: 'AUD-050' },
];
```

and append:

```ts
describe('roster counts (spec §4.7)', () => {
  it('the CLAUDE.md tier table counts equal the agent directories, and the DevOps tier is gone', () => {
    const dir = path.join(ROOT, '.claude', 'agents');
    const count = (tier: string): number => fs.readdirSync(path.join(dir, tier)).filter((f) => f.endsWith('.md') && f !== 'README.md').length;
    const TIERS: Array<[string, string]> = [
      ['0 — Orchestrator', 'orchestrator'], ['1 — Phase managers', 'tier1-phase'], ['2 — Specialists', 'tier2-specialist'],
      ['3 — SPVs', 'spv'], ['Compliance', 'compliance'], ['Cross-cutting', 'crosscutting'],
    ];
    const rows = read('CLAUDE.md').split('\n').filter((l) => l.startsWith('| ')).map((l) => l.split('|').map((c) => c.trim()));
    expect(TIERS.map(([tier]) => `${tier}=${rows.find((c) => c[1] === tier)?.[2]}`)).toEqual(TIERS.map(([tier, d]) => `${tier}=${count(d)}`));
    expect(rows.filter((c) => /DevOps/.test(c[1] ?? ''))).toEqual([]);
    const devops = path.join(dir, 'tier2-5-devops');
    expect(fs.existsSync(devops) ? fs.readdirSync(devops) : []).toEqual([]);
  });
});
```

In `__internal-tests__/role-table.test.ts` (P0b-2):
- delete the `RETIRING` constant and its comment line (`// Retired to agent-graveyard/ by P2 …`);
- replace the first test of `describe('role table (spec §4.2: one declarative table)'` with:

```ts
  it('every agent file has exactly one row; every row has an agent file', () => {
    const files = agentFiles();
    const rows = ROLES.map((r) => r.agent);
    expect(new Set(rows).size).toBe(rows.length);
    expect([...files.keys()].filter((a) => roleOf(a) === undefined)).toEqual([]);
    expect(rows.filter((a) => !files.has(a))).toEqual([]);
  });
```

- in "every contract write of an agent lies inside its role globs", delete the line `if (RETIRING.has(agent)) continue;`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest p2-roster role-table`
Expected: FAIL — the two `qa-ui-designer*` retirement cases, the names test (model policy, pipeline, HANDBOOK/01), the tier-table test (`2 — Specialists=16` vs 14), and both role-table tests (`qa-ui-designer` and `qa-ui-designer-spv` have files but no row; `roleOf(agent)!.writes` throws for them).

- [ ] **Step 3: Move and edit** — run from the worktree root:

```bash
git mv .claude/agents/tier2-specialist/qa-ui-designer.md agent-graveyard/qa-ui-designer.md
git mv .claude/agents/spv/qa-ui-designer-spv.md agent-graveyard/qa-ui-designer-spv.md
node - <<'EOF'
const fs = require('fs');
function edit(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: expected 1 match, found ${n}: ${from.slice(0, 70)}`);
    s = s.replace(from, () => to);
  }
  fs.writeFileSync(file, s);
}
const REASON = 'AUD-050, owner decision 2026-10-02: dashboard work is framework development';
for (const name of ['qa-ui-designer', 'qa-ui-designer-spv']) {
  const file = `agent-graveyard/${name}.md`;
  const s = fs.readFileSync(file, 'utf8');
  const end = s.indexOf('\n---\n', 4);
  if (!s.startsWith('---\n') || end < 0) throw new Error(`${file}: no frontmatter`);
  fs.writeFileSync(file, `${s.slice(0, end)}\nretiredAt: 2026-10-02\nreason: "${REASON}"${s.slice(end)}`);
}
edit('.claude/model-policy.yaml', [
  ['    - qa-web-explorer\n    - qa-ui-designer\n', '    - qa-web-explorer\n'],
  ['    - qa-web-explorer-spv\n    - qa-ui-designer-spv\n', '    - qa-web-explorer-spv\n'],
]);
edit('.claude/pipeline.yaml', [
  ['  - {unit: qa-ui-designer-spv, field: reviewedBy.none, reason: "not stated in prose"}\n', ''],
]);
edit('CLAUDE.md', [
  ['| 2 — Specialists | 16 | Sonnet |', '| 2 — Specialists | 13 | Sonnet |'],
  ['| 3 — SPVs | 24 | Opus | Mirror of Tier 1/2; validate work reports |', '| 3 — SPVs | 23 | Opus | Mirror of Tier 1/2; validate work reports |'],
]);
edit('HANDBOOK/01-what-is-this.md', [
  ['- **Tier-2 specialists** — fourteen workers that execute concrete tasks:', '- **Tier-2 specialists** — thirteen workers that execute concrete tasks:'],
  ['`qa-web-explorer`, `qa-ui-designer`, `qa-database-specialist`', '`qa-web-explorer`, `qa-database-specialist`'],
]);
edit('packages/@qa/path-guard/src/roles.ts', [
  ['The agents P2 retires have no row.', 'Retired agents (agent-graveyard/) have no row.'],
]);
console.log('Task 9 edits applied');
EOF
```

The SPV row reads 23 until Task 11 adds `qa-compliance-spv` (decision 7).

- [ ] **Step 4: Delete the 8 baseline keys** — the 4 P0b-2 keys are the drafted `WRITE-POLICY:qa-ui-designer:<write>:not-writable` keys, one per contract write of `qa-ui-designer`:

```bash
grep 'key: "WRITE-POLICY:qa-ui-designer:' __internal-tests__/alignment/baseline.yaml
node - <<'EOF'
const fs = require('fs');
const f = '__internal-tests__/alignment/baseline.yaml';
const text = fs.readFileSync(f, 'utf8');
const p0b2 = [...text.matchAll(/^  - key: "(WRITE-POLICY:qa-ui-designer:[^"]*)"$/gm)].map((m) => m[1]);
const keys = new Set([
  'DISPATCH:qa-ui-designer-spv:-:undispatched',
  'DISPATCH:qa-ui-designer:-:undispatched',
  'DOC-REF:CLAUDE.md:tier2-specialist=16:count-mismatch',
  'SPV:qa-ui-designer:qa-ui-designer-spv:not-dispatched-together',
  ...p0b2,
]);
const lines = text.split('\n');
const out = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^  - key: "(.*)"$/.exec(lines[i]);
  if (m && keys.delete(m[1])) { while (/^    \S/.test(lines[i + 1] ?? '')) i++; continue; }
  out.push(lines[i]);
}
if (keys.size > 0) { console.error('not in baseline: ' + [...keys].join(', ')); process.exit(1); }
fs.writeFileSync(f, out.join('\n'));
console.log(`deleted ${4 + p0b2.length}`);
EOF
grep -c '^  - key:' __internal-tests__/alignment/baseline.yaml
```

Expected: the grep prints 4 lines (`…:apps/dashboard/src/components/ui/**:…`, `…/components/domain/**:…`, `…/components/layout/**:…`, `…/src/styles/globals.css:…`); then `deleted 8`, then `219` (`main` − 59).

- [ ] **Step 5: Run the suite and the checker**

Run: `pnpm -F @aegis/internal-tests exec jest p2-roster role-table agent-frontmatter`
Expected: PASS.

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm typecheck && pnpm test && pnpm aegis align && pnpm exec tsx scripts/check-baseline-growth.ts --base main`
Expected: all pass; `ratchet: ok`; no growth; every removed key justified (the moved agent files).

- [ ] **Step 6: Commit**

```bash
# git mv (Step 3) already staged the removal of the old paths.
git add agent-graveyard/qa-ui-designer.md agent-graveyard/qa-ui-designer-spv.md .claude/model-policy.yaml .claude/pipeline.yaml CLAUDE.md HANDBOOK/01-what-is-this.md \
  packages/@qa/path-guard/src/roles.ts __internal-tests__/role-table.test.ts __internal-tests__/p2-roster.test.ts \
  __internal-tests__/alignment/baseline.yaml
git commit -F - <<'EOF'
feat(p2a): retire the qa-ui-designer pair; every agent file has a role row (AUD-050)

Dashboard work is framework development. Both files move with
retiredAt/reason; P0b-2's four transient WRITE-POLICY keys leave with
the agent, and role-table.test.ts loses its RETIRING exceptions.
CLAUDE.md: specialists 13, SPVs 23. Baseline -8.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Close the special-phase vocabulary (T9)

Baseline: **0**.

**Files:**
- Modify: `packages/@qa/alignment/src/types.ts` (`SPECIAL_PHASES`)
- Modify: `__internal-tests__/alignment/rules-structure.test.ts` (one new test; two fixtures move off `phase: 'devops'`)
- Modify: `HANDBOOK/14-extending.md:149`

**Interfaces:**
- Produces: `SPECIAL_PHASES = {"crosscutting", "spv"}`. A contract naming `devops` or `tooling` is `CONTRACT:<unit>:<phase>:unknown-phase`. `dataflow.ts` keeps reading `SPECIAL_PHASES` unchanged.

- [ ] **Step 1: Write the failing test** — run from the worktree root:

```bash
node - <<'EOF'
const fs = require('fs');
function edit(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: expected 1 match, found ${n}: ${from.slice(0, 70)}`);
    s = s.replace(from, () => to);
  }
  fs.writeFileSync(file, s);
}
edit('__internal-tests__/alignment/rules-structure.test.ts', [
  ["      'qa-cicd-planner': { contract: { contract: 1, phase: 'devops', dispatchedBy: [], dispatch: none, reviewedBy: { none: 'x y' } } },",
   "      'qa-cicd-planner': { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: [], dispatch: none, reviewedBy: { none: 'x y' } } },"],
  ["  for (const w of ws) agents[w] = { contract: { contract: 1, phase: 'devops', dispatchedBy: ['qa-orchestrator'], reviewedBy: 'qa-cicd-spv' } };",
   "  for (const w of ws) agents[w] = { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: ['qa-orchestrator'], reviewedBy: 'qa-cicd-spv' } };"],
  [`it('CONTRACT: agent listed in two phases', () => {`,
   `it('T9: devops and tooling are no longer special phases', () => {
  const agent = (phase: string) => ({ contract: { contract: 1, phase, dispatchedBy: [], dispatch: none, reviewedBy: none } });
  const t = makeRepo({ agents: { 'qa-a': agent('devops'), 'qa-b': agent('tooling'), 'qa-c': agent('crosscutting'), 'qa-d': agent('spv') }, pipeline: pipe([]) });
  expect(keys(contractRule(loadModel(t.root)))).toEqual(['CONTRACT:qa-a:devops:unknown-phase', 'CONTRACT:qa-b:tooling:unknown-phase']);
  t.cleanup();
});

it('CONTRACT: agent listed in two phases', () => {`],
]);
console.log('Task 10 tests written');
EOF
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest alignment/rules-structure`
Expected: FAIL — "T9: devops and tooling are no longer special phases" receives `[]`.

- [ ] **Step 3: Implement**

In `packages/@qa/alignment/src/types.ts` replace

```ts
export const SPECIAL_PHASES: ReadonlySet<string> = new Set(["crosscutting", "spv", "devops", "tooling"]);
```

with

```ts
// Non-pipeline phases a contract may name (T9, P2): the DevOps tier and qa-ui-designer, the last `devops` and `tooling` units, are retired.
export const SPECIAL_PHASES: ReadonlySet<string> = new Set(["crosscutting", "spv"]);
```

In `HANDBOOK/14-extending.md` replace

```markdown
| `phase` | A phase id from `pipeline.yaml`, or `crosscutting` / `spv` / `devops` / `tooling` |
```

with

```markdown
| `phase` | A phase id from `pipeline.yaml`, or `crosscutting` / `spv` |
```

- [ ] **Step 4: Run the tests and the checker**

Run: `pnpm -F @aegis/internal-tests exec jest alignment`
Expected: PASS.

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm test && pnpm aegis align`
Expected: all pass; `ratchet: ok`; no new `CONTRACT … unknown-phase` key (no remaining unit names `devops` or `tooling`).

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/alignment/src/types.ts __internal-tests__/alignment/rules-structure.test.ts HANDBOOK/14-extending.md
git commit -F - <<'EOF'
feat(alignment): SPECIAL_PHASES is crosscutting and spv only (T9)

No unit names devops or tooling after the P2 retirements, so a contract
that does is an unknown phase.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: `qa-compliance-spv` — the shared compliance reviewer, paired through the role table (AUD-052, AUD-082 P2 half, T11)

Baseline: **0** keys; **+1 escape** (`qa-compliance-spv reviewedBy.none`) → PR label `baseline-growth`.

**Files:**
- Create: `.claude/agents/spv/qa-compliance-spv.md`
- Modify (P0b-2 files): `packages/@qa/path-guard/src/roles.ts` (compliance `spv`, `SPVS`, `Role.spv` comment), `__internal-tests__/role-table.test.ts` (one new test)
- Modify: `packages/@qa/run-state/src/caller.ts` (`SHARED_SPV` deleted, `pairedSpv`), `packages/@qa/run-state/src/phase-map.ts` (`SPV_NONE` final form)
- Modify: `.claude/agents/compliance/qa-compliance-{iso25010,iso5055,istqb,cmmi,gdpr,pdpa}.md` (step 5, `reviewedBy`)
- Modify: `.claude/agents/orchestrator/qa-orchestrator.md` (Worker → SPV table, contract `dispatches`)
- Modify: `.claude/pipeline.yaml` (`spvPairs`, escapes), `.claude/model-policy.yaml`, `CLAUDE.md` (SPV row)
- Modify: `__internal-tests__/run-state-core.test.ts`, `run-state-submit.test.ts`, `run-state-phases.test.ts`, `p0a-final-fix.test.ts`, `cli-cycle-e2e.test.ts`, `alignment/rules-structure.test.ts`, `p2-roster.test.ts`

**Interfaces:**
- Consumes (P0b-2): `roleOf(agent): Role | undefined`, `ROLES`, `row(…)`, `COMPLIANCE`, `SPVS` (see the section header).
- Produces: `pairedSpv(agent: string): string = roleOf(agent)?.spv ?? \`${agent}-spv\`` (no `SHARED_SPV`); the six compliance rows carry `spv: "qa-compliance-spv"`; `qa-compliance-spv` is a `kind: "spv"` row with no writes; `SPV_NONE = {qa-context-scanner, qa-curator}`; `pipeline.yaml#spvPairs` holds the six compliance pairs (the checker compares it with `pairedSpv`).

- [ ] **Step 1: Write the failing tests** — run from the worktree root:

```bash
node - <<'EOF'
const fs = require('fs');
function edit(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: expected 1 match, found ${n}: ${from.slice(0, 70)}`);
    s = s.replace(from, () => to);
  }
  fs.writeFileSync(file, s);
}
edit('__internal-tests__/run-state-core.test.ts', [
  [`import { appendChained } from '@qa/event-bus';\n`, `import { appendChained } from '@qa/event-bus';\nimport { ROLES } from '@qa/path-guard';\n`],
  [`    ['qa-cicd-planner', 'qa-cicd-spv'],
    ['qa-cicd-implementer', 'qa-cicd-spv'],
    ['qa-cicd-evaluator', 'qa-cicd-spv'],
    ['qa-github-planner', 'qa-github-spv'],
    ['qa-github-implementer', 'qa-github-spv'],
  ])('pairs %s with %s', (agent, spv) => {
    expect(pairedSpv(agent)).toBe(spv);
  });`,
   `    ...(['iso25010', 'iso5055', 'istqb', 'cmmi', 'gdpr', 'pdpa'] as const).map((c): [string, string] => [\`qa-compliance-\${c}\`, 'qa-compliance-spv']),
  ])('pairs %s with %s', (agent, spv) => {
    expect(pairedSpv(agent)).toBe(spv);
  });

  it('every other reviewed role pairs with <agent>-spv, and SHARED_SPV is gone (P2 T11)', () => {
    for (const r of ROLES.filter((x) => x.spv !== null && x.kind !== 'compliance')) expect(pairedSpv(r.agent)).toBe(\`\${r.agent}-spv\`);
    const src = fs.readFileSync(path.join(__dirname, '..', 'packages', '@qa', 'run-state', 'src', 'caller.ts'), 'utf-8');
    expect(src).not.toMatch(/SHARED_SPV/);
  });`],
]);
edit('__internal-tests__/run-state-submit.test.ts', [
  [`  it('lets qa-cicd-spv review qa-cicd-planner', async () => {
    const planner = 'qa-cicd-planner';
    await addTask(t.root, runId, { id: 'T-2', title: 'ci plan', agent: planner }, 'qa-test-executor');
    await claimTask(t.root, runId, 'T-2', planner);
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport({ taskId: 'T-2', agent: planner })), planner);
    await releaseTask(t.root, runId, 'T-2', 'done', planner);
    const file = writeJson('r.json', review('passed', { reviewer: 'qa-cicd-spv', target: { agent: planner, taskId: 'T-2' } }));
    await expect(submitReview(t.root, runId, file, 'qa-cicd-spv')).resolves.toMatchObject({ verdict: 'passed', attempt: 1 });
    expect(last(events())).toMatchObject({ type: 'review.passed', target: { agent: planner, taskId: 'T-2' }, emittedBy: 'qa-cicd-spv' });
  });`,
   `  it('lets qa-compliance-spv review qa-compliance-gdpr, and refuses any other SPV', async () => {
    const worker = 'qa-compliance-gdpr';
    await addTask(t.root, runId, { id: 'T-2', title: 'gdpr coverage', agent: worker }, 'qa-orchestrator');
    await claimTask(t.root, runId, 'T-2', worker);
    await submitWorkReport(t.root, runId, writeJson('wr.json', workReport({ taskId: 'T-2', agent: worker })), worker);
    await releaseTask(t.root, runId, 'T-2', 'done', worker);
    for (const other of ['qa-compliance-gdpr-spv', 'qa-ui-specialist-spv']) {
      const wrong = writeJson('w.json', review('passed', { reviewer: other, target: { agent: worker, taskId: 'T-2' } }));
      await expect(submitReview(t.root, runId, wrong, other)).rejects.toMatchObject({ code: 'caller-forbidden' });
    }
    const file = writeJson('r.json', review('passed', { reviewer: 'qa-compliance-spv', target: { agent: worker, taskId: 'T-2' } }));
    await expect(submitReview(t.root, runId, file, 'qa-compliance-spv')).resolves.toMatchObject({ verdict: 'passed', attempt: 1 });
    expect(last(events())).toMatchObject({ type: 'review.passed', target: { agent: worker, taskId: 'T-2' }, emittedBy: 'qa-compliance-spv' });
  });`],
]);
edit('__internal-tests__/run-state-phases.test.ts', [
  [`describe('tasks belong to their phase', () => {`,
   `describe('qa-compliance-spv reviews every compliance task (AUD-052)', () => {
  const approved = { status: 'approved', decisions: 1 };
  beforeEach(async () => {
    fastForward(t.root, runId, 'compliance', { G1: approved, G2: approved });
    await startPhase(t.root, runId, 'compliance', ORCH);
  });

  it('an unreviewed compliance task blocks Compliance and the refusal names it', async () => {
    await workTask(t.root, runId, 'T-compliance-1', 'qa-compliance-gdpr', null);
    await expect(completePhase(t.root, runId, 'compliance', ORCH)).rejects.toMatchObject({
      code: 'barrier',
      message: expect.stringMatching(/task T-compliance-1: attempt 1 of qa-compliance-gdpr has no passing review/),
    });
  });

  it('a passing qa-compliance-spv review completes Compliance', async () => {
    await workTask(t.root, runId, 'T-compliance-1', 'qa-compliance-gdpr', 'qa-compliance-spv');
    await expect(completePhase(t.root, runId, 'compliance', ORCH)).resolves.toMatchObject({ phases: { compliance: { status: 'completed' } } });
  });
});

describe('tasks belong to their phase', () => {`],
]);
edit('__internal-tests__/p0a-final-fix.test.ts', [
  ["const row = prose('orchestrator/qa-orchestrator.md').split('\\n').find((l) => l.includes('none yet — the barrier'))!;",
   "const row = prose('orchestrator/qa-orchestrator.md').split('\\n').find((l) => l.includes('| none: `SPV_NONE`'))!;"],
]);
edit('__internal-tests__/cli-cycle-e2e.test.ts', [
  ["import { staleBuild } from '@qa/alignment';\n", "import { staleBuild } from '@qa/alignment';\nimport { pairedSpv } from '@qa/run-state';\n"],
  ['const SPV_NONE = /^(qa-context-scanner|qa-compliance-.*|qa-curator)$/;', 'const SPV_NONE = /^(qa-context-scanner|qa-curator)$/;'],
  ["attempt(task: string, agent: string, verdict: 'passed' | 'requested-changes' = 'passed', spv = `${agent}-spv`): void {",
   "attempt(task: string, agent: string, verdict: 'passed' | 'requested-changes' = 'passed', spv = pairedSpv(agent)): void {"],
  ["review(task: string, agent: string, verdict: 'passed' | 'requested-changes', spv = `${agent}-spv`): void {",
   "review(task: string, agent: string, verdict: 'passed' | 'requested-changes', spv = pairedSpv(agent)): void {"],
]);
edit('__internal-tests__/alignment/rules-structure.test.ts', [
  [`it('SPV: shared SPV via spvPairs is consistent', () => {
  const ws = ['qa-cicd-planner', 'qa-cicd-implementer', 'qa-cicd-evaluator'];
  const agents: Record<string, any> = {
    'qa-orchestrator': cc({ dispatches: [...ws, 'qa-cicd-spv'] }),
    'qa-cicd-spv': { dir: 'spv', contract: { contract: 1, phase: 'spv', dispatchedBy: ['qa-orchestrator'], reviewedBy: none, reviews: ws } },
  };
  for (const w of ws) agents[w] = { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: ['qa-orchestrator'], reviewedBy: 'qa-cicd-spv' } };
  const t = makeRepo({ agents, pipeline: { ...MIN_PIPELINE, spvPairs: Object.fromEntries(ws.map((w) => [w, 'qa-cicd-spv'])) } });
  expect(keys(spvRule(loadModel(t.root)))).toEqual([]);
  t.cleanup();
});`,
   `it('SPV: a shared SPV paired through the role table is consistent (qa-compliance-spv); a stale pair is reported', () => {
  const ws = ['qa-compliance-iso25010', 'qa-compliance-gdpr', 'qa-compliance-pdpa'];
  const agents: Record<string, any> = {
    'qa-orchestrator': cc({ dispatches: [...ws, 'qa-compliance-spv'] }),
    'qa-compliance-spv': { dir: 'spv', contract: { contract: 1, phase: 'spv', dispatchedBy: ['qa-orchestrator'], reviewedBy: none, reviews: ws } },
  };
  for (const w of ws) agents[w] = { contract: { contract: 1, phase: 'crosscutting', dispatchedBy: ['qa-orchestrator'], reviewedBy: 'qa-compliance-spv' } };
  const consistent = makeRepo({ agents, pipeline: { ...MIN_PIPELINE, spvPairs: Object.fromEntries(ws.map((w) => [w, 'qa-compliance-spv'])) } });
  expect(keys(spvRule(loadModel(consistent.root)))).toEqual([]);
  consistent.cleanup();
  const stale = makeRepo({ agents, pipeline: { ...MIN_PIPELINE, spvPairs: { 'qa-cicd-planner': 'qa-cicd-spv' } } });
  expect(keys(spvRule(loadModel(stale.root)))).toEqual(['SPV:pipeline:qa-cicd-planner:pair-mismatch']);
  stale.cleanup();
});`],
]);
edit('__internal-tests__/p2-roster.test.ts', [
  [`    expect([...SPV_NONE].sort()).toEqual([
      'qa-compliance-cmmi', 'qa-compliance-gdpr', 'qa-compliance-iso25010', 'qa-compliance-iso5055', 'qa-compliance-istqb', 'qa-compliance-pdpa',
      'qa-context-scanner', 'qa-curator',
    ]);`,
   `    expect([...SPV_NONE].sort()).toEqual(['qa-context-scanner', 'qa-curator']);`],
]);
console.log('Task 11 tests written');
EOF
```

In `__internal-tests__/run-state-phases.test.ts`, the helpers import already includes `fastForward` (Task 7).

In `__internal-tests__/role-table.test.ts` (P0b-2), change `import { isSpecialist, pairedSpv } from '@qa/run-state';` to `import { isSpecialist, pairedSpv, SPV_NONE } from '@qa/run-state';` and add inside `describe('role table (spec §4.2: one declarative table)'`:

```ts
  it('every non-SPV row without an SPV is in SPV_NONE or is the task-less metrics collector (P2 §4.6.4)', () => {
    const unreviewed = ROLES.filter((r) => r.kind !== 'spv' && r.spv === null).map((r) => r.agent).sort();
    expect(unreviewed).toEqual([...SPV_NONE, 'qa-metrics-collector'].sort());
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-core run-state-submit run-state-phases p0a-final-fix role-table p2-roster alignment/rules-structure`
Expected: FAIL — the six compliance pairings (`qa-compliance-gdpr-spv` received), "SHARED_SPV is gone", the compliance submit test (`caller-forbidden` for `qa-compliance-spv`), "an unreviewed compliance task blocks Compliance" (resolves), the p0a-final-fix row finder (no `| none: \`SPV_NONE\`` line), the role-table SPV_NONE test, the p2-roster SPV_NONE test, and both halves of the rules-structure shared-SPV test.

- [ ] **Step 3: Create `.claude/agents/spv/qa-compliance-spv.md`** with exactly this content:

````markdown
---
name: qa-compliance-spv
description: Reviews the work of the six compliance agents (ISO 25010, ISO 5055, ISTQB, CMMI, GDPR, PDPA), one task at a time. Validates that the report exists and parses, exact tag formats, cited clauses that exist, evidence-backed gaps, coverage language with no compliance or ship verdict, brand-clean output, the data checks and the completion event. Submits its verdict with aegis review submit.
modelTier: validation
model: claude-opus-4-8
tools: [Read, Bash]
knowledge_refs:
  - knowledge/synthesis/compliance-and-regulations.md
  - agent-memory/qa-compliance-iso25010/lessons.md
  - agent-memory/qa-compliance-iso5055/lessons.md
  - agent-memory/qa-compliance-istqb/lessons.md
  - agent-memory/qa-compliance-cmmi/lessons.md
  - agent-memory/qa-compliance-gdpr/lessons.md
  - agent-memory/qa-compliance-pdpa/lessons.md
---

# QA Compliance SPV

## Your Role

You are the one reviewer of all six compliance agents. Each of them maps the cycle's test cases and defects to one regulation and reports the coverage gaps, and that report feeds the customer-facing closure report. A malformed tag, an invented clause or an unsupported gap there misleads the reader about what was tested. You review one compliance task at a time: your dispatch brief names the worker and the task id, and the worker's name gives the regulation id, `<id>` in `qa-compliance-<id>`, which is one of `iso25010`, `iso5055`, `istqb`, `cmmi`, `gdpr` or `pdpa`.

## Inputs

- `runs/{runId}/reports/work/qa-compliance-*.json` — the compliance agents' work reports, one file per task and attempt; review the worker your brief names
- `runs/{runId}/reports/compliance/*.{md,json}` — the compliance reports; the pair under review is named after the regulation id
- `runs/{runId}/cases/*.json` — the test cases the gaps cite
- `runs/{runId}/defects/*.json` — the defects the gaps cite
- `runs/{runId}/events.jsonl` — read only, for the worker's completion event
- `knowledge/synthesis/compliance-and-regulations.md` — the clause catalogue
- `agent-memory/qa-compliance-iso25010/lessons.md`
- `agent-memory/qa-compliance-iso5055/lessons.md`
- `agent-memory/qa-compliance-istqb/lessons.md`
- `agent-memory/qa-compliance-cmmi/lessons.md`
- `agent-memory/qa-compliance-gdpr/lessons.md`
- `agent-memory/qa-compliance-pdpa/lessons.md`

## Review Checklist

1. **Report present.** The worker's Markdown and JSON reports for its regulation id exist, and the JSON parses. A missing or unparseable report = requested-changes.
2. **Tag format.** Every tag matches its regulation's pattern exactly: `ISO25010-{Characteristic}-{Subcharacteristic}`, `ISO5055-{Characteristic}-CWE-{id}`, `ISTQB-{level}-{section}`, `CMMI-{process-area}-{practice}`, `GDPR-Art{N}` or `PDPA-Sec{N}`. A malformed tag = requested-changes.
3. **Clause exists.** Every article, section, characteristic or practice the report cites appears in the worker's own clause catalogue: its prose and its knowledge references. An invented clause = requested-changes.
4. **Evidence-backed gaps.** Every gap cites existing run artefacts: TC, DEF or REQ ids, or run-relative paths. Open at least three citations and confirm each one exists and says what the gap claims. An unsupported or dangling citation = requested-changes.
5. **Coverage, not a verdict.** The report states test-coverage gaps. It never says the application is or is not compliant, and it gives no ship/no-ship verdict. Either one = requested-changes.
6. **Brand-clean.** The report feeds the customer-facing closure report: `grep -i` it for the framework name and for internal agent names (the `STAKEHOLDER_FORBIDDEN_PATTERNS` list in `@qa/contracts`). A hit = requested-changes.
7. **Data checks (GDPR, PDPA).** The work report records the synthetic-data check and the HAR-sanitisation check of the worker's Process steps 4–5. A missing check = passed-with-notes.
8. **Event matches the report.** The worker appended `compliance.review-complete`, and its counts equal the report's. A missing event or a mismatch = passed-with-notes.

## Verdict

- `passed` — all checks pass
- `passed-with-notes` — a missing data check (7) or an event that does not match the report (8); add a CorrectiveInstruction
- `requested-changes` — a missing or unparseable report, a malformed tag, an invented clause, an unsupported gap, a compliance or ship verdict, or a brand leak (1–6)

## Submitting Your Verdict

Prefix every command with your name: `AEGIS_AGENT=<your-name> pnpm aegis`, for example `AEGIS_AGENT=qa-compliance-spv pnpm aegis review submit --file /dev/stdin`. Review only a released task, and only the attempt the CLI binds: the highest-numbered attempt file of the worker's task (file names end in the attempt number n, `<agent>.<taskId>.<n>.json`). `aegis review submit` refuses a task that is in progress, failed (the owner decides through the escalation), or pending, and a task with no work report: tell your dispatcher instead of waiting. Pipe one `ReviewSchema` object into `aegis review submit --file /dev/stdin`: `id` (`RV-qa-compliance-spv-<taskId>`), `reviewer` (`qa-compliance-spv`), `target` (the worker's `agent`, the `taskId`, and the `workReportId` of the report you reviewed), `verdict`, `summary` (10–500 characters), `findings[]` (each `{severity, claim, evidence[]}`, severity `info`, `low`, `medium`, `high` or `blocker`), `correctiveInstructions[]` (at least one for `passed-with-notes` and `requested-changes`; each has `mistake` and `rootCause` of 20–300 characters and `correctiveRule` of 20–400 characters), `reviewedAt` (a UTC ISO string ending in `Z`) and `modelUsed`. The CLI records the `review.*` event, pipes every corrective instruction into the worker's lessons, and reopens the task on `requested-changes`, except on the third rejection in a round, which escalates the task to the owner instead. You never append `review.*` events, never write lessons, and never re-dispatch the worker.

## Events You Emit

- `review.passed` / `review.passed-with-notes` / `review.requested-changes` — recorded by `aegis review submit`

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
phase: spv
dispatchedBy: [qa-orchestrator]
reviewedBy: {none: "SPVs are not reviewed (spec §4.5)"}
reviews: [qa-compliance-iso25010, qa-compliance-iso5055, qa-compliance-istqb, qa-compliance-cmmi, qa-compliance-gdpr, qa-compliance-pdpa]
reads:
  - "{run}/reports/work/qa-compliance-*.json"
  - "{run}/reports/compliance/*.{md,json}"
  - "{run}/cases/*.json"
  - "{run}/defects/*.json"
  - "{run}/events.jsonl"
  - knowledge/synthesis/compliance-and-regulations.md
  - agent-memory/qa-compliance-iso25010/lessons.md
  - agent-memory/qa-compliance-iso5055/lessons.md
  - agent-memory/qa-compliance-istqb/lessons.md
  - agent-memory/qa-compliance-cmmi/lessons.md
  - agent-memory/qa-compliance-gdpr/lessons.md
  - agent-memory/qa-compliance-pdpa/lessons.md
writes: []
emits:
  - {event: review.passed, via: "cli:review.submit"}
  - {event: review.passed-with-notes, via: "cli:review.submit"}
  - {event: review.requested-changes, via: "cli:review.submit"}
awaits: []
cli: [review.submit]
runs: [grep]
dispatches: []
config: []
```
````

No lessons stub of its own, like the other SPVs: the CLI pipes corrective instructions into the worker's lessons (SPV lessons naming is AUD-074, P5).

- [ ] **Step 4: Pair it through the role table** (P0b-2's `packages/@qa/path-guard/src/roles.ts`):

- Replace the `Role.spv` doc comment `/** The SPV that reviews this agent; null for an SPV, or for an agent with no SPV yet (spec §4.5, \`spv: none (P2)\`). */` with `/** The SPV that reviews this agent; null for an SPV, for an agent in SPV_NONE (@qa/run-state), or for an agent with no task (qa-metrics-collector). */`.
- Replace `...COMPLIANCE.map((c) => row(\`qa-compliance-${c}\`, "compliance", [\`{run}/reports/compliance/${c}.*\`], null)),` with `...COMPLIANCE.map((c) => row(\`qa-compliance-${c}\`, "compliance", [\`{run}/reports/compliance/${c}.*\`], "qa-compliance-spv")),`.
- In `SPVS`, replace `"qa-ui-specialist-spv", "qa-unit-specialist-spv",` with `"qa-ui-specialist-spv", "qa-unit-specialist-spv", "qa-compliance-spv",`.

In `packages/@qa/run-state/src/caller.ts`, replace everything from the line `// Workers whose SPV is shared across a family rather than named \`<agent>-spv\`.` through the closing `}` of `pairedSpv` (the `SHARED_SPV` map, P0b-2's doc comment and the function) with:

```ts
/**
 * The one SPV allowed to review `agent`'s work: its role-table SPV (CO-08, P2 T11), e.g. qa-compliance-spv for the six
 * compliance agents; an agent whose row names no SPV pairs with `<agent>-spv`.
 */
export function pairedSpv(agent: string): string {
  return roleOf(agent)?.spv ?? `${agent}-spv`;
}
```

- [ ] **Step 5: `SPV_NONE`, the compliance agents, the orchestrator, pipeline, policy, CLAUDE.md** — run from the worktree root:

```bash
node - <<'EOF'
const fs = require('fs');
function edit(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: expected 1 match, found ${n}: ${from.slice(0, 70)}`);
    s = s.replace(from, () => to);
  }
  fs.writeFileSync(file, s);
}
const IDS = ['iso25010', 'iso5055', 'istqb', 'cmmi', 'gdpr', 'pdpa'];
edit('packages/@qa/run-state/src/phase-map.ts', [
  [`// Agents the barrier accepts without an SPV review, each for a stated reason (P2 spec §4.6.4):
// qa-context-scanner — the Scan barrier validates target-profile.json against the strict TargetProfileSchema;
// qa-compliance-* — until qa-compliance-spv is paired in the path-guard role table (P2a, after the P0b-2 rebase);
// qa-curator — the owner reviews its proposals through /qa-promote.
// qa-metrics-collector runs without a task, so the barrier never looks it up.
export const SPV_NONE: ReadonlySet<string> = new Set([
  "qa-context-scanner",
  "qa-compliance-iso25010",
  "qa-compliance-iso5055",
  "qa-compliance-istqb",
  "qa-compliance-cmmi",
  "qa-compliance-gdpr",
  "qa-compliance-pdpa",
  "qa-curator",
]);`,
   `// Agents the barrier accepts without an SPV review, each for a stated reason (P2):
// qa-context-scanner — the Scan barrier validates target-profile.json against the strict TargetProfileSchema;
// qa-curator — the owner reviews its proposals through /qa-promote.
// qa-metrics-collector runs without a task, so the barrier never looks it up.
export const SPV_NONE: ReadonlySet<string> = new Set(["qa-context-scanner", "qa-curator"]);`],
]);
for (const id of IDS) {
  edit(`.claude/agents/compliance/qa-compliance-${id}.md`, [
    ['5. **No review yet.** No SPV reviews your task yet; the phase barrier accepts your released work report without one.',
     '5. **Review.** `qa-compliance-spv` reviews your work report. On `requested-changes` the orchestrator re-dispatches you for the same task id with the corrective instruction.'],
    ['reviewedBy:\n  none: "not stated in prose"', 'reviewedBy: qa-compliance-spv'],
  ]);
}
edit('.claude/agents/orchestrator/qa-orchestrator.md', [
  ["   | `qa-context-scanner`, `qa-compliance-*`, `qa-curator` | none yet — the barrier accepts them without a review (`SPV_NONE` in `@qa/run-state`) |",
   "   | `qa-compliance-*` (one task per regulation) | `qa-compliance-spv` |\n   | `qa-context-scanner`, `qa-curator` | none: `SPV_NONE` in `@qa/run-state`. The Scan barrier validates the profile; the owner reviews the curator's proposals. |"],
  ['  - qa-orchestrator-spv\n', '  - qa-orchestrator-spv\n  - qa-compliance-spv\n'],
]);
edit('.claude/pipeline.yaml', [
  ['spvPairs: {}\n', 'spvPairs:\n' + IDS.map((c) => `  qa-compliance-${c}: qa-compliance-spv`).join('\n') + '\n'],
  ...IDS.map((c) => [`  - {unit: qa-compliance-${c}, field: reviewedBy.none, reason: "not stated in prose"}\n`, '']),
  ['  - {unit: qa-context-scanner, field: reviewedBy.none,', '  - {unit: qa-compliance-spv, field: reviewedBy.none, reason: "SPVs are not reviewed (spec §4.5)"}\n  - {unit: qa-context-scanner, field: reviewedBy.none,'],
]);
edit('.claude/model-policy.yaml', [
  ['    - qa-dev-test-reviewer-spv\n', '    - qa-dev-test-reviewer-spv\n    # Shared compliance SPV (reviews all six compliance agents)\n    - qa-compliance-spv\n'],
]);
edit('CLAUDE.md', [
  ['| 3 — SPVs | 23 | Opus | Mirror of Tier 1/2; validate work reports |', '| 3 — SPVs | 24 | Opus | One per reviewed worker; `qa-compliance-spv` reviews the six compliance agents |'],
]);
console.log('Task 11 wiring applied');
EOF
grep -c 'reviewedBy: qa-compliance-spv' .claude/agents/compliance/*.md
```

Expected: `Task 11 wiring applied`, then each of the six files reports `1`. Step 4.3 of the orchestrator already says "dispatch its paired SPV" for every worker, and its `during Compliance` line (the during-phase anchor) and the `aegis.config.json#compliance` config anchor are untouched.

- [ ] **Step 6: Run the tests**

Run: `pnpm -F @aegis/internal-tests exec jest run-state-core run-state-submit run-state-phases p0a-final-fix role-table p2-roster agent-frontmatter alignment`
Expected: PASS. `agent-frontmatter.test.ts` passes for `qa-compliance-spv` (SPV sections: Your Role, Inputs, Review Checklist, Verdict; tools `[Read, Bash]`; tier `validation`).

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm -F @aegis/internal-tests exec jest cli-cycle-e2e stop-check stop-hook`
Expected: PASS, not skipped. The e2e's Compliance phase is reviewed by `qa-compliance-spv` through the CLI; P0b-2's H2 stop check pairs through `pairedSpv` and needs no change.

- [ ] **Step 7: The suite, the checker and the guard**

Run: `pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align`
Expected: all pass; `ratchet: ok`; 219 entries; no `SPV … pair-mismatch`, `not-paired`, `missing-spv`, `not-reciprocal`, `orphan-spv` or `PRODUCER … missing-source` key (the six lessons files exist and are listed one by one).

Run: `pnpm exec tsx scripts/check-baseline-growth.ts --base origin/main` and then `ALLOW_BASELINE_GROWTH=true pnpm exec tsx scripts/check-baseline-growth.ts --base origin/main`
Expected: the first fails with exactly `+ escapes:qa-compliance-spv:reviewedBy.none`; the second passes with that one warning. The PR carries the `baseline-growth` label.

- [ ] **Step 8: Commit**

```bash
git add .claude/agents/spv/qa-compliance-spv.md packages/@qa/path-guard/src/roles.ts packages/@qa/run-state/src/caller.ts \
  packages/@qa/run-state/src/phase-map.ts .claude/agents/compliance/qa-compliance-iso25010.md .claude/agents/compliance/qa-compliance-iso5055.md \
  .claude/agents/compliance/qa-compliance-istqb.md .claude/agents/compliance/qa-compliance-cmmi.md .claude/agents/compliance/qa-compliance-gdpr.md \
  .claude/agents/compliance/qa-compliance-pdpa.md .claude/agents/orchestrator/qa-orchestrator.md .claude/pipeline.yaml .claude/model-policy.yaml \
  CLAUDE.md __internal-tests__/run-state-core.test.ts __internal-tests__/run-state-submit.test.ts __internal-tests__/run-state-phases.test.ts \
  __internal-tests__/p0a-final-fix.test.ts __internal-tests__/cli-cycle-e2e.test.ts __internal-tests__/alignment/rules-structure.test.ts \
  __internal-tests__/role-table.test.ts __internal-tests__/p2-roster.test.ts
git commit -F - <<'EOF'
feat(p2a): qa-compliance-spv reviews the six compliance agents (AUD-052, AUD-082)

One shared reviewer, paired through the path-guard role table (T11):
the compliance rows name qa-compliance-spv, SHARED_SPV is deleted and
pairedSpv reads only the table. SPV_NONE is the scanner (strict schema)
and the curator (owner). spvPairs holds the six compliance pairs.
New escape qa-compliance-spv reviewedBy.none (baseline-growth).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 12: Compliance docs name the shared reviewer (AUD-052)

Baseline: **−1** (218 entries). Deletes `DOC-REF:HANDBOOK/08-compliance.md:qa-compliance-gdpr-spv:unknown` (AUD-052).

**Files:**
- Modify: `HANDBOOK/08-compliance.md` (§8.2 item 3 and :36, §8.9 item 4), `HANDBOOK/06-agents.md` (§6.6), `HANDBOOK/14-extending.md` (§14.3 step 3, §14.11 `spvPairs` row), `HANDBOOK/01-what-is-this.md` (SPV line)
- Modify: `__internal-tests__/p2-roster.test.ts`, `__internal-tests__/alignment/baseline.yaml`

**Interfaces:**
- Consumes: `qa-compliance-spv` and the role-table pairing (Task 11). The compliance relevance wording of HANDBOOK/01:70, 06 §6.7 and 08 §8.9 is P2b's (spec §4.9).

- [ ] **Step 1: Write the failing test** — append to `__internal-tests__/p2-roster.test.ts`:

```ts
describe('compliance review docs (AUD-052)', () => {
  it('docs name the one shared compliance reviewer and no per-regulation compliance SPV', () => {
    const hits = tracked().filter(inDocScope).filter((f) => /qa-compliance-(iso25010|iso5055|istqb|cmmi|gdpr|pdpa)-spv/.test(read(f)));
    expect(hits).toEqual([]);
    expect(read('HANDBOOK/08-compliance.md')).toContain('`qa-compliance-spv`');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest p2-roster`
Expected: FAIL — `HANDBOOK/08-compliance.md` (`qa-compliance-gdpr-spv`).

- [ ] **Step 3: Edit the docs** — run from the worktree root:

```bash
node - <<'EOF'
const fs = require('fs');
function edit(file, pairs) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: expected 1 match, found ${n}: ${from.slice(0, 70)}`);
    s = s.replace(from, () => to);
  }
  fs.writeFileSync(file, s);
}
edit('HANDBOOK/08-compliance.md', [
  ['3. **SPV compliance reviewers** — when scoring compliance agent output', '3. **The compliance reviewer** (`qa-compliance-spv`) — when reviewing compliance agent output'],
  ['will be flagged by `qa-compliance-iso25010` (reviewed by its SPV) as lacking traceability.', 'will be flagged by `qa-compliance-iso25010` (reviewed by `qa-compliance-spv`) as lacking traceability.'],
  ['4. Each annotation file is reviewed by its paired SPV (e.g., `qa-compliance-gdpr-spv`)', '4. Each annotation file is reviewed by the one shared compliance reviewer, `qa-compliance-spv`, one task at a time'],
]);
edit('HANDBOOK/06-agents.md', [
  ['SPV names follow the pattern `qa-{worker-name}-spv` — each SPV mirrors the worker it reviews.',
   'SPV names follow the pattern `qa-{worker-name}-spv` — each SPV mirrors the worker it reviews. The exception is `qa-compliance-spv`, the one reviewer of all six compliance agents.'],
  ['| `qa-test-executor-spv` | Test result fidelity | 88 |\n', '| `qa-test-executor-spv` | Test result fidelity | 88 |\n| `qa-compliance-spv` | All six compliance reports (shared reviewer) | 85 |\n'],
]);
edit('HANDBOOK/14-extending.md', [
  ['3. Create the SPV at `.claude/agents/spv/qa-compliance-{reg}-spv.md`',
   '3. Add the agent to `qa-compliance-spv` (its `reviews` list and its Inputs lessons file), set the agent\'s `reviewedBy: qa-compliance-spv`, add the pair to `pipeline.yaml#spvPairs`, and give its row `spv: "qa-compliance-spv"` in `packages/@qa/path-guard/src/roles.ts`'],
  ['| `spvPairs` | An SPV is not named `<agent>-spv` — also update `SHARED_SPV` in `packages/@qa/run-state/src/caller.ts`, or SPV reports `pair-mismatch` |',
   '| `spvPairs` | An SPV is not named `<agent>-spv` — also set the worker\'s `spv` in `packages/@qa/path-guard/src/roles.ts`, or SPV reports `pair-mismatch` |'],
]);
edit('HANDBOOK/01-what-is-this.md', [
  ['- **SPVs (Supervisors)** — twenty-two reviewer agents that audit work produced by workers and return scored feedback',
   '- **SPVs (Supervisors)** — twenty-four reviewer agents that audit work produced by workers and return scored feedback: one per reviewed worker, and `qa-compliance-spv` for all six compliance agents'],
]);
console.log('Task 12 docs edited');
EOF
```

- [ ] **Step 4: Delete the baseline key**

```bash
node - <<'EOF'
const fs = require('fs');
const f = '__internal-tests__/alignment/baseline.yaml';
const keys = new Set([
  'DOC-REF:HANDBOOK/08-compliance.md:qa-compliance-gdpr-spv:unknown',
]);
const lines = fs.readFileSync(f, 'utf8').split('\n');
const out = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^  - key: "(.*)"$/.exec(lines[i]);
  if (m && keys.delete(m[1])) { while (/^    \S/.test(lines[i + 1] ?? '')) i++; continue; }
  out.push(lines[i]);
}
if (keys.size > 0) { console.error('not in baseline: ' + [...keys].join(', ')); process.exit(1); }
fs.writeFileSync(f, out.join('\n'));
console.log('deleted');
EOF
grep -c '^  - key:' __internal-tests__/alignment/baseline.yaml
```

Expected: `deleted`, then `218` (`main` − 60).

- [ ] **Step 5: Run the tests and the checker**

Run: `pnpm -F @aegis/internal-tests exec jest p2-roster`
Expected: PASS.

Run: `pnpm --filter "@aegis-qa/cli..." run build && pnpm test && pnpm aegis align && ALLOW_BASELINE_GROWTH=true pnpm exec tsx scripts/check-baseline-growth.ts --base origin/main`
Expected: all pass; `ratchet: ok`; the guard's only growth is `escapes:qa-compliance-spv:reviewedBy.none`; every removed key justified (HANDBOOK/08 has a prose change).

- [ ] **Step 6: Commit**

```bash
git add HANDBOOK/08-compliance.md HANDBOOK/06-agents.md HANDBOOK/14-extending.md HANDBOOK/01-what-is-this.md \
  __internal-tests__/p2-roster.test.ts __internal-tests__/alignment/baseline.yaml
git commit -F - <<'EOF'
docs(p2a): HANDBOOK names the shared qa-compliance-spv (AUD-052)

HANDBOOK/08 no longer claims a per-regulation compliance SPV; 06 lists
qa-compliance-spv; 14 tells extenders to pair a new regulation through
the role table instead of SHARED_SPV. Baseline -1.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 13: Matrix housekeeping and the slice check

Baseline: **0** (218 entries; P2a total **−60** keys, **+1** escape).

**Files:**
- Modify: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md` (status cells of the rows below)

- [ ] **Step 1: Confirm no baseline entry still cites a row this task closes**

```bash
for id in AUD-046 AUD-047 AUD-048 AUD-049 AUD-050 AUD-052 AUD-082 AUD-112; do
  echo "${id} $(grep -cE "ids: \[.*\b${id}\b" __internal-tests__/alignment/baseline.yaml)"
done
```

Expected: every count is `0`. If `AUD-112` is not 0 (P0b-2 left another AUD-112 key), use `partial — … ; the rest → <owner>` for AUD-112 in Step 2 instead of `fixed`.

- [ ] **Step 2: Apply the statuses** — run from the worktree root:

```bash
node - <<'EOF'
const fs = require('fs');
const f = 'docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md';
const status = {
  'AUD-011': 'in-spec — the devops.flake-detected await left with the DevOps retirement (P2a); flaky.json from aegis rollup → P0c',
  'AUD-046': 'fixed — P2a (7 DevOps agents retired to agent-graveyard/; github and secretsRef config removed; HANDBOOK/11 states the CI and GitHub boundary)',
  'AUD-047': 'fixed — P2a (retired; agents read knowledge/synthesis through knowledge_refs)',
  'AUD-048': 'fixed — P2a (agent retired; the @qa/event-bus library stays)',
  'AUD-049': 'fixed — P0a-1 dispatches qa-orchestrator-spv for every gate task; P2a fixes the checker for a self-dispatched SPV',
  'AUD-050': 'fixed — P2a (pair retired; dashboard work is framework development)',
  'AUD-052': 'fixed — P2a (qa-compliance-spv reviews the six compliance agents; the Scan barrier strict-validates the scanner profile; the owner reviews the curator through /qa-promote)',
  'AUD-053': 'partial — docs purged of Lite (P2a); config, contracts, CLI and orchestrator → P2b',
  'AUD-074': 'partial — the qa-cicd-spv and qa-github-spv lessons lines left with the agents (P2a); the rest → P5',
  'AUD-075': 'partial — CLAUDE.md tier table and HANDBOOK/06 counts match the P2a roster (P2a); the rest → P5',
  'AUD-076': 'partial — DevOps phantom names in HANDBOOK/03 §3.6 and HANDBOOK/06 §6.5 removed (P2a); the rest → P5',
  'AUD-082': 'fixed — Bash and the CLI task protocol (P0a-2); SPV coverage (P2a)',
  'AUD-112': 'fixed — playwright.config.ts and the qa-ci-bootstrap workflows are named exceptions, the Husky hook and secrets guide are printed (P0b-2); qa-cicd-implementer retired (P2a)',
  'CO-08': 'P0a-1 / P0b-2 / P2a — fixed (SHARED_SPV deleted; SPV pairing is the path-guard role table)',
};
const done = new Set();
const out = fs.readFileSync(f, 'utf8').split('\n').map((line) => {
  const m = /^\| (AUD-\d{3}[a-z]?|CO-\d{2}) \|/.exec(line);
  if (m === null || status[m[1]] === undefined || done.has(m[1])) return line;
  done.add(m[1]);
  const cells = line.split(' | ');
  cells[cells.length - 1] = `${status[m[1]]} |`;
  return cells.join(' | ');
});
const missing = Object.keys(status).filter((id) => !done.has(id));
if (missing.length > 0) { console.error('rows not found: ' + missing.join(', ')); process.exit(1); }
fs.writeFileSync(f, out.join('\n'));
console.log(`updated ${done.size} rows`);
EOF
git diff --stat docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md
```

Expected: `updated 14 rows`; the diff changes only the last cell of those 14 rows. AUD-051, AUD-054, AUD-055 and NEW-06 stay as they are (P2b/P2c).

- [ ] **Step 3: The slice check**

```bash
pnpm install --frozen-lockfile
pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke
pnpm aegis align
pnpm aegis align --by-slice | tail -15
grep -c '^  - key:' __internal-tests__/alignment/baseline.yaml
ALLOW_BASELINE_GROWTH=true pnpm exec tsx scripts/check-baseline-growth.ts --base origin/main
git grep -nE 'qa-(github-planner|github-implementer|cicd-planner|cicd-implementer|cicd-evaluator|cicd-spv|github-spv|knowledge-librarian|event-bus|ui-designer|ui-designer-spv)\b' -- HANDBOOK HANDBOOK.md CLAUDE.md README.md 'docs/*.md' .claude
git grep -n 'D11-' -- ':!docs/superpowers' ':!agent-graveyard' ':!__internal-tests__/p2-roster.test.ts'
```

Expected: all pass, nothing skipped; `ratchet: ok`; `--by-slice` shows no P2a-owned line; `218` (`main` − 60); the guard reports no new key, one escape (`escapes:qa-compliance-spv:reviewedBy.none`) and every removed key justified; both `git grep`s print nothing.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md
git commit -F - <<'EOF'
docs(matrix): close the P2a rows (AUD-046..050, 052, 082, 112; CO-08)

AUD-053/074/075/076 partial with what P2a removed; AUD-011 keeps its
P0c rollup half. Baseline 278 -> 218 on main after P0b-2.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Definition of done (whole branch)

- [ ] `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align` pass on the rebased branch; no hook or built-CLI suite is skipped.
- [ ] Baseline **−60** keys against `main` (278 → 218 when P0b-2 merged at 278): 41 P2-owned (37 at e71d838 plus P0b-2's 4 AUD-050) and 19 side effects (AUD-076 ×12, AUD-075 ×4, AUD-074 ×2, AUD-011 ×1). **+1** escape. `ALLOW_BASELINE_GROWTH=true pnpm exec tsx scripts/check-baseline-growth.ts --base origin/main` agrees.
- [ ] PR body: label `baseline-growth` (the one escape); AUD-049 is fixed by the checker change plus the orchestrator table row; Decisions 1–13 of this plan; the P2c hand-off (decision 13). The main thread opens and merges the PR per the slice flow.

## Self-review notes

- **Spec coverage (P2a).** §4.1 retirement protocol: Tasks 3, 4, 9 (graveyard README in Task 3). §4.2.1 code and pipeline: Tasks 3, 7, 9, 11. §4.2.2 config: Task 3. §4.2.3 docs: Tasks 1, 2 (HANDBOOK/01:67 in Task 9). §4.2.4 events: Task 3. §4.3: Task 4. §4.4: Task 4. §4.5: Task 9. §4.6.1: Tasks 11, 12. §4.6.2: Task 6. §4.6.3: Task 7. §4.6.4: Tasks 7, 11. §4.6.5: Task 5. §4.7: Tasks 2, 4, 9, 11. §4.8 docs half: Task 1. §5 `SPECIAL_PHASES`: Task 10. §6 baseline: every task. §7 P2a tests: `p2-roster.test.ts` (Tasks 1–4, 7, 9, 11, 12), `run-state-core`/`run-state-submit`/`role-table`/`p0a-final-fix`/`cli-cycle-e2e`/`rules-structure` (Task 11), barrier tests (Tasks 6, 7, 11), `rules-structure` AUD-049 and T9 (Tasks 5, 10), `agent-frontmatter` (Task 11). §8 matrix edits: Task 13.
- **Simulated.** Every code block of Tasks 1–7 and 9–13 was extracted from this plan and run in order in a scratch clone of this branch (Tasks 9–11 against a stub of P0b-2's `roles.ts`, `pairedSpv` and `role-table.test.ts`), with the real checker and test suite: each failing test fails first, then the suite, `pnpm typecheck` and `pnpm aegis align` pass; the baseline deltas are −8, −6, −29, −7, −1, 0, 0; −4 (+P0b-2's 4), 0, 0, −1, with no added key and one added escape.
- **Not in P2a:** profile removal in code and config, compliance relevance, email/realtime (P2b); packages, `aegis helpers vendor`, the framework-defect channel, `secrets/README.md`'s `@qa/secrets` paragraph and the AUD-054 row (P2c).
