# agent-graveyard/

Retired agent definitions kept for audit history. When an agent is no longer needed (e.g., temporary Phase A.B agents like `qa-plan-validator` or `qa-prompt-reviewer`), its definition is moved here rather than deleted.

## Why keep them?

1. **Audit trail** — "Aegis once had this agent; here's what it did and when it retired"
2. **Reproducibility** — re-creating a past run requires knowing the agents that existed at that time
3. **Compliance** — some regulations (ISO 5055 maintainability, CMMI process maturity) require process-change documentation

## Layout

```
agent-graveyard/
├── README.md
└── {agent-name}.md              # the retired agent's full definition file
                                  # + a frontmatter note: retiredAt, reason
```

## Retirement protocol

When an agent is retired:

1. Move `.claude/agents/<tier>/<name>.md` → `agent-graveyard/<name>.md` (`git mv`)
2. Update its frontmatter:
   ```yaml
   ---
   retiredAt: 2026-05-25T10:00:00Z
   reason: "Phase A.B complete; no longer needed"
   ---
   ```
3. Record the retirement in the remediation matrix and in the commit message (a framework change happens outside any run, so no event records it)
4. The agent's `agent-memory/{name}/lessons.json` stays in place (do not delete; preserves history)

## What agents are eligible for retirement?

- Temporary agents created for one-time phases (e.g., `qa-plan-validator`, `qa-prompt-reviewer`)
- Agents superseded by a renamed/refactored version (rename to versioned slug; old one comes here)
- Agents whose function has been absorbed into another agent

Permanent roster agents are retired only by an owner decision recorded in the remediation matrix (2026-10-02: 11 agents, P2).
