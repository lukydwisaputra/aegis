---
topic: rag-and-knowledge-design
sources:
  - book: genai-testing-winteringham
    chapters: [11]
    role: primary
  - book: genai-testing-winteringham
    chapters: [10]
    role: secondary
ingestedAt: "2026-05-24"
---

# RAG and Knowledge Design (Cross-Book Synthesis)

> _Validates and documents Aegis's `knowledge/` directory design. Aegis's filesystem + frontmatter knowledge structure is a manually-curated proto-RAG corpus. This file establishes the canonical five-stage RAG pipeline, maps Aegis v1 onto it, and defines the v2 upgrade path (vector embeddings + semantic search). Primary consumer is `qa-knowledge-librarian`._

---

## Why RAG exists

A general-purpose LLM is trained on broad public corpora. It has no exposure to your codebase, domain vocabulary, test suite, architecture decisions, or product risk profile. When asked a question that depends on any of that specific context, the model fills the gap with plausible-but-generic content drawn from its training data (genai-testing-winteringham ch-10).

The naive fix — paste all relevant context into every prompt — fails for three reasons (genai-testing-winteringham ch-10, ch-11):

1. **Context-window ceiling.** Every model has a maximum token budget (4k for compact models, 128k+ for long-context models). Real codebases and knowledge bases exceed any window. When prompts exceed the window the model truncates or errors — neither acceptable when the missing tokens contain the acceptance criteria your generator depends on.
2. **Token cost.** Per-token API pricing makes saturated prompts expensive at scale. A fully-saturated 128k prompt costs roughly $1.28 per call at GPT-4 Turbo rates; CI-pipeline or always-on agent usage compounds quickly.
3. **Noise degrades accuracy.** A larger window does not eliminate the problem — it defers it. Packing many marginally-related documents adds noise that pushes responses toward vague generalisations and makes debugging harder (which document caused the wrong answer?).

The goal is **targeted injection**: enough context to be specific, not so much that signal drowns in noise (genai-testing-winteringham ch-11).

---

## The canonical RAG pipeline (five stages)

From Winteringham Ch 11:

1. **Ingest** — load documents into a queryable store (files, database, vector index).
2. **Embed / index** — represent each document in a form that supports similarity comparison. For basic setups this is raw text; for advanced setups it is a numeric vector produced by an embedding model.
3. **Retrieve** — given a user query, score every document and return the top-k most relevant entries (with a relevance threshold to filter noise).
4. **Augment** — slot the retrieved documents into a prompt template alongside the original query.
5. **Generate** — send the augmented prompt to the LLM and surface the response.

Steps 1-2 establish the corpus. Steps 3-5 happen on every query. The separation of corpus from model is one of RAG's primary operational advantages: the corpus can be updated without redeploying or fine-tuning anything (genai-testing-winteringham ch-11).

---

## Aegis's `knowledge/` as a proto-RAG corpus

Aegis's `knowledge/{book-slug}/ch-XX.md` directory is a manual implementation of stages 1-2 (genai-testing-winteringham ch-11):

- **Ingest** = the `knowledge/` directory tree, populated by ingestion subagents reading source books.
- **Chunking** = one markdown file per chapter (or per chapter section). The Ch 11 worked example uses one user-story per file; Aegis applies the same coherent-unit-per-file principle to chapters.
- **Indexing** = filesystem path + frontmatter metadata (`topics`, `applies_to_agents`, `cross_refs`). The frontmatter is structured metadata a retrieval layer uses to pre-filter candidates before any similarity scoring.

This maps directly to Ch 11's worked Java example: flat files, one coherent artefact per file, loaded by a librarian and matched to queries.

### `qa-knowledge-librarian` as the retrieval layer

The `qa-knowledge-librarian` agent performs stage 3 — retrieval. In v1 this retrieval is **keyword-based + frontmatter-filtered**, which is the manual-curation equivalent of the cosine-distance prototype from Ch 11 §3.4. The chapter's worked failure mode applies directly: when the user query was "I want a list of risks to test for the delete booking endpoint", cosine distance returned a user-story about *retrieving* a booking — the lexical overlap beat the actual delete story (genai-testing-winteringham ch-11).

