---
topic: test-data-generation
sources:
  - book: genai-testing-winteringham
    chapters: [6]
    role: primary
  - book: full-stack-testing-mohan
    chapters: [5]
    role: complementary
ingestedAt: "2026-05-24"
---

# Test Data Generation (Synthesis)

> Test data is a first-class deliverable, not a side effect. Aegis's canonical stack combines deterministic factories (Faker), schema-driven generation (OpenAPI/XSD/JSON Schema), few-shot LLM generation for relational and edge cases, and isolated containerized stores (Testcontainers). The non-negotiable constraint is PII safety: no real customer data in tests, no real PII in prompts.

## Why test data generation is its own skill

Sloppy test data produces tests that pass on uniform happy-path values and fail in production on the edge cases users actually submit (full-stack-testing-mohan ch-05). Performance numbers based on synthetic "Shirt1", "Shirt2" inputs do not stress the query planner the way realistic data does. Test data is also the largest privacy and compliance surface in a non-production environment — every record either complies with GDPR/PDPA or violates it.

A complete test data generation strategy answers four questions:
1. **What** data does the system need (schemas, types, ranges, relationships)?
2. **Where** does the data come from (factory, AI, recorded fixture, captured HAR, vendor sample)?
3. **How** is it seeded and torn down (Testcontainers, API setup, scripted SQL, fresh-per-test)?
4. **Who** is responsible for keeping it safe (PII handling, prompt hygiene, log scrubbing)?

---

## The area-of-effect split

Test data generation is a collaborative activity between human judgment and tooling (genai-testing-winteringham ch-06):

- **Human responsibility** — analyze what data is required, define rules and relationships, supply format specifications, verify output, ensure privacy compliance.
- **Tool responsibility** — produce volume rapidly, vary field values within stated constraints, convert between formats without losing values.

This split applies whether the tool is Faker, an LLM, or a schema-driven generator. A tester who asks the tool to "create data" without encoding constraints gets plausible-but-unreliable fixtures. A tester who hand-encodes every value defeats the time-saving benefit.

---

## The Aegis test data stack

| Layer | Primary tool | Used for |
|---|---|---|
| Deterministic factory | **Faker.js / Faker (Python) / Bogus (.NET)** | Names, addresses, dates, IDs — varied per test but seeded for reproducibility |
| Schema-driven generation | **JSON Schema + Ajv / Zod / OpenAPI tooling** | Type-safe, pattern-constrained records that match the API contract |
| AI-augmented edges | **LLM via API** (Claude, GPT-4o) with structured prompts | Edge-case rows, format conversion, few-shot relational seeds |
| Isolated stores | **Testcontainers** (PostgreSQL, Kafka, MongoDB, Redis, RabbitMQ) | Clean reproducible state per run; multi-engine portability tests |
| Recorded fixtures | **HAR record/replay** (Playwright `routeFromHAR`) | Frozen third-party traffic without live dependency |
| API-driven setup | The application's own create endpoints | Insulates tests from schema changes; goes through validation logic |

The stack composes: Faker for everyday values, schemas to constrain shape, LLMs for novel edges, Testcontainers to host it all reproducibly.

---

## Faker-first defaults (deterministic core)

For routine values where the only requirement is "varied but realistic":

```ts
import { faker } from '@faker-js/faker';
faker.seed(42); // deterministic — same output across runs

const user = {
  id: faker.string.uuid(),
  name: faker.person.fullName(),
  email: faker.internet.email(),
  phone: faker.phone.number(),
  address: faker.location.streetAddress(),
};
```

Properties:
- **Reproducible** when seeded — failing tests can be replayed with the same inputs.
- **Localizable** — Faker has locale-specific data (`faker.locale = 'fr_FR'`) for i18n tests.
- **Free of PII risk** — no real names or emails are emitted.
- **Fast** — synchronous, no network call.

Faker should be the default for any field where the value's identity does not matter — only its plausibility and uniqueness.

---

## Schema-driven generation

When a record must comply with an exact contract (API request body, DB row, event payload), generate from the schema rather than a hand-written field list.

### From OpenAPI

```
You are a JSON data generator. Generate a JSON array with 3 randomized
JSON objects based on the OpenAPI schema delimited by three hashes.
Confirm that all 3 JSON objects match the OpenAPI schema rules before
outputting the results.

###
openapi: 3.0.0
components:
  schemas:
    Room:
      type: object
      properties:
        accessible: { type: boolean }
        type: { type: string, pattern: "Single|Double|Twin|Family|Suite" }
        roomPrice: { type: integer, minimum: 0, maximum: 999 }
      required: [accessible, type, roomPrice]
###
```

Advantages over hand-written rules (genai-testing-winteringham ch-06):
- The schema is already maintained by the team — no separate prompt to update when the model changes.
- Pattern fields act as exact enumerations.
- Outputs show better semantic consistency because the model understands the schema as a whole.

