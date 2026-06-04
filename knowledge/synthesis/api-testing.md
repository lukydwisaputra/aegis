---
topic: api-testing
sources:
  - book: full-stack-testing-mohan
    chapters: [3]
    role: primary
  - book: practical-playwright-greffier
    chapters: [11]
    role: complementary
ingestedAt: "2026-05-24"
---

# API Testing (Synthesis)

> Service-layer testing sits between unit tests and UI tests in the pyramid. It treats APIs as independent products — tested thoroughly without UI involvement — and is the highest-leverage layer for catching integration defects cheaply and quickly. The Aegis canonical tool is Playwright's `APIRequest` fixture for projects already on Playwright; REST Assured, Postman, and Karate remain valid for Java-first or low-code teams. Contract testing with Pact prevents silent drift between stubs and real providers during parallel development.

## Layer in the test pyramid

- Service tests occupy the middle of the pyramid, above unit/integration/contract tests and below UI-driven tests (full-stack-testing-mohan ch-03).
- They exercise domain logic — business rules, authorization, error handling, retry behavior, HTTP semantics — without involving a browser.
- The recommended ratio puts roughly 5x as many service tests as UI tests; service tests should comprise the majority of integration coverage.
- Also called **component tests** when the unit under test is an independently deployable service.
- Architecturally, REST APIs function as a contract between frontend and backend. API tests verify that contract independently of the UI, complementing rather than replacing backend unit and integration tests (practical-playwright-greffier ch-11).

---

## Test patterns

- **Request/response validation:** send a request and assert status code, response body shape, and relevant field values.
- **Schema testing:** validate responses against an OpenAPI spec or JSON Schema to catch structural regressions before they reach consumers.
- **Authentication and authorization:** verify protected endpoints reject unauthenticated requests and enforce role-based access (canonical example: only authenticated users can create orders) (full-stack-testing-mohan ch-03).
- **Error code coverage:** exercise 4xx client errors (bad input, unauthorized, not found) and 5xx server errors; do not test the happy path only.
- **Business rule edge cases:** stock unavailability, out-of-range values, concurrent writes — whichever domain rules live in the service.
- **Retry and timeout behavior:** confirm the service degrades gracefully when downstream dependencies are slow or unavailable.
- **Pagination, sorting, and filtering:** boundary pages, empty result sets, invalid sort/filter parameters.
- **Pattern (asymmetric) matching:** for endpoints that return non-deterministic data (timestamps, generated IDs, random quotes), assert the **shape** rather than exact values (practical-playwright-greffier ch-11).

---

## Data validation tactics (Playwright)

Playwright's `APIRequest` exposes a graduated set of assertion patterns (practical-playwright-greffier ch-11):

| Pattern | Strictness | When to use |
|---|---|---|
| Field-by-field assertion | Highest control, brittle as field count grows | Small responses; specific fields under scrutiny |
| `toEqual(expected)` | Deep equality; every field must match exactly | Deterministic responses with stable field set |
| `toMatchObject({...})` | Checks only the listed fields; ignores extras | **Recommended default** — robust to added fields and volatile values like timestamps |
| Asymmetric matchers (`expect.any(Number)`, `expect.anything()`) | Shape match, not value match | Non-deterministic endpoints (random quote, generated IDs) |
| Schema validation (Zod, Ajv, Pydantic) | Contract-level | When validating against the published API contract |

Example using `toMatchObject`:

```ts
expect(data).toMatchObject({
  quote: 'Your heart is the size of an ocean...',
  author: 'Rumi',
});
```

Example using shape match for a non-deterministic endpoint:

```ts
expect(data).toMatchObject({
  id:     expect.any(Number),
  quote:  expect.any(String),
  author: expect.any(String),
});
```

For more rigorous contract validation (required fields, enum values, nested schemas), dedicated libraries are preferred over hand-written assertions: Zod (TypeScript-first, composable), Ajv (JSON Schema-based, fast), tools with native OpenAPI support.

---

