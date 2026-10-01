---
name: qa-start
description: Launch a full STLC cycle from requirements through closure for one or more app modules
---

# /qa-start

## Purpose
Kicks off a complete Software Testing Life Cycle run — requirements analysis, planning, test design, environment setup, execution, defect logging, and closure reporting. Creates a new run directory (RUN-{date}-NNN) and dispatches the qa-orchestrator to coordinate all downstream agents. The specialist cap comes from `aegis.config.json#parallelism.maxSpecialists` and is enforced by the CLI. For a PR-gate smoke cycle use `/qa-smoke`.

## Usage
```
/qa-start [--module=AUTH] [--env=development|testing|staging|production] [--scope=<feature>] [--type=Functional,Regression] [--intake=<glob>] [--apps=prospect,bishan]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--module` | `ALL` | Limit the run to a specific module (e.g. AUTH, BILLING) |
| `--env` | `testing` | Target environment |
| `--scope` | *(none)* | Narrow scope to a single feature or user story |
| `--type` | `Functional,Regression` | Comma-separated test types to include |
| `--intake` | `aegis.config.json#intake.sources` | Target-relative globs of requirement documents to copy into the run |
| `--apps` | `all` | Comma-separated list of apps in the monorepo to include |

## Behaviour
1. **Preflight (hard gate).** Before allocating a run: (a) resolve `targetProjectRoot`; abort if it resolves to a multi-project parent — heuristic: more than one nested `playwright.config.*` under it, OR no `package.json` at the resolved root. (b) If `aegis.config.json#preCycleHealthCheck` is true, run `/qa-health`; abort if it does not pass. Do not create a run directory when preflight fails.
2. Validate flags and resolve the target environment config from `config/environments.yaml`.
3. Create the run: `AEGIS_AGENT=owner pnpm aegis run create --env <env> --module <codes> --cycle full --health <passed|not-run>` (plus `--intake <globs>` when given). `--health passed` only when step 1 ran `/qa-health` and it passed. The CLI allocates `RUN-YYYYMMDD-NNN`, writes `run.json` (status `created`), copies the intake documents, records `run.created` and makes the run active.
4. Dispatch **qa-orchestrator** as a sub-agent, passing the run ID and the resolved flags.
5. The orchestrator advances the phases through the CLI. The cycle pauses at the three gates (G1 Plan approval, G2 Defect triage, G3 Closure) until the owner decides each with `/qa-gate-decide`; no gate can be skipped.
6. Relay the orchestrator's status to the owner. The run is complete only when the orchestrator's final CLI command records `run.completed`.

## Events emitted
- `run.created` — recorded by `aegis run create`; this skill appends no events. A failed preflight prints its reason and creates no run.

## Example
```
/qa-start --module=AUTH --env=staging --type=Functional --apps=prospect
```
Creates RUN-20260524-001, runs full STLC for the AUTH module of the prospect app against staging.

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
kind: execution
dispatchedBy: []
reads:
  - "{target}/package.json"
writes: []
emits:
  - {event: run.created, via: "cli:run.create"}
awaits: []
cli: [run.create]
runs: []
dispatches: [qa-orchestrator, qa-health]
config:
  - aegis.config.json#targetProjectRoot
  - aegis.config.json#preCycleHealthCheck
  - aegis.config.json#intake.sources
  - aegis.config.json#parallelism.maxSpecialists
  - config/environments.yaml
```
