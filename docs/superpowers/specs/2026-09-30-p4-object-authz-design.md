# P4 — Object-level authorization, IDOR & integer-ID enumerability (Design)

> **Temporary working document** — part of the audit remediation program. Delete together with
> `2026-09-29-audit-remediation-matrix.md` once P6 is closed.

- Date: 2026-09-30 (revised 2026-10-02 after the owner-delegated review)
- Status: approved — ready for plan
- Program matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`, §P4 (AUD-070)
- Builds on: main as of e71d838. Main already has the strict `TargetProfileSchema` in
  `packages/@qa/contracts/src/target-profile.ts` (top level `.strict()`); P4 adds `objectRoutes` to it.
  The other slices P4 depends on are listed in §1.1.
- Closes: AUD-070

---

## Decisions (owner, binding)

Every owner decision for this spec is stated here once; the body refers to it by id.

| # | Decision | Decided |
|---|----------|---------|
| D1 | Only a **404** passes a cross-owner request. | 2026-10-01 |
| D2 | A **403** to a cross-owner request is a **Sev2** defect (existence disclosure). | 2026-10-01 |
| D3 | An authorization leak (the other owner's data returned, or the object changed or deleted) is a **Sev1** defect. | 2026-10-01 |
| D4 | An integer id whose object is otherwise correctly protected is a **Sev3** defect, filed **once per resource type**. | 2026-10-01 |
| D5 | DELETE probes target **fixture-owned objects only**. | 2026-10-01 |
| D6 | Production stays read-only: no object-authorization request ever runs there. | 2026-10-01 |
| D7 | **Control probe** (Q1). A guaranteed-nonexistent id is probed as a control. A response for userA's real object that **differs** from the control response is **Sev2** (existence disclosure, like 403). An **identical non-404 denial** is **Sev3** ("non-standard denial"). A **2xx with no data and no change** is **Sev2**. A **5xx** is **Sev2**, pending origin confirmation. | 2026-10-02 |
| D8 | ObjectAuthz runs on **`development` and `testing` only** (Q2) — never on `staging` or `production`, with no opt-in. | 2026-10-02 |
| D9 | Gate effect (Q3): only an **open Sev1** blocks G2 mechanically (the P0c carry-over). A Sev2 is shown at G2 for the owner's decision and counts against `maxHigh` (0) in the promotion gate check, so it still blocks promotion. Smoke already blocks on Sev2 through `thresholds.yaml#smoke.openSev2Max: 0`. | 2026-10-02 |
| D10 | No agent that P2 retires has a role in this design. | 2026-10-02 (P2) |
| D11 | Aegis may copy the `@qa/supabase` and `@qa/test-helpers` helpers (including `sanitizeHar`) into the target's `tests/qa/support/` (P2). | 2026-10-02 (P2) |

---

## 1. Context

The owner asked whether Aegis checks that app URLs expose object references safely: does a resource
sit behind an integer id that another user can "shoot" by changing the number, and is the object
protected by an authorization check whatever the id shape? Today nothing in the pipeline runs an
IDOR / object-level-authorization test, and no agent records whether a route uses an integer id, a
UUID, a slug or a composite key. AUD-070 owns the gap.

Approach A (agreed): **detection + an active B→A test**, wired into the existing phases and agents,
with no new agent. Detection runs on every full cycle and always produces the customer-facing
"Object reference exposure" section (§7); the active test runs where D8 allows.

### 1.1 Where P4 lands

**Touch set.** Existing agents only, so the roster stays P2's:

- `qa-context-scanner` (static detection), `qa-web-explorer` (runtime enrichment),
  `qa-requirements-analyst` (derived authz stories), `qa-test-designer` (ObjectAuthz TCs),
  `qa-environment-engineer` (peer factory), `qa-security-specialist` (the matrix),
  `qa-defect-manager` (defect shapes), `qa-closure-reporter` (the exposure section);
- the SPVs of the reviewed ones among them: `qa-web-explorer-spv`, `qa-requirements-analyst-spv`,
  `qa-test-designer-spv`, `qa-environment-engineer-spv`, `qa-security-specialist-spv`,
  `qa-defect-manager-spv`, `qa-closure-reporter-spv`;
- `qa-test-executor` gets no routing or contract change (ObjectAuthz is documentation-only, §9.5);
  only its documentation-only technique list in Process step 4 gains the word `ObjectAuthz`.

`qa-context-scanner` has no SPV (`reviewedBy: {none: "(no SPV — cross-cutting profiler)"}`). Its
classifier is a pure function in `@qa/contracts` covered by the unit tests in §10.2, and
`qa-web-explorer-spv` reconciles the static shapes with runtime evidence (§9.4).

**Dependencies.**

| Slice | What P4 consumes | If it is not there |
|-------|------------------|--------------------|
| P1 (merged) | Test vocabulary, `TECHNIQUE_COMPANION_TYPES`, strict `TargetProfileSchema` | — |
| P0c | The G2 mechanical block on an open Sev1 (carried from P0a to P0c, shared with P4) | P4 owns it |
| P0c | Trace T1/T4: §4.3 relies on T4 listing `blocked` and `not-run` | P4 cannot complete |
| P0c | The TC result schema / rollup (`cases/{TC-ID}-result.json` has no schema on main) | The TC result stays free-form and cites `evidence/{TC-ID}/authz-matrix.json` (§5.7) |
| P0c | Retest (`/qa-retest`, `/qa-verify-defect`) to re-verify IDOR fixes | Fixes are re-verified by the next full cycle |
| P0b-2 | Env check for non-specialist mutating agents: the defect manager's clean-state reproduction (§6.4) mutates the env in Triage | P4 cannot complete |
| P3 (AUD-056b) | `qa-gate-check` rewrite (it still reads `execution/results.json` and `config/thresholds.yaml`). The Sev→threshold mapping in §6.3 takes effect there; P3 lands after P4 | Until P3, Sev2 is visible at G2 only |
| P2 | The helper copy into `tests/qa/support/` (D11) | P4's environment-engineer step copies the files it needs itself (§3.3) |

