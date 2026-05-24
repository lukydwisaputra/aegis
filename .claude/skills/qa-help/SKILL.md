---
name: qa-help
description: Render a top-10 command cheat sheet in the terminal
---

# /qa-help

## Purpose
Prints a concise, colour-formatted cheat sheet of the most commonly used QA pipeline commands directly in the terminal. Groups commands by category, shows the most important flags for each, and includes a one-line description. Designed to be memorised quickly or used as a fast reference without leaving the terminal.

## Usage
```
/qa-help
```

## Key flags
*(No flags — always prints the full cheat sheet)*

## Behaviour
1. Load the command registry from `config/commands.yaml` (or a static embedded list if the file is absent).
2. Select the top 10 most commonly used commands based on a curated priority ranking:
   - `/qa-start`, `/qa-smoke`, `/qa-status`, `/qa-stop`, `/qa-resume`
   - `/qa-rerun-failed`, `/qa-gate-check`, `/qa-health`, `/qa-compare`, `/qa-export`
3. Group by category: Core, Workflow, Admin, CI/CD.
4. For each command, print: name, one-line description, and key flags with short descriptions.
5. Append a footer with links to: full HANDBOOK.md, GitHub repo, and the `/qa-doctor` diagnostic command.
6. Use ANSI colour codes for headings and flag names if the terminal supports colour; fall back to plain text.

## Events emitted
*(Read-only display command — no events emitted)*

## Example
```
/qa-help
```
Prints a formatted cheat sheet grouped by category with key flags for the top 10 commands.

Sample output (abridged):
```
CORE
  /qa-start       Launch a full STLC cycle    --module --env --type
  /qa-smoke       Fast PR gate (~10 min)      --budget --module
  /qa-status      Show run status             --watch --json
  /qa-stop        Abort a running cycle       --reason

Run /qa-doctor for diagnostics | See HANDBOOK.md for full reference
```
