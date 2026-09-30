# P4 — Object-level authorization, IDOR & integer-ID enumerability (Design)

> **Temporary working document** — part of the audit remediation program. Delete together with
> `2026-09-29-audit-remediation-matrix.md` once P6 is closed.

- Date: 2026-09-30
- Status: draft — awaiting owner review
- Program matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`, §P4 (AUD-070)
- Builds on: P0 (`2026-09-29-p0-pipeline-foundation-design.md`, incl. P0a-1's minimal `TargetProfileSchema`) and P1 (contracts & vocabulary)
- Owner decisions: 2026-10-01 (§9) — only 404 passes; 403 is a Sev2 defect; DELETE on fixture-owned objects only
- Closes: AUD-070

---

## 1. Context

The owner asked whether Aegis checks that app URLs expose object references safely: does a resource
sit behind an integer id that another user can "shoot" by changing the number, and is the object
protected by an authorization check regardless of id shape? Today nothing in the pipeline runs an
IDOR / object-level-authorization test, and no agent records whether a route uses an integer id, a
UUID, a slug or a composite key. AUD-070 owns the gap.

Approach A (agreed): the feature is **detection + active IDOR test**, wired into the existing
phases and agents rather than a bolt-on tool. Test accounts are created locally (docker) by the
environment engineer. Only a **404** passes a cross-owner request. An authorization leak is **Sev1**,
gate-blocking, tagged CWE-639 / WSTG-v42-ATHZ-04; a **403** (existence disclosed) is **Sev2**; an
enumerable integer id whose object is otherwise correctly protected is a **Sev3** hardening finding.

### 1.1 Where P4 lands

P4 runs on the P0 target-state pipeline, after **P0c** (rollup, trace, retest, execution skills) and
**P1** (contracts & vocabulary) are merged. It touches five existing agents plus the defect manager;
it adds **no new agent** and therefore **no new SPV** — each change is reviewed by the agent's
existing SPV. This keeps the roster stable (P2 owns roster changes) and the barrier undisturbed.

### 1.2 Non-goals

- No new specialist or SPV pair (AUD-070 is one capability across existing agents).
- No SAST/DAST tooling change: the B→A matrix is authored request logic, not a ZAP scan.
- No production testing of any kind (§6).
- No auto-remediation of the target; findings are defects only (Territory rule).

---

## 2. Detection

### 2.1 What is classified

For every object-bearing route or endpoint, the id-shape is classified into one of:

| Shape | Signal | Enumerable? |
|-------|--------|-------------|
| `integer` | path/query segment is `^\d+$`; OpenAPI `type: integer`; Prisma/SQL `serial`/`bigserial` PK | yes (id±1) |
| `uuid` | segment matches RFC-4122; OpenAPI `format: uuid` | no |
| `slug` | human-readable token (`/posts/my-first-post`) | no — observation only (O6) |
| `composite` | two+ id segments (`/orgs/:orgId/projects/:projectId`) | per-segment |
| `opaque` | ULID / nanoid / hashid — non-sequential, non-UUID | no |
| `unknown` | shape not determinable statically | flagged for runtime confirmation |

### 2.2 Sources (three, merged)

1. **Static — `qa-context-scanner`** (phase 1, Scan). Extends `sourceInventory`: for each `routes[]`
   and `apiHandlers[]` entry, parse the dynamic segments (`[id]`, `:id`, `{id}`) and infer the shape
   from the segment name plus, where present, the schema declaration (Prisma model PK type, Drizzle
   column, OpenAPI/Swagger parameter). Emits nothing new; writes `objectRoutes[]` seed into
   `target-profile.json`.
2. **Runtime — `qa-web-explorer`** (phase 5, Explore). During the read-only BFS it already
   parameterises URLs (`/users/[id]` not `/users/42`). It now records the **observed concrete id**
   for each parameterised route (an example integer or UUID actually seen in the authenticated app),
   confirms/upgrades the static shape from live evidence, and captures the list endpoint that
   surfaced the id (for the "list leaks ids" edge). Enriches `objectRoutes[]`.
3. **API specs if present** — an OpenAPI/Swagger/GraphQL schema found by the scanner is the
   authoritative shape source and overrides inference on conflict.

The scanner writes the initial `objectRoutes[]`; the web-explorer enriches it in place (rmw on
`target-profile.json`, matching the existing optional-read escape the scanner already declares).

### 2.3 `target-profile.json#objectRoutes[]` schema (extends `TargetProfileSchema` in `packages/@qa/contracts/src/target-profile.ts`)