### 1.2 Non-goals

- No new specialist or SPV pair.
- No SAST/DAST tooling change: the B→A matrix is authored request logic, not a ZAP scan.
- No object-authorization request on `staging` or `production` (D6, D8).
- No auto-remediation of the target; findings are defects only (Territory rule).
- No GraphQL object access (`node(id:)` and similar): a GraphQL schema is read as a shape source
  (§2.2) but no GraphQL request enters the matrix.
- No body-borne ids (an id sent only in a request body). Ids in the path and the query string are in
  scope (§2.2); the mass-assignment cell (§5.2) writes an owner field but does not discover body ids.

---

## 2. Detection

### 2.1 Id shapes

| Shape | Signal | Enumerable |
|-------|--------|------------|
| `integer` | value `^\d+$`; OpenAPI `type: integer`; Prisma `Int @id` / SQL `serial`/`bigserial`/`identity` PK | yes |
| `uuid` | RFC-4122 value; OpenAPI `format: uuid`; `uuid` PK | no |
| `slug` | human-readable token (`/posts/my-first-post`) | no — observation only, never a defect |
| `opaque` | ULID / nanoid / hashid — non-sequential, non-UUID | no |
| `unknown` | not determinable statically | flagged for runtime confirmation |

A **composite** route (`/orgs/:orgId/projects/:projectId`) is not a shape: it has one `idParams[]`
entry per id, each classified on its own.

### 2.2 Sources

1. **Static — `qa-context-scanner`** (Scan). For each `sourceInventory.routes[]` and
   `apiHandlers[]` entry it reads the dynamic path segments (`[id]`, `:id`, `{id}`) and the query
   parameters the handler or an API spec declares, and infers the shape from the parameter name plus
   the schema declaration (Prisma model PK, Drizzle column, OpenAPI/Swagger parameter). For
   `platform: "supabase"` it also records each table with an owner column as a PostgREST object
   route, `kind: "api"`, route `/rest/v1/{table}?{pk}=eq.:{pk}` (browser clients reach tables
   directly, so table access is object access).
2. **Runtime — `qa-web-explorer`** (Explore). During the BFS it records the **GET** XHR/fetch
   request URLs the pages make (it never replays them and never sends any other method). From them
   it records an observed example id per parameter, upgrades `unknown` shapes, adds query-string ids
   it saw (`?id=42`, `?id=eq.42`), and fills `listSource` from the request that surfaced an id.
3. **API specs** — an OpenAPI/Swagger/GraphQL schema found by the scanner is authoritative for the
   shape.

**Merge precedence** for a parameter's shape: spec > runtime > static. The web-explorer never
overwrites a `source: "spec"` parameter.

**Write model (option A).** The scanner writes the initial `objectRoutes[]`; the web-explorer
updates it in place. Its contract declares `{path: "{run}/target-profile.json", rmw: true}` and
writes the same path, with a matching `pipeline.yaml#escapes` entry (`field: rmw`, §9.5). It
parses the profile with `TargetProfileSchema` before and after the update and leaves every other
field untouched. The scanner's change detection compares only the parameters whose `source` is
`static` or `spec`, so runtime enrichment never raises `target.changed` on the next run.

### 2.3 `target-profile.json#objectRoutes` schema

Added to `TargetProfileSchema` in `packages/@qa/contracts/src/target-profile.ts`; nested objects
strip unknown keys, like the rest of the profile.

```ts
const IdShapeSchema = z.enum(["integer", "uuid", "slug", "opaque", "unknown"]);
const IdParamSchema = z.object({
  name: S,                                            // required
  location: z.enum(["path", "query"]),                // required
  shape: IdShapeSchema,                               // required
  enumerable: z.boolean(),                            // required; refine: true exactly when shape is "integer"
  observedExample: z.string().optional(),             // refine: classifyIdShape(example) must agree with shape
  source: z.enum(["static", "runtime", "spec"]),      // required
});
export const ObjectRouteSchema = z.object({
  route: S,                                           // required; parameterised, ids as :name
  kind: z.enum(["api", "page"]),                      // required
  resourceType: S,                                    // required; see derivation below
  methods: z.array(z.enum(["GET", "PUT", "PATCH", "DELETE"])).default(["GET"]),
  idParams: z.array(IdParamSchema).min(1),            // required
  ownerBinding: z.enum(["user", "org", "role", "unknown"]).default("unknown"),
  ownerField: z.string().optional(),                  // e.g. "user_id"; enables the mass-assignment cells
  listSource: z.string().optional(),                  // GET route that enumerates these objects
  createSource: z.string().optional(),                // POST route that creates them
  confidence: z.enum(["high", "low"]).default("low"),
});
// in TargetProfileSchema:  objectRoutes: z.array(ObjectRouteSchema).default([]),
```

- `objectRoutes` defaults to `[]`, so a profile written before P4 still parses.
- **`resourceType` derivation**: the Prisma/Drizzle model name the handler maps to, lowercased;
  otherwise the last static path noun before the first id, singularised
  (`/api/orders/:id` → `order`); for a PostgREST route, the table name singularised.
- **`ownerBinding`**: `user` when the object carries a user owner column/field, `org` when it carries
  a tenant column (multi-tenant), `role` when only a role gates it, `unknown` otherwise.
- `classifyIdShape(value)` lives in `@qa/contracts` beside the schema; the schema's refinements use
  it, so a profile whose example contradicts its shape does not parse.

### 2.4 Phase order and runtime-only routes

Requirements runs before Explore (`PHASE_IDS`: scan → dev-test-review → requirements → env-auth →
explore), so authz stories come from the **static** seed only.

- A runtime-only route of a **known** resource type joins that type's TCs: the designer (Design, after
  Explore) writes its TCs against the existing story's criteria.
