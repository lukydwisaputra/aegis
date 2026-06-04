---
book: full-stack-testing-mohan
chapter: 5
title: "Data Testing"
pages: "208-272"
topics:
  - data-testing
  - sql-testing
  - nosql-testing
  - cache-testing
  - stream-testing
  - schema-testing
  - migration-testing
  - etl-testing
  - data-driven-tests
  - gdpr
  - pii-handling
  - data-flow
  - data-integrity
  - test-data-management
  - full-stack-testing
  - shift-left
applies_to_agents:
  - qa-database-specialist
  - qa-backend-engineer
  - qa-data-engineer
  - qa-security-specialist
  - qa-performance-engineer
---

# Chapter 5 — Data Testing

> Data sits at the core of every online application, and its integrity can make or break customer trust. This chapter surveys the four principal data storage and processing systems found in modern web and mobile applications — relational databases, caches, batch processors, and event streams — and explains the distinct test cases each one demands. It then presents a four-branch data testing strategy (manual exploration, automated functional testing, performance testing, and security/privacy testing) before walking through practical exercises using SQL, JDBC, Apache Kafka with Zerocode, Testcontainers, and Deequ. Throughout, the emphasis is on a fault-finding mindset: the majority of data testing effort focuses on failure modes rather than happy-path user journeys.

---

## Core concepts

### Data integrity as a trust foundation
- Applications fall into two broad categories: those that sell data to users (e-commerce, streaming, ride-hailing) and those that accumulate user data (social networks, blogging). In both cases data is the product, and integrity failures — wrong account balances, lost photos, inconsistent posts — erode customer trust faster than almost any other class of bug.
- Testing how data is stored, processed, and presented is therefore not optional; it is a primary quality skill alongside functional and security testing.

### The four data systems
The chapter uses a simplified e-commerce application to illustrate how four distinct data systems collaborate:

1. **Relational database** — the durable, disk-backed record of truth for customers, orders, products, and all other persistent business entities.
2. **Cache** — an in-memory key/value store (e.g., Redis, Memcached) holding transient, frequently accessed data such as OAuth access tokens.
3. **Batch processing system** — a scheduled job (e.g., Apache Spark, Spring Batch) that transforms large volumes of file-based or record-based input into the database; runs autonomously at off-peak hours.
4. **Event stream** — a durable, near-real-time publish/subscribe platform (e.g., Apache Kafka, Google Cloud Pub/Sub, RabbitMQ) where services post events for downstream consumers to act on asynchronously.

### Data flow tracing
Following data as it moves through all four layers reveals test cases invisible at the UI or API level. Example: a login action creates credentials in the database, stores an OAuth token in the cache, the token expiry triggers a redirect, and an order placement simultaneously writes to the database and publishes an event to the stream for warehouse and fulfillment services to consume.

### Relational databases — key properties
- Data is organised in tables (rows and columns); the schema defines column names, data types, and lengths.
- Every row is assigned a UUID primary key used to relate records across tables.
- The four core operations are Create, Read, Update, Delete (CRUD), expressed using SQL.
- Replication distributes copies across geographic regions. One replica acts as **leader** and propagates writes to **followers**, creating **replication lag** and an **eventual consistency** model.

### Cache — key properties
- In-memory key/value storage yields sub-millisecond latency versus a database round-trip.
- Each entry carries a **time-to-live (TTL)** value after which the cache discards it automatically.
- Caches trade durability for speed; they are appropriate for transient data where loss has minimal impact (e.g., session tokens, not customer payment history).
- When the same data lives in both cache and database, the application code must own cache invalidation and fallback logic.

### Batch processing — key properties
- Processes large volumes of input (files, database extracts, images) in a scheduled window rather than in real time.
- Performance is measured in throughput (records per second, maximum file size handled) not response latency.
- Typical use cases: vendor catalog imports, report generation, bill generation, payslip runs, ML training data preparation.
- **Data skew** — disproportionately large volumes in one category — can degrade job performance.

### Event streaming — key properties
- Publishers post events to named **topics**; subscribers consume only the topics relevant to them.
- Processing is **asynchronous and near-real-time**: the publisher does not wait for subscribers to acknowledge.
- Events are stored on disk for a configurable **retention period**, enabling subscribers to replay missed events after a failure.
- A **dead letter queue (DLQ)** captures events that cannot be processed after repeated retries, along with error details.
- In Apache Kafka specifically: events are distributed across **partitions** within a topic for parallelism; a monotonically increasing **offset** lets each consumer track its position independently; a **Schema Registry** enforces message contract compatibility across versions.

