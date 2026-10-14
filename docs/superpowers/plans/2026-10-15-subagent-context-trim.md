# Subagent Context Trim (omitClaudeMd) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop attaching the 17.9 KB `CLAUDE.md` (about 4k tokens, replayed on every turn of every dispatch, about 3% of a run's weighted tokens) to the 56 `qa-*` subagents, and give them instead a ~1.2 KB rules core through the SubagentStart hook (H4). The main thread, the human owner and every test that reads `CLAUDE.md` keep the file unchanged.

**Architecture:** Claude Code supports a per-agent frontmatter field `omitClaudeMd: true`: the subagent then starts without the user, project and local `CLAUDE.md` files. H4 (`runContextFor`, `packages/@qa/run-state/src/hook-context.ts`) already injects the run, the environment verdict, paths, writable globs, CLI-only globs and the exact CLI cheat-sheet into every `qa-*` agent; it gains a short rules core (the target's source is read-only, the brand and tooling-word rules, ids are minted by the CLI, HANDBOOK/17 is binding, the gitignore list), built from the constants the path-guard enforces. The flag is centralised in `.claude/model-policy.yaml` and pinned by the agent-frontmatter test. A script measures the effect on real dispatch transcripts.

**Tech Stack:** TypeScript, jest (`__internal-tests__`), `tsx` scripts (`scripts/*.ts`, the repo convention), YAML frontmatter.

**Spec:** `docs/superpowers/specs/2026-10-14-lighter-framework-design.md` (items 4 to 7, "smaller dispatch context"). Measured basis (three real runs, 2026-10-15): the first-turn prompt of every dispatch averages 22k tokens and is replayed on every later turn (19 to 20% of all prompt tokens); `CLAUDE.md` is about 4k of it. The `knowledge_refs` frontmatter is NOT loaded by Claude Code, so the planned knowledge digest saves about nothing and is dropped.

**Docs verified by the plan review (2026-10-15)** (https://code.claude.com/docs/en/sub-agents and https://code.claude.com/docs/en/memory): the frontmatter table says `omitClaudeMd`: "Set to `true` to start this subagent without the user, project, and local CLAUDE.md files in its initial context; managed policy files still load ... Requires Claude Code v2.1.271 or later"; "A nested subagent is configured the same way as a top-level one and resolves from the same scopes"; project `.claude/rules` are part of the dropped hierarchy; "a subdirectory's CLAUDE.md and matching path-scoped rules still load when the subagent works with files there"; imports "don't reduce its context cost". Installed Claude Code is 2.1.285 (the real runs used 2.1.296). There is no managed policy file, no `~/.claude/CLAUDE.md`, no `AGENTS.md` and no `.claude/rules` here. The docs say the auto-memory `MEMORY.md` is not loaded into subagents, but real `qa-*` transcripts show it loaded (type `AutoMem`): a docs-versus-observed conflict that Task 3 measures.

## Global Constraints

- The Territory rule sentence "Framework work by subagents happens in a git worktree outside this directory" is a bug found 2026-10-15: the path-guard (`guard.ts` inNativeWorktree/inCheckout, `context.ts` A13) only treats `{aegisRoot}/.claude/worktrees/<name>` as a separate checkout, so a worktree outside the directory (a stray `aegis-worktrees` folder was created next to the repo, and one for the renci clone) is treated as target source and every non-qa subagent write there fails. Task 2 corrects the sentence and ignores `.claude/worktrees/` in `.gitignore`.
- `CLAUDE.md` stays whole: the only edits are two added sentences and one corrected sentence (Task 2). Moving sections to another file is rejected: it breaks 7 tests that pin `CLAUDE.md` text and forces baseline renames for no extra saving.
- Fail-safe both ways: a Claude Code older than 2.1.271 ignores the key and the agent still gets `CLAUDE.md` (more tokens, no lost rule); if the packages are not built, H1 denies every write anyway (existing behaviour); if `runContextFor` throws at run time (the catch in `inject-run-context.mjs`, around line 29, where the build exists and H1 permits writes), the rules core is still delivered there.
- The rules core states only rules that are also physically enforced or restated elsewhere (H1 denies target source writes and brand patterns; the pre-gate lint; the CLI mints ids). It must not invent a rule, and it must not contradict the agents' write rights: the QA tests directory lives INSIDE the target and `qa-environment-engineer` may write the named `playwright.config.ts` entry, so the rule is "the target's SOURCE is read-only", not "the target is read-only".
- The brand and tooling globs come from `BRAND_CLEAN_RUN_GLOBS` and `TOOLING_CLEAN_RUN_GLOBS` (`@qa/path-guard`, `guard.ts:53,56`), never a hand-copied list; the project name for the "write as the {project} QA team" line comes from the config already loaded in `runContextFor` (`dashboard.projectName`), with a neutral fallback.
- Other tests assert that H4 must NOT contain `run create`, `phase start`, `run reissue`, `run descope`, `defect amend`, `metrics defects`, `metrics coverage`, `metrics rollups` or `/pnpm (install|build)/`: the core must not either.
- H4 output stays under the truncation cap (9000 characters, `inject-run-context.mjs`). Measured today: 3281 to 4110 characters without a run, up to 4455 with one; the core adds about 1200: worst case about 5.7k. The existing test budget (6000) is raised to 7000.
- The core's heading says CLAUDE.md "may not be loaded" (true on older Claude Code and between the two commits), never "is not loaded".
- Gate: `pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && pnpm aegis align` stay green; the align ratchet (207) does not grow. (In a worktree under `.claude/worktrees`, 4 tests of `customer-wording.test.ts` fail by location only; CI is their real run.)
- No backticked dotted token in agent, HANDBOOK or docs prose unless it is a registered event type (`event-type-drift.test.ts`).
- The `_qa-build-agents` skill has stale paths that are pinned in the alignment baseline (`CONFIG:_qa-build-agents:config/model-policy.yaml:missing`, `SKILL:...:unresolved`, `WRITE-POLICY:...:agents/**:not-writable`): do NOT fix them here (a fixed entry turns stale and fails the ratchet); edit only the prose of its Behaviour step 5.

## Review Focus

- A `qa-*` agent dispatched with NO active run still gets the rules core (it is not inside the run branch of `runContextFor`); an agent type without a role row (`qa-no-such-agent`) still gets it; a non-`qa-*` type gets null as today.
- The H4 text of every agent (with and without a run) stays under 7000 characters.
- Every one of the 56 `qa-*` agent files has `omitClaudeMd: true` exactly once in its frontmatter block, and the policy file says so; a new agent without it fails the test.
- The main thread: `CLAUDE.md` unchanged apart from two sentences; every pinned test passes unchanged.
- In the real runs, `qa-*` agents ran at spawn depth 2 or 3 (11 of the newest 400 slec dispatches were depth 1): the docs say nested subagents resolve the same way, but only a depth-2+ transcript proves it: Task 3's script reports `spawnDepth` and the plan requires one such sample.
- The target copies (renci, slec) receive the change only when their aegis checkout pulls it.
- The user-level wd-devkit SubagentStart hook (a 36 KB block persisted to a file, about 2 KB preview in context) cannot be influenced from this repo; it is reported, not changed.

---

### Task 1: The rules core in H4

**Files:**
- Modify: `packages/@qa/run-state/src/hook-context.ts` (add and export `subagentRulesLines(projectName?: string)`; push its lines in `runContextFor` after the CLI-only line and before `FRAMEWORK_DEFECT_LINE`, for every `qa-*` agent, outside the run branch; import `BRAND_CLEAN_RUN_GLOBS` and `TOOLING_CLEAN_RUN_GLOBS` from `@qa/path-guard` next to the existing `CLI_ONLY_RUN_GLOBS` import: run-state already depends on path-guard, no cycle), `scripts/hooks/inject-run-context.mjs` (in the catch around line 29, when `runContextFor` throws, prepend `rs.subagentRulesLines().join("\n")` to what the hook prints; the build-missing branch around line 22 already tells the agent every write is denied and to stop: leave it)
- Test: `__internal-tests__/hook-context.test.ts` (extend; the file uses `t` from `beforeEach` and an async `create()`; its budget assertion is at lines ~80-84)

**Interfaces:**
- Produces: `export function subagentRulesLines(projectName?: string): string[]`, the lines in order:
  1. `## Rules core (SubagentStart hook): CLAUDE.md may not be loaded into qa-* agents; these rules bind you`
  2. `- The target's source is READ-ONLY: write only the globs listed below (QA tests under the tests directory; the environment engineer's playwright.config.ts entry is the one named exception). A fix needed in target source is a defect in your report.`
  3. `- Brand rule: inside the run directory, never write the word "Aegis", an internal agent name (qa-*) or a framework identifier in {BRAND_CLEAN_RUN_GLOBS joined with ", "}; write as the {projectName ?? "project's"} QA team. Files under {TOOLING_CLEAN_RUN_GLOBS joined with ", "} also never carry tooling words (CLI, defectMap, event sequence numbers, "framework defect", review or attempt counts, "record owner"); HANDBOOK/13 lists them.`
  4. `- Mint every id with the CLI id command (never hand-number); the id formats are {KIND}-{MODULE}-{NNN} (for example TC-AUTH-031) and DEF-{NNN}-{MODULE}-{TYPE}; module codes are in module-codes.md.`
  5. `- HANDBOOK/17-operating-ruleset.md is binding for every cycle.`
  6. `- Never stage or commit secrets/.env.* (except .example), test-data/credentials/*.env.local, books/raw/* or sandbox/* (except README.md and .gitignore).`

  (Check each rule against `CLAUDE.md` lines ~172-176, 233-262 and `HANDBOOK/13` before writing: the core restates them, it adds nothing. Use the Write tool for any file whose text contains the `.env` names: a Bash command that names them is blocked by the env-guard hook.)

- [ ] **Step 1: Write the failing test** (async, using the file's `t` and `create()`; check before and after `create()` for the no-run and run cases)

```ts
it('every qa-* agent gets the rules core, with or without an active run, and an agent without a role row too', async () => {
  const check = (text: string | null) => {
    expect(text).toContain('CLAUDE.md may not be loaded into qa-* agents');
    expect(text).toContain("target's source is READ-ONLY");
    expect(text).toContain('HANDBOOK/17-operating-ruleset.md');
    expect(text).toContain('{KIND}-{MODULE}-{NNN}');
  };
  check(runContextFor(t.root, 'qa-ui-specialist'));
  check(runContextFor(t.root, 'qa-no-such-agent'));
  await create();
  check(runContextFor(t.root, 'qa-ui-specialist'));
});
it('the brand and tooling globs of the core are exactly the path-guard constants', () => {
  const text = runContextFor(t.root, 'qa-test-designer')!;
  for (const g of [...BRAND_CLEAN_RUN_GLOBS, ...TOOLING_CLEAN_RUN_GLOBS]) expect(text).toContain(g);
});
it('a non-qa agent gets null', () => {
  expect(runContextFor(t.root, 'general-purpose')).toBeNull();
});
it('the core never contains the commands other tests forbid in H4', () => {
  const text = runContextFor(t.root, 'qa-test-designer')!;
  for (const f of ['run create', 'phase start', 'run reissue', 'run descope', 'defect amend', 'metrics defects', 'metrics coverage', 'metrics rollups']) expect(text).not.toContain(f);
  expect(text).not.toMatch(/pnpm (install|build)/);
});
it('every qa-* agent type (with a run) stays under 7000 characters', async () => {
  await create();
  for (const agent of qaAgentNames()) expect(runContextFor(t.root, agent)!.length).toBeLessThan(7000);
});
```

(`qaAgentNames()` lists `.claude/agents` with `readdirSync(dir, { recursive: true })`, keeps files named `qa-*.md` and skips the `temp/` directory; the existing `<6000` assertion becomes `<7000`; import `BRAND_CLEAN_RUN_GLOBS` and `TOOLING_CLEAN_RUN_GLOBS` from `@qa/path-guard`.)

- [ ] **Step 2: Run it to see it fail** — `cd __internal-tests__ && npx jest hook-context` (FAIL: the core is not in the output).

- [ ] **Step 3: Implement** `subagentRulesLines()` and the push in `runContextFor`; pass the project name from the already-loaded guard context when it is available (`ctx` in `runContextFor`; check which field holds `dashboard.projectName`, else read it with `readRunConfig`), with the neutral fallback when it is not; add the catch prepend in `inject-run-context.mjs`.

- [ ] **Step 4: Run it, then the whole gate** — `pnpm build && cd __internal-tests__ && npx jest hook-context hooks-final-wave final-wave-docs agent && cd .. && pnpm test && pnpm typecheck && pnpm aegis align` (207).

- [ ] **Step 5: Commit** — `git add packages scripts __internal-tests && git commit -m "feat(hooks): the SubagentStart context carries the rules core (read-only target source, brand, ids, ruleset, gitignore)"`.

---

### Task 2: `omitClaudeMd: true` on every qa-* agent, centralised and pinned

**Files:**
- Modify: all 56 `.claude/agents/**/qa-*.md` (add `omitClaudeMd: true` to the frontmatter block), `.claude/model-policy.yaml` (a top-level `omitClaudeMd: true` AFTER the `assignments:` block, with a comment: qa-* agents get their rules from H4), `.claude/skills/_qa-build-agents/SKILL.md` (prose of Behaviour step 5 only: also stamp `omitClaudeMd: true` from the policy; note that the skill scans `*.yaml`/`*.json`, so for the `.md` agent files the stamp is applied by the build script or by hand; do NOT touch its stale paths), `CLAUDE.md` (two added sentences and one corrected sentence only: in Execution flow item 6 after the H4 sentence: "H4 also carries the rules core, because `qa-*` agents start without CLAUDE.md (`omitClaudeMd`)"; and in "Adding a new agent + SPV pair" a step: "Frontmatter carries `omitClaudeMd: true` (stamped from model-policy.yaml)"; and the corrected sentence at the end of the Territory rule, which today tells agents to create the worktree outside this directory: "Framework work by subagents happens in a git worktree INSIDE this directory at `.claude/worktrees/<name>`, the only place the path-guard recognises as a separate checkout; never create a worktree outside this directory"), `.gitignore` (add `.claude/worktrees/`: today it is excluded only by each clone's local `.git/info/exclude`), `docs/D13-model-policy.md` (~line 36, the "Inject model/effort" step: also the flag) and `HANDBOOK/14-extending.md` (the frontmatter template at ~22-31: add the key)
- Test: `__internal-tests__/agent-frontmatter.test.ts` (it uses `parseFrontmatter`, `parseYaml`, `MODEL_POLICY_PATH`, an `agents` list of `{path, relPath, tierDir}` and a `describe.each(agents)` block with a local `fm`, around line 286; `fm.raw` is a `Record<string,string>`)

**Interfaces:**
- Consumes: Task 1 (H4 carries the rules, so no agent loses a rule when it stops receiving `CLAUDE.md`).
- Produces: every `qa-*` agent has `omitClaudeMd: true`; the policy file is the single source.

- [ ] **Step 1: Write the failing test** (inside the existing `describe.each(agents)` and next to the policy tests)

```ts
it('starts without CLAUDE.md: omitClaudeMd true, exactly once, in the frontmatter block', () => {
  expect(fm.raw['omitClaudeMd']).toBe('true');
  const source = readFileSync(path, 'utf-8');
  const block = source.slice(0, source.indexOf('\n---\n', 4));
  expect((block.match(/^omitClaudeMd:/gm) ?? []).length).toBe(1);
});
it('the policy says qa-* agents start without CLAUDE.md', () => {
  expect(parseYaml(readFileSync(MODEL_POLICY_PATH, 'utf-8')).omitClaudeMd).toBe(true);
});
```

(Use the file's own variable names for the agent path and source; if `fm`/`path` are named differently inside the block, follow the file.)

- [ ] **Step 2: Run it to see it fail** — `cd __internal-tests__ && npx jest agent-frontmatter` (FAIL: no agent has the key).

- [ ] **Step 3: Stamp** the key into the 56 agent files with a one-off Node script (run once, not committed): insert `omitClaudeMd: true` on the line after `effort:` (or after `model:` when there is no effort line); read a few real frontmatter blocks first for variance (agents without `effort:`, CRLF) and handle it; verify that exactly 56 files changed and that `git diff --stat` shows one added line per file. Add the key to the policy file, the skill prose, the two `CLAUDE.md` sentences and the two doc edits.

- [ ] **Step 4: Run the whole gate** — `pnpm build && pnpm test && pnpm typecheck && pnpm test:smoke && pnpm aegis align` (207). The pins on `CLAUDE.md` (final-wave-docs, p2-roster, p2c-packages, run-reissue-skill, reissue-descope-prose, prepare-build) must pass unchanged: the file only gained two sentences; if one fails, fix the sentence's wording, not the test.

- [ ] **Step 5: Commit** — `git add .claude docs HANDBOOK CLAUDE.md __internal-tests && git commit -m "feat(agents): qa-* agents start without CLAUDE.md (omitClaudeMd), policy-centralised and pinned"`.

---

### Task 3: Measure it on real dispatches: `scripts/subagent-context-check.ts`

**Files:**
- Create: `scripts/subagent-context-check.ts` (run with `tsx`, the repo convention; export the pure helper for the test)
- Modify: `package.json` (a script `"subagent-context-check": "tsx scripts/subagent-context-check.ts"`), `HANDBOOK/13-mechanics.md` (one paragraph: the procedure below)
- Test: `__internal-tests__/subagent-context-check.test.ts` (create; imports `summariseTranscript` from `../scripts/subagent-context-check`, as `gen-index.test.ts` does)

**Interfaces:**
- Produces: `pnpm subagent-context-check [--projects-dir <dir>] [--last <n>]` which reads Claude Code's per-subagent transcripts (`<projects-dir>/*/subagents/agent-*.jsonl` and the sibling `agent-*.meta.json`), keeps those whose `meta.agentType` matches `^qa-` (the default project directory holds 453 transcripts and zero `qa-*`: the real runs live in the target copies, for example `~/.claude/projects/-Users-lukydwisaputra-Desktop-QA-slec-visitor-management-aegis`), and prints for the newest `n` (default 5): agent type, `spawnDepth`, `claudeMdLoaded`, `memoryLoaded`, `rulesCore`, `firstTurnTokens`, `turns`. Read-only; prints counts and names only, never transcript text.
- Pure helper `summariseTranscript(lines: string[], meta: { agentType: string; spawnDepth?: number }): { agentType, spawnDepth, claudeMdLoaded, memoryLoaded, rulesCore, firstTurnTokens, turns }`.
- Record shapes (found by inspecting real transcripts; re-check one before coding): agent type and depth are in the sibling `agent-*.meta.json` (`agentType`, `spawnDepth`, `parentAgentId`), NOT in the JSONL; the instructions attachment is `attachment.files[]` of `{path, type, content}` with `type` `"Project"` (CLAUDE.md) or `"AutoMem"` (MEMORY.md): key on `type`, with the path suffix as a fallback; the hook context is an attachment with `hookEvent: "SubagentStart"` whose `content` is a `string[]`, one item per hook: scan every item for the heading `Rules core (SubagentStart hook)`; assistant records repeat per API message (32 records but 22 distinct `message.id` in one orchestrator transcript): `turns` = the number of distinct `message.id`, and `firstTurnTokens` = the first message id's `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`, counted once.

- [ ] **Step 1: Write the failing test** with small synthetic transcripts in the real shape: (a) an `instructions` attachment listing a `Project` file and an `AutoMem` file, a `SubagentStart` hook attachment with `content: ["other hook", "## Rules core (SubagentStart hook) ..."]`, and assistant records where one message id appears twice with usage; (b) a transcript without the `Project` file. Assert `claudeMdLoaded` true/false, `memoryLoaded`, `rulesCore` detection across all content items, `firstTurnTokens` counting a duplicated message id once, `turns` counting distinct ids, `spawnDepth` from the meta, and that malformed lines are skipped without throwing.

- [ ] **Step 2: Run it to see it fail** — `cd __internal-tests__ && npx jest subagent-context-check`.

- [ ] **Step 3: Implement** the helper, the file walker (newest first by mtime) and the CLI wrapper; HANDBOOK/13 paragraph: "after merging a change that touches agent frontmatter or hook context: restart the Claude Code session (agents load at session start), run one `/qa-smoke` (its agents run at depth 2 and 3), then `pnpm subagent-context-check --projects-dir <target copy's project dir>`: expect `claudeMdLoaded: no`, `rulesCore: yes` and a first-turn drop of about 4k tokens against the earlier baseline of about 21-24k at depth 1 AND at depth 2+; `memoryLoaded: yes` is the user's auto memory (docs say not loaded; observed loaded); the target copies get the change only when their aegis checkout pulls it".

- [ ] **Step 4: Run it, then the whole gate** — `pnpm build && cd __internal-tests__ && npx jest subagent-context-check && cd .. && pnpm test && pnpm typecheck && pnpm test:smoke && pnpm aegis align` (207). Then, read-only, run the script against the existing real transcripts of a target copy (`--projects-dir` of the slec project) and put the output in the report: it is the BEFORE state (`claudeMdLoaded: yes`, `rulesCore: no`) at depth 1 and at depth 2+.

- [ ] **Step 5: Commit** — `git add scripts package.json HANDBOOK __internal-tests && git commit -m "feat(scripts): subagent-context-check reports what a dispatched agent actually loads"`.

---

## Self-review

- Coverage: the rules core (Task 1), the flag everywhere with policy and test (2), the measurement and the validation procedure the docs cannot give (3), including the depth-2+ and target-copy facts found by the plan review.
- Placeholders: the test sketches name the helpers that exist in the files they extend (`t`, `create`, `describe.each(agents)`, `parseYaml`, `MODEL_POLICY_PATH`); the implementer reads those files to reuse them, as in earlier plans.
- Types: `subagentRulesLines`, `summariseTranscript` keep the same names across tasks.

## Known limits (stated, not hidden)

- Whether `omitClaudeMd` is honoured for nested dispatches is documented but not yet observed: the first depth-2+ transcript after merge settles it (Task 3).
- Agents load at session start: a session started before the merge still uses the old definitions.
- The user-level wd-devkit hook (about 550 tokens per dispatch) is outside this repo.
- Tone, the neutral-language guidance beyond the project-name line, and the one-line operating-ruleset summary in `CLAUDE.md` are not in the core (the first is a style hint, the rest is restated in the agents' Process steps and in HANDBOOK/17).
- The saving is the file's weight (about 3.7k tokens net per turn, 2.7 to 3.2% of weighted tokens), not a change in what agents are asked to do.