```jsonc
{
  "objectRoutes": [
    {
      "route": "/api/orders/:id",              // parameterised, id segments as :name
      "kind": "api" | "page",
      "methods": ["GET", "PUT", "PATCH", "DELETE"],
      "idParams": [
        { "name": "id", "shape": "integer", "enumerable": true,
          "observedExample": "1042", "source": "static|runtime|spec" }
      ],
      "ownerBinding": "user" | "org" | "role" | "unknown", // whose object this is, if inferable
      "listSource": "/api/orders",             // endpoint that enumerates these ids, if any
      "confidence": "high" | "low"
    }
  ]
}
```

`enumerable` is true only for `integer`; a `slug` is recorded as an observation, never a defect (O6). It drives the Sev3 finding
independently of the authz test outcome.

---

## 3. Account provisioning

### 3.1 What is provisioned

Per role in scope (from `target-profile.json#roles` / `aegis.config.json#target.supabase.rolesToTest`),
the environment engineer provisions **two peer accounts** — `userA` and `userB` — that share a role
but own distinct objects. This is the B→A pair: userB attempts to reach userA's objects. Vertical
checks reuse the existing per-role fixtures (a low-privilege role reaching a high-privilege object).

This is done in **Env:data** (phase 8) — P0 already reserves "per-role peer users (reserved for P4)"
there. Env:auth (phase 4) still only logs in existing roles.

### 3.2 How, and only where

- **Only on `mutating` envs** (`aegis.config.json#environments.{env}.mutating === true`). On a
  non-mutating env, provisioning is impossible → the run is **blocked with a reason**
  (`env.setup-failed { reason: "objectAuthz-requires-mutating-env" }`), never silently skipped. The
  security specialist then records the ObjectAuthz TCs as `blocked`, and trace T4 lists them
  explicitly (not `not-run` waived away).
- Provisioning method, in preference order, recorded per account in the fixture manifest:
  1. **App signup / public API** — preferred; exercises the real registration path.
  2. **Admin/seed API** — when signup is closed.
  3. **Docker DB seed** — direct insert into the local Postgres/Supabase (the owner's stated local
     docker workflow), used only when 1–2 are unavailable; recorded as `method: db-seed`.
- Each account is seeded with **at least one owned object per object-type** in `objectRoutes[]`, so
  the matrix has a concrete userA-owned target and a userB identity to attack from.

### 3.3 Fixture storage & cleanup

- Peer identities and their storageState under `tests/qa/fixtures/authz/` (state files gitignored,
  same rule as `tests/qa/state/*.json`).
- An `authz-peers.json` manifest (ids, role, owned-object ids, provisioning method) under
  `tests/qa/fixtures/authz/` — **synthetic data only, no real PII**, `qa_`/`test_` prefixes.
- Cleanup pairs with creation: `global-teardown.ts` deletes seeded objects and peer accounts
  (or the docker DB is reset), exactly like the existing factory `create()/cleanup()` discipline.
- Credentials never logged; never seeded into any non-`mutating` or production env.

---

## 4. Test design

### 4.1 Stories & acceptance criteria (NEW-01 shape)

The requirements analyst / designer emit an authorization user story per owner-bound object type,
using P0's happy / rejection / edge AC categories:

- **Story:** "As userB I want the system to prevent access to userA's `<object>` so that data stays
  private." (`derived: true` when synthesized from `objectRoutes[]` rather than intake; confirmed at
  Gate 1.)
- **Happy AC:** userA reads/edits **their own** object → 2xx, data as expected.
- **Rejection AC:** userB reads/edits **userA's** object by id → **404** (the object's existence is
  not disclosed; a 403 fails the AC — O1), **and userA's data is
  unchanged**.
