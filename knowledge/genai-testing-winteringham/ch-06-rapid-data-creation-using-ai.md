---
book: genai-testing-winteringham
chapter: 6
title: "Rapid data creation using AI"
pages: "109-132"
topics:
  - ai-test-data-generation
  - synthetic-data
  - data-driven-tests
  - mocks-and-fixtures
  - faker
  - edge-case-generation
  - output-constraints
  - json-schema
  - csv-data
  - pii-handling
  - gdpr
applies_to_agents:
  - qa-environment-engineer
  - qa-test-designer
  - qa-database-specialist
  - qa-api-specialist
  - qa-unit-specialist
---

# Chapter 6 — Rapid data creation using AI

> LLMs are effective probabilistic text generators, which makes them well-suited for
> producing structured test data quickly. Success depends on crafting prompts that are
> explicit about format, field types, value ranges, and inter-field relationships. This
> chapter works through generating and transforming data, using formal schema
> specifications as prompt inputs, and calling an LLM API programmatically from inside
> an automated test.

---

## Core concepts

### Why LLMs work for test data

LLMs excel at producing syntactically valid, semantically plausible text—including data
that looks like JSON, XML, SQL, or CSV. The key insight is that "generating realistic test
data" is, from the model's perspective, just another structured text completion task. The
practical consequence: with a well-designed prompt, you can replace hours of manual
fixture authoring or brittle data-factory code with a short, reusable prompt template.

The trade-off is that LLMs are probabilistic. Without explicit constraints they will
make plausible-but-wrong choices (a "double" room with three beds, placeholder
image URLs, lorem-ipsum descriptions where domain text is expected). The solution is
more specification in the prompt, not less—while avoiding over-specification that
defeats the purpose of rapid generation.

### The area-of-effect split for data tasks

The chapter frames test data generation as a collaborative activity:

- **Human responsibility** — analyzing what data is required, defining rules and
  relationships, supplying format specifications, verifying the output, and ensuring
  privacy compliance.
- **LLM responsibility** — rapidly producing volume, varying field values within
  stated constraints, and converting between formats without losing the original
  values.

Neither side replaces the other. A tester who simply asks "give me test data" without
encoding constraints will get plausible-looking but unreliable fixtures. A tester who
encodes every rule manually defeats the time-saving benefit.

---

## Techniques and templates

### 6.1 — Generating simple data sets with structured prompts

The baseline approach combines several prompt-engineering tactics in a single prompt:

- **Format tactic** — declare the desired output format (JSON array, XML, SQL) at
  the start of the prompt.
- **Delimiter tactic** — use a consistent symbol (e.g., `%`) to mark each field, and
  `|` separators to state field name, data type, and value options in a predictable
  order.
- **Time-to-think / work-out-solution tactic** — instruct the model to verify the
  count or validity of the output before printing it. This reduces hallucinations
  where the model skips records or garbles a value.

A representative prompt structure for JSON:

```
You are a JSON data generator. Generate 5 JSON objects in an array
and check that 5 JSON objects have been created before outputting results.

Rules:
* Each parameter is identified with a % sign.
* Each column is described as: key | value data type | options, using |.
* If options say "random", randomize based on the column name.

Instructions:
% room_name | string  | random
% type      | string  | 'single' or 'double'
% beds      | integer | 1 to 6
% accessible| boolean | true or false
% image     | string  | random url
% description | string | random max 20 characters
% features  | array[string] | 'Wifi', 'TV' or 'Safe'
% roomPrice | integer | 100 to 200
```

The same delimiter structure can be reused for XML generation by changing only the
preamble (e.g., "You are an XML data generator…") and adding a `#` symbol to
designate the root node name. Most of the rules stay identical, demonstrating the
reusability of this prompt pattern across formats.

**Observed limitations of the simple approach**

Even with explicit rules, the model will sometimes produce logically inconsistent data
(a single room with multiple beds, placeholder `example.com` image URLs, unusual
room names). These issues appear where the prompt leaves implicit relationships
unspecified. Mitigating them by adding more rules is possible, but the prompt can
become unwieldy. The chapter recommends format specifications (see §6.2) as a better
solution for complex scenarios.

---

### 6.1.2 — Transforming data between formats

LLMs can convert existing data from one format to another without losing values.
A useful pattern: provide a JSON object inside triple-hash delimiters and instruct the
model to produce a CREATE TABLE statement plus INSERT statements. Adding the
instruction "check that each SQL statement covers all aspects of the JSON before
outputting" reduces the risk that values are silently dropped or renamed during
transformation.

This is practical for:
- Seeding a relational database from a JSON fixture already written for an API test.
- Converting XML exports from a legacy system into something a new service can
  consume.
- Populating a NoSQL collection from a SQL dump, or vice versa.

The verification step in the prompt is load-bearing. Without it, the model may quietly
omit a nullable field or flatten a nested object without warning.

---

### 6.2 — Processing complex test data using format specifications

Rather than hand-crafting field-by-field rules, supply an authoritative schema
document as the prompt context. Two common options are explored.

