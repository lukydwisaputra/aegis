---
name: qa-ingest-book
description: Chunk a QA reference book or document into the knowledge base for use by downstream agents
---

# /qa-ingest-book

## Purpose
Parses a QA book, standards document, or internal guide and splits it into structured chunks stored in `knowledge/`. Each chunk is tagged with its source, chapter, and topic so that specialist agents and the test-design agent can perform targeted retrieval. Supports auto-chapter detection for documents with Markdown or PDF heading structure.

## Usage
```
/qa-ingest-book --book=<path> [--auto-chapters]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--book` | *(required)* | Path to the source document (Markdown, PDF, or plain text) |
| `--auto-chapters` | `false` | Detect chapter boundaries from heading levels rather than page breaks |

## Behaviour
1. Validate the file exists and determine its format (Markdown, PDF, text).
2. If `--auto-chapters`, split on H1/H2 headings (Markdown) or PDF bookmark structure.
3. Otherwise, split into fixed-size chunks (~800 tokens) with 100-token overlap.
4. For each chunk, extract metadata: source file, chapter title, page/line range, detected topics.
5. Write each chunk to `knowledge/{book-slug}/{NNN}.json` with metadata and content fields.
6. Update `knowledge/index.json` with the new book entry and chunk count.
7. Report total chunks created and estimated retrieval coverage.

## Events emitted
- `book.ingest.started` — source path, detected format, chunking strategy
- `book.chunk.written` — per chunk: ID, chapter, token count
- `book.ingest.completed` — total chunks, knowledge index updated

## Example
```
/qa-ingest-book --book=docs/istqb-foundation.pdf --auto-chapters
```
Ingests the ISTQB Foundation syllabus PDF, splitting by chapter headings into the knowledge base.
