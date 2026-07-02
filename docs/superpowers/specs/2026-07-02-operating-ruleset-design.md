# Aegis 4-Phase Operating Ruleset — Design

**Date:** 2026-07-02
**Status:** Approved (design)
**Enforcement model:** Full — rules encoded into agent `## Process` + `## Quality Standards` blocks (SPVs reject violations), gates added to `qa-start`/orchestrator, and documented in a new HANDBOOK chapter.

---

## Goal

Formalize a 4-phase QA operating standard and make it enforceable. The four phases:

1. **Preparation** — analyze the project, point Aegis at exactly one target, health-check before any cycle.
2. **Planning** — build the run plan for maximum coverage; mandate sandbox-first exploration before writing any real test script.
3. **Test Case Development** — author a complete case set (Gherkin for flows, acceptance/rejection/edge cases) grouped as User Story → Scenario → Test Case, with reusable seed data and logical ordering.
4. **Execution & Defect Handling** — all scripts under target `tests/qa/[subfolder]`; confirm a defect originates from development (not test setup/env/seed) before logging; results must be stand-behind accurate.

## Non-goals

- No new `@qa/ruleset` validator package (prose enforcement via SPVs is sufficient for now).
- No new agents (so no `model-policy.yaml` change).
- Not selecting/migrating a live target in this work — the ruleset ships target-agnostic; the preflight gate refuses to run until pointed at one repo.
- Not touching developer unit tests or the developer's `tests/` tree.

## Design decisions (locked)

| Decision | Choice |
|----------|--------|
| Enforcement depth | Full — Process + Quality Standards + gates + HANDBOOK |
| Test-case shape | Gherkin required only for flow cases (`testType` Functional/E2E + `testTechnique:["Flow"]`); technique-derived cases (BVA/EP) keep current step format; add Story→Scenario→Case hierarchy |
| Sandbox-first | Hard SPV gate; artifact kept lightweight so trivial derived cases satisfy cheaply |
| Defect-origin | Mandatory `originConfirmation` block on every defect record; SPV rejects if missing/failing |
| Test output path | Nest all Aegis output under target `tests/qa/`; never write developer `tests/` outside `tests/qa/` |
| Unit testing | Developer scope — `qa-unit-specialist` becomes read-only on dev units, reports coverage gaps as findings |
| VSCode discovery | `qa-environment-engineer` must write a discoverable `playwright.config.ts` (`testDir` includes `tests/qa`, plus `testMatch` and a named QA Playwright project) |

## Why this is a net improvement (review findings)

- **Defect-origin confirmation** closes a real false-positive hole: `qa-defect-manager` currently runs variation testing but never rules out test-side cause. Added as Process step 0 (before variation testing).
- **Sandbox-first** is the biggest win: attacks flaky-test root cause (guessed selectors, unverified timing) by requiring exploration before a spec is committed.
- **VSCode-discoverable config** fixes an actual observed bug: env-engineer produced configs the IDE Test Explorer could not see (root cause: no loaded `playwright.config.ts` had `testDir` pointing at the QA specs; the target root was a multi-project parent folder).
- **Story→Scenario→Case hierarchy** fills a genuine structural gap (only a flat `storyId` exists today).
- Additional refinements folded in:
  - **B — scenario-owned seed:** shared seed declared once at `scenario.sharedSeed{}`, reused across the scenario's flows.
  - **C — "stand behind results" made concrete:** no assertion-free specs (≥1 web-first assertion each); every defect carries reproduction evidence + `originConfirmation`.
  - **A — flaky discipline:** ui/responsive specialists forbid `waitForTimeout`/hard sleeps; web-first assertions only.
  - **D — developer territory:** path-guard already narrows writes to `testsDir`; setting `testsDir` to `tests/qa` makes developer `tests/` non-writable for free. Locked with a guard test.

---

## Architecture — where each rule gets teeth

Rules live where the framework already enforces them: the paired `## Process` (numbered steps) + `## Quality Standards (SPV rejects if violated)` blocks in each agent file, mirrored by a check in the matching SPV. `aegis.config.json` holds machine-readable knobs. `packages/@qa/path-guard` hard-enforces the write allowlist. HANDBOOK is the narrative index.

### Section 1 — Canonical doc
- **New:** `HANDBOOK/09-operating-ruleset.md` — binding 4-phase standard; each rule cross-linked to the enforcing agent/SPV.
- Regenerate TOC via `_qa-build-toc`.
- Add a short pointer in root `HANDBOOK.md` and a one-line "Operating ruleset" mention in `CLAUDE.md`.

### Section 2 — Phase 1: Preparation (health + single-target gates)
- **`aegis.config.json`:** `testsDir` → `"../<target>/tests/qa"` (set at target-selection time, not hardcoded); add a `preCycleHealthCheck: true` knob.
- **`.claude/skills/qa-start/SKILL.md`** + **`qa-orchestrator.md`:** mandatory pre-cycle step — abort (`PreflightFailed`, halt) if `targetProjectRoot` resolves to a multi-project parent (heuristic: >1 nested `playwright.config.*`, or no `package.json` at the resolved root) OR if `/qa-health` fails. Hard gate.
- **`scripts/reset-target.sh`:** default `--tests-dir` to `tests/qa`; print single-target reminder.
- **`qa-context-scanner.md`:** assert single-target during scan; write `targetIsSingleProject: bool` into `target-profile.json`.

