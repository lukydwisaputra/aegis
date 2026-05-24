---
name: qa-init-project
description: "Internal: scaffold a new Aegis QA project directory structure from templates"
---

# /qa-init-project

<!-- INTERNAL SKILL — not user-invocable. Invoked by `aegis init` CLI command. -->

## Purpose
Bootstraps the complete Aegis QA framework directory tree for a new project. Reads the project's `package.json` and `pnpm-workspace.yaml` to detect apps, copies template files, writes initial configuration stubs, and registers the project in the workspace index. Called once per project by the `aegis init` CLI — not intended to be run directly by users.

## Usage
```
/qa-init-project [--project-root=<path>] [--template=default|minimal] [--force]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--project-root` | `cwd` | Root directory of the target project |
| `--template` | `default` | Scaffold template: `default` (full) or `minimal` (lean) |
| `--force` | `false` | Overwrite existing files (destructive — use with caution) |

## Behaviour
1. Detect project type by reading `package.json` and `pnpm-workspace.yaml`.
2. Create the canonical directory tree: `runs/`, `artifacts/{requirements,test-cases,defects,rtm}`, `config/`, `knowledge/`, `templates/`, `reports/`, `promotions/{pending,approved,rejected}`.
3. Copy template config files (`environments.yaml`, `thresholds.yaml`, `model-policy.yaml`, `cost-estimates.yaml`) from `templates/config/` with project-specific values substituted.
4. Write initial `HANDBOOK.md` stub with project name and TOC placeholder.
5. Append recommended entries to the project's `.gitignore`.
6. Register the project in `~/.aegis/workspace-index.json` for cross-project commands.
7. Emit `project.initialized` to a bootstrap log.
8. Print a "next steps" checklist guiding the user to run `/qa-doctor` and `/qa-ci-bootstrap`.

## Events emitted
- `project.initialized` — project root, template used, app count detected
- `project.init.file.written` — per scaffolded file

## Example
```bash
# Invoked by aegis CLI:
aegis init --template=default
# Which internally dispatches:
/qa-init-project --project-root=/path/to/project --template=default
```