#### 6.2.1a — OpenAPI 3.0 schemas as prompt inputs

OpenAPI schemas already encode type, pattern constraints, minimum/maximum, and
required fields. Embedding the relevant schema component directly in the prompt gives
the model a richer specification than a hand-written rule list, for three reasons:

1. The schema language is standardized and widely represented in LLM training data,
   so the model interprets it reliably.
2. The schema is already maintained by the team—no separate prompt maintenance
   is required when the data model changes; just update the schema and re-run the
   prompt.
3. Pattern fields (e.g., `pattern: Single|Double|Twin|Family|Suite`) act as exact
   enumerations, giving tighter output control than "one of the following" prose.

Prompt pattern:

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
      title: Room
      type: object
      properties:
        accessible:
          type: boolean
        type:
          type: string
          pattern: Single|Double|Twin|Family|Suite
        roomPrice:
          type: integer
          minimum: 0
          maximum: 999
        ...
      required:
        - accessible
        - description
        - features
        - image
        - roomNumber
        - roomPrice
###
```

Compared to hand-written delimiter rules, outputs from schema-guided prompts tend
to show better semantic consistency. For example, room descriptions correctly
reference other attributes (e.g., a family suite description mentions extra features),
because the model understands the schema structure rather than treating each field
independently.

Specific schema properties can be tuned incrementally. If image URLs are
unsatisfactory, adding a `pattern` to the image field that lists real URLs (pipe-separated)
causes the model to pick from those values on subsequent runs—no other prompt
changes are needed.

#### 6.2.1b — XSD schemas for XML data

The same approach applies to XML. An XSD supplied inside triple-hash delimiters
constrains element names, types, and enumerated values (e.g., `FeatureType` restricted
to WiFi | TV | Radio | Refreshments | Safe | Views). The prompt instruction adds one
extra step: grouping all output under a common root element (e.g., `<rooms>`).

This pattern is especially valuable for XML-heavy domains such as insurance, healthcare
(HL7), or supply-chain integrations, where XSD documents are typically the source of
truth and manually constructing conformant test documents is error-prone and slow.

#### 6.2.2 — SQL exports as few-shot guides for relational data

When data is distributed across multiple related tables, the most reliable approach is
the **few-shot** tactic: provide existing `CREATE TABLE` and `INSERT` statements for
every table, with at least one row of real (or representative) data. The model then
generates new rows that respect column types, enumerations, and—crucially—foreign
key relationships.

Key design decision: supply both `CREATE TABLE` and `INSERT` in the prompt, not just
`INSERT`. The `CREATE TABLE` statement gives the model type and constraint context
that individual insert rows cannot convey. Providing only `INSERT` statements increases
the risk that foreign keys are populated with IDs that point to non-existent records.

Example instruction wrapper:

```
You are a SQL generator. Take the SQL statement delimited by three hashes
and create a SQL statement that generates 5 new records that follow the
format of the provided statement.

Check that each new entry doesn't match the provided SQL statement before
outputting the newly generated data, and that the SQL can be executed
successfully before outputting it.

###
CREATE TABLE rooms (...);
INSERT INTO rooms (...) VALUES (...);

CREATE TABLE bookings (
  ...
  FOREIGN KEY (roomid) REFERENCES ROOMS(roomid)
);
INSERT INTO bookings (...) VALUES (...);
###
```

The model will propagate roomid values correctly across both tables, producing
referentially consistent seed data without manual coordination.

---

### 6.3 — Integrating LLM data generation into automated tests via API

Moving beyond interactive tools like ChatGPT, this section demonstrates calling an
LLM programmatically from inside a test, so that data is generated fresh each test run
rather than committed as static fixtures.

#### Setup

The example uses the OpenAI platform (https://platform.openai.com) with
**LangChain4j** — a Java library that wraps the OpenAI HTTP API. The Maven
dependency is:

```xml
<dependency>
  <groupId>dev.langchain4j</groupId>
  <artifactId>langchain4j-open-ai</artifactId>
  <version>0.31.0</version>
</dependency>
```

An API key must be obtained from the OpenAI platform and stored securely (not
hard-coded). OpenAI charges per token; a usage cap should be set via
https://platform.openai.com/account/billing/limits to avoid unexpected costs.

The choice of model affects both quality and cost. `gpt-3.5-turbo` is cheaper and
sufficient for simple data generation. `gpt-4o` produces higher-quality output at
significantly higher cost.

#### Prompt design for programmatic use

The prompt follows the same structured-output and delimiter tactics used interactively,
but is stored as a multi-line string in the test code (or, for maintainability, in an
external file imported at run time). A representative prompt for a contact-form test:

```
You are a data generator. Create me random data in a JSON format
based on the criteria delimited by three hashes.
Additional data requirements are shared between back ticks.

