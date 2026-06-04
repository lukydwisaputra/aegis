---
book: genai-testing-winteringham
chapter: 11
title: "Contextualizing prompts with retrieval-augmented generation"
pages: "218-241"
topics:
  - rag
  - retrieval-augmented-generation
  - embeddings
  - vector-search
  - vector-database
  - knowledge-base-design
  - chunking
  - semantic-search
  - hybrid-retrieval
  - llm-customization
applies_to_agents:
  - qa-orchestrator
  - qa-curator
  - qa-knowledge-librarian
  - qa-test-planner
  - qa-test-designer
cross_refs:
  - "[[ch-09-ai-agents-as-testing-assistants]]"
  - "[[ch-10-introducing-customized-llms]]"
  - "[[ch-12-fine-tuning-llms-with-business-domain-knowledge]]"
---

# Chapter 11 — Contextualizing prompts with retrieval-augmented generation

> RAG is the practice of identifying documents from a corpus that are relevant to a user
> query, then injecting those documents alongside the query into a prompt before sending
> it to an LLM. The chapter walks through building a basic Java RAG prototype, explains
> why simple string-similarity algorithms fall short, and upgrades to a vector-database-
> backed framework using Pinecone/Canopy. Aegis's `knowledge/` folder is a manual
> proto-RAG corpus; the `qa-knowledge-librarian` agent is its retrieval layer.

---

## 1. Why RAG exists

### 1.1 The context-window constraint

Every LLM enforces a maximum sequence length — its **context window** — measured in
tokens. Tokens are roughly equivalent to word fragments; a model such as Llama-2 ships
with a default window of 4 096 tokens, which is approximately ten pages of prose. Testing
and development artefacts — user stories, test scripts, API specifications, monitoring
dashboards — routinely exceed that budget individually, let alone collectively.

When a prompt exceeds the context window, the model either silently truncates the
trailing tokens or returns an error. Neither outcome is acceptable when those tokens
contain the acceptance criteria your test-idea generator depends on.

### 1.2 Token cost at enterprise scale

Models that charge per token make context-window efficiency a budget concern as well
as a quality concern. At the time the book was written, GPT-4 Turbo (128k context) cost
roughly $10 per million tokens, meaning a fully-saturated prompt would cost about
$1.28 per call. Even fractional saturation adds up quickly across a CI pipeline or an
always-on QA agent. RAG answers both problems — quality and cost — by injecting
only the documents that are genuinely relevant to the current query.

### 1.3 Accuracy degrades with noise

A larger context window does not eliminate the problem; it defers it. Packing many
marginally related documents into a prompt adds noise that the model has to parse
before it can reason. This noise can push responses toward vague generalisations instead
of targeted, context-specific answers. It also makes debugging harder: when a prompt
contains thirty documents and the response is wrong, identifying which document
(or whose absence) caused the error is non-trivial.

The sweet spot is **targeted injection** — enough context to be specific, not so much
that signal drowns in noise.

### 1.4 Separation of corpus from model

Storing the reference corpus independently from the LLM and the prompt-generation
logic means the corpus can be updated without redeploying or fine-tuning anything.
Any data source works as a corpus — project-management tickets, wiki pages, test
scripts, monitoring metrics — as long as a relevance check can be run against it at
query time. This architectural separation is one of RAG's most practical operational
advantages.

---

## 2. The RAG pipeline

The canonical five-stage flow:

1. **Ingest** — load documents into a queryable store (files, database, vector index).
2. **Embed / index** — represent each document in a form that supports similarity
   comparison (for basic setups this is raw text; for advanced setups it is a numeric
   vector produced by an embedding model).
3. **Retrieve** — given a user query, score every document and return the top-k most
   relevant entries.
4. **Augment** — slot the retrieved documents into a prompt template alongside the
   original query.
5. **Generate** — send the augmented prompt to the LLM and surface the response.

The chapter focuses on steps 3-5 through concrete code and tooling; steps 1-2 are
illustrated first with flat files and then with a managed vector database.

---

## 3. Building a basic RAG framework (Java prototype)

### 3.1 Corpus structure

