# Chapter 15 — FAQ & Troubleshooting

> _Common issues with diagnostic flows. First stop when something goes wrong._

## 15.1 "My run is stuck"

**Diagnostic flow:**

1. Check what phase the run is in: `/qa-status --run=RUN-...`
2. Look for gates: is a human gate waiting for input? Check for `gate.requested` events in `events.jsonl`
3. Look for orphan locks: `/qa-health --run=RUN-...`
4. If locks are stale: `/qa-resume --run=RUN-...` to release and continue
5. If an agent is running but making no progress, check its token budget: `/qa-status --run=RUN-... --json | jq .tokenUsage`
6. Still stuck? `/qa-stop --run=RUN-... --reason="diagnosing"` and re-examine artifacts

**Most common cause:** a gate waiting for keyboard input (`[y/n]` prompt) that nobody answered. Check the terminal where `/qa-start` was invoked.

## 15.2 "Tests pass locally but fail in CI"

Checklist:
- [ ] Does CI use the same Node version? Check `target-profile.json.node` vs the workflow's `node-version`
- [ ] Are all required env vars set as GitHub secrets? `gh secret list` on the repo
- [ ] Is the testing-env URL provisioned? Check the `TESTING_PREVIEW_URL` env var in the workflow run
- [ ] Is Playwright running in headed or headless mode? CI requires headless; check `playwright.config.ts`
- [ ] Does the test depend on a timing assumption? Add `await expect(locator).toBeVisible()` instead of `page.waitForTimeout()`
- [ ] Is there a missing `pnpm install` step before test execution?

## 15.3 "An agent keeps making the same mistake"

1. Check its lessons file: `cat aegis/agent-memory/qa-{agent}/lessons.md`
2. Does it have a relevant lesson? If not, the lesson wasn't appended — check that the trigger fired: look for `lesson.appended` events in `events.jsonl`
3. If the lesson exists but the agent still fails: the agent's system prompt may need to more explicitly reference the lessons file. Check `knowledge_refs` in the agent definition.
4. Open a curator proposal via `/qa-promote` if you have a pattern fix that should apply system-wide.

## 15.4 "Curator proposed a bad pattern"

Simply answer `n` when `/qa-promote` shows it. The rejection is logged with your reason in `pending-promotions/{runId}/rejected.md`.

If the same bad pattern keeps being proposed: add a note to the curator's `agent-memory/qa-curator/lessons.json` explaining why this pattern is wrong (you can edit the file directly — it's just JSON). The next curator run will read it.

## 15.5 "Token costs are exploding"

1. Run `/qa-status --json | jq .tokenUsage` to see per-agent costs
2. Sort by `costUsd DESC` — which agents are expensive?
3. Check if SPVs are the dominant cost: if yes, consider the SPV fast-path (Sonnet first, Opus only on escalation). Edit `aegis/.claude/model-policy.yaml` to switch validation tier to `claude-sonnet-4-6`.
4. Check `cached%` column in token-usage report. Low `cached%` means prompt caching isn't working — check that knowledge files are not being regenerated between calls.
5. Use `/qa-dry-run` before the next cycle to estimate costs before committing.

## 15.6 "Health check failed"

```bash
/qa-health --fix
```

The `--fix` flag auto-repairs safe issues (orphan locks, stale counters, re-renders out-of-sync MD files). Unsafe issues (schema drift, broken cross-artifact links) are reported but not auto-repaired — they require manual investigation.

For gitignore issues: `/qa-health --gitignore --fix` re-derives both `.gitignore` files from the canonical template.

## 15.7 "Schema validation failed"

When an artifact can't be written because its JSON doesn't match the Zod schema:

1. Check the error message — it will name the failing field and the Zod constraint
2. If the artifact was hand-edited, revert to the JSON and let the agent re-render the MD
3. If the schema changed (after an Aegis version bump), run the migration script from `docs/D14-upgrade-guide.md`

Never bypass Zod validation by commenting it out — it's the primary data-integrity guard.

## 15.8 "Books copyright concern"

Books in `aegis/books/raw/` are NEVER committed (always gitignored). Knowledge chunks in `aegis/knowledge/` are paraphrased summaries (not verbatim excerpts) generated under fair-use analysis principles.

If your team's legal policy prohibits even paraphrased content:
- Set `aegis.config.json.shareKnowledge: false` (default — knowledge is gitignored)
- Each team member must ingest books locally on their own machine
- CI runs without book knowledge — agents fall back to general training

## 15.9 "A quality gate is failing — should I lower the threshold?"

Decision tree:

```
Is the metric genuinely unachievable for this project right now?
  YES → Adjust threshold in thresholds.yaml with a documented reason
        qa-cicd-spv will flag it as a relaxation from industry default (informational)
  NO  →
    Is it a temporary regression (flaky test, environment issue)?
      YES → Quarantine the flaky test; fix the environment; don't relax the gate
      NO  →
        Is it a new codebase without existing tests (green field)?
          YES → Relax only the "overall" coverage threshold; keep "newCode" ≥ 80%
          NO  → Investigate root cause; opening a defect may be appropriate
```

## 15.10 "Production rollback procedure"

```bash
# Emergency: rollback + open incident
/qa-rollback --reason="<specific description of what broke>" --to-tag=v{previous-good-tag}

# This will:
# 1. Trigger rollback.yml workflow (revert deploy)
# 2. Open Sev1 defect DEF-*-XXXX with events.jsonl timeline
# 3. Create runs/{id}/postmortem.md from template
# 4. Emit rollback.triggered event

# Follow up: complete the postmortem before re-deploying
```

After stabilizing: address the root cause, bump to a new version, run through the staging gate, promote again.

## 15.11 Common error codes

| Error | Meaning | Fix |
|-------|---------|-----|
| `WORK_TAKEN` | Task already claimed by another agent | Wait; orchestrator will reassign |
| `LOCK_STALE` | An orphan lock is blocking progress | `/qa-resume --run=RUN-...` |
| `TERRITORY_VIOLATION` | Non-qa-* agent tried to write to aegis/ | Check agent name; use a qa-* agent |
| `ENV_WRITE_BLOCKED` | Mutating action blocked in read-only env | Remove mutation from test; production is read-only |
| `BRAND_VIOLATION` | "Aegis" or internal name in stakeholder artifact | Remove forbidden string from artifact |
| `SCHEMA_REJECTED` | Artifact JSON failed Zod validation | Fix the failing field per error message |
| `LESSON_CONFLICT` | New lesson contradicts existing one | Run `/qa-promote --type=lesson` to resolve |
| `BUDGET_EXHAUSTED` | Token/cost budget exceeded | Run `/qa-dry-run` to estimate before next cycle |

## 15.12 Where to file bugs / propose changes

- Bugs in the framework: file a defect in `aegis/runs/` using `/qa-record-manual` if it's a framework behavior issue
- Propose new features: write a curator proposal (as a draft in `runs/{id}/pending-promotions/`) and accept it via `/qa-promote`
- Documentation gaps: edit the relevant `HANDBOOK/{chapter}.md` file directly and submit a PR
