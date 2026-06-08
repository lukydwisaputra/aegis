# Aegis Docs

Deep-dive reference files for the QA framework. Start with `HANDBOOK.md` for the narrative tour;
come here for specification-level detail.

Each file is prefixed `D{chapter}` matching the HANDBOOK chapter it extends.
For example, `D13-event-bus-spec.md` is a deep dive into [HANDBOOK chapter 13 — Mechanics](../HANDBOOK/13-mechanics.md).

## Index

### D02 — Getting Started ([HANDBOOK/02](../HANDBOOK/02-getting-started.md))
| File | Topic |
|------|-------|
| [D02-teammate-onboarding.md](D02-teammate-onboarding.md) | Cloned an existing project? 5-min checklist |

### D03 — Architecture ([HANDBOOK/03](../HANDBOOK/03-architecture.md))
| File | Topic |
|------|-------|
| [D03-agent-workflow-diagram.md](D03-agent-workflow-diagram.md) | Full agent workflow Mermaid diagram (+ rendered .svg) |

### D05 — Commands ([HANDBOOK/05](../HANDBOOK/05-commands.md))
| File | Topic |
|------|-------|
| [D05-cheat-sheet.md](D05-cheat-sheet.md) | Printable one-pager: top-10 commands |
| [D05-commands-reference.md](D05-commands-reference.md) | All 28 commands + flags |

### D07 — Templates & Standardization ([HANDBOOK/07](../HANDBOOK/07-templates-and-standardization.md))
| File | Topic |
|------|-------|
| [D07-brand-exposure-rules.md](D07-brand-exposure-rules.md) | Class A vs B, forbidden strings, enforcement |

### D10 — Self-Improvement ([HANDBOOK/10](../HANDBOOK/10-self-improvement.md))
| File | Topic |
|------|-------|
| [D10-per-agent-auto-learning.md](D10-per-agent-auto-learning.md) | Dedup algorithm, lesson archive format |
| [D10-self-improvement-cycle.md](D10-self-improvement-cycle.md) | Curator flow, proposal format |

### D11 — DevOps Tier ([HANDBOOK/11](../HANDBOOK/11-devops-tier.md))
| File | Topic |
|------|-------|
| [D11-devops-tier-overview.md](D11-devops-tier-overview.md) | Purpose, sub-roles, activation gates |
| [D11-github-workflow.md](D11-github-workflow.md) | Branch strategy, PR conventions, gh CLI usage |
| [D11-worktree-isolation.md](D11-worktree-isolation.md) | When/why worktree isolation is used |
| [D11-secrets-handling.md](D11-secrets-handling.md) | Secret resolution, naming, scanning |

### D12 — CI/CD Operations ([HANDBOOK/12](../HANDBOOK/12-cicd-operations.md))
| File | Topic |
|------|-------|
| [D12-environments-overview.md](D12-environments-overview.md) | 4-env model, recommended test strategy |
| [D12-cicd-workflow.md](D12-cicd-workflow.md) | GitHub Actions workflow templates + safety |
| [D12-cicd-stage-map.md](D12-cicd-stage-map.md) | Pipeline stages, triggers, gate thresholds |
| [D12-env-safety-and-prod.md](D12-env-safety-and-prod.md) | Environment safety, read-only enforcement |
| [D12-monorepo-multi-app.md](D12-monorepo-multi-app.md) | Multiple apps in one repo — config, workflow, CI matrix |

### D13 — Mechanics ([HANDBOOK/13](../HANDBOOK/13-mechanics.md))
| File | Topic |
|------|-------|
| [D13-concurrency-and-locking.md](D13-concurrency-and-locking.md) | Lock protocol, stale-lock detection |
| [D13-event-bus-spec.md](D13-event-bus-spec.md) | Full event type catalog |
| [D13-spv-review-pattern.md](D13-spv-review-pattern.md) | SPV review pipeline and verdict types |
| [D13-work-report-schema.md](D13-work-report-schema.md) | Work report JSON schema |
| [D13-model-policy.md](D13-model-policy.md) | Model tier assignments and policy resolution |
| [D13-prompt-caching.md](D13-prompt-caching.md) | Prompt caching strategy and cost accounting |
| [D13-spv-fast-path.md](D13-spv-fast-path.md) | SPV reduced-prompt review path |

### D14 — Extending the System ([HANDBOOK/14](../HANDBOOK/14-extending.md))
| File | Topic |
|------|-------|
| [D14-extending-the-system.md](D14-extending-the-system.md) | Step-by-step recipes for each extension type |
