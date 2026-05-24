## Chapter 1 — What This System Is

> _Philosophy, scope, non-goals, and common misconceptions about the QA framework._

---

### 1.1 The Core Idea

This QA framework is an autonomous, agent-based testing system that sits alongside your product codebase. It does not replace your developers or your judgment. It replaces the mechanical, repetitive labor of test planning, execution, defect triage, and reporting — and does so in a reproducible, auditable way.

The system is opinionated about process. It follows a structured Software Testing Life Cycle (STLC) with explicit gates. It writes artefacts in standardised formats. It learns from its own mistakes between runs. If you need something more freeform, you can disable gates or restrict to Lite mode; but the default profile is designed to produce board-quality evidence.

---

### 1.2 How You Interact With It

**The framework runs through Claude Code.** You open Claude Code with the `aegis/` directory as your project, and you interact with it by typing slash commands in the Claude Code chat — for example `/qa-start`, `/qa-smoke`, `/qa-health`. These are not shell commands; they are skills that Claude Code loads from `aegis/.claude/skills/` and executes as agent workflows.

The typical interaction loop looks like this:

```
1. Open Claude Code → navigate to your project's aegis/ folder
2. Type /qa-smoke --env=development     ← in the Claude Code chat
3. Framework runs, writes artefacts to aegis/runs/RUN-.../
4. Gate fires → you review and type "approve" in Claude Code chat
5. Cycle completes → open the dashboard at http://localhost:3030
```

Nothing in this framework is invoked from the terminal directly (except `pnpm install` during setup and the `aegis` CLI for one-time configuration). Every `/qa-*` command lives in the Claude Code chat.

---

### 1.3 What the System Covers

The framework covers the following concerns:

1. **Planning** — requirement ingestion, risk analysis, test strategy, RTM skeleton
2. **Design** — test case authoring for unit, API, UI, security, accessibility, performance, email, visual, and exploratory testing
3. **Execution** — autonomous test runs against dev / testing / staging / production environments
4. **Defect management** — structured defect reports with severity/priority, deduplication, and a triage gate
5. **Compliance review** — parallel ISO 25010, ISO 5055, ISTQB, CMMI, GDPR, and PDPA checks
6. **Reporting** — per-run closure reports, executive PDF summaries, and a live dashboard on port 3030
7. **Self-improvement** — lesson capture, per-agent instruction updates, curator-led promotion of validated lessons

The target application lives in the parent directory. The framework never modifies source files in the target — it produces defect reports and lets developers apply fixes.

---

### 1.4 What the System Does Not Cover

The framework explicitly does not:

- **Fix production bugs** — it finds and reports them; developers own remediation
- **Replace exploratory testing by domain experts** — it runs charter-based exploration but cannot substitute for user research or deep domain knowledge
- **Guarantee zero defects** — coverage is finite; risk-based prioritisation means some areas receive lighter attention
- **Own your CI/CD pipeline** — it generates workflow files and wires gates, but your pipeline configuration lives in your repository
- **Handle multi-tenancy** — each instance of the framework monitors one target project

---

### 1.5 The Agent Model

The system uses a tiered agent hierarchy:

- **Orchestrator** (`qa-orchestrator`) — a single director agent that receives commands, plans work, and dispatches to lower tiers
- **Tier-1 phase agents** — eight agents that own each STLC phase: `qa-requirements-analyst`, `qa-test-planner`, `qa-test-designer`, `qa-environment-engineer`, `qa-test-executor`, `qa-defect-manager`, `qa-closure-reporter`, `qa-executive-reporter`
- **Tier-2 specialists** — fourteen workers that execute concrete tasks: `qa-ui-specialist`, `qa-api-specialist`, `qa-unit-specialist`, `qa-performance-specialist`, `qa-security-specialist`, `qa-accessibility-specialist`, `qa-exploratory-specialist`, `qa-email-specialist`, `qa-web-explorer`, `qa-ui-designer`, `qa-database-specialist`, `qa-realtime-specialist`, `qa-feature-flag-specialist`, `qa-responsive-specialist`
- **Tier-2.5 DevOps** — seven agents that own CI/CD, branch strategy, environment provisioning, and secrets
- **SPVs (Supervisors)** — twenty-two reviewer agents that audit work produced by workers and return scored feedback
- **Compliance agents** — six agents, one per regulation, running in parallel during every cycle
- **Cross-cutting agents** — five agents handling knowledge ingestion, self-improvement, and metrics

In **Lite mode** (set `profile: "lite"` in `aegis.config.json`), only the Orchestrator plus a reduced set of workers run. SPV review, compliance, and lesson capture are disabled. Lite mode is useful for fast local smoke runs where cost is a concern.

---

### 1.6 Philosophy

Three principles guide every design decision:

1. **Artefacts first** — every agent action must produce a file. An agent that "checked" something without writing evidence is considered to have done nothing. This keeps the system auditable.

2. **Human gates at decision points** — the framework pauses at three gates: plan approval, defect triage, and closure sign-off. These are the moments where domain knowledge matters most. Disable them only with explicit intent.

3. **Separate concerns strictly** — workers produce, SPVs review, the curator promotes lessons. No agent does more than one of these roles. This prevents circular feedback loops and makes the system testable.

---

### 1.7 Worked Example — The Login Feature

Throughout this handbook we use a single running example: the **Login / SSO feature** for a Vite + React + Supabase application. The consistent identifiers you will see are:

| Identifier | Meaning |
|---|---|
| `REQ-AUTH-04` | Requirement: OAuth2/SSO login must redirect to `/dashboard` |
| `STORY-AUTH-204` | User story: "As a user I can log in with Google SSO" |
| `TC-AUTH-031` | Test case: Verify redirect after successful SSO login |
| `DEF-AUTH-0017` | Defect: SSO redirect lands on `/` instead of `/dashboard` |
| `RUN-20260523-001` | The QA run during which these artefacts were produced |

When you see these IDs in later chapters, they always refer to this same scenario.

---

### ⚠ Pitfalls

1. **Trying to run `/qa-*` commands in a terminal** — these are Claude Code skills, not shell commands. Type them in the Claude Code chat with `aegis/` open as your project directory.

2. **Treating the framework as a black box** — if you never read the plan file before approving the gate, you lose the primary human checkpoint. The gate exists for you to read and override.

3. **Running in full-profile mode against production** — `production` environment is configured `smoke-only` and `mutating: false`. Running a full cycle against production is blocked by path-guard; do not attempt to override this without understanding the consequences.

4. **Assuming "no defects" means "no bugs"** — the framework tests what it can reach. Unreachable code, untested edge cases, and misspecified requirements are outside its scope.

5. **Skipping Lite mode for local iteration** — a full-profile run costs more tokens and takes longer. Use `profile: "lite"` and `/qa-smoke` for rapid feedback loops during development.

6. **Ignoring the self-improvement loop** — if agents keep making the same mistakes and you never promote lessons, the system does not improve. Run `/qa-promote` after stable cycles.

---

### Further Reading

- Chapter 3 — Architecture mental model
- Chapter 4 — STLC walkthrough with worked example
- Chapter 6 — Full agent roster