- **Edge AC:** (a) integer `id±1` reaches a neighbour's object; (b) a **deleted** object's id;
  (c) **vertical** escalation — a lower role reaching a higher-role object; (d) a **list endpoint
  leaking** ids belonging to other owners; (e) **mass assignment** of an owner-id field (userB
  sets `ownerId=userA` on create/update).

### 4.2 Generated Gherkin test cases

Designer emits, per AC, a TC with `testType: ["Security"]` and `testTechnique: ["ObjectAuthz"]`.
Because these are flow cases they carry the `gherkin { given[], when[], then[] }` block (HANDBOOK/17
rule; `Flow` need not be co-listed — the Gherkin trigger is extended to include ObjectAuthz, see §7).
Example:

```gherkin
Given userA owns order 1042 and userB is authenticated
When userB sends GET /api/orders/1042
Then the response status is 404
And a follow-up GET as userA returns order 1042 unchanged
```

Enumerable-id (Sev3) checks ride on the same TC where the object is integer-keyed; the enumerability
finding is reported from detection data, not from a separate TC (§5.2).

### 4.3 Traceability

Standard T0–T5: each ObjectAuthz AC → ≥1 TC (T1); each Automated TC → a tagged script under
`tests/qa/**` (T2/T3); each TC a result (T4). ObjectAuthz TCs are `Automated` (request-driven,
deterministic) unless provisioning was impossible, in which case `blocked` with a recorded reason.

---

## 5. Execution (qa-security-specialist)

### 5.1 The B→A request matrix

For each `objectRoutes[]` entry with an owner binding, the specialist runs, using Playwright
`APIRequestContext` with **userB's** storageState against **userA's** object id:

| Dimension | Values |
|-----------|--------|
| Method | GET, PUT, PATCH, DELETE (only methods the route declares) |
| Target id | userA's own id; for integer ids also `id-1` and `id+1`; a deleted id |
| Actor | userB (same role, horizontal); each lower role (vertical) |

**Pass** = every B→A request returns **404**, **and** userA's object is **unchanged** afterwards
(O1). A **403** with data unchanged is a **fail** (Sev2, existence disclosure). A 2xx that returns
userA's data, or any mutation that alters it, is a **fail** (Sev1). Vertical cells follow the same
rule: a lower role must get 404 for a higher-role object.

### 5.2 Assertions

1. **Response assertion** — web-first: `expect(res).toHaveStatus(404)` (helper asserting exactly 404;
   the result records the actual status so 403 maps to Sev2, 2xx to Sev1); a 401 is treated as
   pass only if the request was genuinely unauthenticated (it is not here — userB is logged in), so
   401 from an authenticated userB is a finding.
2. **Data-unchanged verification** — after any write attempt, confirm userA's object is intact via
   **userA's own GET** (preferred, black-box) or, when no read endpoint exists, a **read-only DB
   check** against the local docker DB. Never trust the attacker's response body alone.
3. **Enumerability (Sev3)** — asserted from `objectRoutes[].idParams[].enumerable`, reported once per
   resource type (§5.3), regardless of the authz result.

### 5.3 Safety of DELETE (non-destructive default)

DELETE in the matrix targets **fixture-owned objects only**: userB attempts to delete a
**userA-fixture** object that was seeded for this run and will be torn down anyway. The pass criterion
is that the delete is **refused** with 404 and the object still exists on userA's follow-up read
(a 403 refusal is the Sev2 finding);
if the delete unexpectedly **succeeds**, that is the Sev1 finding itself and the fixture is
re-seeded before the next case. No non-fixture / real object is ever a DELETE target. (Choice:
fixture-owned-only, not dry-run — a dry run cannot prove the endpoint would have refused.)

### 5.4 Evidence

- Request/response pairs captured as HAR, **sanitized** via `@qa/test-helpers.sanitizeHar` before
  landing under `{run}/evidence/{TC-ID}/` (userA/userB tokens and cookies stripped — the same rule
  every specialist already follows).