The v1 librarian compensates for this lexical-similarity gap by relying on (a) curated `applies_to_agents` frontmatter and (b) the orchestrator's explicit reference to chapter or topic names. This works at the current corpus size; as the corpus grows, semantic retrieval becomes necessary.

### Orchestrator + workers as augment-and-generate

The `qa-orchestrator` and worker agents perform stages 4-5. They receive retrieved knowledge chunks from the librarian, slot them into their working prompts (the augment step), and produce artefacts — test plans, risk registers, defect reports (the generate step) (genai-testing-winteringham ch-11).

The chapter's demonstration is the empirical basis for Aegis's design: context-rich prompts produced risks tied to specific JSON parameters and acceptance-criteria clauses, while context-free prompts returned generic categories with no connection to the actual endpoint's payload shape (genai-testing-winteringham ch-11).

---

## Corpus design principles (Aegis-specific application)

From Ch 11 §7:

### Granularity of chunks

Each document should represent a coherent, self-contained unit. Ch 11's example uses one user story per file — context, acceptance criteria, and payload contract all in one place. Splitting mid-sentence or across files breaks internal coherence and degrades retrieval quality (genai-testing-winteringham ch-11).

For Aegis: one chapter section per file (current practice) is the right starting point. If broad-query retrieval quality degrades, split large sections into sub-chunks that inherit frontmatter metadata. Mixing unrelated topics in a single chunk increases the chance of a false-positive retrieval.

### Richness of artefact content

The quality of a RAG response is bounded by the quality of the injected document. A user story specifying JSON field names, status codes, and edge-case handling produces test ideas tied to those specifics. A vague user story produces vague test ideas even with perfect retrieval (genai-testing-winteringham ch-11).

For Aegis: chapter chunks must be paraphrased deeply enough that the LLM can ground responses in concrete claims, not summary-level abstractions. Synthesis files (this directory) play the same role — they are higher-density, cross-book chunks designed for retrieval over multiple agents.

### Provenance tracking

Ch 11's vector-DB demonstration appended a `Source:` line identifying which file(s) were retrieved. Provenance is not cosmetic: it lets a human auditor verify the retrieval was appropriate, diagnose wrong-document errors, and rebuild trust after a failure (genai-testing-winteringham ch-11).

For Aegis: agents that inject knowledge chunks should record which chunk(s) were used in their output metadata. Every cited claim in this synthesis directory carries `(book-slug ch-XX)` provenance for the same reason.

### Keeping the corpus current

Documents stored separately from the model can be updated independently — but stale embeddings or out-of-date content silently degrade retrieval quality. Corpus maintenance is a first-class operational concern, not an afterthought (genai-testing-winteringham ch-11).

For Aegis: knowledge files carry an `ingestedAt` frontmatter date. v2 should add a `last_reviewed` date so the librarian can flag potentially stale material when it is retrieved.

---

## v1 → v2 upgrade path

The chapter's progression from cosine-distance string similarity to embedding-based vector search defines Aegis's upgrade path (genai-testing-winteringham ch-11):

| Aegis version | Retrieval mechanism | Equivalent in Ch 11 |
|---|---|---|
| v1 (current) | Keyword match + frontmatter filter + manual cross-refs | §3.4 cosine-distance prototype |
| v2 (proposed) | Embedding-based vector search over `knowledge/` and `synthesis/` | §5 Canopy/Pinecone (vector DB) |

### Why v2 matters

The v1 cosine-equivalent approach has the same two structural gaps the chapter identifies (genai-testing-winteringham ch-11):

1. **Lexical not semantic.** Two documents using different vocabulary for the same concept ("delete booking" vs "cancel reservation") score as dissimilar. QA artefacts especially suffer from this — user queries ("risks for the delete endpoint") rarely match artefact vocabulary ("As a guest, in order to cancel my booking…").
2. **Single-document retrieval.** A broad query like "list tests for each Booking endpoint" should pull in five separate user stories simultaneously. A keyword-matched single-best-match returns only one and silently omits the rest.

