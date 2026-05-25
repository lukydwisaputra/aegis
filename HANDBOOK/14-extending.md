# Chapter 14 — Extending the System

> _Add agents, regulations, commands, reports, and stay consistent._

## 14.1 Adding a new MODULE abbreviation

Modules group all IDs (TC-AUTH-031, DEF-BILL-0017) and are the primary scoping dimension for cycles.

1. Open `aegis/module-codes.md`
2. Add a row: `| ABBR | Full name | Owner | Description |`
3. Run `/qa-health` — it validates all module codes used in artifacts against this registry
4. Open a PR via the standard flow; `qa-github-spv` will verify the registry update

Example: adding a Billing module:
```markdown
| BILL | Billing | qa-test-designer | Stripe payment flows, invoice generation, subscription management |
```

## 14.2 Adding a new agent

1. Choose a tier: Tier-1 (STLC phase), Tier-2 (specialist), Tier-2.5 (DevOps), Tier-3 (cross-cutting)
2. Create `aegis/.claude/agents/{tier}/{name}.md` with this frontmatter:
   ```yaml
   ---
   name: qa-{name}
   description: One-line description of what this agent does.
   modelTier: implementation   # planning | implementation | validation | read-only
   tools: [Read, Write, Edit, Bash, Agent, Skill]
   knowledge_refs:
     - knowledge/synthesis/{relevant-topic}.md
     - agent-memory/qa-{name}/lessons.md
   ---
   ```
3. Add a corresponding SPV agent at `aegis/.claude/agents/spv/qa-{name}-spv.md`
4. Create `aegis/agent-memory/qa-{name}/lessons.json` with the empty stub
5. Add both agent names to `model-policy.yaml` under the correct tier
6. Run `pnpm aegis build-agents` to inject the `model:` field
7. Add agent to the relevant STLC phase in `qa-orchestrator.md`'s dispatch table

## 14.3 Adding a new compliance regulation

1. Create a knowledge file at `knowledge/synthesis/compliance-{reg}.md` with the clause catalog
2. Create the reviewer agent at `.claude/agents/compliance/qa-compliance-{reg}.md`
3. Create the SPV at `.claude/agents/spv/qa-compliance-{reg}-spv.md`
4. Add the tag format regex to `@qa/contracts/tags.ts`
5. Update `aegis.config.json.compliance[]` with the new regulation key
6. Add the regulation to `thresholds.yaml` under relevant stages
7. Add a compliance report output to the closure reporter's artifact list
8. Document in `docs/` with worked examples

## 14.4 Adding a new specialist

A specialist is a Tier-2 agent invoked by the test executor for a specific testing domain.

1. Follow §14.2 for the agent definition
2. Add the specialist name to `aegis.config.json.environments.{env}.allowedSpecialists` for each env where it should run
3. Add a `/qa-run-specialist --specialist={name}` path to the skill
4. Wire it into `qa-test-executor.md`'s dispatch table
5. If the specialist uses worktree isolation (rare for non-DevOps specialists), add the `isolation: "worktree"` annotation

## 14.5 Adding a new command/skill

Skills are the implementation of slash commands.

1. Create `aegis/.claude/skills/qa-{command-name}/SKILL.md`:
   ```markdown
   ---
   name: qa-{command-name}
   description: What this command does.
   category: core | workflow | admin | advanced | cicd | maintenance
   ---
   # /qa-{command-name}

   ## Purpose
   ...
   ## Steps
   ...
   ## Emits
   - `category: "command"` event at start
   - `{relevant events}` during execution
   ```
2. If the command needs new options, document them in `docs/D05-commands-reference.md`
3. All commands must emit `{ type: 'command.invoked', command: '/qa-{name}', ts }` at start
4. All commands should support `--json` for machine-readable output

## 14.6 Adding a new report

1. Add a Zod schema to `@qa/contracts/reports.ts`
2. Add an EJS template to `@qa/templates/{report-name}.md.ejs`
3. Call `@qa/reporters.writeArtifact({ kind: '{report-name}', data })` from the closure reporter or relevant phase agent
4. Add a route to the Fastify API at `apps/dashboard-api/src/routes/reports.ts`
5. Add a dashboard page at `apps/dashboard/src/routes/`
6. Update `docs/D09-reports-catalog.md` with the new report's fields

## 14.7 Adding a new event type

1. Add to the discriminated union in `@qa/contracts/events.ts`:
   ```typescript
   | { type: 'your.new.event'; field1: string; field2: number; ts: string }
   ```
2. Update `docs/D13-event-bus-spec.md` with the new event's key fields
3. Any agent that subscribes to the new event must add it to its `knowledge_refs` section

## 14.8 Versioning the boilerplate

Aegis follows SemVer. Changes that are **not** breaking:
- Adding new agents, skills, or commands
- Adding new optional config fields
- Adding new report types
- Adding new compliance regulations

Changes that **are** breaking (require major version bump):
- Renaming or removing existing agent names
- Changing the schema of any artifact that existing runs contain
- Removing or renaming config fields that users are likely to have set
- Changing the ID format for any artifact kind

Breaking changes require a migration guide in `docs/D14-upgrade-guide.md`.

## 14.9 ⚠ Extension pitfalls

- **Don't add agents without SPVs.** The review loop is how quality is enforced; solo agents drift.
- **Don't add config fields without schema updates.** `@qa/contracts/QaConfig` must be updated or `pnpm build` will fail.
- **Don't hardcode model names in agent definitions.** Always use `modelTier` — model names are resolved at build time from `model-policy.yaml`.
- **Don't forget to update `docs/D05-commands-reference.md`** when adding commands. The cheat sheet and `/qa-help` pull from this file.
- **Don't skip the `aegis.territory.violated` event setup** when adding agents that write to non-standard paths.

## 14.10 → Deep dive

- [docs/D14-extending-the-system.md](../docs/D14-extending-the-system.md) — step-by-step recipes for each extension type