### Eventual consistency failure modes
When leader-follower replication introduces lag, several observable anomalies can emerge:
- **Reading your own writes** — a user updates their profile and immediately re-reads it from a lagging follower, seeing stale data.
- **Time traveling** — a user refreshing a live sports score sees results move backwards when successive requests hit different followers at different replication states.
- **Inconsistent ordering** — a reply to a comment appears before the question that prompted it, because the question has not yet propagated to the follower being read.
- **Write conflicts** — with multiple leaders, concurrent edits to the same resource (e.g., a shared slide deck) are accepted by different leaders and must be reconciled.

### Concurrency failure modes (single-instance databases)
- **Lost updates** — two users purchase the same last item simultaneously; inventory decreases by one instead of two.
- **Dirty reads** — an item's availability flag is set to true before its quantity is updated, causing another user to see "available" with zero stock.
- **Shared resource conflicts** — two concurrent cash-on-delivery orders for the last item result in the allocation going to one user and the invoice to another.
- Concurrency bugs are hard to reproduce in automated tests; they should be identified during analysis and addressed in design.

---

## Techniques / templates

### Data testing strategy (four branches)
The recommended strategy is visualised as four parallel branches applied to all four data systems:

1. **Manual exploratory testing** — apply sampling techniques from Chapter 2 to uncover fault-causing scenarios; learn the specific quirks of each tool (Kafka partition behaviour, Redis TTL semantics, Spark skew handling).
2. **Automated functional testing** — begin with unit and integration tests integrated into CI; use the tools in the exercises below for database and stream verification.
3. **Performance testing** — load and stress test every data storage and processing system, not just the API tier (covered in depth in Chapter 8).
4. **Security and privacy testing** — data breaches attract regulatory penalties and destroy trust; covered in Chapter 7 (security) and Chapter 10 (data protection law compliance).

### Fault-finding mindset
Data testing is approximately 90% fault-case focused, versus functional testing which centres on valid user actions. When designing data test cases, always ask: what happens under each of the following conditions?
- Network failure mid-write
- Partial write across multiple tables or services
- Retry of a failed operation (does it duplicate, overwrite, or abort?)
- Concurrent access by multiple users or services
- Replication lag between leader and followers
- Cache expiry at the moment of access
- Downstream subscriber failure in an event stream
- Corrupted, null, duplicate, or out-of-range input data

### Database test case catalog
- **Schema boundary testing** — verify column data type and length constraints are enforced consistently at the database and at the UI; test boundary values (e.g., name field capped at 20 characters).
- **Special character handling** — ensure strings containing SQL syntax characters (apostrophes, quotes, semicolons) are stored and retrieved correctly without injection risk.
- **Partial write resilience** — simulate network failure during a multi-table write; confirm the database either completes or rolls back atomically.
- **Retry behaviour** — verify that retrying a failed write does not produce duplicate records or corrupt related tables.
- **Timeout user experience** — confirm the timeout period is appropriate and the user receives a meaningful error or is correctly redirected.
- **Race condition scenarios** — analyse (in design) and where possible test: lost updates, dirty reads, and shared resource conflicts under concurrent load.
- **Replication consistency** — test read-your-own-writes, monotonic read, and consistent prefix read guarantees for applications where eventual consistency is insufficient.

### Cache test case catalog
- **TTL expiry** — confirm that cached entries are automatically removed after the configured TTL and that the system correctly regenerates or falls back to the database.
- **Cache miss fallback** — verify that a total cache failure (e.g., Redis outage) causes the application to fall back to the database gracefully and, where relevant, redirects unauthenticated users to the login page.
- **Distributed cache consistency** — when service instances are replicated, confirm that cache redirection (e.g., Redis Cluster) routes requests to the correct shard and that all instances remain consistent.
- **Cache-database sync** — when the same data is held in both cache and database, verify that updates in one are propagated to the other; test stale-read windows.
- **Performance under load** — stress test the cache with peak concurrent request volumes.

