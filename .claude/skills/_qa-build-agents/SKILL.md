---
name: qa-build-agents
description: "Internal: resolve modelTier → concrete model field in all agent definition files via model-policy.yaml"
---

# /qa-build-agents

<!-- INTERNAL SKILL — not user-invocable. Run during framework build/update steps. -->

## Purpose
Processes all agent YAML/JSON definition files in the Aegis framework and resolves the abstract `modelTier` field (e.g. `tier: fast`, `tier: smart`) into the concrete `model` field value by looking up the current mapping in `config/model-policy.yaml`. This separation allows the framework to change model assignments without editing every agent file individually.

## Usage
```
/qa-build-agents [--agents-dir=aegis/agents] [--dry-run] [--policy=config/model-policy.yaml]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--agents-dir` | `aegis/agents` | Directory to scan for agent definition files |
| `--dry-run` | `false` | Print resolved model values without writing files |
| `--policy` | `config/model-policy.yaml` | Path to the model-tier mapping policy file |

## Behaviour
1. Load `model-policy.yaml` and build a `tier → model` lookup map.
2. Scan `--agents-dir` recursively for `*.yaml` and `*.json` agent definition files.
3. For each file containing a `modelTier` field, resolve it against the policy map.
4. Validate the resolved model ID is a recognised Anthropic model name.
5. Write the resolved `model` field into the agent file alongside (or replacing) `modelTier`.
6. Track which files were updated and which already had the correct value (no-op).
7. If any `modelTier` value has no mapping in policy, emit a warning and skip that file.
8. Write a build manifest to `build/agents-manifest.json` listing all resolved assignments.

## Events emitted
- `agents.build.started` — agent count, policy path
- `agent.model.resolved` — agent file, modelTier, resolved model
- `agent.model.unresolved` — agent file, unrecognised tier (warning)
- `agents.build.completed` — updated count, skipped count

## Example
```bash
# Run during Aegis framework update:
/qa-build-agents --dry-run
```
Previews all tier → model resolutions without writing any files.