The worked example uses a folder of plain-text user stories, one file per story. Each
story follows a "As a … I want … Acceptance Criteria … HTTP Payload Contract" format —
structured enough for a relevance algorithm to work with, but no different from any
project-management export. The author is explicit that this data could have been pulled
from a project management platform, a test management tool, wiki entries, or any
structured artefact a team already maintains.

### 3.2 Loading the corpus

A utility method scans the resource folder, reads every `.txt` file into a `String`, and
returns a `List<String>`. This list is the in-memory corpus for the session. For real
deployments the corpus would be loaded from a database or cached, not read from disk
on every request.

### 3.3 The prompt template

The template uses two parameterised slots:

- `{relevant_document}` — delimited by `###` — receives the retrieved user story.
- `{user_input}` — delimited by triple backticks — receives the raw user query.

The system message instructs the model to act as an expert software tester, to compile
a list of testing risks, to cite which part of the user story each risk derives from, and
to verify the citation before outputting it. The citation requirement is a quality gate
that makes hallucinated risks easier to detect: a risk that cannot be traced back to a
sentence in the user story is a signal that the wrong document was retrieved.

### 3.4 Relevance matching with cosine distance

The first relevance algorithm used is **cosine distance** from the Apache Commons Text
library. For every document in the corpus, the method computes a distance score
between the document string and the query string. The document with the lowest
distance score is returned as the closest match.

The method is simple and fast but has a structural limitation: it operates on raw string
tokens without any understanding of meaning. Two strings that use completely different
words to describe the same concept (e.g., "delete booking" vs. "cancel reservation")
will score as dissimilar even if they are semantically equivalent. Conversely, a document
that shares many words with the query by coincidence may outscore a document that is
genuinely relevant.

#### Observed failure mode

When the query was "I want a list of risks to test for the delete booking endpoint", the
cosine distance algorithm returned a user story about *retrieving* a booking by ID —
not deleting one. The lexical overlap between the booking-retrieval story and the query
was sufficient to beat the actual delete story. The author uses this failure to motivate
the move to vector databases.

### 3.5 Completing the pipeline

Once the closest match is identified, the two placeholder tokens in the prompt template
are replaced with the retrieved document and the user query. The populated prompt is
forwarded to `gpt-3.5-turbo` via LangChain4j.

**With RAG engaged**, the response listed specific JSON parameters from the user story's
HTTP payload contract, cited the acceptance-criteria clauses, and grounded every risk
in the artefact text.

**Without RAG** (same prompt, placeholder removed), the response returned generic
categories — boundary testing, data validation, performance testing, security testing —
with no connection to the actual endpoint's payload shape or constraints.

The contrast makes the point cleanly: context specificity comes from the retrieved
document, not from the LLM's training weights.

---

## 4. Limitations of the prototype

| Limitation | Cause | Consequence |
|---|---|---|
| Lexically similar but semantically wrong document returned | Cosine distance on raw tokens has no semantic understanding | Wrong context injected; LLM produces plausible-sounding but misleading risks |
| Only one document returned per query | Basic loop returns a single closest match | Broad queries that span multiple user stories receive only partial context |
| Corpus changes require a restart | Files loaded at startup into memory | No live corpus updates without redeployment |
| Debugging is opaque | No score or provenance surfaced to the caller | Hard to tell why a particular document was selected |

The single-document limitation is especially visible when queries like "list tests for
each Booking endpoint" should draw on five separate user stories simultaneously. With
the basic prototype, only one story is injected and the rest are silently ignored.

---

## 5. Vector databases and why they improve retrieval

### 5.1 What a vector is

A vector is an ordered list of numbers that locates a document (or a query) as a point
in a high-dimensional space. The intuition from 2D: a character at (0,0) is closer to an
entity at (5,5) — distance 7.07 — than to one at (10,10) — distance 14.14. In text
applications, the dimensions are produced by an embedding model and encode
semantic meaning, not just lexical content.

The key difference from cosine distance on raw strings: two documents that use
different words but describe the same concept will end up near each other in the
embedding space because the embedding model has learned their semantic relationship
from a large training corpus. "Delete booking" and "cancel reservation" would occupy
nearby coordinates; "delete booking" and "retrieve room list" would be far apart.