### Batch processing test case catalog
- **Full-file processing** — verify that the entire input file is processed and no records are silently dropped.
- **Corrupt and anomalous input** — test with records containing null values, unexpectedly large integers, missing required keys, unrecognised formats, and mixed vendor schemas.
- **Incomplete record quarantine** — confirm that records that cannot be transformed are flagged and isolated rather than silently discarded or written partially.
- **Retry and cleanup** — verify that rerunning a failed job either discards or overwrites the data from the previous failed run without creating duplicates.
- **Performance and skew** — test with data skew (one category vastly larger than others) to expose performance degradation; confirm batch jobs do not affect application responsiveness during scheduled run windows.
- **ETL correctness** — verify that extracted data is accurately transformed into the target schema (correct field mapping, correct data type coercion, correct deduplication).

### Event stream test case catalog
- **Schema contract** — whenever the message schema changes, retest the complete end-to-end flow; validate backward and forward compatibility.
- **Ordered processing** — where business logic requires a specific event sequence (e.g., warehouse availability confirmed before shipment), test that the sequence is enforced correctly under asynchronous conditions.
- **Subscriber catchup after failure** — bring down a subscriber, let messages accumulate, then restart; verify that all missed messages are consumed in the correct order.
- **Dead letter queue routing** — deliberately cause repeated processing failures; confirm that the event is moved to the DLQ with correct error metadata and that other events continue to flow.
- **Stream outage behaviour** — simulate broker downtime; verify publisher and subscriber retry logic and confirm recovery without data loss.
- **Consumer throughput** — test that subscriber processing rate keeps pace with publisher rate under realistic volumes, preventing unbounded queue growth.
- **Partition and offset correctness** — verify that messages requiring sequential processing are assigned to the correct partition via keys, and that consumer offsets are committed only after successful processing.

### Data quality validation (Deequ / pre-batch pattern)
Before loading large vendor files into a batch job, apply unit tests on the raw data:
- Assert expected row counts (e.g., `hasSize(_ > 100000)`).
- Assert completeness — no null values in mandatory fields.
- Assert uniqueness — no duplicate SKUs or primary keys.
- Assert allowed value sets — size values restricted to `["S", "M", "L", "XL"]`.
- Assert non-negativity — price and quantity values must be >= 0.
Run the same category of assertions on the transformed output to catch errors introduced by the batch job itself.

### Test data management
- Prefer creating test data through the application's own APIs rather than direct database inserts; this insulates tests from schema changes.
- Use containerised throwaway database instances (Testcontainers) for unit and integration tests to guarantee a clean, reproducible starting state.
- Reserve direct database access (via JDBC) for verifying legacy downstream systems that expose no APIs.
- Do not use production data in test environments — see the PII/privacy section below.

### Database portability testing
If the application is expected to run against multiple database engines (e.g., Oracle, PostgreSQL, MySQL), use Testcontainers to run the same integration test suite against each engine image, verifying that all SQL queries and JDBC connection logic work correctly across all supported targets.

---

## Examples

### SQL — relational database testing (PostgreSQL)
The exercises use a local PostgreSQL instance accessed via the `psql` shell client or pgAdmin.

**Creating a table with typed columns:**
```sql
CREATE TABLE items (
    item_sku  VARCHAR(10),
    color     VARCHAR(3),
    size      VARCHAR(3),
    price     INT
);
```

**Inserting rows:**
```sql
INSERT INTO items VALUES ('ABCD0001', 'Blk', 'S', 200),
                         ('ABCD0002', 'Yel', 'M', 200);
```
Inserting values that exceed the defined column length or mismatched data types causes the query to fail, confirming the constraint is enforced.

**Reading all rows:**
```sql
SELECT * FROM items;
```

**Filtering and grouping — useful for verifying counts per category:**
```sql
SELECT color, COUNT(*) FROM items
WHERE size = 'S'
GROUP BY color
HAVING COUNT(*) > 1;
```

**Sorting results — useful for verifying ordering guarantees:**
```sql
SELECT item_sku, color, size FROM items ORDER BY price ASC;
```

**Aggregate functions** — `COUNT()`, `SUM()`, `AVG()`, `MIN()`, `MAX()` allow verifying totals and statistical properties against expected values.

**Logical operators** — `AND`, `OR`, `NOT`, `IS NULL`, `IS NOT NULL` allow precise filtering for boundary and null-value test cases.

**Joining multiple tables — verifying relational integrity:**
```sql
SELECT * FROM orders o
INNER JOIN items i ON o.item_sku = i.item_sku;
```
An `INNER JOIN` returns only rows present in both tables. `LEFT JOIN`, `RIGHT JOIN`, and `FULL OUTER JOIN` variants expose orphaned or mismatched records, which are common data integrity defects.