###
name
email
phone `UK format`
subject `Over 20 characters in length`
description `Over 50 characters in length`
###
```

#### Wiring the response into a test

1. Instantiate `OpenAiChatModel` with the API key.
2. Call `model.generate(prompt)` — returns the LLM response as a raw string.
3. Parse the JSON string into a typed POJO using a library such as Gson
   (`new Gson().fromJson(testData, ContactFormDetails.class)`).
4. Pass the POJO fields into the page-object or API client calls in the test body.
5. Assert on the application outcome as normal.

The test passes because the LLM produces values that satisfy the application's
validation rules (phone in UK format, subject and description over the required
character counts)—rules that were specified in the prompt rather than hard-coded
in the test itself.

**Maintainability note**: storing prompts in external files (rather than inline strings)
allows non-developers to update data requirements without touching test code. When
business rules change, the prompt file changes; the test logic stays the same.

---

## Anti-patterns

### Underspecified prompts producing plausible-but-wrong data

LLMs default to common, expected-looking values. Without explicit range, pattern, or
relationship constraints, outputs will cluster around typical values and miss edge cases.
For boundary-value testing, the prompt must explicitly request boundary values;
the model will not generate them spontaneously.

### Omitting the verification step

The "check before outputting" instruction is not boilerplate—it materially reduces the
rate of malformed or incomplete outputs. Skipping it saves a few tokens but increases
the chance that records are silently wrong (wrong count, missing required fields,
mangled foreign keys). Always include a self-verification instruction for any data
generation prompt.

### Relying on implicit inter-field relationships

Room type vs. bed count, booking dates that are logically sequenced, foreign keys that
reference real records—these relationships will not be respected unless they are spelled
out explicitly in the prompt, the schema, or the example data. For simple data sets this
is acceptable; for integration or regression data where referential integrity matters, use
schema-based or few-shot SQL approaches.

### Sending real personal or organizational data to a public LLM

The chapter includes an explicit caution: if seed data, schema definitions, or prompt
examples contain personal data (names, emails, phone numbers from a real database)
or confidential intellectual property, submitting them to a third-party LLM API may
violate:
- Internal data-handling or IP policies.
- GDPR or equivalent privacy regulations (the LLM provider processes the data on
  their infrastructure).

Safe alternatives:
- Use anonymized or fully synthetic seed examples in prompts.
- Route requests through a self-hosted or enterprise-licensed model that does not
  train on customer data.
- Review what the LLM provider's data-use terms say about prompt content before
  using proprietary schemas.

### Treating generated data as ground truth without verification

Because LLMs can hallucinate, generated data should be treated as a draft to review,
not a verified fixture. For data used in regression suites, add a validation step (schema
validation, database constraint check, or a smoke-check query) after generation and
before committing fixtures to source control.

---

## Practical prompt templates

### Template A — JSON array from field spec

```
You are a JSON data generator.
Generate {N} JSON objects in an array and check that {N} objects have
been created before outputting results.

Rules:
* Each parameter is identified with a % sign.
* Format: key | type | options (use | as separator).
* If options say "random", randomize within the column's domain.

Instructions:
% {field_1} | {type} | {options}
% {field_2} | {type} | {options}
...
```

### Template B — JSON from OpenAPI schema

```
You are a JSON data generator.
Generate a JSON array with {N} randomized JSON objects based on the
OpenAPI schema delimited by three hashes.
Confirm all {N} objects match the schema rules before outputting results.

###
{paste OpenAPI YAML component schema here}
###
```

### Template C — SQL insert from existing CREATE + INSERT

```
You are a SQL generator. Take the SQL delimited by three hashes and
create a SQL statement that generates {N} new records following the
format of the provided statement.

Check that each new entry is distinct from the provided example,
and that the SQL can be executed before outputting.

###
{CREATE TABLE ...};
{INSERT INTO ... VALUES (...)};

{CREATE TABLE ...};
{INSERT INTO ... VALUES (...)};
###
```

### Template D — Format transformation (JSON to SQL)

```
You are a JSON to SQL transformer.
Convert the JSON object delimited by triple hashes into a SQL statement that:
1. Creates a SQL table to insert the transformed records into.
2. Creates INSERT statements for each record.

Check that each SQL statement covers all aspects of the JSON before
outputting the results.

###
{paste JSON here}
###
```

### Template E — Programmatic data generation (Java / LangChain4j sketch)

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
MyDataClass data = new Gson().fromJson(rawJson, MyDataClass.class);
// use data fields in your test steps
```

---

## Cross-refs

- `[[ch-02-llms-and-prompt-engineering]]` — delimiter, format, time-to-think,
  few-shot, and structured-output tactics used throughout this chapter.
- `[[ch-04-ai-assisted-testing-for-developers]]` — programmatic LLM integration
  patterns; similar API-call patterns appear for automation augmentation.
- `[[ch-05-test-planning-with-ai-support]]` — identifying what data categories and
  boundary conditions are needed (feeds the "data requirements" side of the
  area-of-effect split).
- `[[ch-07-accelerating-ui-automation-using-ai]]` — UI automation tests that
  benefit from dynamically generated test data rather than hardcoded strings.
- `[[ch-11-contextualizing-prompts-with-rag]]` — RAG patterns for pulling live
  schema definitions into prompts at run time, avoiding the need to manually
  paste schemas.