- A **new** resource type found only at runtime has no story, so no criterion and no TC. The
  web-explorer appends `observation.recorded { kind: "uncovered-behaviour" }` naming it; the planner
  lists it in the plan for the owner at Gate 1. It still appears in the closure section (§7) as "not
  tested: found at runtime only".

---

## 3. Peers & fixtures

### 3.1 Actors

- **Roles in scope**, in precedence order: `aegis.config.json#target.supabase.rolesToTest` when
  non-empty, else `target-profile.json#roles` when non-empty, else
  `aegis.config.json#discovery.rolesToExplore`.
- **Peers per role**: `userA` (the owner) and `userB` (the attacker), same role. For a resource type
  with `ownerBinding: "org"`, userB belongs to a **second tenant**, so the B→A pair is cross-tenant;
  for `user`, userB is in userA's tenant.
- **Vertical actors**: the existing per-role logins from Env-auth (`tests/qa/state/{role}.json`).
  "Lower role" needs an order: new key `aegis.config.json#target.roleHierarchy` (role names, lowest
  privilege first). When it is absent, vertical cells are recorded `not-run` with the reason
  "no role hierarchy configured".
- **Seed per userA and resource type**: three fixture objects — `target`, `sibling` (created right
  after `target`; used by §5.6) and `deleted` (created, then deleted by userA before the matrix).
  Per userB and resource type: one object (used by §6.4 and the mass-assignment update cell).
  Every fixture object carries a unique `qa_authz_<nonce>` marker in a text field when the type has
  one; the verdict mapper looks for it (§5.3).

### 3.2 Where, and how

- **Environments**: ObjectAuthz runs only where D8 allows: the run's environment is in
  `OBJECT_AUTHZ_ENVIRONMENTS = ["development", "testing"]`, a constant in `@qa/contracts` (not a
  config key, so no project can add `staging`). On any other environment the TCs are still
  designed (T1) and their results are `blocked` (§5.1).
- **Read-only environments** follow main's existing path: Env-data is `not-applicable`
  (`aegis phase start` refuses it), the executor creates no task for a `mutates: true` specialist
  (security is one) and marks the ObjectAuthz TCs `blocked` (reason: read-only environment), and
  the run continues.
- **Provisioning method**, in preference order, recorded per account in the manifest:
  1. **App signup / public API.** Email verification uses the configured email adapter
     (`aegis.config.json#emailAdapter`; Mailpit on development and testing). A CAPTCHA or a signup
     rate limit falls back to method 2, and the fallback is recorded.
  2. **Admin/seed API** (for Supabase, the service-role admin API).
  3. **`db-seed`** — direct insert into the local docker Postgres/Supabase, on **`development`
     only** (the one environment with a local database; `testing` is a Vercel preview on a staging
     snapshot).

### 3.3 Peer factory (Env-data writes it; the spec run uses it)

In Env-data (`scope=data`), when the run's environment is in `OBJECT_AUTHZ_ENVIRONMENTS` and the
approved cases include ObjectAuthz TCs, the environment engineer writes
**`tests/qa/fixtures/authz/peers.fixture.ts`**: a worker-scoped Playwright fixture with
`create()`/`cleanup()` built on `FactoryCleanupTracker`. It touches neither the auth fixture nor
`playwright.config.ts` nor `global-teardown.ts`, so the scope split holds.

- The spec run provisions peers and seed objects at test time and tears them down in the fixture's
  own teardown. Objects created by POST cells (§5.2) are registered with the same tracker.
- **Start-of-run sweep**: before provisioning, the fixture deletes leftover `qa_authz_` accounts
  and objects from crashed runs, through the admin API or (development) the database. Where no
  deletion path exists, it lists the leftovers in the manifest; on `testing` they disappear with the
  ephemeral preview, on `development` with the docker DB reset.
- **Environment refusal**: the fixture reads the environment name from `QA_ENVIRONMENT`, which the
  security specialist sets when it runs the spec, and throws when it is unset or not in
  `OBJECT_AUTHZ_ENVIRONMENTS`. A developer re-running the spec against staging is refused.
- **Clean-state reproduction** is re-running the `@TC-…`-tagged test: a fresh worker re-provisions
  fresh peers and fresh seed.
- **Helpers**: the fixture and the spec import `FactoryCleanupTracker`, `sanitizeHar` and the
  matrix helpers (§10.2) from `tests/qa/support/`, copied from `@qa/test-helpers` (D11). If P2's copy
  step has not landed, this Env-data step copies those files into `tests/qa/support/` itself. Copied
  helpers import nothing at runtime from other `@qa/*` packages (type-only imports).

### 3.4 Credentials & manifest

- Peer passwords are random per run, held in memory, and never written anywhere.
- Only storageState is saved, under the existing gitignored `tests/qa/state/`:
  `tests/qa/state/authz-{role}-{a|b}.json`.
- The manifest `runs/{runId}/authz-peers.json` (`AuthzPeersManifestSchema`, §9.1) holds ids, role,
  tenant, owned-object ids per resource type, provisioning method and leftovers — no secrets. It
  is written by the spec run, never into a committed path.
- Signup and login traffic runs in a separate request context with no HAR recording; it is never
  evidence.
- Admin/seed keys (e.g. `SUPABASE_SERVICE_ROLE_KEY`) come only from `secrets/.env.{env}`, the file
  the environment engineer already verifies in Process step 5, and are never echoed or logged.
- Synthetic data only: `qa_authz_` prefixes, plus-aliased emails (`base+qa@domain.com`), no real PII.

---

## 4. Test design

### 4.1 Stories & acceptance criteria

`qa-requirements-analyst` (Requirements, Process step 8) writes **one derived story per owner-bound
resource type** (`ownerBinding` `user`, `org` or `role`) in the static seed: `source.kind:
"derived"`, `derived: true`, `source.ref` = `target-profile.json#objectRoutes` plus the resource type.
Gate 1 asks the owner to confirm it.