**Updating and deleting test data:**
```sql
UPDATE items SET color = 'BK' WHERE color = 'Blk';
DELETE FROM items WHERE price = 180;
```

### JDBC — automated database assertions from a Java test suite
JDBC (Java Database Connectivity) allows a Java test to open a connection to any relational database (using a driver-specific Maven dependency), execute arbitrary SQL, and assert on the returned `ResultSet`. The chapter demonstrates extending a Selenium/TestNG suite with a `DataVerificationTest` class that:
1. Opens a PostgreSQL connection in a `@BeforeTest` setup method using `DriverManager.getConnection(jdbcUrl, user, password)`.
2. Executes a `SELECT` query via `Statement.executeQuery(sql)`.
3. Iterates the `ResultSet` and calls TestNG `assertEquals` to verify field values.
4. Closes the connection in an `@AfterTest` teardown method.

This pattern is reserved for situations where the system under test is a legacy downstream service with no API surface, making direct database verification the only option. For all other cases, the test pyramid principle applies: prefer unit and integration tests over UI-level DB assertions.

### Apache Kafka — event stream testing with Zerocode
Zerocode is an open-source declarative test framework for REST APIs and Kafka. Tests are written as JSON (or YAML) files and run as JUnit 4 test classes annotated with `@TargetEnv` (pointing to broker configuration) and `@RunWith(ZeroCodeUnitRunner.class)`.

**Producer test** — posts an order message to the `orders` topic and asserts broker acknowledgement metadata (status, partition number, topic name):
```json
{
  "scenarioName": "Produce an order details message",
  "steps": [
    {
      "name": "produce order messages",
      "url": "kafka-topic:orders",
      "operation": "produce",
      "request": {
        "recordType": "JSON",
        "records": [
          { "value": { "order_id": "PR125", "item_sku": "ABCD0006", "quantity": "1" } }
        ]
      },
      "verify": {
        "status": "Ok",
        "recordMetadata": { "topicPartition": { "partition": 0, "topic": "orders" } }
      }
    }
  ]
}
```

**Consumer test** — reads from the same topic and asserts message count and content:
```json
{
  "name": "consume order messages",
  "url": "kafka-topic:orders",
  "operation": "consume",
  "request": {
    "consumerLocalConfigs": { "recordType": "JSON", "commitSync": true, "maxNoOfRetryPollsOrTimeouts": 3 }
  },
  "assertions": {
    "size": 1,
    "records": [ { "value": { "order_id": "PR125", "item_sku": "ABCD0006", "quantity": "1" } } ]
  }
}
```

Zerocode can also assert on offset, partition, and message key fields in the same declarative style. The Kafka broker and its dependencies (Schema Registry, ZooKeeper) are run locally via Docker Compose using the Zerocode Docker Factory repository.

### Testcontainers — isolated database instances for unit/integration tests
A single line of Java code spins up a fresh, containerised PostgreSQL instance before a test run:
```java
PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>(imageTag);
postgres.start();
```
Testcontainers also supports MySQL, Cassandra, MongoDB, Kafka, RabbitMQ, and arbitrary custom containers. Tests connect via a slightly modified JDBC URL that routes through the container. The container is discarded after the test run, preventing state pollution between runs.

### Deequ — data quality unit testing on batch input files
Deequ is an Amazon-built open-source library sitting on top of Apache Spark. It validates data quality before and after batch processing. A sample Scala assertion suite on a vendor file:
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
Results are metric-based (e.g., "90% of price values are valid") enabling trend monitoring over time. Deequ also provides anomaly detection on quality metrics and automatic suggestions for new validation rules. Alternative tools in the same space include TensorFlow Data Validation and Great Expectations.

---

## Pitfalls / anti-patterns

### Using production data in test environments
Production data typically contains real customer PII — names, contact details, payment information. Copying it into test environments violates data protection regulations (GDPR, PDPA) and exposes it to a broader group of staff and automated tooling. Synthetic or anonymised test data should always be used. This is classified as a privacy-by-design concern and is covered in detail in Chapter 10.

### Relying on UI/API tests to cover all data integrity scenarios
Testing via the UI or API validates the visible behaviour but cannot confirm that all related database tables were written atomically, that cache and database are in sync, or that the correct event was published to the stream. Dedicated data-layer assertions are required to close these gaps.

### Testing data at the wrong level of the pyramid
Direct database connections from UI-level tests create slow, brittle test suites and obscure the actual source of failures. DB-related assertions belong at the unit and integration test level. Reserve JDBC-based tests for legacy systems with no API surface.

