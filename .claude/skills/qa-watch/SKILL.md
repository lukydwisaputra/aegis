---
name: qa-watch
description: Watch source directories and automatically re-run affected tests on file changes (TDD watch mode)
---

# /qa-watch

## Purpose
Starts a file-system watcher on one or more source directories. When a file changes, the impact analysis agent determines which test cases are affected, and only those tests are re-dispatched to the relevant specialists. Provides a tight feedback loop for TDD and BDD workflows without running the full suite on every save.

## Usage
```
/qa-watch [--paths=apps/web] [--debounce=2s] [--specialist=unit,api]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--paths` | project root | Comma-separated directories or glob patterns to watch |
| `--debounce` | `2s` | Wait period after the last file change before triggering re-run |
| `--specialist` | `unit,api,ui` | Comma-separated specialists to dispatch on change |

## Behaviour
1. Start a file-system watcher on the resolved `--paths` directories.
2. Collect file-change events; apply the `--debounce` delay to batch rapid saves.
3. For each batch of changed files, invoke the impact analysis agent to map files → affected TC IDs.
4. If no TCs are affected, print "no affected tests" and continue watching.
5. Dispatch only the affected TC subset to the `--specialist` agents.
6. Stream test results to the terminal as they complete; display pass/fail inline.
7. Maintain a rolling summary of the last 10 watch cycles in the terminal footer.
8. Continue watching until the user sends an interrupt signal (Ctrl+C).

## Events emitted
- `watch.started` — paths, debounce, specialists
- `watch.cycle.triggered` — changed files, affected TC count
- `watch.cycle.completed` — pass/fail counts for the cycle
- `watch.stopped` — on clean shutdown

## Example
```
/qa-watch --paths=apps/prospect/src --debounce=1s --specialist=unit,api
```
Watches the prospect app's source, re-running unit and API tests within 1 second of any change.
