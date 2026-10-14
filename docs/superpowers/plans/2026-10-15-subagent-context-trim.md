# Subagent Context Trim (omitClaudeMd) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop attaching the 16 KB `CLAUDE.md` (about 4k tokens, replayed on every turn of every dispatch, about 3% of a run's tokens) to the 56 `qa-*` subagents, and give them instead a ~1.1 KB rules core through the SubagentStart hook (H4). The main thread, the human owner and every test that reads `CLAUDE.md` keep the file unchanged.

**Architecture:** Claude Code supports a per-agent frontmatter field `omitClaudeMd: true` (sub-agents docs, Claude Code 2.1.271 or later; 2.1.285 is installed): the subagent then starts without the user, project and local CLAUDE.md files. H4 (`runContextFor`, `packages/@qa/run-state/src/hook-context.ts`) already injects the run, the environment verdict, paths, writable globs, CLI-only globs and the exact CLI cheat-sheet into every `qa-*` agent; it gains a short "rules core" (target read-only, brand rule, id format, HANDBOOK/17 binding, gitignore list), built from the same constants the path-guard enforces. The flag is centralised in `.claude/model-policy.yaml` and pinned by the agent-frontmatter test. A small script measures the effect on a real dispatch transcript.

**Tech Stack:** TypeScript, jest (`__internal-tests__`), Node scripts (`scripts/`), YAML frontmatter.

**Spec:** `docs/superpowers/specs/2026-10-14-lighter-framework-design.md` (items 4 to 7, "smaller dispatch context"). Measured basis (three real runs, 2026-10-15): the first-turn prompt of every dispatch averages 22k tokens and is replayed on every later turn (19 to 20% of all prompt tokens); `CLAUDE.md` is about 4k of it, 3.0 to 3.5% of the weighted token cost. The `knowledge_refs` frontmatter is NOT loaded by Claude Code, so the planned knowledge digest saves about nothing and is dropped.

## Global Constraints

- `CLAUDE.md` stays whole and keeps working for the main thread, the owner and the developer: the only edits are two added sentences (Task 2). Option "move sections to a handbook file" is rejected: it breaks 7 tests that pin `CLAUDE.md` text and forces baseline renames for no extra saving; `@import` and `.claude/rules` were checked in the docs and give no saving (imports "don't reduce context cost"; unconditional rules load like CLAUDE.md).
- Fail-safe in both directions: a Claude Code older than 2.1.271 ignores the key and the agent still gets `CLAUDE.md` (more tokens, no lost rule); if the packages are not built, H4 gives no rules but H1 denies every write anyway (existing behaviour, so the fallback line tells the agent to read the two CLAUDE.md sections).
- The rules core states only rules that are also physically enforced or restated elsewhere: the target is read-only (H1 denies target writes), the brand rule (H1 brand pattern in `guard.ts` and the pre-gate lint), ids (the CLI mints them), the gitignore list. It must not invent a new rule.
- The brand globs in the core come from `BRAND_CLEAN_RUN_GLOBS` (`@qa/path-guard`), never a hand-copied list; a test pins H4's list to the `CLAUDE.md` brand bullets (the existing final-wave-docs check).
- H4 output stays under the truncation cap (9000 characters, `scripts/hooks/inject-run-context.mjs`); the existing test budget (6000 characters) is raised to 7000 and a test pins the largest agent's context under it.
- Never put a literal framework name into a file the customer reads: the core is hook output for agents, not a run artefact.
- Gate: `pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align` stay green; the align ratchet (207) does not grow. (In a worktree under `.claude/worktrees`, 4 tests of `customer-wording.test.ts` fail by location only; CI is their real run.)
- No backticked dotted token in agent, HANDBOOK or docs prose unless it is a registered event type (`event-type-drift.test.ts`).

## Review Focus

- A `qa-*` agent dispatched with NO active run still gets the rules core (the core is not inside the run branch of `runContextFor`).
- An agent without a role-table row (nothing writable) still gets it; a non-`qa-*` agent type gets null as today.
- The H4 text of the largest agent (the orchestrator: about 4.1k characters today) plus the core stays under 7000 characters.
- Every one of the 56 `qa-*` agent files has `omitClaudeMd: true` and the policy file says so; a new agent without it fails the frontmatter test.
- The main thread: `CLAUDE.md` unchanged in content apart from the two sentences; all pinned tests pass unchanged.
- Nested dispatch (the executor dispatching a specialist) and whether `omitClaudeMd` still applies at depth 2, and whether the auto-memory `MEMORY.md` still loads into a subagent, are NOT verified by the docs: the measurement script (Task 3) reports both after merge.
- The user-level wd-devkit SubagentStart hook (a 36 KB block persisted to a file, about 2 KB preview in context) cannot be influenced from this repo; it is reported, not changed.