### 5.2 Multi-dimensional distance and multi-document retrieval

Because relevance is computed across many dimensions simultaneously, a vector
database can:

- Return a **ranked list** of documents rather than a single closest match.
- Define a **relevance threshold** (a maximum acceptable distance) so that only
  documents within a useful range are included.
- Return **multiple documents** for a single query when several fall within the threshold.

This directly addresses the two biggest gaps in the prototype: semantic accuracy and
multi-document retrieval.

### 5.3 Canopy / Pinecone as a managed RAG platform

The chapter demonstrates vector-database-backed RAG using **Canopy**, a framework
built by Pinecone that wraps a managed cloud vector database. The workflow:

1. Set environment variables for the Pinecone API key, OpenAI API key, and index name.
2. Run `canopy new` to create the index in Pinecone's cloud.
3. Run `canopy upsert <folder>` to upload documents; Canopy handles chunking and
   embedding internally.
4. Run `canopy start` to start the RAG server.
5. Run `canopy chat --no-rag` to open an interactive session that shows responses both
   with and without RAG enabled, side by side.

The trade-off is explicit: Canopy gives up control (chunking strategy, embedding model,
scoring threshold) in exchange for speed to value. For production systems, lower-level
libraries such as LlamaIndex or Weaviate offer more configurability.

### 5.4 Observed improvements with vector-database RAG

**Single-entity query**: "List different types of tests for each JSON parameter in the
PUT branding endpoint" — the vector-backed system returned tests tied precisely to
the JSON fields defined in the user story's HTTP payload contract, and appended a
provenance citation (`Source: src/main/resources/data/put-branding.txt`).

**Multi-entity query**: "List different types of tests for each Booking endpoint" — the
system pulled in all five booking-related user stories simultaneously and produced a
structured response covering GET, POST, GET-by-ID, PUT-by-ID, and GET-summary
endpoints, with a source citation pointing to the root data folder. The prototype would
have returned only one story.

---

## 6. Relevance algorithms: a brief taxonomy

The chapter mentions several similarity tools without deep derivation:

| Algorithm | Behaviour | Use case |
|---|---|---|
| Cosine distance (string-based) | Measures overlap of token sets; ignores semantic meaning | Fast prototyping; works when query and document share many of the same words |
| Levenshtein distance | Character-edit distance; best for typo tolerance | Not well-suited for semantic retrieval |
| Jaccard similarity | Set-intersection ratio of token sets | Reasonable for keyword-dense corpora |
| Embedding-based vector distance | Semantic similarity in high-dimensional space | Production retrieval; handles paraphrase and synonymy |

