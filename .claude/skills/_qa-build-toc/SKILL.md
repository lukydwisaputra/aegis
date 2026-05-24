---
name: qa-build-toc
description: "Internal: regenerate HANDBOOK.md table of contents from all heading anchors in the document"
---

# /qa-build-toc

<!-- INTERNAL SKILL — not user-invocable. Run as a pre-commit hook and during framework build steps. -->

## Purpose
Parses `HANDBOOK.md` (and optionally other designated Markdown documentation files) and regenerates the Table of Contents section by extracting all H1/H2/H3 headings and building a properly nested, anchor-linked TOC. Ensures the TOC never drifts from the actual document structure. Intended to be run automatically via a pre-commit hook or during the framework build step.

## Usage
```
/qa-build-toc [--file=HANDBOOK.md] [--max-depth=3] [--dry-run]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--file` | `HANDBOOK.md` | Markdown file to process |
| `--max-depth` | `3` | Maximum heading depth to include in TOC (1 = H1 only, 3 = H1-H3) |
| `--dry-run` | `false` | Print the generated TOC without modifying the file |

## Behaviour
1. Read the target Markdown file.
2. Locate the TOC section delimited by `<!-- TOC -->` and `<!-- /TOC -->` markers.
3. Extract all headings from the document body (outside the TOC section) up to `--max-depth`.
4. For each heading, generate a GitHub-compatible anchor slug (lowercase, spaces to hyphens, strip punctuation).
5. Build a nested Markdown list with proper indentation for H2 and H3 entries.
6. Replace the content between `<!-- TOC -->` and `<!-- /TOC -->` markers with the new list.
7. Write the updated file back to disk (unless `--dry-run`).
8. Report the number of TOC entries generated and any duplicate anchors detected.

## Events emitted
- `toc.build.started` — file path, heading count found
- `toc.build.completed` — entry count, duplicate anchor warnings (if any)

## Example
```bash
# Run automatically by pre-commit hook:
/qa-build-toc --file=HANDBOOK.md --max-depth=2
```
Regenerates the HANDBOOK.md TOC using only H1 and H2 headings.