- Evidence names follow the existing `{TC}_{step}_{ts}` convention; result JSON at
  `{run}/cases/{TC-ID}-result.json`.

### 5.5 Defects (qa-defect-manager)

| Outcome of a B→A (or vertical) cell | Severity | Tags | Gate effect |
|-------------------------------------|----------|------|-------------|
| 2xx returns userA's data, or userA's object changed/deleted | **Sev1** — authz leak | `CWE-639`, `WSTG-v42-ATHZ-04` (vertical: also `WSTG-v42-ATHZ-03`) | gate-blocking at G2 |
| **403**, data unchanged — existence disclosed | **Sev2** (O1) | `CWE-639`, `WSTG-v42-ATHZ-04` | gate-blocking at G2 |
| 404 everywhere, but the resource type is integer-keyed | **Sev3** — enumerable id | `CWE-639` | tracked, not blocking |
| slug-keyed resource | observation only (O6) | — | none |

- Sev1 and Sev2 count against the `thresholds.yaml` security limits of 0 (`maxCritical`, `maxHigh`);
  the plan confirms the Sev→limit mapping used by the gate check.
- **Grouping.** Sev1/Sev2 are filed per route × method (each is a distinct missing check). Sev3 is
  filed **once per resource type** (O5): the defect manager keys it on `resourceType` (the object
  type behind the route, e.g. `order`) and lists every integer-keyed route of that type in the one
  defect's reproduction steps; later runs update that defect instead of opening a new one.
- **Origin confirmation** (HANDBOOK/17 (d)): before filing, the defect manager rules out test-side
  causes — userB's session really is userB (identity echo), the target object really belongs to userA
  (userA's own GET succeeds), and the fixture is fresh — then reproduces the failing cell on a clean
  state (fresh peer accounts + fresh seed). The result goes in `originConfirmation`.
- Defect files stay brand-clean (CLAUDE.md brand rule).

---

## 6. Safety

- **Env guard.** ObjectAuthz TCs run only where `environments.{env}.mutating === true` **and** the
  env is not production. `production` (`readOnly: true`, `mutating: false`) blocks them via
  `assertEnvSafe` before dispatch; the security specialist additionally re-checks `mutating` at
  runtime and refuses otherwise. This closes the "never on production" requirement in two places.
- **Rate limits.** The matrix is bounded: `id±1` only (not a range sweep), one request per
  method×actor×target. A per-route request cap (`thresholds.yaml#security.objectAuthz.maxRequestsPerRoute`,
  default 40) caps fan-out so the test never becomes a brute-force enumeration.
- **Non-destructive DELETE** — §5.3.
- **No real data.** All targets are run-seeded fixtures; teardown removes them.

---

## 7. Contract, pipeline & checker impact

Every change keeps `pnpm aegis align` green (HANDBOOK/14 §14.11): prose edited first, then the
contract block, then pipeline touch-points and their prose anchors.

### 7.1 Contracts (`@qa/contracts`) — depends on P0a-1 and P1

- `TargetProfileSchema` gains `objectRoutes[]` (§2.3). The schema lives in
  `packages/@qa/contracts/src/target-profile.ts`: **P0a-1** introduces it with the core fields,
  **P1 (AUD-031)** extends it to the full strict schema in the same file (still exported as
  `TargetProfileSchema`), and **P4** extends that strict schema with `objectRoutes[]`. P4 never
  introduces the schema.
- `TestTechniqueSchema` gains **`ObjectAuthz`**. It is not in P1's final vocabulary (P1 keeps `E2E`
  as a testType and adds no authz technique), so **P4 adds it** — to the schema, to `pipeline.yaml`
  routing and `designerEmits`, and to the prose anchors (§7.4).
- `DefectSchema` needs no new field: severity (Sev1/Sev3), `compliance` tags (CWE-639,
  WSTG-ATHZ-04), `defectType: "Standards"` for the enumerable-id finding and `"Logic"` for the authz
  leak all already exist.