For QA-focused RAG corpora (user stories, test plans, API specs), embedding-based
retrieval is strongly preferable because the vocabulary of a query ("I want risks for the
delete endpoint") rarely matches the vocabulary of the artefact ("As a guest in order to
cancel my booking…") word for word.

---

## 7. RAG corpus design principles (derived from the chapter)

### 7.1 Granularity of chunks

Each document in the corpus should represent a coherent, self-contained unit of
information. The chapter uses one user story per file. This is effective because a user
story is self-contained: it includes context, acceptance criteria, and a payload contract.
Splitting it mid-sentence or across files would break the internal coherence and degrade
retrieval quality.

For Aegis's `knowledge/` folder the equivalent principle is: one chapter section per
document, or at minimum one topic per document. Mixing unrelated topics in a single
chunk increases the chance of a false positive during retrieval.

### 7.2 Richness of artefact content

The worked example highlights that the quality of a RAG response is bounded by the
quality of the injected document. A user story that specifies JSON field names,
acceptable status codes, and edge-case handling produces test ideas tied to those
specifics. A vague user story produces vague test ideas even with perfect retrieval.
Corpus curation — ensuring documents are detailed, accurate, and current — is as
important as the retrieval algorithm.

### 7.3 Provenance tracking

The Canopy responses included a `Source:` line identifying which file(s) were retrieved.
This is not cosmetic: provenance lets a human auditor verify that the retrieved context
was appropriate, diagnose wrong-document errors, and rebuild trust after a failure.
Any production RAG system should surface provenance alongside the response.

### 7.4 Keeping the corpus current

Documents stored separately from the model can be updated independently. But if the
corpus drifts (user stories are revised, APIs change) while embeddings or cached
similarity scores remain stale, retrieval quality silently degrades. Corpus maintenance
needs to be a first-class operational concern, not an afterthought.

---

## 8. Anti-patterns

### 8.1 Indiscriminate retrieval

Returning the maximum number of documents regardless of actual relevance fills the
context window with noise and pushes the response toward generic answers — exactly
the problem RAG is meant to solve. Relevance thresholds, top-k limits, and re-ranking
steps all exist to prevent this.

### 8.2 Stale embeddings

If documents in the corpus are edited or replaced after embeddings have been
generated, the embedding index no longer accurately represents the current content.
Queries will retrieve documents based on the old embedding, not the new text. Corpus
updates must trigger re-embedding.

### 8.3 Treating RAG as a magic context-injector

RAG improves response quality by supplying relevant context, but it cannot compensate
for a poorly phrased query, an under-specified prompt, or a corpus that does not
actually contain the information needed. RAG is one layer in a quality stack, not a
substitute for prompt engineering or domain-appropriate corpus curation.

### 8.4 No relevance scoring or provenance surfaced

Without visibility into which documents were retrieved and at what relevance score,
debugging is guesswork. When the model produces a wrong answer, the first diagnostic
question should always be: was the right document retrieved? If retrieval is a black box,
that question cannot be answered.

### 8.5 Single-document retrieval for multi-entity queries

Broad queries that reference multiple entities (endpoints, features, components) require
multi-document retrieval. A system that returns only one document will silently
provide incomplete context, producing responses that look plausible but omit entire
categories of risk.

---

## 9. Aegis-specific mapping

### 9.1 `knowledge/` as a proto-RAG corpus

Aegis's `knowledge/{book-slug}/ch-XX.md` structure is a manual implementation of
the ingest and chunking stages of a RAG pipeline. Each markdown file is a chunk.
The slug-based folder hierarchy provides coarse-grained namespace isolation. The
frontmatter fields (`topics`, `applies_to_agents`, `cross_refs`) are structured metadata
that a retrieval layer can use to pre-filter before running similarity scoring.

This maps directly to the chapter's worked example: flat files, one coherent artefact
per file, loaded into memory (or, in Aegis's case, loaded by a librarian agent) and
matched to a query.

### 9.2 `qa-knowledge-librarian` as the retrieval layer

The `qa-knowledge-librarian` agent performs the retrieval step in Aegis's pipeline. In
v1 that retrieval is keyword-based and file-system-driven — equivalent to the cosine
distance prototype. The chapter's progression from string similarity to vector search
defines a clear upgrade path:

| Aegis version | Retrieval mechanism | Equivalent in chapter |
|---|---|---|
| v1 | Keyword match + frontmatter filter | Section 11.2 — cosine distance prototype |
| v2 (proposed) | Embedding-based vector search over `knowledge/` | Section 11.3 — Canopy/Pinecone setup |

### 9.3 Augmentation and generation

The `qa-orchestrator` and `qa-test-planner` agents correspond to the augment and
generate stages: they receive the retrieved knowledge chunks from the librarian, slot
them into their working prompts, and produce artefacts (test plans, risk registers,
test cases). The chapter's demonstration that context-rich prompts produce
domain-specific outputs while context-free prompts produce generic ones is the
empirical basis for Aegis's knowledge-injection architecture.

### 9.4 Design implications

- **Chunk granularity**: section-level chunking (as in Aegis's current structure) is the
  right starting point. If retrieval quality degrades on broad queries, consider splitting
  large sections into sub-chunks with inherited frontmatter metadata.
- **Provenance in agent responses**: where possible, agents that inject knowledge
  chunks should record which chunk(s) were used in their output metadata, mirroring
  the `Source:` line in Canopy responses.
- **Corpus freshness signals**: knowledge files should carry a `last_reviewed` date in
  frontmatter so the librarian can flag potentially stale material when it is retrieved.
- **Multi-chunk retrieval**: the librarian should be designed to return multiple ranked
  chunks, not just the single best match, so that broad prompts from the orchestrator
  get complete coverage.

---

## 10. Practical patterns for QA use

### Pattern A — User-story-scoped test-idea generation

Maintain one chunk per user story or feature specification. At test-planning time,
retrieve the chunks for the feature under test (by story ID, component name, or
semantic similarity) and inject them into the test-idea prompt. The chapter shows this
produces risks tied to specific field names, status codes, and acceptance criteria rather
than generic categories.

### Pattern B — Endpoint-spanning risk analysis

For queries that span multiple endpoints or features, use multi-document retrieval
(vector database or top-k similarity) to gather all relevant chunks before prompting.
The Canopy demo showed that "list tests for each Booking endpoint" returned coherent
coverage of five distinct endpoints when five matching documents were retrieved.

### Pattern C — Comparison baseline (no RAG)

When presenting test-idea outputs to a team, run the same query with and without
RAG and include both responses. The contrast makes the value of the context corpus
visible and builds team buy-in for corpus maintenance effort.

### Pattern D — Query reformulation before retrieval

User queries and artefact documents rarely use identical vocabulary. Before running
similarity search, reformulate the query to match the language of the corpus. For
example, if the corpus uses "cancel booking" but the user types "delete reservation",
a reformulation step that expands synonyms or maps to canonical terminology improves
retrieval recall. This is especially relevant for Aegis agents whose internal vocabulary
may diverge from the knowledge-base vocabulary over time.

---

## 11. RAG versus fine-tuning

The chapter closes by framing RAG and fine-tuning as complementary, not competing,
approaches. RAG is the right tool when:

- The knowledge domain changes frequently (corpus updates are cheaper than
  retraining).
- Transparency and provenance are required (retrieved documents are inspectable).
- The knowledge base is large relative to what any single query needs.

Fine-tuning (covered in chapter 12) is the right tool when:

- The goal is to change how the model reasons or communicates, not what facts it
  knows.
- The relevant knowledge is stable enough to be baked into weights.
- Latency and cost constraints make context-window injection impractical.

For Aegis's current architecture, RAG is the primary mechanism because the knowledge
base is actively growing, domain specificity is about artefact content (test coverage,
risk areas, API specs), and provenance matters for audit.

---

## 12. Summary

- **RAG** combines a corpus of reference documents with a user query by first
  identifying the most relevant documents and then injecting them into the prompt.
- **Relevance selection** is the critical step; returning irrelevant or insufficient
  context produces wrong or generic responses.
- **Context-window constraints** and **per-token costs** make targeted injection
  necessary; maximising context is not the same as maximising quality.
- **String-based similarity** (cosine distance on raw tokens) is a working prototype
  but fails when query and document use different vocabulary for the same concept.
- **Vector databases** solve this by encoding semantics in high-dimensional vectors,
  enabling multi-document retrieval and relevance thresholds.
- **Corpus design** — granularity, richness, provenance, and freshness — determines
  the ceiling on RAG quality regardless of the retrieval algorithm.
- **Aegis's `knowledge/` folder** is a manual proto-RAG corpus; the
  `qa-knowledge-librarian` is its retrieval layer; the orchestrator and planner agents
  are the augment-and-generate stages.
- The natural upgrade path is from keyword + filesystem retrieval (v1) to
  embedding-based vector search (v2).

---

## Cross-references

- `[[ch-09-ai-agents-as-testing-assistants]]` — agent architectures that consume
  RAG-retrieved context as part of their tool calls.
- `[[ch-10-introducing-customized-llms]]` — overview of the customisation spectrum;
  RAG sits at the prompt-level end, fine-tuning at the weight-level end.
- `[[ch-12-fine-tuning-llms-with-business-domain-knowledge]]` — the alternative to
  RAG when knowledge is stable and latency constraints make injection impractical.
- `[[ch-01-enhancing-testing-with-llms]]` — foundational framing of why additional
  context improves LLM output quality.
- `[[ch-02-llms-and-prompt-engineering]]` — prompt structure techniques (delimiters,
  parameterisation) that the RAG template builds on.
- `[[ch-05-test-planning-with-ai-support]]` — test planning as a consumer of
  RAG-injected user stories and acceptance criteria.