- **Module**: the resource's module, which must be registered in `module-codes.md`; ids are minted
  with `aegis id next --kind STORY --module <MODULE>` and `aegis id next --kind AC --story <STORY-ID>
  --category happy|rejection|edge` (`AC-{MODULE}-{NNN}-H1`, `-R1`, `-E{n}`).
- **Story**: "As the owner of an `<object>` I want other users unable to read or change it so that my
  data stays private."
- **Happy (H1)**: userA reads and edits their own object → 2xx, data as expected.
- **Rejection (R1)**: userB reads or changes userA's object by id → 404, and userA's object is
  unchanged (D1). For an `org` binding userB is in another tenant (§3.1). For a `role` binding the
  rejection criterion is the vertical one — a lower role gets 404 — and no vertical edge is minted.
- **Edge**, minted in this order, each only when it applies (an edge that does not apply is not
  minted): integer neighbour ids `id±1` are not reachable; a deleted object's id returns 404; a
  lower role cannot reach a higher role's object (needs `roleHierarchy`); the list endpoint returns
  no other owner's objects or ids (needs `listSource`); a forged owner field is not stored on create
  or update (needs `ownerField`); ids of `<type>` are not sequentially guessable (integer-keyed types
  only, §5.6).
- Routes with `ownerBinding: "unknown"` get no story; the analyst raises them in the ambiguity
  report for Gate 1.

### 4.2 Test cases

`qa-test-designer` writes the TCs (Design):

- **Granularity**: one TC per **route × criterion** (H1, R1 and each applicable edge), plus one TC per
  **integer-keyed resource type** for the enumerability edge. The defect manager files Sev1/Sev2 per
  route × method (§6.2), so a route-level TC keeps `testCaseId` meaningful.
- **Fields**: `testType: ["Security"]`, `testTechnique: ["ObjectAuthz"]`, `testLevel: "System"`,
  `automationStatus: "Automated"` always, `traceability.acIds` set, `compliance` with the tags of
  §6.1.
- **Format**: matrix-derived, like a decision table, so the TC carries `steps[]`; `gherkin` stays
  optional. The Gherkin rule (HANDBOOK/17 §17.4, `artefacts.ts` `Flow` check) is unchanged.
- **Scripts**: each matrix cell is one Playwright `test()` in
  `tests/qa/security/object-authz.security.spec.ts`, tagged with its `@TC-…`.

Example (R1, `/api/orders/:id`):

| step | action | expected |
|------|--------|----------|
| 1 | As userB, GET `/api/orders/{userA target id}` | 404 |
| 2 | As userB, PATCH the same id with a changed field | 404 |
| 3 | As userA, GET the same id | 200; body equal to the snapshot taken before step 1 |

### 4.3 Traceability

Standard T0–T5: each authz criterion → ≥1 TC (T1); each TC → a tagged script (T2/T3); each TC a
result (T4). A TC whose cells could not run has the **result** `blocked` with its reason (not an
`automationStatus` change); T4 lists it.

---

## 5. Execution (`qa-security-specialist`)

### 5.1 Eligibility

Before any ObjectAuthz cell, the security specialist reads `run.json#environment` and
`run.json#cycleType`:

- environment not in `OBJECT_AUTHZ_ENVIRONMENTS` (D8) → every ObjectAuthz TC result is `blocked`,
  reason "object-level authorization runs on development and testing only"; the rest of the task
  continues;
- `cycleType` not `full` → `not-run`, reason "full-cycle only". The smoke cycle has no Requirements or
  Design phase, so it never derives ObjectAuthz TCs; this covers smoke reusing earlier cases.

Production never gets this far: security is forbidden there by `DEFAULT_ENVIRONMENT_SPECIALISTS`
and `aegis task claim` refuses the claim through `assertEnvSafe` (`run-state/src/tasks.ts`).

**Pages.** A client-rendered SPA answers 200 for every document, so page navigations are not judged
by status alone. A `kind: "page"` cell is a GET navigation as the attacker: a 404 document passes; a
userA marker rendered in the DOM is Sev1; a 2xx document without the marker is `no-verdict`
("client-rendered shell; judged by its data requests", which are their own `api` routes); any other
status follows §5.3.

### 5.2 The matrix

Per eligible route and actor, with Playwright `APIRequestContext` (`maxRedirects: 0`, so 3xx is
observed):

| Target | Methods | Notes |
|--------|---------|-------|
| `owned` — userA's `target` fixture | every declared method (GET, PUT, PATCH, DELETE) | writes only ever hit this fixture (D5) |
| `control` — guaranteed-nonexistent id | GET, plus the write methods of `owned` once the id is confirmed absent | integer: `2147483647`; uuid: a fresh v4; slug/opaque: `qa_authz_absent_<nonce>`. A control write runs only after the admin API or (development) the database confirms the id absent; otherwise rows 7–8 of §5.3 leave that write cell `unjudged` (reason "no write control"). An object a control write creates is registered for cleanup |
| `id-1`, `id+1` (integer ids only) | **GET only** | owner lookup below |
| `deleted` — userA's deleted fixture | GET | |
| `list` — `listSource` | GET | horizontal actor only |
| `create` — `createSource` | POST with `ownerField` = userA's id | horizontal actor only; created objects go to the cleanup tracker |
| mass-assignment update — userB's own fixture | PATCH (or PUT) with `ownerField` = userA's id | a fixture write (D5) |

**Actors**: userB (horizontal) on every row; each lower role (vertical) on `owned` and `control`
only. A `role`-bound route has no horizontal actor: same-role access is legitimate there.

**Owner lookup for `id±1`**, against the manifest, before a cell is judged:

