# Worktree Isolation

When and why git worktrees are used for DevOps agent operations.
See [HANDBOOK chapter 11 §11.4](../HANDBOOK/11-devops-tier.md) for context.

---

## Why worktrees

DevOps agents run `git checkout`, `git commit`, and `gh pr create` — operations that mutate the working tree. Running these from the main working directory risks:

- Corrupting the orchestrator's working state mid-run
- Race conditions when multiple agents operate concurrently
- Leaving the repo in a dirty state if an agent crashes

Worktrees solve this by giving each agent its own isolated directory backed by the same git object store. Changes in a worktree never affect the main checkout.

---

## Which agents use worktree isolation

| Agent | Reason |
|-------|--------|
| `qa-github-implementer` | Creates branches, stages files, commits, pushes |
| `qa-cicd-implementer` | Writes `.github/workflows/*.yml`, stages, commits |

All other agents — including Tier-2 specialists — write only to `aegis/runs/` or `tests/`, which are not git-sensitive paths. They do not need worktree isolation.

---

## How the orchestrator sets this up

The orchestrator passes `isolation: "worktree"` in the agent dispatch config:

```jsonc
{
  "agent": "qa-github-implementer",
  "isolation": "worktree",
  "branch": "test/TC-AUTH-031-add-sso-e2e"
}
```

The harness then:
1. Runs `git worktree add /tmp/aegis-wt-{runId}-{agentName} {branch}`
2. Sets the agent's working directory to the new worktree path
3. On agent completion: if no changes were made, removes the worktree automatically
4. If changes were made: returns the worktree path and branch name to the orchestrator

---

## Branch lifecycle in a worktree

```
orchestrator dispatches qa-github-implementer
  → harness creates worktree at /tmp/aegis-wt-{id}/
  → agent creates branch, writes files, commits
  → agent pushes branch: git push -u origin {branch}
  → agent calls gh pr create
  → agent completes; harness removes worktree
  → PR lives on remote; branch lives on remote
  → human reviews and merges (Gate 3)
```

The worktree is always ephemeral. The branch and PR persist on the remote.

---

## Orphan cleanup

If an agent crashes after the worktree is created but before it is removed:

```bash
/qa-health --fix
```

This detects worktrees older than 5 minutes with no active agent heartbeat and removes them via `git worktree remove --force {path}`. It also logs a `worktree.orphan.removed` event.

Manual cleanup if needed:
```bash
git worktree list              # list all worktrees
git worktree remove --force /tmp/aegis-wt-{id}/
git worktree prune             # clean stale administrative files
```

---

## Limits

- Only 2 worktree-isolated agents may run concurrently (part of the max-4 parallelism budget, with 2 slots reserved for worktree ops)
- Worktrees are created under `/tmp/` and are not persisted across machine restarts
- Secrets passed to a worktree agent are scoped to that agent's process and are not written to the worktree filesystem

---

## Related docs

- [D11-devops-tier-overview.md](D11-devops-tier-overview.md)
- [D11-github-workflow.md](D11-github-workflow.md)
- [D12-cicd-workflow.md](D12-cicd-workflow.md)
- [HANDBOOK/11-devops-tier.md](../HANDBOOK/11-devops-tier.md)