## Playwright APIRequest patterns

The `request` fixture is the canonical Aegis API testing tool for Playwright projects. It runs in Node.js without launching a browser, making it fast and lightweight (practical-playwright-greffier ch-11).

| CRUD | HTTP method | Playwright call |
|---|---|---|
| Create | POST, PUT | `request.post()`, `request.put()` |
| Read | GET | `request.get()` |
| Update | PATCH, PUT | `request.patch()`, `request.put()` |
| Delete | DELETE | `request.delete()` |

### Response inspection

- Status code: `response.status()` — or `response.ok()` for any 2xx.
- Body: `response.body()` (Buffer), `response.text()` (string), `response.json()` (parsed object).
- Headers: `response.headers()` (plain object) or `response.headersArray()` (for duplicate header names).

### Isolated context (default `request` fixture)

```ts
test('API contract check', async ({ request }) => {
  const response = await request.get('https://api.example.com/resource/1');
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data).toMatchObject({ id: expect.any(Number), name: expect.any(String) });
});
```

### Sharing authentication between UI and API

The default `request` fixture has its own cookie jar separate from any browser. For tests that need shared auth, use `page.request` or `context.request` instead — these share cookies bidirectionally with the browser context:

```ts
test('authenticated API check', async ({ page }) => {
  await page.goto('/login');
  // ... perform UI login ...
  const response = await page.request.get('/api/profile');
  expect(response.ok()).toBeTruthy();
});
```

This enables a clean pattern: authenticate via UI, then exercise protected API endpoints without re-authenticating.

### Practical bidirectional UI + API patterns

- **API setup, UI exercise:** use the API to seed test data, drive the user flow through the browser. Faster than driving setup through a UI wizard.
- **UI exercise, API teardown:** drive the user flow in the browser, then delete created records via the API. Faster and more reliable than navigating through a delete UI.
- **Golden master:** drive actions in the browser, then compare final API state against a reference snapshot to catch invisible side-effects.

### Dependent requests

```ts
test('create then read', async ({ request }) => {
  const create = await request.post('/api/items', { data: { name: 'widget' } });
  const { id } = await create.json();
  const read = await request.get(`/api/items/${id}`);
  expect(read.ok()).toBeTruthy();
});
```

### Shared base URL and auth headers

Configure once in `playwright.config.ts`:

```ts
use: {
  baseURL: 'https://api.example.com',
  extraHTTPHeaders: {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
  },
},
```

---

## Contract testing (Pact)

Consumer-driven contract testing addresses a specific problem: when two services are developed in parallel, the consumer team uses a stub. Without a mechanism to keep the stub aligned with the real provider, drift accumulates silently and surfaces only at integration time (full-stack-testing-mohan ch-03).

Workflow:
1. Consumer team writes integration tests against a Pact-generated stub.
2. Pact generates a **pact file** capturing the requests the consumer makes and the response attributes it actually needs — not the full provider response.
3. The pact file is shared via **Pact Broker** (self-hosted, open source) or **Pactflow** (paid managed service).
4. Provider team runs the pact file against its real implementation. `@State` methods set up the test data states each pact interaction requires.
5. Results flow back to the consumer through the broker — fully automated feedback loop.
6. Both consumer and provider tests integrate into CI pipelines.

**When to use Pact:**
- Microservice architectures.
- Multiple consumers relying on the same provider with independent deployment cadences.

**What contract tests do not do:**
- They do not replace functional service tests.
- They verify structural contract compatibility, not business logic correctness.

---

## Tool catalog

