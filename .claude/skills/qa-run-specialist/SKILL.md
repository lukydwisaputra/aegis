---
name: qa-run-specialist
description: Invoke a single Tier-2 specialist agent directly against a named feature
---

# /qa-run-specialist

## Purpose
Dispatches one specialist testing agent in isolation, bypassing the full STLC orchestration. Ideal for spot-checking a specific concern (e.g. run only the security specialist against a new endpoint) without the overhead of a complete cycle. Results are written to a transient `spot/{specialist}/{timestamp}/` directory unless `--run` is supplied.

## Usage
```
/qa-run-specialist --specialist=<type> [--target=<feature>]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--specialist` | *(required)* | Specialist type: `api`, `ui`, `unit`, `perf`, `security`, `a11y`, `exploratory`, `email`, `database`, `realtime`, `feature-flag`, `responsive`. Primary specialists (`api`, `ui`, `perf`, `security`, `exploratory`, `database`, `responsive`) are auto-dispatched by `testType`. Technique specialists (`unit`, `a11y`, `email`, `realtime`, `feature-flag`) are auto-dispatched by `testTechnique`. Use this command to invoke any specialist directly, bypassing the cycle. |
| `--target` | *(none)* | Feature, module, or file path to focus the specialist on |

## Behaviour
1. Validate `--specialist` against the registered specialist manifest.
2. Resolve the specialist's model tier from `config/model-policy.yaml` and instantiate the agent.
3. If `--target` is provided, scope the specialist's context to that feature or file path.
4. Write a minimal run context to `spot/{specialist}/{timestamp}/run.json`.
5. Dispatch the specialist agent; it reads relevant source files, existing test cases, and prior defects.
6. Specialist writes findings to `spot/{specialist}/{timestamp}/results.json`.
7. Print a brief terminal summary of pass/fail/issue counts.

## Events emitted
- `specialist.started` — specialist type, target, model used
- `specialist.completed` — TC count, defect count, duration, token cost
- `specialist.failed` — error detail on unrecoverable failure

## Example
```
/qa-run-specialist --specialist=security --target=apps/prospect/src/api/auth
```
Runs the security specialist scoped to the auth API directory and reports findings immediately.