For non-AI generation, tools like `json-schema-faker` produce the same kind of output deterministically.

### From XSD

The same pattern applies to XML domains (insurance, healthcare HL7, supply chain). XSDs supplied inside delimiters constrain element names, types, and enumerated values. The prompt adds one extra step: grouping output under a common root element.

---

## Few-shot LLM generation for relational data

When data spans multiple related tables, the most reliable AI approach is the **few-shot tactic**: provide `CREATE TABLE` + `INSERT` for every table with at least one row of representative data. The model generates new rows that respect column types, enumerations, and foreign keys (genai-testing-winteringham ch-06).

```
You are a SQL generator. Take the SQL delimited by three hashes and
create a SQL statement that generates 5 new records following the
format of the provided statement.

Check that each new entry is distinct from the provided example,
and that the SQL can be executed before outputting.

###
CREATE TABLE rooms (...);
INSERT INTO rooms (...) VALUES (...);

CREATE TABLE bookings (
  ...
  FOREIGN KEY (roomid) REFERENCES rooms(roomid)
);
INSERT INTO bookings (...) VALUES (...);
###
```

Critical design choice: supply both `CREATE TABLE` and `INSERT`, not just `INSERT`. The `CREATE TABLE` statement carries type and constraint context that individual rows cannot convey. Providing only `INSERT` increases the risk of foreign keys pointing to non-existent records.

---

## Format transformation

LLMs convert existing data between formats (JSON ↔ SQL ↔ XML ↔ CSV) without losing values. Useful for:
- Seeding a relational DB from a JSON fixture already written for an API test.
- Converting XML exports from a legacy system.
- Populating a NoSQL collection from a SQL dump.

The verification step in the prompt ("check that each statement covers all aspects of the JSON before outputting") is load-bearing. Without it, fields are silently dropped or flattened.

---

## Programmatic LLM integration

Beyond interactive tools (ChatGPT, Claude), LLM data generation can run inside automated tests so data is fresh each run rather than committed as static fixtures.

```java
OpenAiChatModel model = OpenAiChatModel.withApiKey(System.getenv("OPENAI_KEY"));

String prompt = """
  You are a data generator. Create random data in JSON format
  based on the criteria delimited by three hashes.
  Additional requirements are in back ticks.
  ###
  name
  email
  phone `UK format`
  subject `Over 20 characters`
  description `Over 50 characters`
  ###
  """;

String rawJson = model.generate(prompt);
ContactFormDetails data = new Gson().fromJson(rawJson, ContactFormDetails.class);
```

Maintainability note: store prompts in external files. When business rules change, the prompt file changes; test logic stays the same.

Cost note: LLM calls are billable per token. Set a usage cap. Choose model tier to fit the task (cheaper models suffice for simple data generation; reserve top-tier models for relational or schema-driven work).

---

## Deterministic seeding for reproducibility

Every layer of the stack should support deterministic mode:
- Faker: `faker.seed(N)`.
- Schema generators: pass a seed to the underlying randomness source.
- LLMs: limited — `temperature: 0` reduces variation but cannot guarantee identical output across model versions. For reproducibility, capture the LLM output once, commit it, and replay deterministically from the committed fixture.

A test that fails because of randomness is a flaky test. Either fix the seed or capture the values when the test runs.

---

## Test data lifecycle patterns

### Fresh-per-test (Testcontainers)

```java
PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");
postgres.start();
// container lives for the duration of the test; discarded afterwards
```

Strengths: complete isolation, no cross-test interference, no setup/teardown scripting. Cost: container startup time per test class.

### Shared test fixture with scoped teardown

Setup data once per test suite, but each test owns specific records identified by a unique key (test name, UUID prefix). Teardown removes only those records.

### API-driven setup (preferred for E2E)

Create test data through the application's own create endpoints. Insulates tests from schema changes, exercises validation logic, and is the closest match to how production data is generated (full-stack-testing-mohan ch-05).

### HAR record/replay for third-party data

For tests that depend on external services, record real traffic once into a HAR file, sanitize it (strip tokens, cookies, PII), commit it, then replay offline. The HAR file is updated only when the external contract changes.

---

## PII safety and prompt hygiene

The most consequential constraint on test data generation is privacy compliance:

- **No real customer data** in any test environment. Use synthetic or fully anonymized data. (full-stack-testing-mohan ch-05)
- **No real PII in LLM prompts.** If seed examples, schema fields, or instructions contain real names/emails/phones, sending them to a third-party API may violate GDPR/PDPA and internal data-handling policies. (genai-testing-winteringham ch-06)
- **Safe alternatives:**
  - Anonymized or fully synthetic seed examples in prompts.
  - Self-hosted or enterprise-licensed models that do not train on customer data.
  - Review the LLM provider's data-use terms before sending proprietary schemas.