- **Tags:** `CWE-639` matches the existing `cweTag` regex. The WSTG tag is emitted in the versioned
  form **`WSTG-v42-ATHZ-04`** (O2), which the existing `wstgTag` regex already accepts — no tag-schema
  change.

### 7.2 New events (declared)

- `objectroute.detected { route, shapeCounts }` — via `append`, emitted by scanner/web-explorer when
  `objectRoutes[]` is written/enriched (feeds detection metrics).
- `authz.peers-provisioned { env, role, accounts }` — via `append`, environment engineer.
- `authz.leak-detected { route, method, cwe: "CWE-639", severity }` — via `append`, security
  specialist; Sev1, gate-blocking (mirrors `secret.leak-detected`).
- `id.enumerable-detected { resourceType, shape }` — via `append`, security specialist; Sev3.

Each is added to `@qa/contracts/events.ts` and to the emitting agent's contract `emits`.

### 7.3 Agent contract changes

| Agent | Change |
|-------|--------|
| `qa-context-scanner` | prose + `objectRoutes[]` write; new event `objectroute.detected` |
| `qa-web-explorer` | prose + `objectRoutes[]` rmw enrich; `objectroute.detected` |
| `qa-test-designer` | emits `testType: Security` + `testTechnique: ObjectAuthz`; Gherkin trigger extended to ObjectAuthz |
| `qa-environment-engineer` | Env:data peer provisioning; writes `tests/qa/fixtures/authz/**`; `authz.peers-provisioned`; block-with-reason on non-mutating env |
| `qa-security-specialist` | B→A matrix process step; `authz.leak-detected`, `id.enumerable-detected`; `cli: [task.claim, work-report.submit]` already required by P0 |
| `qa-defect-manager` | Sev1 authz-leak & Sev3 enumerable-id defect shapes; origin confirmation for both |

SPV checklists updated in lockstep (each agent's existing SPV): the security SPV gains "B→A matrix
ran for every owner-bound route", "data-unchanged verified via userA GET or DB", "authz leak = Sev1", "403 = Sev2",
"enumerable-id reported once per resource type"; the environment SPV gains "peer fixtures created +
teardown paired, mutating-env only"; the designer SPV gains "ObjectAuthz TC carries Gherkin".

### 7.4 pipeline.yaml routing for ObjectAuthz

- `routing.byTechnique`: add `ObjectAuthz: qa-security-specialist` — a secondary dispatch to the
  security specialist. (Primary routing is already `Security → qa-security-specialist` via `byType`.)
- `routing.designerEmits.testTechnique`: add `ObjectAuthz`.
- Prose anchors: add `ObjectAuthz → qa-security-specialist` under the executor's **By `testTechnique`**
  list, and `ObjectAuthz` to the designer's technique line — or the `route-not-in-prose` /
  `emit-not-in-prose` checks fire.
- `sources` / `escapes` / `writePolicy`: `tests/qa/fixtures/authz/**` is already covered by the
  `{tests}/qa/**` writable rule; no new escape hatch needed.

### 7.5 Expected baseline entries: ideally none

Every change is a paired prose+contract edit that resolves in the same slice, so **no new baseline
line is expected**. The one risk is a temporary `unlisted`/`stale` escape if the fixture path or an
event is added to a contract before its prose — mitigated by the edit-prose-first workflow. If any
baseline growth is unavoidable it is owned by **AUD-070** and carries the `baseline-growth` label.

---

## 8. Testing strategy for the feature itself

### 8.1 Fixture app (deliberate IDOR + correct twin)

A tiny local server under `__internal-tests__/fixtures/idor-app/` (Fastify or bare Node http), with
two mounted resources sharing one shape:

- `/api/vulnerable/orders/:id` (integer) — **no ownership check**: returns any order by id (the
  planted IDOR + enumerable integer id).
- `/api/safe/orders/:id` (integer) — checks the caller owns the order, else 404 (the correct twin;
  still Sev3-enumerable, but authz-clean).
- `/api/forbidden/orders/:id` (integer) — checks ownership but answers 403 (the Sev2 existence-
  disclosure variant).
- `/api/safe-uuid/orders/:uuid` (UUID) — ownership-checked and non-enumerable (fully clean).

Seed: userA owns order 1, userB owns order 2. The suite asserts the pipeline **finds** the leak on
`/vulnerable` (Sev1), a Sev2 on `/forbidden`, and **clean** on `/safe-uuid`; `/safe` and `/forbidden`
share the `order` resource type with `/vulnerable`, so exactly **one** Sev3 is filed for `order`.

### 8.2 Unit / invariant tests (`__internal-tests__`)

- **Detection:** id-shape classifier fixtures — integer, UUID, slug, composite, opaque, unknown.
- **Matrix builder:** given an `objectRoutes[]` entry, the generated request set is exactly
  methods × {self, id-1, id+1, deleted} × actors, capped at `maxRequestsPerRoute`.
- **Data-unchanged check:** userA-GET diff and DB-read paths both detect a mutation.
- **Env guard:** ObjectAuthz refused on a non-mutating env and on production; blocked-with-reason,
  not skipped.
- **Severity mapping:** leak → Sev1 + CWE-639 + WSTG-v42-ATHZ-04; 403 → Sev2; enumerable-clean →
  Sev3, once per resource type; slug → observation.
- **Alignment:** `pnpm aegis align` green; `ObjectAuthz` present in schema, pipeline routing and
  both prose anchors; new events resolve to an emitter.
- **E2E:** the §8.1 fixture app driven through the security specialist's matrix (stubbed
  provisioning), asserting the four expected verdicts and that DELETE never removed a non-fixture
  object.