| Tool | Language | Best fit |
|---|---|---|
| **Playwright APIRequest** | TypeScript / JavaScript | **Aegis canonical** — projects already using Playwright for UI; bidirectional UI+API; shares auth state via `page.request` (practical-playwright-greffier ch-11) |
| **REST Assured** | Java | Java-stack services; Gherkin-style chaining; pairs with JUnit/TestNG (full-stack-testing-mohan ch-03) |
| **Karate** | Gherkin (BDD) | Low-code API test authoring; predefined Gherkin statements; no custom step definitions; supports contract testing and mock servers |
| **Postman / Newman** | GUI + CLI | Exploratory API testing; sharing requests across teams; simple CI integration without code-first authoring |
| **Pact** | Multi-language (Java, JS, Python, Go, Scala) | Consumer-driven contract testing for microservices in parallel development |
| **Japa** | TypeScript | Node.js backends with contract-based testing driven from OpenAPI/Swagger definitions |

### Selection guidance

- If the project uses Playwright for UI → use Playwright APIRequest; one tool, one language, one auth state. Bidirectional patterns are first-class.
- If the project is Java-stack → REST Assured aligns the test stack with the dev stack and reduces tester-developer friction.
- If business stakeholders need to read tests → Karate or Postman.
- If services are developed in parallel by independent teams → add Pact alongside whatever functional API testing tool is in use.

---

## Component testing as the bridge to APIs

Standard component testing (Jest, Vitest) uses jsdom or happy-dom — simulated DOM environments. They are fast but cannot detect CSS-driven behavior or anything dependent on a real rendering engine.

Playwright Component Testing (experimental) and the Storybook + Playwright pattern run components in a real browser, catching CSS bugs invisible to jsdom (practical-playwright-greffier ch-11). Component tests sit between unit and E2E — they cover real-browser behavior at component scope without the cost of a full application stack.

---

## Mohan canonical test patterns (REST Assured example)

For Java-stack projects, REST Assured remains the canonical API testing tool (full-stack-testing-mohan ch-03):

```java
given()
  .when().get("/items")
  .then().assertThat().statusCode(200);
```

For POST with serialized body:
- Add `jackson-databind` Maven dependency.
- Create a data object class (e.g., `ItemDetails`) annotated with `@JsonPropertyOrder` and `@JsonProperty`.
- Pass the object as the request body; `log().body()` inspects serialization during test development.

Framework structure:

```
ApiTestProject/
├── pom.xml
└── src/
    ├── main/java/dataobjects/    ← ItemDetails, etc.
    └── test/java/apitests/       ← ItemsTest, etc.
```

---

## Pitfalls

- **Testing only the happy path.** Skipping 4xx, 5xx, timeout, and retry scenarios leaves an entire class of production failures undetected (full-stack-testing-mohan ch-03).
- **No contract tests when services develop in parallel.** Stub contracts drift silently from real providers; the mismatch surfaces only at integration — at high cost.
- **Hand-rolled mocks without Pact.** A consumer-owned mock will diverge from the real API without any automatic detection mechanism.
- **Test consolidation into a single shared codebase.** Breaks the component boundary; tests no longer travel with the service they test.
- **API tests that re-test UI behavior.** API tests are most valuable when they validate the contract — shape, status codes, semantics — independently of the frontend. Mirroring E2E flows in API tests adds coverage overhead without isolation benefit (practical-playwright-greffier ch-11).
- **Exact-value assertions for non-deterministic endpoints.** Random quotes, generated IDs, and timestamps fail unpredictably with `toEqual`. Use `toMatchObject` with `expect.any(...)` matchers instead.
- **Ignoring the automation tracking gap.** Service tests are deprioritized under delivery pressure. Track automation status per story and mark stories done only when service test coverage is complete.
- **Cross-context cookie confusion.** Using `request` (isolated) when authentication should be shared with the browser causes auth failures; use `page.request` or `context.request` for shared state.

---

## Agent applicability

- **qa-api-specialist:** owns the API test suite; uses Playwright APIRequest as the default tool in Playwright projects, REST Assured for Java-stack services; integrates Pact when parallel development creates contract drift risk.
- **qa-ui-specialist:** uses `page.request` for setup/teardown and golden-master patterns in E2E tests, avoiding slow UI-only data setup.
- **qa-database-specialist:** consumes API setup endpoints rather than direct SQL inserts; pairs API tests with DB assertions for data integrity validation.
