---
topic: data-testing
sources:
  - book: full-stack-testing-mohan
    chapters: [5]
    role: primary
  - book: genai-testing-winteringham
    chapters: [6]
    role: complementary
ingestedAt: "2026-05-24"
---

# Data Testing (Synthesis)

> Data sits at the core of every online application; integrity failures erode customer trust faster than almost any other defect class. Modern data testing spans four storage/processing systems (DB, cache, batch, streams), demands a 90% fault-finding mindset (vs. happy paths), and respects GDPR/PDPA constraints on PII. AI-generated test data is now a viable accelerator for both volume and edge-case coverage — but only when constrained by schemas and never fed real PII.

## Data integrity as a trust foundation

Applications either sell data to users (ecommerce, streaming, ride-hailing) or accumulate user data (social, blogging). In both cases data is the product, and integrity failures — wrong balances, lost photos, inconsistent posts — destroy trust faster than functional bugs (full-stack-testing-mohan ch-05). Data testing is therefore not optional; it is a primary quality skill alongside functional and security testing.

---

## The four data systems

A modern web/mobile app typically uses four collaborating data systems:

1. **Relational database** — durable, disk-backed record of truth for persistent business entities (PostgreSQL, MySQL, Oracle).
2. **Cache** — in-memory key/value store for transient, frequently-accessed data (Redis, Memcached). Sub-ms latency vs. DB round-trip.
3. **Batch processing system** — scheduled jobs transforming large volumes of file/record input (Apache Spark, Spring Batch). Measured in throughput, not response latency.
4. **Event stream** — durable near-real-time pub/sub platform (Apache Kafka, Cloud Pub/Sub, RabbitMQ).

Each carries its own properties (replication lag, TTL, data skew, retention period, partitioning, schema registry) and its own failure modes — and each needs its own test cases.

### Data flow tracing

Following data through all four layers reveals test cases invisible at the UI/API level. Example: login creates DB credentials, stores an OAuth token in cache, the token expiry triggers redirect, and order placement simultaneously writes to DB and publishes an event to the stream for warehouse and fulfillment services.

---

## The fault-finding mindset

Data testing is ~90% fault-case-focused, not happy-path-focused (full-stack-testing-mohan ch-05). Always ask:

- Network failure mid-write.
- Partial write across tables or services.
- Retry of a failed operation (duplicate, overwrite, abort?).
- Concurrent access by multiple users/services.
- Replication lag between leader and followers.
- Cache expiry at the moment of access.
- Downstream subscriber failure on event streams.
- Corrupted, null, duplicate, or out-of-range input data.

---

## Failure-mode catalog

### Eventual consistency anomalies

Leader-follower replication lag produces observable anomalies:
- **Reading your own writes** — user updates profile, immediately re-reads from lagging follower, sees stale data.
- **Time traveling** — refreshing scores reveals values moving backwards as requests hit followers at different states.
- **Inconsistent ordering** — reply appears before the question on a follower that hasn't propagated the question.
- **Write conflicts** — multiple leaders accept concurrent edits to the same resource.

### Concurrency anomalies (single-instance)

- **Lost updates** — two users purchase the last item; inventory drops by one not two.
- **Dirty reads** — availability flag flipped before stock updated; another user sees "available" with zero stock.
- **Shared resource conflicts** — two cash-on-delivery orders; allocation to one user, invoice to another.

Concurrency bugs are hard to reproduce in automated tests. Identify them during analysis and address through transaction isolation, locking, or idempotent retries.

---

## Test case catalogs by system

### Relational DB
- Schema boundary testing (column type/length enforcement).
- Special character handling (apostrophes, quotes, semicolons — SQL injection minimum).
- Partial write resilience (transaction atomicity).
- Retry behavior (idempotency).
- Timeout UX.
- Race conditions (analysis-driven; testable only loosely).
- Replication consistency (read-your-own-writes, monotonic read, consistent prefix).

### Cache
- TTL expiry behavior.
- Cache miss fallback (full outage → graceful DB fallback or redirect).
- Distributed cache consistency (sharded routing).
- Cache-DB sync windows.
- Performance under load.

### Batch processing
- Full-file processing (no silent drops).
- Corrupt/anomalous input (null, oversize integers, missing keys, mixed schemas).
- Incomplete record quarantine (flag and isolate, never silently discard).
- Retry and cleanup (no duplicates).
- Data skew (one category vastly larger).
- ETL correctness (field mapping, type coercion, deduplication).

### Event streams
- Schema contract retest on every change.
- Ordered processing (where business logic requires).
- Subscriber catchup after failure.
- Dead letter queue routing with error metadata.
- Broker outage behavior.
- Consumer throughput vs. publisher rate.
- Partition assignment and offset correctness.

---

## Data quality validation (Deequ pattern)

Apply unit tests on raw vendor data **before** batch loading and on the transformed output (full-stack-testing-mohan ch-05):

```scala
VerificationSuite()
  .onData(data)
  .addCheck(
    Check(CheckLevel.Error, "vendor file quality")
      .hasSize(_ > 100000)
      .isComplete("item_sku")
      .isUnique("item_sku")
      .isContainedIn("size", Array("S", "M", "L", "XL"))
      .isNonNegative("price")
  )
  .run()
```

Results are metric-based (e.g., "90% of price values are valid"), enabling trend monitoring. Alternatives: TensorFlow Data Validation, Great Expectations.

---

## Test data management discipline