---

## 9. Decisions (resolved 2026-10-01)

| # | Decision | Resolution |
|---|----------|------------|
| O1 | 403 vs 404 for a denied cross-owner request | **Owner: only 404 passes; 403 is a Sev2 defect** (existence disclosure, CWE-639 / WSTG-v42-ATHZ-04). |
| O2 | WSTG tag form | **Emit `WSTG-v42-ATHZ-04`** — no tag-schema change. |
| O3 | Provisioning fallback when signup is closed | **Admin/seed API, then docker DB seed**, recorded as `method`. |
| O4 | DELETE handling | **Owner: fixture-owned objects only** (§5.3). |
| O5 | Enumerability reporting granularity | **Once per resource type** (§5.5). |
| O6 | Low-confidence `slug` shape | **Observation only**, never a defect. |

No open decisions remain for this spec.

---

## 10. Tasks outline (for the later plan)

1. **Contracts** (needs P0a-1 + P1): extend the strict `TargetProfileSchema` with `objectRoutes[]`; add `ObjectAuthz` to
   `TestTechniqueSchema`; add the four new events; confirm CWE-639 / WSTG-v42-ATHZ-04 tag validity.
2. **Detection:** scanner id-shape classifier + `objectRoutes[]` seed; web-explorer runtime enrich;
   `objectroute.detected`.
3. **Provisioning:** environment engineer Env:data peer accounts + `authz-peers.json` + teardown +
   mutating-env guard + `authz.peers-provisioned`.
4. **Design:** designer authz story/AC synthesis (happy/rejection/edge) + ObjectAuthz Gherkin TCs +
   traceability.
5. **Execution:** security specialist B→A matrix, response + data-unchanged assertions, HAR
   sanitization, non-destructive DELETE, rate cap; `authz.leak-detected`, `id.enumerable-detected`.
6. **Defects:** defect-manager Sev1 leak, Sev2 403 existence disclosure (both gate-blocking) & Sev3
   enumerable-id (per resource type) shapes + origin confirmation.
7. **Pipeline & anchors:** `pipeline.yaml` routing + prose anchors; `thresholds.yaml#security.objectAuthz`.
8. **Tests:** §8 fixture app + unit/invariant/E2E; `pnpm aegis align` green.
9. **SPV checklists:** update the five agents' existing SPVs in lockstep.
10. **Docs:** HANDBOOK cross-links (security-testing chapter + §17 ruleset note) if the plan judges
    them in scope; otherwise deferred to P5 doc pass.