---

### Task 1: The rules core in H4

**Files:**
- Modify: `packages/@qa/run-state/src/hook-context.ts` (add and export `subagentRulesLines()`; push its lines in `runContextFor` after the CLI-only line, for every `qa-*` agent whether or not a run is active; the build-missing fallback line is Task 2's `inject-run-context.mjs` edit), import `BRAND_CLEAN_RUN_GLOBS` from `@qa/path-guard` next to the existing `CLI_ONLY_RUN_GLOBS` import
- Test: `__internal-tests__/hook-context.test.ts` (extend; its budget assertion is at lines ~80-84)

**Interfaces:**
- Produces: `export function subagentRulesLines(): string[]`, the lines (in order):
  1. `## Rules core (SubagentStart hook): CLAUDE.md is not loaded into qa-* agents; these rules bind you`
  2. `- The target project is READ-ONLY: never modify its source. A fix needed in the target is a defect in your report.`
  3. `- Brand rule: never write the word "Aegis", an internal agent name (qa-*) or a framework identifier in {BRAND_CLEAN_RUN_GLOBS joined with ", "}; write as the project's own QA team. defects/, reports/closure/ and reports/compliance/ also never carry tooling words (CLI, defectMap, event sequence numbers, "framework defect", review or attempt counts, "record owner"); HANDBOOK/13 lists them.`
  4. `- Ids are {KIND}-{MODULE}-{NNN} (for example TC-AUTH-031; defects DEF-{NNN}-{MODULE}-{TYPE}); mint them with the CLI id command when your command list below has it; module codes are in module-codes.md.`
  5. `- HANDBOOK/17-operating-ruleset.md is binding for every cycle.`
  6. `- Never stage or commit secrets/.env.* (except .example), test-data/credentials/*.env.local, books/raw/* or sandbox/* (except README.md and .gitignore).`

  (About 1.1 KB. Check each rule against `CLAUDE.md` lines ~172-176, 237-262 and `HANDBOOK/13` before writing: the core restates them, it adds nothing. Use the Write tool for any file whose text contains the `.env` names: a Bash command that names them is blocked by the env-guard hook.)

- [ ] **Step 1: Write the failing test** (in `hook-context.test.ts`, with the existing helpers that call `runContextFor` on a temp root with and without an active run)

```ts
it('every qa-* agent gets the rules core, with or without an active run', () => {
  for (const withRun of [false, true]) {
    const text = runContextFor(rootOf(withRun), 'qa-ui-specialist')!;
    expect(text).toContain('CLAUDE.md is not loaded into qa-* agents');
    expect(text).toContain('READ-ONLY');
    expect(text).toContain('HANDBOOK/17-operating-ruleset.md');
    expect(text).toContain('{KIND}-{MODULE}-{NNN}');
  }
});
it('the brand globs of the core are exactly BRAND_CLEAN_RUN_GLOBS', () => {
  const text = runContextFor(rootOf(false), 'qa-test-designer')!;
  for (const g of BRAND_CLEAN_RUN_GLOBS) expect(text).toContain(g);
});
it('a non-qa agent gets null; an agent without a role row still gets the core', () => {
  expect(runContextFor(rootOf(false), 'general-purpose')).toBeNull();
});
it('the largest context (every qa-* agent type, with a run) stays under 7000 characters', () => {
  for (const agent of allQaAgentNames()) expect(runContextFor(rootOf(true), agent)!.length).toBeLessThan(7000);
});
```

(`rootOf` and `allQaAgentNames` are small helpers: reuse the root builders already in the file and list the agent names from `.claude/agents/**`; the existing `<6000` assertion becomes `<7000`.)

- [ ] **Step 2: Run it to see it fail** — `cd __internal-tests__ && npx jest hook-context` (FAIL: the core is not in the output).

- [ ] **Step 3: Implement** `subagentRulesLines()` and push it in `runContextFor` after the `CLI_ONLY_RUN_GLOBS` line and before `FRAMEWORK_DEFECT_LINE`, outside any `if (runId === null)` branch.

- [ ] **Step 4: Run it, then the whole gate** — `pnpm build && cd __internal-tests__ && npx jest hook-context hooks-final-wave final-wave-docs agent && cd .. && pnpm test && pnpm typecheck && pnpm aegis align` (207).

- [ ] **Step 5: Commit** — `git add packages __internal-tests && git commit -m "feat(hooks): the SubagentStart context carries the rules core (read-only target, brand, ids, ruleset, gitignore)"`.

---

### Task 2: `omitClaudeMd: true` on every qa-* agent, centralised and pinned

**Files:**
- Modify: all 56 `.claude/agents/**/qa-*.md` (add `omitClaudeMd: true` to the frontmatter, next to `model:` and `effort:`), `.claude/model-policy.yaml` (a top-level `omitClaudeMd: true` with a comment: qa-* agents get their rules from H4), `.claude/skills/_qa-build-agents/SKILL.md` (Behaviour step 5: also stamp `omitClaudeMd: true` from the policy; also fix its stale `config/model-policy.yaml` / `aegis/agents` paths if the test or review shows they are wrong), `scripts/hooks/inject-run-context.mjs` (the build-missing fallback adds one line: `read the Brand exposure and Read / write policy sections of CLAUDE.md before writing anything`), `CLAUDE.md` (two sentences only: in Execution flow item 6 after the H4 sentence: "H4 also carries the rules core, because `qa-*` agents start without CLAUDE.md (`omitClaudeMd`)"; and in "Adding a new agent + SPV pair" a step: "Frontmatter carries `omitClaudeMd: true` (stamped from model-policy.yaml)"), `HANDBOOK/14-*.md` or the chapter that documents agent frontmatter (one sentence; find it with `grep -rn "effort:" HANDBOOK`)
- Test: `__internal-tests__/agent-frontmatter.test.ts` (its parser keeps `fm.raw`, lines ~89-94)

**Interfaces:**
- Consumes: Task 1 (H4 carries the rules, so no agent loses a rule when it stops receiving `CLAUDE.md`).
- Produces: every `qa-*` agent has `omitClaudeMd: true`; the policy file is the single source.

- [ ] **Step 1: Write the failing test** (in `agent-frontmatter.test.ts`, using its existing per-agent loop)

```ts
it('every qa-* agent starts without CLAUDE.md: omitClaudeMd true, matching the policy', () => {
  const policy = yaml.parse(fs.readFileSync(policyPath, 'utf8'));
  expect(policy.omitClaudeMd).toBe(true);
  for (const a of agents) expect(a.fm.raw).toMatch(/^omitClaudeMd:\s*true\s*$/m);
});
it('no agent carries the key with another value, and the key sits in the frontmatter block (not the body)', () => {
  for (const a of agents) expect((a.fm.raw.match(/^omitClaudeMd:/gm) ?? []).length).toBe(1);
});
```

- [ ] **Step 2: Run it to see it fail** — `cd __internal-tests__ && npx jest agent-frontmatter` (FAIL: no agent has the key).

- [ ] **Step 3: Stamp** the key into the 56 agent files with a one-off script (Node, run once, not committed): insert `omitClaudeMd: true` on the line after `effort:` (or after `model:` when there is no effort); verify that exactly 56 files changed and that `git diff --stat` shows one added line per file. Add the key to the policy file, the skill text, the fallback line, the two `CLAUDE.md` sentences and the handbook sentence.

- [ ] **Step 4: Run the whole gate** — `pnpm build && pnpm test && pnpm typecheck && pnpm test:smoke && pnpm aegis align` (207). The pins on `CLAUDE.md` (final-wave-docs, p2-roster, p2c-packages, run-reissue-skill, reissue-descope-prose, prepare-build) must pass unchanged: the file only gained two sentences; if one fails, fix the sentence's wording, not the test.

- [ ] **Step 5: Commit** — `git add .claude scripts CLAUDE.md HANDBOOK __internal-tests && git commit -m "feat(agents): qa-* agents start without CLAUDE.md (omitClaudeMd), policy-centralised and pinned"`.

---

### Task 3: Measure it on a real dispatch: `scripts/subagent-context-check.mjs`

**Files:**
- Create: `scripts/subagent-context-check.mjs`
- Modify: `HANDBOOK/13-mechanics.md` (one paragraph: how to run the check after a framework change that touches agent context)
- Test: `__internal-tests__/subagent-context-check.test.ts` (create)

**Interfaces:**
- Produces: `node scripts/subagent-context-check.mjs [--projects-dir <dir>] [--last <n>]` which finds the newest `n` (default 3) subagent transcripts (`~/.claude/projects/<aegis project>/*/subagents/agent-*.jsonl`) and prints, for each: the agent type, whether an `instructions` attachment lists `CLAUDE.md` (`claudeMdLoaded: yes|no`), whether `MEMORY.md` is listed, whether the hook context contains the rules core (`rulesCore: yes|no`), the first assistant turn's `cache_creation + cache_read` tokens, and the number of assistant turns. Read-only; prints counts and names only, never transcript text.
- Pure helper `summariseTranscript(lines: string[]): { agentType, claudeMdLoaded, memoryLoaded, rulesCore, firstTurnTokens, turns }` (exported for the test).

- [ ] **Step 1: Write the failing test** with two small synthetic transcripts (JSONL strings) in the shape the research measured: an `attachment` record with `type: "instructions"` and `files: [{path: ".../CLAUDE.md", ...}, {path: ".../MEMORY.md"}]`, an `attachment` with `hook_additional_context` text, and assistant records with `message.usage`. Assert that a transcript listing CLAUDE.md gives `claudeMdLoaded: true`, one without it gives `false`, the rules-core detection keys on the heading line `Rules core (SubagentStart hook)`, `firstTurnTokens` sums the first assistant usage, `turns` counts assistant records, and malformed lines are skipped without throwing. (Read one real subagent transcript under `~/.claude/projects/-Users-lukydwisaputra-Desktop-QA-aegis/*/subagents/` read-only first to confirm the exact record field names: `attachment.type`, `files[].path`, the hook-context record shape; adjust the synthetic fixtures to the real shape.)

- [ ] **Step 2: Run it to see it fail** — `cd __internal-tests__ && npx jest subagent-context-check`.

- [ ] **Step 3: Implement** the helper and the CLI wrapper; HANDBOOK/13 paragraph: "after merging a change that touches agent frontmatter or hook context, dispatch one `qa-context-scanner` with no active run, then run the script: expect `claudeMdLoaded: no`, `rulesCore: yes` and a first-turn drop of about 4k tokens against the earlier baseline of about 21-24k; if `memoryLoaded` is still yes, that is the user's auto memory and is expected".

- [ ] **Step 4: Run it, then the whole gate** — `pnpm build && cd __internal-tests__ && npx jest subagent-context-check && cd .. && pnpm test && pnpm typecheck && pnpm test:smoke && pnpm aegis align` (207). Then, read-only, run the script against the existing real transcripts and put the output in the report (it shows the BEFORE state: `claudeMdLoaded: yes`, `rulesCore: no`).

- [ ] **Step 5: Commit** — `git add scripts HANDBOOK __internal-tests && git commit -m "feat(scripts): subagent-context-check reports what a dispatched agent actually loads"`.

---

## Self-review

- Coverage: the rules core (Task 1), the flag everywhere with policy and test (2), the measurement and the validation procedure the docs cannot give (3).
- Placeholders: the test sketches name their helpers (`rootOf`, `allQaAgentNames`, the agent loop of the frontmatter test); the implementer reads the existing test files to reuse them, as in earlier plans.
- Types: `subagentRulesLines`, `summariseTranscript` keep the same names across tasks.

## Known limits (stated, not hidden)

- Whether `omitClaudeMd` is honoured for nested dispatches (executor to specialist) and whether `MEMORY.md` still loads are unverified until Task 3's script runs on real dispatches after merge.
- The first dispatch after merge in a Claude Code session started BEFORE the merge may still use the old agent definitions (agents load at session start): restart the session before measuring.
- The user-level wd-devkit hook (about 550 tokens per dispatch) is outside this repo.
- The saving is the file's weight (about 3.7k tokens net per turn, 2.7 to 3.2% of weighted tokens), not a change in what agents are asked to do.
