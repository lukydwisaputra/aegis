# Aegis Handbook

This handbook is the complete guide to the Aegis QA framework. Read it cover-to-cover for a full mental model, or jump to a specific chapter using the table of contents below.

<!-- TOC START -->
## Table of Contents

| # | Chapter | Summary |
|---|---|---|
| 1 | [What This System Is](HANDBOOK/01-what-is-this.md) | Philosophy, scope, non-goals, and common misconceptions about the QA framework. |
| 2 | [Getting Started](HANDBOOK/02-getting-started.md) | Three onboarding tracks: fresh installer (~30 min), teammate after clone (~5 min), and CI/CD wiring (~10 min). Every step has a verify command. |
| 3 | [Architecture](HANDBOOK/03-architecture.md) | Orchestrator, tiers, SPVs, model tiers, Taskmaster, event bus, path-guard, and the three human gates. |
| 4 | [STLC Walkthrough](HANDBOOK/04-stlc-walkthrough.md) | What happens when `/qa-start` runs: a nine-phase breakdown (Requirements → Discovery → Planning → Design → Environment → Execution → Triage → Closure → Executive Report), illustrated with the Login/SSO feature. |
| 5 | [Commands](HANDBOOK/05-commands.md) | All 28 user commands in 6 groups: each with purpose, flags table, and a worked example. |
| 6 | [Agent Roster](HANDBOOK/06-agents.md) | All agents in full mode: Orchestrator (1), Tier-1 phase managers (8), Tier-2 specialists (16), Tier-2.5 DevOps (6), SPVs (25), compliance (6), cross-cutting (4 Haiku + Discovery/curation), with Lite mode notes. |
| 7 | [Templates and Standardization](HANDBOOK/07-templates-and-standardization.md) | ID scheme, severity/priority dual-format, defect report fields, test case fields, RTM columns, naming conventions, and test data. |
| 8 | [Compliance](HANDBOOK/08-compliance.md) | ISO 25010, ISO 5055, ISTQB, CMMI, GDPR, and PDPA: tag formats per regulation, parallel reviewer workflow, and how findings appear in reports. |
| 9 | [Reports and Dashboards](HANDBOOK/09-reports-and-dashboards.md) | Per-run reports, operational rollups, the live dashboard (Vite+React on port 3030), three executive PDFs, and the SSE event stream. |
| 10 | [Self-Improvement](HANDBOOK/10-self-improvement.md) | Two layers: per-agent automatic lessons and the curator's system-wide curation cycle. |
| 11 | [DevOps Tier](HANDBOOK/11-devops-tier.md) | GitHub and CI/CD masters: branch strategy, PR flow, workflow implementation, safety gates. |
| 12 | [CI/CD Operations](HANDBOOK/12-cicd-operations.md) | The full pipeline: stages, triggers, gates, commands, thresholds. |
| 13 | [Mechanics](HANDBOOK/13-mechanics.md) | The load-bearing internals — read this when extending or debugging. |
| 14 | [Extending the System](HANDBOOK/14-extending.md) | Add agents, regulations, commands, reports, and stay consistent. |
| 15 | [FAQ & Troubleshooting](HANDBOOK/15-faq-and-troubleshooting.md) | Common issues with diagnostic flows. First stop when something goes wrong. |
| 16 | [Glossary](HANDBOOK/16-glossary.md) | Plain-English definitions for QA terms, STLC phases, compliance acronyms, framework-specific terms, and key metrics. |

<!-- TOC END -->

---

## Quick-Jump TL;DR

| # | One sentence |
|---|---|
| 1 | The QA framework is an agent-based STLC system that writes artefacts, pauses at human gates, and learns from mistakes — it does not fix code. |
| 2 | There are three setup tracks; all of them end with a health check and a smoke run to verify the wiring is correct. |
| 3 | The Orchestrator dispatches work to a four-tier agent hierarchy; Taskmaster queues tasks; path-guard and three human gates maintain control. |
| 4 | A full run has seven phases (Discovery through Closure) and three gate pauses — reading the plan gate is the single most valuable minute you can spend. |
| 5 | Twenty-eight commands cover run lifecycle, defect management, knowledge ingestion, CI/CD, dashboard, and self-improvement in six groups. |
| 6 | Sixty-three agents run in full mode; Lite mode drops to 14 agents, disabling SPVs, compliance, and lesson capture. |
| 7 | All artefact IDs follow `TYPE-MODULE-SEQUENCE`; severity and priority are independent axes; teardown is required on every test case. |
| 8 | Six compliance frameworks run in parallel; their findings are merged into the run report at Phase 6 and do not block execution. |
| 9 | The run report is a self-contained HTML file; the dashboard at port 3030 streams live run state via SSE. |
| 10 | Lessons are only created from SPV feedback, not from routine successes; they take effect in the next run after `/qa-promote`. |
| 11 | The DevOps tier generates CI/CD workflow files and PR descriptions but never merges to `main` — that is always a human action. |
| 12 | The four environments (development, testing, staging, production) have increasing strictness; production is read-only and smoke-only. |
| 13 | The event bus is an append-only JSONL file; all inter-agent communication goes through it; crash recovery replays it. |
| 14 | Every extension point has a registration mechanism — add a new agent, SPV, regulation, or command by registering it, not by editing existing code. |
| 15 | Most "stuck run" problems are a gate waiting for input or an orphan lock; use `/qa-resume` before reaching for `/qa-stop`. |
| 16 | Severity measures technical impact; priority measures business urgency — they are not synonyms and should not be set identically by default. |