- the actor's own object → skipped (an expected 2xx, not a probe);
- another peer's fixture (e.g. userA's `sibling`) → the normal §5.3 rule;
- an id outside the manifest → a 2xx returning an object body is Sev1 with the **response body
  redacted in evidence** (it may be real user data); any other response is `unjudged` (existence unknown).

**Verification**: userA GETs the `target` once before the actor's cells and once after every write
cell. When the route has no read endpoint for userA, the check is a read-only SELECT against the
local docker database on `development`; with neither, the write cell is `blocked` with the reason,
never `passed`.

### 5.3 Verdicts

Evaluated in this order for every judged cell:

| # | Observation | Verdict |
|---|-------------|---------|
| 1 | userA's object changed or deleted (verification differs from the snapshot) | Sev1 (D3) |
| 2 | 2xx and the body carries userA's data (the fixture marker, or a non-id field value of userA's own GET) | Sev1 (D3) |
| 3 | 2xx, no data, no change | Sev2 (D7) |
| 4 | 404 | pass (D1) |
| 5 | 403 | Sev2 (D2) |
| 6 | 5xx | Sev2, pending origin confirmation (D7) |
| 7 | any other status (401, 400, 405, 422, 3xx) **differing** from the control response | Sev2 (D7) |
| 8 | any other status **identical** to the control response | Sev3, non-standard denial (D7) |

"Identical" means the same status and the same body once the probed id is replaced by a fixed token
and volatile headers are dropped. `list` cells: other owners' objects with data → Sev1; other
owners' ids only → Sev2; neither → pass. `create` / mass-assignment cells: the forged owner stored
(read back by userA or userB) → Sev1; refused or overridden → pass.

### 5.4 Assertions

Each cell `test()` writes its cell record (§5.7) first, then asserts with
`expect(res.status()).toBe(404)` (or the cell's expected outcome; Playwright's `APIResponse` has no
`toHaveStatus` and no auto-retry). A data-unchanged check compares userA's GET bodies key-sorted;
the attacker's response body is never trusted alone.

### 5.5 Write safety

PUT, PATCH and DELETE target only userA's `target` and userB's own object — both manifest fixtures
(D5) — and a control id confirmed absent (§5.2). `id±1`, `deleted` and `list` are GET-only. A DELETE that unexpectedly succeeds is the
Sev1 itself; the fixture re-creates the object before the next cell and updates the manifest.

### 5.6 Enumerability TC (Sev3, D4)

The one TC per integer-keyed resource type fails when `idParams[].enumerable` is true **and** one
live check confirms it: as userA, GET `target id + 1` returns userA's `sibling`. Without that
confirmation it passes, and the closure section still shows the id shape as integer. It is judged
whatever the authz result of the type's routes. Each failing check appends `id.enumerable-detected`.

### 5.7 Cell record

`runs/{runId}/evidence/{TC-ID}/authz-matrix.json` (`AuthzMatrixSchema`, §9.1), one entry per cell:

```jsonc
{ "route": "/api/orders/:id", "method": "GET", "actor": "userB",
  "targetKind": "owned",            // owned | control | id-1 | id+1 | deleted | list | create | mass-assign
  "targetOwner": "peer",            // actor | peer | outside-manifest | none
  "status": 403, "controlStatus": 404,
  "dataReturned": false, "dataChanged": false,
  "verdict": "Sev2",                // pass | Sev1 | Sev2 | Sev3 | skipped | unjudged | no-verdict | not-run | blocked
  "reason": "403 to another owner's object" }
```

The record holds statuses and booleans, never bodies. The TC result
(`cases/{TC-ID}-result.json`) is `failed` when any cell is Sev1–Sev3, `blocked` or `not-run` when
none ran, otherwise `passed`; it cites the matrix file.

### 5.8 Spec file and sandbox-first

The spec is `tests/qa/security/object-authz.security.spec.ts` (the existing `{surface}` pattern). It
is prototyped in `sandbox/{date}-{slug}/` first and recorded with `sandbox.explored` (security
Process step 2, SPV item 10).

### 5.9 Evidence & HAR

HAR is captured only for the matrix context and passes through `sanitizeHar` before it lands under
`runs/{runId}/evidence/{TC-ID}/`. Today `sanitizeHar` (`packages/@qa/test-helpers/src/index.ts`)
strips only `authorization`, `cookie`, `set-cookie`, `x-api-key` and `x-auth-token` headers. **P4
extends it** (backward-compatible): the `apikey` header; request bodies (`password`, `token`
fields); response bodies (`access_token`, `refresh_token`, `id_token`); query-string tokens
(`access_token`, `token`, `apikey`, `code`); and full response-body redaction for the
outside-manifest URLs of §5.2. The extended function is the one copied into `tests/qa/support/`
(D11). Evidence names follow `evidenceFileName` (`{TC}_{step}_{ts}.{ext}`).

### 5.10 Request cap

`aegis.config.json#objectAuthz.maxRequestsPerRoute` (run configuration, not a quality gate), default
**60**, minimum 12. It counts every matrix request to one route — control and verification
included, provisioning excluded. A typical route (4 methods, userB plus two lower roles) needs
about 44. When the cap is exceeded, cells are dropped in this order: vertical actors beyond the
nearest lower role, then `deleted`, then `id±1`, then `list`/`create`/mass-assignment. `owned`,
`control` and verification cells for userB are never dropped. A dropped cell is recorded `not-run`
with the reason "request cap", so it reaches T4.

---

## 6. Defects (`qa-defect-manager`)

### 6.1 Shapes

All authz defects use the DEF type code **`SEC`** (`DEF-{NNN}-{MODULE}-SEC`).