- **Log scrubbing.** Test runs may emit generated values into logs and CI artifacts. Treat logs as exfiltration surface for any PII-shaped fields.
- **HAR sanitization.** HAR files capture auth headers, session cookies, access tokens, and request/response bodies verbatim. Always strip sensitive fields before committing — treat un-sanitized HARs as committed `.env` files.

---

## Edge-case generation discipline

LLMs default to common, expected-looking values. Without explicit prompting, generated data clusters around plausible cases and misses edges (genai-testing-winteringham ch-06).

For boundary-value coverage, request boundaries explicitly:

```
Generate 10 records. Include exactly:
- 2 records at the minimum boundary of each numeric field.
- 2 records at the maximum boundary of each numeric field.
- 2 records with maximum-length strings.
- 2 records with empty optional fields.
- 2 records with unicode characters in name and description.
```

For SQL injection / XSS sanity checks, hand-curated edge cases (Bob D'arcy, `<script>alert(1)</script>`, `; DROP TABLE users;--`) remain more reliable than asking an LLM to generate them — both because the set is short and stable and because LLM providers may refuse to generate exploit-shaped strings.

---

## Validating generated data

Treat all generated data — Faker, schema-driven, or AI — as a draft, not a verified fixture. Validation steps before committing or running:

- **Schema validation** (Zod, Ajv, Pydantic) — confirm structure matches the contract.
- **DB constraint check** — load into a Testcontainer; surface FK/unique/check-constraint violations.
- **Smoke query** — run a representative SELECT against the seeded data to confirm it is queryable as expected.
- **Sample review** — for AI-generated fixtures, eyeball 3–5 records before bulk loading.

The "check before outputting" verification step in AI prompts reduces malformed output but does not eliminate it. External validation is mandatory for regression fixtures.

---

## Practical templates

### Template A — Faker factory (deterministic)

```ts
export function makeUser(overrides: Partial<User> = {}): User {
  faker.seed(42); // for reproducibility; remove for per-test variation
  return {
    id: faker.string.uuid(),
    name: faker.person.fullName(),
    email: faker.internet.email(),
    age: faker.number.int({ min: 18, max: 99 }),
    ...overrides,
  };
}
```

### Template B — Schema-driven AI prompt

```
You are a JSON data generator.
Generate {N} JSON objects matching the schema delimited by three hashes.
Confirm all {N} objects match the schema before outputting.

###
{paste OpenAPI YAML component schema}
###
```

### Template C — Few-shot SQL prompt

```
You are a SQL generator. Take the SQL delimited by three hashes and
generate {N} new records following the same format and respecting
all foreign key relationships.

Check that each new entry is distinct and that the SQL can be
executed before outputting.

###
{CREATE TABLE …};
{INSERT INTO … VALUES …};
###
```

### Template D — Testcontainers + Faker setup

```java
@Container
static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

@BeforeEach
void seed() throws SQLException {
  try (Connection conn = postgres.createConnection("")) {
    for (int i = 0; i < 100; i++) {
      User u = UserFactory.make();
      // insert via prepared statement
    }
  }
}
```

---

## Pitfalls

- **Real production data in tests.** GDPR/PDPA violation; broadens PII exposure to tooling and staff. Always synthetic or anonymized (full-stack-testing-mohan ch-05).
- **Real PII in LLM prompts.** Even anonymized-looking data may identify individuals. Use synthetic seeds; prefer self-hosted models for proprietary schemas (genai-testing-winteringham ch-06).
- **Underspecified AI prompts.** Missing range, pattern, or relationship constraints produces plausible-but-wrong data. Add the verification step.
- **Implicit inter-field relationships.** Bed count vs. room type, ordered booking dates, foreign keys — must be specified in prompt, schema, or example data.
- **Treating AI output as ground truth.** Generated data is a draft. Validate against schema / DB constraints before committing.
- **Static fixtures committed without seeding.** Tests pass once, fail mysteriously later when the fixture goes stale. Either commit deterministically or regenerate at run time.
- **Shared mutable test data across tests.** Causes intermittent failures. Each test owns its data (Testcontainers, scoped IDs).
- **Setup via direct SQL inserts (bypassing the API).** Couples tests to current schema and skips application validation. Prefer API-driven setup.
- **Unbounded LLM token spend.** Set per-account usage caps; choose cheaper model tiers for routine generation.
- **HAR files committed with secrets.** Treat un-sanitized HARs as secret leaks. Strip tokens, cookies, and PII before committing.

---

## Agent applicability

- **qa-environment-engineer:** owns the test data stack composition (Faker + schemas + Testcontainers + AI augmentation), the lifecycle policy (fresh-per-test vs. shared-scoped), and the deterministic-seed discipline.
- **qa-database-specialist:** partners on schema-driven generation, validates that generated data exercises constraints, and runs Deequ-style quality checks on AI-generated batches.
- **qa-api-specialist:** uses API-driven setup as the default; consumes schema-generated bodies in service tests.
- **qa-security-specialist:** owns PII safety review for both fixtures and LLM prompts; audits HAR sanitization and log scrubbing.
