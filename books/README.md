# books/

QA reference books used to teach Aegis the testing discipline.

## Layout

```
books/
├── raw/                       # original PDFs — GITIGNORED, never committed
│   └── {book-slug}.pdf        # you place books here locally
└── metadata.yaml              # registry of ingested books (committed)
```

## Why `raw/` is gitignored

Most QA books are commercially licensed (ISTQB, O'Reilly, Pearson). Redistributing PDFs violates publisher licenses even in private repos. Each user/team ingests their own books locally; `metadata.yaml` records WHICH books were ingested (titles + authors only — no copyrighted text).

## How to ingest a book

1. Drop the PDF at `books/raw/{book-slug}.pdf` (or paste it in chat — Aegis can read attachments)
2. Run `/qa-ingest-book` (or wait for the build assistant to prompt you)
3. Aegis chunks the book into `../knowledge/{book-slug}/` using the tiered model strategy (Haiku metadata + Sonnet chunking with prompt caching + Opus synthesis)
4. `metadata.yaml` is updated with the new book

## Cost estimate per book

~$2.80 (per the locked model strategy in the build plan). See `docs/71-book-ingestion-model-strategy.md`.

## Recommended starter library

Aegis ships no book recommendations (book selection is left to you). Common foundations include ISTQB Foundation Syllabus, Lessons Learned in Software Testing (Kaner/Bach/Pettichord), and one ISO 25010 reference.