| Finding | Severity | `defectType` | Tags |
|---------|----------|--------------|------|
| Read leak (data returned; list with other owners' data) | Sev1 (D3) | Logic | `CWE-639`, `WSTG-v42-ATHZ-04`, `ISO25010-Security-Confidentiality`; vertical also `WSTG-v42-ATHZ-03` |
| Write/delete leak (object changed or deleted) | Sev1 (D3) | Logic | `CWE-639`, `WSTG-v42-ATHZ-04`, `ISO25010-Security-Integrity`; vertical also `WSTG-v42-ATHZ-03` |
| Mass assignment (forged owner stored) | Sev1 (D3) | Logic | `CWE-915`, `CWE-639`, `WSTG-v42-ATHZ-04`, `ISO25010-Security-Integrity` |
| 403; response differing from control; 2xx without data; 5xx | Sev2 (D2, D7) | Logic | `CWE-204`, `CWE-639`, `WSTG-v42-ATHZ-04`, `ISO25010-Security-Confidentiality` |
| List returning other owners' ids only | Sev2 | Logic | `CWE-200`, `WSTG-v42-ATHZ-04`, `ISO25010-Security-Confidentiality` |
| Non-standard denial (identical to control) | Sev3 (D7) | Standards | `CWE-703`, `WSTG-v42-ATHZ-04`, `ISO25010-Security-Confidentiality` |
| Enumerable integer id (§5.6) | Sev3 (D4) | Standards | `CWE-340`, `WSTG-v42-ATHZ-04`, `ISO25010-Security-Confidentiality` |
| Slug-keyed resource | none — observation only | — | — |

All tags pass the existing `tags.ts` regexes; no tag-schema change. `resourceType` is not a
`DefectSchema` field (the schema strips unknown keys): it goes in the title and the reproduction
steps.

### 6.2 Grouping

- Sev1 and Sev2: one defect per route × method (each is a distinct missing check).
- Sev3 non-standard denial: one defect per route, listing the affected methods.
- Sev3 enumerable id: one defect per resource type (D4) — it comes from the one enumerability TC,
  and its reproduction steps list every integer-keyed route of the type.
- Across runs, Process step 3 applies as written: a failure matching the previous run's open defect
  links to it and updates `lastSeen`.
- Supabase: an ObjectAuthz Sev1 on a PostgREST route is de-duplicated (step 3, `defect.duplicate`)
  against a database-specialist RLS defect on the same table (`rls.violation-detected`).

### 6.3 Gate and threshold effect

- G2: D9. The Sev1 block is P0c's mechanical rule; P4 adds no gate logic of its own unless P0c ships
  without it (§1.1).
- Promotion gate check (P3's rewrite of `qa-gate-check`): Sev1 → `maxCritical` (0), Sev2 → `maxHigh`
  (0). The ObjectAuthz Sev3 defects (non-standard denial, enumerable id) are **excluded** from the
  security counts — counted against `maxMedium` (testing 5, staging 3) they would fail promotion
  for any app with several integer-keyed types — and are listed in the closure section (§7)
  instead.

### 6.4 Origin confirmation (HANDBOOK/17 (d))

Before filing, the defect manager rules out test-side causes and records them in
`originConfirmation.ruledOut`:

- userB's session really is userB: an identity-echo endpoint when the app has one, otherwise userB's
  own GET of its own fixture succeeds;
- the target belongs to userA: userA's own GET succeeds;
- the fixture is fresh: it was created in this spec run (manifest).

It then reproduces the failing cell on a clean state by re-running the `@TC-…`-tagged test
(`pnpm exec playwright test --grep @TC-…`), which re-provisions fresh peers and seed (§3.3), and
sets `reproducedOnClean`. This mutates the environment in Triage, hence the P0b-2 dependency
(§1.1). A 5xx (D7) that does not reproduce is a test-side finding, not a defect.

Defect files stay brand-clean.

---

## 7. Closure: "Object reference exposure"

`qa-closure-reporter` adds a brand-clean section to `reports/closure/closure.md` and the key
`objectReferenceExposure[]` to `closure.json`, built from `target-profile.json#objectRoutes`, the
ObjectAuthz TC results and the defects. It is produced on **every** full cycle, including when the
ObjectAuthz TCs are `blocked` (staging, read-only), so the integer-id flag always reaches the owner.

| Resource type | Routes | Id shape | Enumerable | Authorization result |
|---------------|--------|----------|------------|----------------------|
| order | `/api/orders/:id`, `/orders/[id]` | integer | yes | protected (404) |

Authorization result values: "protected (404)", "existence disclosed", "access leak", "not tested:
<reason>" (environment, read-only, owner binding unknown, found at runtime only). The section also
lists the Sev3 findings excluded from the gate counts (§6.3). Neutral language only — no framework or
agent names.

---

## 8. Safety summary

- **Environments**: development and testing only (D8), enforced by the security specialist (§5.1),
  the peer fixture (§3.3) and the security SPV (§9.4); production additionally by `aegis task claim`.
- **Full cycle only** (§5.1).
- **Writes**: fixture-owned ids only (D5, §5.5); neighbour probes are GET-only.
- **Bounded**: `id±1` only, never a range sweep; per-route cap (§5.10).
- **No secrets at rest**: §3.4; HAR sanitisation and outside-manifest body redaction (§5.9).
- **Cleanup**: tracker teardown plus the start-of-run sweep (§3.3).

---

## 9. Contract, pipeline & checker impact

Every change keeps `pnpm aegis align` green (HANDBOOK/14 §14.11): prose first, then the contract
block, then pipeline touch-points and their prose anchors.

### 9.1 Contracts (`@qa/contracts`)

- `target-profile.ts`: `ObjectRouteSchema`, `IdParamSchema`, `classifyIdShape`;
  `objectRoutes` on `TargetProfileSchema` (§2.3).
- New `object-authz.ts`: `OBJECT_AUTHZ_ENVIRONMENTS`, `AuthzMatrixSchema` (§5.7),
  `AuthzPeersManifestSchema` (§3.4).
- `artefacts.ts`: `TestTechniqueSchema` gains `ObjectAuthz`.
- `routing.ts`: `ObjectAuthz` in `TEST_ROUTING.documentationOnly`;
  `TECHNIQUE_COMPANION_TYPES.ObjectAuthz = ["Security"]`, so `TestCaseSchema` refuses an ObjectAuthz
  TC that is not `Security`.
- `events.ts`: the four events of §9.2, declared and added to `AegisEventUnionSchema`.
- `DefectSchema`, `DefectCandidateSchema`, the tag regexes and `ids.ts` are unchanged.

### 9.2 Events

All are appended with `aegis event append`; none is a CLI-recorded family
(`run-state/src/caller.ts#CLI_RECORDED_PREFIXES`). All are telemetry: blocking comes from the
defects (§6.3).

| Event | Fields | Emitter |
|-------|--------|---------|
| `object-routes.classified` | `count`, `shapeCounts` (shape → count) | `qa-context-scanner` and `qa-web-explorer`, one per write of `objectRoutes` |
| `authz.peers-provisioned` | `accounts` (a count; never identities or credentials) | `qa-security-specialist`, after the spec run, with the count the peer fixture reports |
| `authz.leak-detected` | `route`, `method`, `cwe`, `severity: SeveritySchema` | `qa-security-specialist`, per Sev1 cell |
| `id.enumerable-detected` | `resourceType`, `shape` | `qa-security-specialist`, per failing §5.6 check |

### 9.3 Agent changes

| Agent | Prose | Contract |
|-------|-------|----------|
| `qa-context-scanner` | Source-inventory step: id-shape classification, PostgREST routes, `objectRoutes`; change detection ignores runtime parameters | emits `object-routes.classified` |
| `qa-web-explorer` | BFS records GET XHR/fetch URLs only, never replays; rmw enrichment; `observation.recorded` for a runtime-only resource type | reads `{path: "{run}/target-profile.json", rmw: true}`; writes `{run}/target-profile.json`; emits `object-routes.classified`, `observation.recorded` |
| `qa-requirements-analyst` | Step 8: one derived authz story per owner-bound resource type (§4.1); unknown bindings to the ambiguity report | none (already reads the profile, writes stories, runs `id.next`) |
| `qa-test-designer` | ObjectAuthz TCs (§4.2); `ObjectAuthz` in the documentation-only technique list | none |
| `qa-environment-engineer` | scope=data: peer factory (§3.3), helper copy when P2 has not landed | writes `{tests}/qa/support/**` (only if P2 has not added it); config `aegis.config.json#discovery.rolesToExplore` |
| `qa-security-specialist` | Eligibility (§5.1), matrix, verdicts, enumerability TC, cell record, cap; Quality Standards "DAST skipped" applies to tasks with scanning-surface TCs only | reads `{run}/run.json`; writes `{tests}/qa/security/object-authz.security.spec.ts` (covered by `{surface}`), `{tests}/qa/state/authz-{role}-{a|b}.json`, `{run}/authz-peers.json`; emits the three security events of §9.2; config `aegis.config.json#objectAuthz.maxRequestsPerRoute`, `aegis.config.json#target.roleHierarchy` |
| `qa-defect-manager` | §6 shapes, grouping, origin confirmation, RLS de-dup | reads `{run}/authz-peers.json`, `{run}/target-profile.json`; `runs: [pnpm]` |
| `qa-closure-reporter` | §7 section | reads `{run}/target-profile.json` |
| `qa-test-executor` | the word `ObjectAuthz` in step 4's documentation-only list | none |

The security `cli` stays `[task.claim, work-report.submit, task.release, event.append]`.

### 9.4 SPV checklists (lockstep)

- **qa-security-specialist-spv**: item 1 (all four scan surfaces) applies to tasks whose TCs need a
  scanning surface; an ObjectAuthz-only task is judged on these items instead — matrix ran for every
  eligible route; eligibility respected (development/testing, full cycle); writes only on fixture
  ids, neighbours GET-only; data-unchanged verified by userA GET or DB; verdicts follow §5.3; cell
  record present for every TC; HAR sanitised and outside-manifest bodies redacted; no secret in the
  manifest or evidence; `sandbox.explored` present.
- **qa-environment-engineer-spv** (scope=data): peer factory has create/cleanup on
  `FactoryCleanupTracker`, the start-of-run sweep and the environment refusal; no password persisted;
  state under `tests/qa/state/`; auth fixture, `playwright.config.ts` and `global-teardown.ts`
  untouched.
- **qa-test-designer-spv**: one ObjectAuthz TC per route × criterion and one per integer-keyed type;
  `Security` + `ObjectAuthz`, `System`, `Automated`; `steps[]` (no Gherkin demanded).
- **qa-requirements-analyst-spv**: one derived authz story per owner-bound resource type, with the
  module registered and the applicable criteria; unknown bindings in the ambiguity report.
- **qa-web-explorer-spv**: the enrichment made no non-GET request; static shapes reconciled with
  runtime evidence (a contradiction is reported, not silently overwritten); the profile still parses
  with `TargetProfileSchema`.
- **qa-defect-manager-spv**: severity ladder (§5.3, §6.1); `SEC` code; tags; Sev3 enumerable once per
  resource type; Sev1/Sev2 per route × method; `originConfirmation` fields filled.
- **qa-closure-reporter-spv**: the exposure section present on every full cycle (including blocked
  ObjectAuthz), brand-clean.

### 9.5 Pipeline & routing

- `pipeline.yaml#routing`: `ObjectAuthz` in `techniqueWithoutSpecialist` and in
  `designerEmits.testTechnique`; no `byTechnique` route (`Security` already routes to
  `qa-security-specialist`, and `routeTestCase` dispatches each specialist once).
- `routing-vocab` test: unchanged assertions keep `pipeline.yaml` and `TEST_ROUTING` in step; add
  `routeTestCase({ testType: ["Security"], testTechnique: ["ObjectAuthz"] })` →
  `["qa-security-specialist"]`.
- `pipeline.yaml#escapes`: `{unit: qa-web-explorer, field: rmw, value: "{run}/target-profile.json",
  reason: "qa-web-explorer.md enriches objectRoutes in the Scan profile"}` — a new entry, so the PR
  carries the `baseline-growth` label.
- `writePolicy`: no change. `{tests}/qa/**` covers `tests/qa/fixtures/authz/**`,
  `tests/qa/support/**` and the spec; `{run}/**` covers the manifest and cell records.

### 9.6 Config

- `aegis.config.json`: new `objectAuthz: { maxRequestsPerRoute: 60 }` and `target.roleHierarchy: []`.
- `thresholds.yaml`: no change.

### 9.7 Baseline

No new `baseline.yaml` line is expected: every change is a paired prose + contract edit in one slice.
The one escape entry (§9.5) needs the `baseline-growth` label. Any unavoidable baseline growth is
owned by AUD-070.

---

## 10. Testing the feature

### 10.1 Fixture app

`__internal-tests__/fixtures/idor-app/`, bare `node:http` (no new dependency), four mounted variants
of one `order` resource:

- `/api/vulnerable/orders/:id` (integer) — no ownership check;
- `/api/safe/orders/:id` (integer) — owner check, else 404;
- `/api/forbidden/orders/:id` (integer) — owner check, answers 403;
- `/api/safe-uuid/orders/:uuid` — owner check, else 404.

Seed: userA owns orders 10 (`target`) and 11 (`sibling`), and 12 (`deleted`, removed before the
matrix); userB owns 20; order 9 belongs to a user outside the manifest (a stand-in for real data).

Expected: `/vulnerable` Sev1 (owned GET/PATCH/DELETE; `id+1` is userA's sibling → Sev1; `id-1` is
the outsider → Sev1 with its body redacted); `/forbidden` Sev2; `/safe` and `/safe-uuid`
authz-clean; exactly one enumerability target for `order`, from the integer routes only. Order 9
still exists after every run, and its body never appears in evidence.

### 10.2 Code and tests

P4's code, by package:

- `@qa/contracts`: schemas of §9.1 and `classifyIdShape`.
- `@qa/test-helpers` (copied into `tests/qa/support/`, D11): `buildAuthzMatrix(route, manifest,
  cap)`, `judgeAuthzCell(observation, control)`, `assertDataUnchanged(before, after)`, the peer-factory
  base on `FactoryCleanupTracker`, and the extended `sanitizeHar`.

Tests (`__internal-tests__`):

- **Classifier**: integer, uuid, slug, opaque, unknown; composite (two `idParams`); query `?id=42`;
  PostgREST `?id=eq.42`.
- **Schema**: a profile without `objectRoutes` parses; `enumerable`/`shape` and example refinements.
- **Matrix builder**: exact cell set per §5.2 — writes only on fixture ids, neighbours GET-only, the
  actor's own object skipped, outside-manifest marked; cap and drop order (§5.10).
- **Verdict mapper**: every row of §5.3, including both control-probe rows, list and create cells.
- **Data-unchanged**: the userA-GET diff and the DB-read path both detect a mutation.
- **Env guard**: `OBJECT_AUTHZ_ENVIRONMENTS` is exactly development and testing; the peer fixture
  refuses staging, production and an unset `QA_ENVIRONMENT`.
- **sanitizeHar**: `apikey` header, body tokens, query tokens, outside-manifest body redaction; the
  existing header behaviour unchanged.
- **Routing & vocabulary**: `ObjectAuthz` documentation-only; companion type enforced by
  `TestCaseSchema`; `routing-vocab` green.
- **Events**: the four events parse and are agent-appendable.
- **Alignment**: `pnpm aegis align` green.
- **E2E**: the §10.1 fixture app driven through `buildAuthzMatrix` + `judgeAuthzCell` with a seeded
  manifest (provisioning stubbed), asserting the §10.1 expectations.

---

## 11. Open questions

None. Q1–Q3 of the review were answered on 2026-10-02 and are recorded as D7–D9.

---

## 12. Delivery

**One plan, one PR.** The size is close to P0a-2's: eight agents, seven SPVs, contracts, routing,
config, one library, a fixture app and tests. Tasks:

1. **Contracts**: §9.1 schemas, `classifyIdShape`, `ObjectAuthz` vocabulary and companion type, events.
2. **Detection**: scanner classification and PostgREST routes; web-explorer GET-only enrichment, rmw
   contract and escape entry; `object-routes.classified`; runtime-only observation.
3. **Stories & design**: analyst derived stories; designer TCs (§4).
4. **Library**: `@qa/test-helpers` matrix builder, verdict mapper, data-unchanged checker, peer-factory
   base, `sanitizeHar` extension.
5. **Env-data**: peer factory, sweep, environment refusal, helper copy fallback.
6. **Execution**: security eligibility, matrix, cap, cell records, enumerability TC, events; SPV
   item 1 scoping.
7. **Defects & closure**: §6 and §7.
8. **Config & pipeline**: §9.5, §9.6.
9. **SPV checklists**: §9.4.
10. **Docs (required)**: HANDBOOK/07 §7.6 technique table gains `ObjectAuthz` (documentation-only);
    HANDBOOK/06 security-specialist row mentions object-level authorization. HANDBOOK/17 needs no
    change (no Gherkin rule change; Sev3 flows through a failed TC, not a candidate). HANDBOOK/17
    §17.1 makes an agent/chapter disagreement a defect, so this task is not deferrable.
11. **Tests**: §10.

**Optional split**, if the owner wants the integer-id flag sooner: **P4a** — the `objectRoutes`
schema, detection (task 2) and the closure section (§7); it needs only P1 and sends no mutating
request. **P4b** — everything else, including the enumerability TCs (§5.6's live check needs the
peer fixtures), after P0c and P0b-2. Both stay in this spec and one plan; the split only changes the
PR boundary.
