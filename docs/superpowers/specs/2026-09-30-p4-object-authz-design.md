# P4 — Object-level authorization, IDOR & integer-ID enumerability (Design)

> **Temporary working document** — part of the audit remediation program. Delete together with
> `2026-09-29-audit-remediation-matrix.md` once P6 is closed.

- Date: 2026-09-30
- Status: draft — awaiting owner review
- Program matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`, §P4 (AUD-070)
- Builds on: P0 (`2026-09-29-p0-pipeline-foundation-design.md`) and P1 (contracts & vocabulary)
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
environment engineer. Two severities apply: an authorization leak is **Sev1**, gate-blocking, tagged
CWE-639 / WSTG-ATHZ-04; an enumerable integer id whose object is nonetheless correctly authorized is
a **Sev3** hardening finding.

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
| `slug` | human-readable token (`/posts/my-first-post`) | partially (guessable) |
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

### 2.3 `target-profile.json#objectRoutes[]` schema (added in P1's `TargetProfileSchema`)

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

`enumerable` is true only for `integer` (and low-confidence `slug`). It drives the Sev3 finding
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
- **Rejection AC:** userB reads/edits **userA's** object by id → 403 or 404, **and userA's data is
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
Then the response status is 403 or 404
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

**Pass** = every B→A request returns **403 or 404**, **and** userA's object is **unchanged**
afterwards. A 2xx that returns userA's data, or any mutation that alters it, is a **fail** (Sev1).

### 5.2 Assertions

1. **Response assertion** — web-first: `expect(res).toBeOneOf([403, 404])`; a 401 is treated as
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
is that the delete is **refused** (403/404) and the object still exists on userA's follow-up read;
if the delete unexpectedly **succeeds**, that is the Sev1 finding itself and the fixture is
re-seeded before the next case. No non-fixture / real object is ever a DELETE target. (Choice:
fixture-owned-only, not dry-run — a dry run cannot prove the endpoint would have refused.)

### 5.4 Evidence

- Request/response pairs captured as HAR, **sanitized** via `@qa/test-helpers.sanitizeHar` before
  landing under `{run}/evidence/{TC-ID}/` (userA/userB tokens and cookies stripped — the same rule
  every specialist already follows).
- Evidence names follow the existing `{TC}_{step}_{ts}` convention; result JSON at
  `{run}/cases/{TC-ID}-result.json`.

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

### 7.1 Contracts (`@qa/contracts`) — depends on P1

- `TargetProfileSchema` gains `objectRoutes[]` (§2.3). P1 owns `TargetProfileSchema`; **P4 requires
  P1 to have landed it** so P4 only extends, never introduces, the schema.
- `TestTechniqueSchema` gains **`ObjectAuthz`**. *This is the explicit P1 dependency:* `ObjectAuthz`
  must be added to the vocabulary in P1's final technique set (or, if P1 has already frozen, added by
  P4 with a P1-owned baseline note). Named here so it is not lost.
- `DefectSchema` needs no new field: severity (Sev1/Sev3), `compliance` tags (CWE-639,
  WSTG-ATHZ-04), `defectType: "Standards"` for the enumerable-id finding and `"Logic"` for the authz
  leak all already exist.
- **Tags:** `CWE-639` matches the existing `cweTag` regex; `WSTG-ATHZ-04` — the current `wstgTag`
  regex is `^WSTG-v\d+-[A-Z]+-\d+$`, which does **not** admit `WSTG-ATHZ-04` (no `vNN`). P4 must
  relax the regex to also accept the short `WSTG-{CATEGORY}-{NN}` form, or the designer must emit
  `WSTG-v42-ATHZ-04`. **Recommendation: emit the versioned form `WSTG-v42-ATHZ-04`** (no schema
  change, consistent with existing security tags).

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
ran for every owner-bound route", "data-unchanged verified via userA GET or DB", "authz leak = Sev1",
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
- `/api/safe/orders/:id` (integer) — checks the caller owns the order, else 403 (the correct twin;
  still Sev3-enumerable, but authz-clean).
- `/api/safe-uuid/orders/:uuid` (UUID) — ownership-checked and non-enumerable (fully clean).