- Prefer creating test data through the application's own APIs (not direct SQL inserts) to insulate tests from schema changes.
- Use Testcontainers (PostgreSQL, MySQL, Kafka, Cassandra, MongoDB, RabbitMQ) for unit/integration tests — clean reproducible state per run.
- Reserve direct DB access (JDBC) for legacy systems without an API surface.
- **Do not use production data in test environments** — see PII/GDPR section.

### Database portability testing

For apps targeting multiple engines (Oracle/PostgreSQL/MySQL), use Testcontainers to run the same integration suite against each engine image.

---

## AI-augmented test data generation

LLMs are effective probabilistic text generators, making them well-suited for producing structured test data (JSON, XML, SQL, CSV) when prompts encode format, types, ranges, and inter-field relationships (genai-testing-winteringham ch-06). This is a complement to traditional factories, not a replacement.

### The area-of-effect split

Human responsibility: analyze what data is required, define rules and relationships, supply format specs, verify output, ensure privacy compliance. LLM responsibility: produce volume rapidly, vary field values within stated constraints, convert between formats without losing values (genai-testing-winteringham ch-06).

For full coverage of when AI generation works, when it fails, safe prompt design, schema-driven generation patterns, and practical templates, see [[synthesis/test-data-generation.md]].

---

## GDPR / PDPA touch points

PII handling is the most consequential compliance constraint on data testing (full-stack-testing-mohan ch-05):

- Customer names, addresses, phone numbers, emails, payment details are PII subject to GDPR (Europe), PDPA (Thailand and other Asian jurisdictions), and equivalent laws.
- Test data must not contain real PII. Synthetic or fully anonymized data is mandatory.
- SQL injection sanity check: test with names containing apostrophes (e.g., "Bob D'arcy") at every input boundary.
- Cached tokens are high-value targets; TTL, isolation, and compromise fallback must be tested.
- A breach of DB records or event-stream payloads can expose PII at scale; data-store security testing is non-optional.

### LLM-specific PII risk

When using AI for test data generation, never include real PII in the prompt. Safe alternatives (genai-testing-winteringham ch-06):
- Anonymized or fully synthetic seed examples in prompts.
- Self-hosted or enterprise-licensed models that do not train on customer data.
- Review the LLM provider's data-use terms before sending proprietary schemas.

---

## Tools

| Purpose | Tool |
|---|---|
| Direct SQL (ad-hoc) | psql, pgAdmin, MySQL Workbench |
| Java DB assertions | JDBC + REST Assured/TestNG/JUnit |
| Isolated DB containers | **Testcontainers** (PostgreSQL, MySQL, Cassandra, MongoDB, Kafka, RabbitMQ) |
| Kafka declarative testing | **Zerocode** (JSON/YAML, JUnit) |
| Data quality validation | **Deequ** (Spark/Scala), Great Expectations, TensorFlow Data Validation |
| Synthetic data factories | Faker, Mimesis, Bogus |
| AI-augmented generation | OpenAI / Claude / local LLMs + LangChain4j or direct API |
| Schema validation | Zod (TS), Ajv (JSON Schema), Pydantic (Python) |

---

## Pitfalls

- **Using production data in test environments.** Violates GDPR/PDPA and exposes PII to a broader group of staff and tooling. Always use synthetic or anonymized data (full-stack-testing-mohan ch-05).
- **Relying on UI/API tests for data integrity.** They validate visible behavior but cannot confirm atomic multi-table writes, cache-DB sync, or correct event publication. Dedicated data-layer assertions are required.
- **Testing data at the wrong pyramid level.** UI tests with direct DB assertions are slow, brittle, and obscure failure sources. DB assertions belong at unit/integration level.
- **Creating test data via direct SQL inserts.** Bypasses application validation and couples tests to the current schema; tests break on schema evolution. Prefer setup via the same API endpoints the application uses.
- **Shared mutable test data.** Cross-test interference causes intermittent failures. Each test or suite owns its data (Testcontainers or scoped setup/teardown).
- **Ignoring data skew.** Uniformly-distributed test data hides performance degradation that production-realistic skew exposes.
- **Neglecting DLQ testing.** Only covering happy-path stream consumption misses a critical failure mode.
- **Assuming eventual consistency is always fine.** Acceptable for social feeds; dangerous for finance, inventory, anything where stale reads cause incorrect decisions.
- **Deferring concurrency tests to automation alone.** Race conditions are timing-dependent; analysis-phase design (isolation levels, locking, idempotency) is more effective than hoping tests catch them.
- **Underspecified AI prompts.** LLMs default to plausible common values; without explicit boundary/range/relationship constraints, generated data covers happy paths and misses edges (genai-testing-winteringham ch-06).
- **Omitting the AI verification step.** Skipping "check before outputting" produces malformed/incomplete records that look correct on quick inspection.
- **Sending real PII to public LLMs.** Privacy and regulatory violation. Always anonymize or use a self-hosted model.

---

## Agent applicability

- **qa-database-specialist:** owns the four-system test case catalogs, Testcontainers integration, JDBC assertion patterns, and Deequ data-quality gates.
- **qa-environment-engineer:** owns the test data management discipline — factories, fixtures, AI-augmented generation pipelines, seeded data lifecycles.
- **qa-security-specialist:** validates PII handling, encryption, access tokens, GDPR/PDPA compliance touch points; co-owns the LLM-prompt PII risk review.
- **qa-api-specialist:** uses API-driven test data setup as the default (not direct DB inserts).
