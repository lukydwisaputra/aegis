# Extending the System — Step-by-Step Recipes

Concrete recipes for each type of extension. See [HANDBOOK chapter 14](../HANDBOOK/14-extending.md) for the rationale behind each extension point.

---

## Adding a new module

```bash
# 1. Register the module abbreviation
echo "| ABBR | Full name | Owner | Description |" >> aegis/module-codes.md

# 2. Verify
pnpm qa-health
```

Module abbreviations must be 2–6 uppercase letters. The abbreviation is used in all artifact IDs (TC-ABBR-001, DEF-001-ABBR-UI).

---

## Adding a new agent + SPV pair

### Step 1 — Create the agent definition

```
aegis/.claude/agents/{tier}/{name}.md
```

Frontmatter template:
```yaml
---
name: qa-{name}
description: One-line description of what this agent does.
modelTier: implementation   # planning | implementation | validation | read-only
tools: [Read, Write, Edit, Bash]
knowledge_refs:
  - knowledge/synthesis/{relevant-topic}.md
  - agent-memory/qa-{name}/lessons.md
---
```

Tiers: `orchestrator/`, `tier1/`, `tier2/`, `tier2.5-devops/`, `spv/`, `compliance/`, `cross-cutting/`

### Step 2 — Create the SPV

```
aegis/.claude/agents/spv/qa-{name}-spv.md
```

SPV frontmatter:
```yaml
---
name: qa-{name}-spv
description: Reviews qa-{name} work reports. Validates [specific checks]. Emits CorrectiveInstruction on findings.
modelTier: validation
tools: [Read, Bash]
---
```

SPV agents get only `Read` and `Bash` — never `Write` or `Edit`.

### Step 3 — Create the lessons stub

```bash
mkdir -p aegis/agent-memory/qa-{name}
echo '{"version":"1.0","lessons":[]}' > aegis/agent-memory/qa-{name}/lessons.json
```

### Step 4 — Register in model policy

```yaml
# aegis/.claude/model-policy.yaml
agents:
  qa-{name}:
    tier: implementation
  qa-{name}-spv:
    tier: validation
```

### Step 5 — Apply policy

```bash
pnpm aegis build-agents
```

### Step 6 — Wire into orchestrator

Add the agent to the dispatch table in `aegis/.claude/agents/orchestrator/qa-orchestrator.md` under the correct STLC phase.

---

## Adding a new compliance regulation

### Step 1 — Knowledge file

```
knowledge/synthesis/compliance-{reg}.md
```

Include: clause catalog, tag format, common findings, worked examples.

### Step 2 — Agent + SPV

Follow the agent creation recipe above using tier `compliance/`.

### Step 3 — Tag regex

```typescript
// packages/@qa/contracts/src/tags.ts
export const TAG_PATTERNS = {
  // ... existing patterns
  YOUR_REG: /^YOURREG-[A-Z]+\d+$/,
};
```

### Step 4 — Config

```jsonc
// aegis.config.json
{
  "compliance": ["iso25010", "iso5055", "istqb", "cmmi", "gdpr", "pdpa", "your-reg"]
}
```

### Step 5 — Thresholds

```yaml
# aegis/thresholds.yaml
staging:
  compliance:
    your-reg:
      maxHighGaps: 0
```

---

## Adding a new command / skill

### Step 1 — Skill file

```
aegis/.claude/skills/qa-{command-name}/SKILL.md
```

```markdown
---
name: qa-{command-name}
description: What this command does.
category: core | workflow | admin | advanced | cicd | maintenance
---
# /qa-{command-name}

## Purpose
[One paragraph]

## Usage
/qa-{command-name} [--option=value]

## Options
| Flag | Default | Description |
|------|---------|-------------|

## Steps
1. ...
2. ...

## Emits
- `command.invoked` at start
- `{relevant events}` during execution
```

### Step 2 — Commands reference

Add an entry to `docs/D05-commands-reference.md` under the appropriate category.

### Step 3 — Cheat sheet (if top-10 worthy)

Update `docs/D05-cheat-sheet.md`.

---

## Adding a new report type

### Step 1 — Zod schema

```typescript
// packages/@qa/contracts/src/reports.ts
export const MyReportSchema = z.object({
  kind: z.literal('my-report'),
  // fields...
});
```

### Step 2 — EJS template

```
packages/@qa/templates/my-report.md.ejs
```

### Step 3 — Write from agent

```typescript
import { writeArtifact } from '@qa/reporters';
await writeArtifact({ kind: 'my-report', data: myData, runId });
```

### Step 4 — API route

```typescript
// apps/dashboard-api/src/routes/reports.ts
fastify.get('/runs/:runId/reports/my-report', async (req, reply) => {
  // serve from runs/{runId}/reports/my-report.*
});
```

### Step 5 — Dashboard page

```
apps/dashboard/src/routes/runs/[runId]/my-report.tsx
```

---

## Adding a new event type

### Step 1 — Discriminated union

```typescript
// packages/@qa/contracts/src/events.ts
export type AegisEvent =
  | ExistingEvents
  | { type: 'your.new.event'; field1: string; ts: string };
```

### Step 2 — Event bus spec

Add the event to `docs/D13-event-bus-spec.md` with key fields documented.

---

## Checklist before opening a PR for any extension

- [ ] `pnpm build` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm qa-health` passes (no orphan module codes, broken links)
- [ ] New agent has a matching SPV
- [ ] New agent has a `lessons.json` stub
- [ ] `model-policy.yaml` updated and `build-agents` run
- [ ] Relevant `docs/` file updated or created
- [ ] Brand-clean: no "Aegis" in any customer-facing output

---

## Related docs

- [HANDBOOK/14-extending.md](../HANDBOOK/14-extending.md)
- [D13-model-policy.md](D13-model-policy.md)
- [D13-event-bus-spec.md](D13-event-bus-spec.md)
- [D05-commands-reference.md](D05-commands-reference.md)