### Creating test data via direct SQL inserts instead of APIs
Inserting test data directly into the database bypasses application validation logic and couples tests to the current schema. When the schema evolves, these tests break. The preferred approach is to set up test data through the same API endpoints the application uses, so schema changes are absorbed transparently.

### Shared mutable test data
When multiple tests read from and write to the same database tables or cache keys, tests interfere with each other, producing intermittent failures. Each test or test suite should own its data, either through isolated containerised instances (Testcontainers) or through careful setup/teardown of specifically scoped records.

### Ignoring data skew in batch job performance tests
Testing batch jobs only with small, uniformly distributed data sets misses performance degradation caused by disproportionate data volumes in certain categories. Tests should include skewed distributions that reflect realistic production inputs.

### Neglecting dead letter queue testing
Event stream tests that only cover the happy path (events consumed successfully) miss a critical failure mode. Intentionally causing repeated processing failures to exercise the DLQ routing and error-metadata attachment is a mandatory test scenario.

### Assuming eventual consistency is always acceptable
Treating replication lag as a negligible detail works for low-stakes read operations (e.g., a social media feed) but is dangerous for financial transactions, inventory management, or any flow where stale reads cause incorrect decisions. Applications must explicitly choose and test consistency guarantees appropriate to each use case.

### Deferring concurrency test cases to automation alone
Race condition bugs are heavily timing-dependent and extremely difficult to reproduce deterministically in automated tests. The value of identifying them lies in the analysis phase, where developers can address them through appropriate transaction isolation levels, locking strategies, or idempotent retry designs — not in hoping a test will catch them after the fact.

---

## Security and privacy considerations

Although Chapter 7 and Chapter 10 cover these topics in depth, the chapter flags several data-layer concerns that the QA team must keep in mind:

- **PII handling** — customer names, addresses, phone numbers, email addresses, and payment details are personally identifiable information subject to GDPR (Europe), PDPA (Thailand and other Asian jurisdictions), and equivalent laws. Test data must not contain real PII; anonymisation or synthetic generation is mandatory.
- **SQL injection** — user-supplied strings containing SQL syntax must be validated and sanitised at the application boundary. The chapter explicitly calls out testing with names like "Bob D'arcy" (containing an apostrophe) as a minimum sanity check.
- **Access token security** — cached tokens are a high-value target; their TTL, cache isolation, and fallback behaviour when the cache is compromised must be tested.
- **Data breach impact** — a breach of database records or event stream payloads can expose PII at scale. Security testing of data stores (covered in Chapter 7) is not optional.

---

## Data testing strategy summary

| Branch | Primary data systems | Key tools |
|---|---|---|
| Manual exploratory | All four (especially DB and batch) | SQL / psql, Redis CLI, Kafka console consumer |
| Automated functional | All four | JDBC, Testcontainers, Zerocode, Deequ |
| Performance | All four | Load testing tools (Chapter 8), Kafka consumer lag monitoring |
| Security and privacy | All four | OWASP checks (Chapter 7), compliance review (Chapter 10) |

For each branch, apply the following test case lenses regardless of system type:
- Data types and boundary values
- Null, empty, and malformed inputs
- Distributed system failures (network partition, node crash)
- Concurrent access patterns
- Retry and idempotency behaviour

---

## Cross-refs

- `[[foreword]]`
- `[[ch-01-introduction-to-full-stack-testing]]`
- `[[ch-02-manual-exploratory-testing]]` — sampling techniques used in manual database and batch exploration
- `[[ch-03-automated-functional-testing]]` — test pyramid placement of DB assertions; Selenium/TestNG framework extended with JDBC
- `[[ch-04-continuous-testing]]` — integrating data tests into CI pipelines; Git workflow for test code
- `[[ch-06-visual-testing]]`
- `[[ch-07-security-testing]]` — SQL injection, data breach prevention, access token security
- `[[ch-08-performance-testing]]` — load and stress testing of databases, caches, batch jobs, and event streams
- `[[ch-09-accessibility-testing]]`
- `[[ch-10-cross-functional-requirements-testing]]` — GDPR, PDPA, PII-handling compliance testing
- `[[ch-11-mobile-testing]]`
- `[[ch-12-moving-beyond-first-principles]]`
- `[[ch-13-introduction-to-testing-in-emerging-technologies]]`