Seed: userA owns order 1, userB owns order 2. The suite asserts the pipeline **finds** the leak on
`/vulnerable` (Sev1), reports Sev3-only on `/safe`, and reports **clean** on `/safe-uuid`.

### 8.2 Unit / invariant tests (`__internal-tests__`)

- **Detection:** id-shape classifier fixtures — integer, UUID, slug, composite, opaque, unknown.
- **Matrix builder:** given an `objectRoutes[]` entry, the generated request set is exactly
  methods × {self, id-1, id+1, deleted} × actors, capped at `maxRequestsPerRoute`.
- **Data-unchanged check:** userA-GET diff and DB-read paths both detect a mutation.
- **Env guard:** ObjectAuthz refused on a non-mutating env and on production; blocked-with-reason,
  not skipped.
- **Severity mapping:** leak → Sev1 + CWE-639 + WSTG-v42-ATHZ-04; enumerable-clean → Sev3.
- **Alignment:** `pnpm aegis align` green; `ObjectAuthz` present in schema, pipeline routing and
  both prose anchors; new events resolve to an emitter.
- **E2E:** the §8.1 fixture app driven through the security specialist's matrix (stubbed
  provisioning), asserting the three expected verdicts and that DELETE never removed a non-fixture
  object.

---

## 9. Open decisions for the owner

| # | Decision | Recommendation |
|---|----------|----------------|
| O1 | 403 vs 404 for a denied cross-owner request — is a 403 (existence disclosed) itself a Sev3? | **Accept both as pass; note 403 as an info-only observation.** 404 is stricter but 403 is a legitimate design choice; do not fail it. |
| O2 | WSTG tag form — relax the regex for short `WSTG-ATHZ-04`, or emit versioned `WSTG-v42-ATHZ-04`? | **Emit `WSTG-v42-ATHZ-04`** — no schema change, matches existing tags. |
| O3 | Provisioning fallback order when signup is closed — admin API vs direct docker DB seed? | **Prefer admin/seed API; fall back to docker DB seed** (owner's stated local flow), recorded as `method`. |
| O4 | DELETE handling — fixture-owned-only vs dry-run/verify? | **Fixture-owned-only.** A dry run cannot prove the endpoint would refuse; a seeded object can be safely re-created. |
| O5 | Enumerability reporting granularity — one Sev3 per resource type or per route? | **Once per resource type** (an integer PK is a data-model property, not a per-route bug). |
| O6 | Should a low-confidence `slug` shape be treated as enumerable (Sev3)? | **No — report as an observation only**, since guessability is not the same as sequential enumeration. |

---

## 10. Tasks outline (for the later plan)

1. **Contracts** (needs P1): add `objectRoutes[]` to `TargetProfileSchema`; add `ObjectAuthz` to
   `TestTechniqueSchema`; add the four new events; confirm CWE-639 / WSTG-v42-ATHZ-04 tag validity.
2. **Detection:** scanner id-shape classifier + `objectRoutes[]` seed; web-explorer runtime enrich;
   `objectroute.detected`.
3. **Provisioning:** environment engineer Env:data peer accounts + `authz-peers.json` + teardown +
   mutating-env guard + `authz.peers-provisioned`.
4. **Design:** designer authz story/AC synthesis (happy/rejection/edge) + ObjectAuthz Gherkin TCs +
   traceability.
5. **Execution:** security specialist B→A matrix, response + data-unchanged assertions, HAR
   sanitization, non-destructive DELETE, rate cap; `authz.leak-detected`, `id.enumerable-detected`.
6. **Defects:** defect-manager Sev1 leak (CWE-639, gate-blocking) & Sev3 enumerable-id (per resource
   type) shapes + origin confirmation.
7. **Pipeline & anchors:** `pipeline.yaml` routing + prose anchors; `thresholds.yaml#security.objectAuthz`.
8. **Tests:** §8 fixture app + unit/invariant/E2E; `pnpm aegis align` green.
9. **SPV checklists:** update the five agents' existing SPVs in lockstep.
10. **Docs:** HANDBOOK cross-links (security-testing chapter + §17 ruleset note) if the plan judges
    them in scope; otherwise deferred to P5 doc pass.