### Section 3 — Phase 2: Sandbox-first (hard SPV gate)
- **All Tier-2 writing specialists** (ui, api, database, accessibility, responsive, realtime, email, performance): Process step — explore in `sandbox/{date}-{slug}/` before writing the final spec; emit `SandboxExplored{ specialist, artifactPath, targetSpecRef }`.
- **Their SPVs:** reject a final spec under `tests/qa/**` with no matching `SandboxExplored` event/artifact. Artifact is lightweight (a scratch `.ts` + notes).
- **`sandbox/README.md`** + **`HANDBOOK/04-stlc-walkthrough.md` §4.7:** document the sandbox-before-write mandate (extends today's exploratory-only meaning).

### Section 4 — Phase 3: Story→Scenario→Case + Gherkin-for-flows + scenario-seed
- **`qa-test-designer.md`:**
  - Schema hierarchy: `storyId` → `scenarioId` → `id`. New per-scenario file `runs/{runId}/scenarios/{SCN-ID}.json` grouping its TCs. RTM gains a `scenarioId` column.
  - Gherkin for flows: TCs with `testType` in {Functional, E2E} and `testTechnique:["Flow"]` MUST include a `gherkin` block (Given/When/Then). Technique-derived cases keep current step format. Kaner engine unchanged — still decides which cases exist.
  - Each scenario enumerates acceptance cases, rejection (negative) cases, and edge cases; SPV rejects a scenario missing any applicable category.
  - Scenario-owned seed: `scenario.sharedSeed{}` declared once; member TCs reference it.
  - Logical ordering: TCs carry `order`; scenario emits a runnable sequence.
- **`qa-test-designer-spv.md`:** Quality Standards for hierarchy completeness, Gherkin-on-flows, acceptance/rejection/edge presence, shared-seed integrity.

### Section 5 — Phase 4: Execution & defect origin + territory + discoverable config
- **`qa-environment-engineer.md`:** MUST write target `playwright.config.ts` with `testDir` resolving to `tests/qa`, a `testMatch` glob, and a named QA Playwright project so VSCode Test Explorer discovers specs. Emit `TestConfigWritten`. SPV rejects if absent or `testDir` excludes `tests/qa`.
- **All writing specialists:** final path rule → `tests/qa/[subfolder]/...` only (path-guard already enforces via `testsDir`).
- **`qa-unit-specialist.md`:** read-only on developer units — reports coverage gaps as findings, never writes/edits dev unit tests. SPV rejects any write under developer `tests/` outside `tests/qa/`.
- **`qa-defect-manager.md`:** new Process step 0 — origin confirmation (before variation testing): rule out test-setup, env, seed-data; require clean-state reproduction. Add `originConfirmation{ ruledOut:[...], reproducedOnClean:bool, evidenceRef }` to every defect record. SPV rejects any defect missing a passing `originConfirmation`.
- **Stand-behind (finding C):** Quality Standard across specialists — no assertion-free specs; every reported defect carries reproduction evidence + `originConfirmation`.
- **Flaky discipline (finding A):** ui/responsive specialists — forbid `waitForTimeout`/hard sleeps; web-first assertions only.

### Section 6 — path-guard test lock
- **`packages/@qa/path-guard/` (`__internal-tests__`):** assert that with `testsDir=../<target>/tests/qa`, a write to `<target>/tests/unit/foo.spec.ts` is blocked while `<target>/tests/qa/...` is allowed. Locks the developer-territory boundary. (No production code change — `testsDir` is already the single write knob at `src/index.ts:59`.)

### Section 7 — build steps
- No frontmatter `modelTier` changes → `_qa-build-agents` not required.
- Run `_qa-build-toc` for the new chapter.

---

## Enforcement / gate severities

All four gates hard-reject, but tuned so cycles don't grind:
- **Health + single-target:** hard preflight; blocks the whole cycle (cheap, runs once).
- **Sandbox-first:** hard, but artifact is lightweight — trivial derived cases satisfy with a scratch file + note.
- **Defect-origin:** hard, but reuses existing evidence capture.
- **Gherkin/hierarchy:** hard only for flow cases; technique cases unaffected.

## Files touched (~14)

New chapter `HANDBOOK/09-operating-ruleset.md`; `aegis.config.json`; `qa-start/SKILL.md`; `qa-orchestrator.md`; `qa-context-scanner.md`; `scripts/reset-target.sh`; `qa-test-designer.md` + spv; `qa-defect-manager.md`; `qa-environment-engineer.md`; `qa-unit-specialist.md`; ~7 specialist Quality-Standards edits; path-guard `__internal-tests__` case; `CLAUDE.md` pointer; `HANDBOOK/04-stlc-walkthrough.md` + `sandbox/README.md`.

## Open item

Single-target migration ships as (a): leave `targetProjectRoot` as-is; add the rule + preflight gate that refuses to run until pointed at one repo. Point it at a real target when actually testing (via `reset-target.sh`).

## Testing / verification

- `pnpm -F @qa/path-guard test` (new boundary case passes).
- `pnpm qa-health` clean.
- `pnpm qa-build-toc` regenerates HANDBOOK TOC with the new chapter.
- Spot-check: each edited SPV's Quality Standards list contains the new reject condition.