Vector retrieval addresses both: semantic embedding distance handles paraphrase and synonymy, and top-k ranking with a relevance threshold supports multi-document retrieval for broad queries (genai-testing-winteringham ch-11).

### v2 implementation options

The chapter demonstrates Canopy (Pinecone-managed) as a fast-to-value option that gives up control (chunking strategy, embedding model, scoring threshold) in exchange for setup speed. For production systems, lower-level libraries (LlamaIndex, Weaviate) offer more configurability (genai-testing-winteringham ch-11).

For Aegis v2 the practical sequence:

1. Generate embeddings for every file in `knowledge/` and `synthesis/`.
2. Index in a vector store (managed or self-hosted).
3. Reformulate librarian queries before retrieval (Ch 11 §10 Pattern D): expand synonyms, map to canonical terminology, so query vocabulary matches corpus vocabulary.
4. Return ranked multi-document results with relevance scores and source paths.
5. Add re-embedding on file edits to prevent stale-embedding drift (Ch 11 §8 anti-pattern).

---

## Relevance-algorithm taxonomy

For reference when evaluating retrieval options (genai-testing-winteringham ch-11 §6):

| Algorithm | Behaviour | Aegis use |
|---|---|---|
| Cosine distance (string) | Token-overlap; ignores meaning | Acceptable v1 prototype; fails on paraphrase |
| Levenshtein distance | Character-edit distance | Typo tolerance only; not for semantic retrieval |
| Jaccard similarity | Set-intersection of token sets | Reasonable for keyword-dense corpora |
| Embedding-based vector distance | Semantic similarity in high-dimensional space | Recommended v2; handles paraphrase + synonymy |

For QA-focused RAG (user stories, test plans, API specs, synthesis files), embedding-based retrieval is strongly preferable because query vocabulary rarely matches artefact vocabulary verbatim.

---

## Practical patterns for QA use

From Ch 11 §10:

### Pattern A — Artefact-scoped test-idea generation

Maintain one chunk per user story or feature spec. At planning time, retrieve chunks for the feature under test (by story ID, component name, or semantic similarity) and inject them into the test-idea prompt. Produces risks tied to specific field names and acceptance criteria rather than generic categories (genai-testing-winteringham ch-11).

### Pattern B — Multi-entity / endpoint-spanning analysis

For queries spanning multiple endpoints or features, use multi-document retrieval (top-k vector search) to gather all relevant chunks before prompting. Ch 11's demo showed "list tests for each Booking endpoint" returned coherent coverage of five distinct endpoints when five matching documents were retrieved (genai-testing-winteringham ch-11).

### Pattern C — No-RAG baseline comparison

When presenting test-idea outputs to a team, run the same query with and without RAG and include both responses. The contrast makes the value of the context corpus visible and builds team buy-in for corpus-maintenance effort (genai-testing-winteringham ch-11).

### Pattern D — Query reformulation before retrieval

User queries and artefact documents rarely use identical vocabulary. Before similarity search, reformulate the query to match the language of the corpus (synonym expansion, canonical-term mapping). Especially relevant for Aegis agents whose internal vocabulary may diverge from knowledge-base vocabulary over time (genai-testing-winteringham ch-11).

---

## Anti-patterns

From Ch 10 and Ch 11:

