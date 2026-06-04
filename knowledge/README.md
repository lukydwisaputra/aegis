# knowledge/

Aegis's working memory — chunked QA book content + cross-book topic synthesis. Read by agents at runtime via `qa-knowledge-librarian`.

## Default state: gitignored

`knowledge/` is gitignored by default because chunks may contain paraphrased copyrighted content. Teams with permissive books or private repos can opt in via:

```jsonc
// aegis.config.json
{ "shareKnowledge": true }
```

This removes the gitignore rule and lets the team share the curated knowledge base.

## Layout (populated during Phase A)

```
knowledge/
├── INDEX.md                            # master cross-book index
├── {book-slug}/                        # one folder per ingested book
│   ├── index.md                        # ToC + 1-line chapter summaries
│   └── ch-XX-{title-slug}.md           # per-chapter chunks (Zod-frontmattered)
└── synthesis/                          # topic-organized cross-book layer
    ├── INDEX.md
    ├── stlc-process.md
    ├── test-design-techniques.md
    ├── risk-based-testing.md
    ├── defect-management.md
    ├── requirements-analysis.md
    ├── automation-strategy.md
    ├── api-testing.md
    ├── ui-testing.md
    ├── performance-testing.md
    ├── security-testing.md
    ├── accessibility-testing.md
    ├── exploratory-testing.md
    ├── email-testing.md
    ├── metrics-and-reporting.md
    ├── compliance-and-regulations.md
    ├── qa-frontend-skill.md            # shadcn/Tailwind/Vite patterns
    └── web-exploration-techniques.md   # BFS crawl, POM generation
```

## Chunk format

Each chapter `.md` carries YAML frontmatter:

```yaml
---
book: {slug}
chapter: {N}
pages: "{start}-{end}"
topics: [test-design, risk-based, ...]
applies_to_agents: [qa-test-designer, qa-test-planner, ...]
---
```

Sections: Core concepts · Techniques/templates · Examples (paraphrased) · Pitfalls · Cross-refs (`[[other-chapter]]` links).

## Synthesis layer

When 2+ books cover the same topic, `qa-knowledge-librarian` consolidates into the synthesis file with provenance: "from {book-slug} ch-XX".