- **Indiscriminate retrieval.** Returning the maximum number of documents regardless of relevance fills the context window with noise and pushes responses toward generic answers — exactly the problem RAG is meant to solve. Relevance thresholds, top-k limits, and re-ranking exist to prevent this (genai-testing-winteringham ch-11).
- **Stale embeddings.** Editing corpus documents without re-embedding makes the index inaccurate. Queries retrieve based on old embedding, not new text (genai-testing-winteringham ch-11).
- **Treating RAG as a magic context-injector.** RAG cannot compensate for a poor query, an under-specified prompt, or a corpus that does not contain the needed information. RAG is one layer in a quality stack (genai-testing-winteringham ch-11).
- **No relevance scoring or provenance.** Without visibility into which documents were retrieved at what score, debugging is guesswork. When the model produces a wrong answer, the first question must be "was the right document retrieved?" — and that requires inspectable retrieval (genai-testing-winteringham ch-11).
- **Single-document retrieval for multi-entity queries.** Broad queries referencing multiple entities require multi-document retrieval. A system returning only one document silently provides incomplete context, producing plausible-looking but incomplete responses (genai-testing-winteringham ch-11).
- **Brute-forcing full context into every prompt.** For any non-trivial codebase or knowledge corpus you will either hit the context-window ceiling or generate unsustainable token costs (genai-testing-winteringham ch-10).
- **Assuming customization makes the LLM deterministic.** A RAG system is only as good as its retrieval step. Retrieval errors produce confidently wrong outputs. Structured output validation and human review remain essential even with extensive customization (genai-testing-winteringham ch-10).

---

## RAG vs. fine-tuning — when to use which

The chapters frame these as complementary, not competing (genai-testing-winteringham ch-10, ch-11):

**RAG when:**
- The knowledge domain changes frequently (corpus updates are cheaper than retraining).
- Transparency and provenance are required (retrieved documents are inspectable).
- The knowledge base is large relative to what any single query needs.
- Speed-to-value and learning-curve matter (RAG is an extension of prompt engineering).

**Fine-tuning when:**
- The goal is to change how the model reasons or communicates (tone, vocabulary, response style), not what facts it knows.
- The relevant knowledge is stable enough to bake into weights.
- Latency and cost constraints make context-window injection impractical.
- Privacy/deployment requirements demand a self-hosted model.

For Aegis's current architecture, RAG is the primary mechanism: the knowledge base is actively growing, domain specificity is about artefact content (test coverage, risk areas, API specs), and provenance matters for audit. Fine-tuning is a longer-term option for domain-vocabulary alignment when style and naming-convention drift becomes a persistent problem (genai-testing-winteringham ch-10, ch-11).

---

## Cross-book agreements

- The single strongest empirical claim across both source chapters: **context specificity comes from the retrieved/injected document, not from the LLM's training weights**. Context-rich prompts produced field-level specific risks; context-free prompts produced generic categories. This is the foundational claim that justifies the entire `knowledge/` directory existing (genai-testing-winteringham ch-10, ch-11).
- Both chapters treat the context-window constraint as a live operational concern, not a theoretical one. Every prompt budgets tokens; broad context-stuffing is not a solution.
- Both chapters insist customization (RAG or fine-tuning) does not make the LLM deterministic. Skepticism and human review remain non-negotiable.

## Cross-book disagreements / different framings

The two chapters are tightly aligned — Ch 10 is the concept and tradeoffs, Ch 11 is the implementation. No genuine disagreements. The only framing difference is positioning: Ch 10 frames RAG as one strategy on a customization spectrum (with fine-tuning at the other end); Ch 11 frames RAG as a structured solution to context-window and token-cost constraints. Both views are consistent.

---

## Pointers

- **Used by agents:** `qa-knowledge-librarian` (primary — retrieval mechanics, chunk-granularity, provenance, freshness signals), `qa-orchestrator` (augment-and-generate stage, multi-document retrieval for broad goals), `qa-curator` (corpus-design principles when proposing new lessons or synthesis chunks), `qa-test-planner` and `qa-test-designer` (consumers of retrieved context).
- **Used by skills:** any skill that retrieves knowledge before constructing a prompt — librarian retrieval, orchestrator delegation, lesson proposal.
- **Cross-ref:** [[synthesis/prompt-engineering.md]] — RAG-injected context plus delimiter/structured-output patterns is the canonical augmented-prompt structure. [[synthesis/ai-agents-patterns.md]] — agent tool-calling can wrap retrieval; the "analysis agent" pattern (multi-source aggregation) is the manual precursor to RAG.
