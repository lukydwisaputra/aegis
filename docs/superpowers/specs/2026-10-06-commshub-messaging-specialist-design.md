# NEW-07 — CommsHub messaging specialist replaces Mailpit email testing: Design

> Temporary working document of the P0–P6 remediation program (see the matrix header). Delete with
> the other program specs once P6 closes.

Matrix: `docs/superpowers/specs/2026-09-29-audit-remediation-matrix.md`, "New requirements", row NEW-07.
Supersedes the Mailpit half of AUD-051 (P2b, `2026-10-02-p2-roster-design.md` §4.10). Branch:
`feat/commshub-messaging-specialist`, from `main` at 49b4474.

Owner rules this slice applies:
- Aegis never modifies its own framework at runtime.
- Agents never modify the target app's source.
- Production is never used for mutating tests.
- No credential is written to a log, event, work report, evidence file or HAR.

## 1. Context

WerkDone apps do not send email, SMS or WhatsApp themselves. They call **CommsHub** (`wd-commhub`), which
owns templates, providers and delivery. Aegis tests messaging through a Mailpit inbox
(`qa-email-specialist`), which only sees mail an app sends over SMTP. A CommsHub app sends nothing over
SMTP, so for every WerkDone target the email specialist either no-ops or tests nothing real.

Found while setting up `renci-volunteer-management` (2026-10-05/06), all against CommsHub `development`
at 418f357:

- **The send API is `POST {base}/events`**, `Authorization: Bearer chk_…`, body checked by the
  `.strict()` `fireEventSchema` (unknown key → 400 `VALIDATION_ERROR`). Fields: `event_id`, `occurs_at`,
  `timezone`, `external_id`, `recipient_external_id`, `recipient_email`, `recipient_phone`,
  `template_variables`, `attachments[]`, `recipients[]`. `Idempotency-Key` header optional. 201 →
  `{event_id, scheduled: [{message_id, …}], skipped?}`; `scheduled` may be empty.
- **Read-back is `GET {base}/events/{message_id}`** → `status`, `skip_reason`, `simulated`,
  `delivery_log[]`. There is no list or lookup-by-`external_id`.
- **CommsHub sends no webhooks to client apps.** Clients poll.
- **Simulation is per tenant** (`tenants.delivery_mode`), set by a CommsHub admin; there is no API to
  read or change it. A simulated message ends `sent`, `simulated: true`, `provider_code: "simulated"`.
  Renci's dev tenant was **live** until the owner noticed on 2026-10-06: a probe went out over
  `whatsapp_cloud`. "Dev only simulates" is not a safe assumption.
- **Events are registered per tenant** in the Event Inventory. An unregistered id → 400
  `UNKNOWN_EVENT_ID`. A body with only `event_id` returns `RECIPIENT_CONTACT_REQUIRED` (with the
  event's channel) for a registered event and `UNKNOWN_EVENT_ID` otherwise, and creates nothing.
- **The published contract** is `docs/08-commhub-events-api.yaml` in `WerkDone-Pte-Ltd/wd-commhub`.
- **Real defects this would have caught**: Renci posted `{channels_allowed, to, reference, body}` to
  `${base}/v1/messages` (a 404, and a 400 on the right path) until #223, tested only against fixtures it
  authored. slec-visitor-management had the same class of bug until 29/09. Renci's
  `renci.organisation.registered` is fired by `POST /api/v1/organisations` but is not registered in the
  dev tenant.

## 2. Decisions

| # | Decision | Source |
|---|---|---|
| D1 | Mailpit is removed from Aegis entirely: config keys, helper, env-engineer check, docs, tests. | Owner, 2026-10-06 |
| D2 | The email pair is replaced, not extended: `qa-messaging-specialist` + `qa-messaging-specialist-spv`; technique `Email` → `Messaging`; profile flag `hasEmailFlows` → `hasMessagingIntegration`; config `emailAdapter` → `messaging.adapter: "commshub"`. Email, SMS and WhatsApp are all in scope. | Owner |
| D3 | Three layers: **static** (code vs contract), **stub** (local recording CommsHub), **live** (CommsHub dev, simulated tenant). | Owner |
| D4 | The contract is read **fresh from GitHub each run** through `gh`, and the commit sha is recorded. | Owner |
| D5 | **Local only.** The specialist runs in `development`; `testing`, `staging` and `production` forbid it. | Owner |
| D6 | The live key comes from the process environment, then `secrets/.env.development`; agents never see it (§4.4). | Owner |
| D7 | **Live replays what the stub recorded**, it does not need the app re-pointed. The app is launched once, at the stub; every request it sends is recorded; the live layer replays each recorded body against CommsHub dev with the recipient swapped for a fake one. One run covers all three layers. *(Refines the "per-run stub or live mode" discussed in chat: that needed a relaunch of the target between layers, which Aegis does not own.)* | Design, for owner review |
| D8 | Live sends go only to `+6500000000` and `aegis-probe@example.com`. The helper refuses any other recipient. | Design |
| D9 | Every live batch starts with one preflight send that must come back `simulated: true`; `false` stops the run with a Sev1 finding. | Design, from the Renci incident |

Accepted consequence of D1/D2: a target that sends mail directly over SMTP or a mail SDK (not through
CommsHub) has no messaging coverage. No WerkDone target does this today; the scanner records it (§4.1)
so the gap is visible, not silent.

## 3. Architecture

```
                 ┌────────────── static ──────────────┐
 aegis messaging │ gh → wd-commhub@<ref>:docs/08-…yaml │──► runs/{id}/messaging/commshub-contract.json
 contract fetch  └─────────────────────────────────────┘        (sha, fetchedAt, JSON schema)
                                   │
 target app ── COMMSHUB_BASE_URL=http://127.0.0.1:{stubPort}/api/v1 ──► stub (tests/qa/support/commshub.ts)
   ▲  flows triggered by specs                                          validates vs contract, records
   │                                                                     │
   └────── tests/qa/messaging/*.messaging.spec.ts ◄── recorded() ────────┘
                                   │ replay (recipient → fake)
                                   ▼
                       aegis messaging exec -- <cmd>  (injects key, never prints it)
                                   │
                        CommsHub dev  POST /events · GET /events/{id}
```

## 4. Components

### 4.1 Target profile and scanner

- `packages/@qa/contracts/src/target-profile.ts`: `hasEmailFlows` → `hasMessagingIntegration: boolean`
  (required, strict schema unchanged otherwise), plus `messagingProvider: "commshub" | "direct-mail" |
  "none"`.
- `qa-context-scanner` step 19 is rewritten. `hasMessagingIntegration` is true, provider `commshub`,
  when any of: an env var name `COMMSHUB_*` / `COMMHUB_*`; a source string containing
  `commhub.` + `.werkdone.com` or a `/events` POST beside a `COMMSHUB_`/`COMMHUB_` read. Provider
  `direct-mail` (flag still false) when a mail SDK or SMTP env name from today's list is found and no
  CommsHub signal is. Otherwise `none`.

### 4.2 Config (`aegis.config.json`)

Removed: `emailAdapter`, `ports.mailpit`, `environments.testing.ephemeralProvisioning.mailpitPerInstance`.

Added:
```json
"messaging": {
  "adapter": "commshub",
  "commshub": {
    "contract": { "repo": "WerkDone-Pte-Ltd/wd-commhub", "path": "docs/08-commhub-events-api.yaml", "ref": "development" },
    "stubPort": 4010,
    "dispatchTimeoutSeconds": 90
  }
}
```
`environments.{testing,staging,production}.forbiddenSpecialists` gain `"messaging"` (production already
forbids `"email"`, renamed). `DEFAULT_ENVIRONMENT_SPECIALISTS` in `packages/@qa/contracts/src/specialists.ts`
matches.

`packages/@qa/run-state/src/config.ts`: `assertMailpitAdapter` → `assertMessagingConfig`: absent block is
fine; `adapter` other than `commshub`, a non-integer `stubPort`, or a contract block missing `repo`/
`path`/`ref` → `RunStateError("invalid-input", …)`. A leftover `emailAdapter` key → `invalid-input`
naming the replacement, so a stale config is refused rather than ignored.

CLI `init` and `reconfigure`: `--email <adapter>` → `--messaging <adapter>` with `choices(["commshub"])`.

### 4.3 `@qa/messaging` package (vendored helper)

New package `packages/@qa/messaging`, added to `VENDORED_HELPERS` (`packages/@qa/run-state/src/vendor.ts`)
and `pipeline.yaml#sources.cli`; `aegis helpers vendor` copies it to `tests/qa/support/commshub.ts`.
Dependency-free (Node 22 built-ins only), like the other vendored helpers.

| Export | Does |
|---|---|
| `loadContract(path)` | Reads `commshub-contract.json`; returns the `fireEvent` request schema and response shapes. |
| `startStub({port, contract})` | HTTP server on `127.0.0.1:port`. `POST /api/v1/events` validates against the schema with a built-in validator covering what the contract uses (`type`, `required`, `enum`, `pattern`, `format: email/date-time`, `additionalProperties: false`, `minItems`/`maxItems`, `oneOf` for single vs `recipients[]`); 401 without `Bearer`; 400 with CommsHub's error envelope `{error, code, details}`; 201 with a contract-shaped body otherwise. `GET /api/v1/events/{id}` answers for recorded ids. |
| `stub.respondNext(kind)` | Forces the next answer: `400`, `429` (with `Retry-After`), `500`, `timeout`. |
| `stub.recorded()` / `stub.reset()` | Requests seen: method, path, headers (Authorization reduced to `Bearer <present>`), parsed body, validation result. |
| `fire(body)` / `getEvent(id)` | Live calls. Read `COMMSHUB_BASE_URL` and `COMMSHUB_SERVICE_TOKEN` from `process.env` only. |
| `toFakeRecipient(body)` | Replaces `recipient_email`/`recipient_phone` (and each `recipients[]` entry) with `aegis-probe@example.com` / `+6500000000`. `fire` throws if a body still holds any other recipient. |
| `preflight()` | One `fire` + `getEvent` poll; resolves `{simulated}`; throws on non-`true`. |
| `probeRegistered(eventId)` | POST with only `event_id`; `RECIPIENT_CONTACT_REQUIRED` → `{registered: true, channel}`, `UNKNOWN_EVENT_ID` → `{registered: false}`. Creates nothing. |

### 4.4 CLI

- `aegis messaging contract fetch --run <id>`: runs `gh api repos/{repo}/contents/{path}?ref={ref}`,
  converts YAML → JSON with `yaml` (already a dependency of `@qa/run-state`, which the CLI imports), writes
  `runs/{runId}/messaging/commshub-contract.json` with `{repo, path, ref, sha, fetchedAt, openapi}`, and
  appends `messaging.contract-fetched {sha}`. Failure → `invalid-input`/`internal` with the `gh` exit
  reason; nothing written. `runs/*/messaging/` is a CLI-written path (role table, H1).
- `aegis messaging exec --run <id> -- <cmd…>`: resolves `COMMSHUB_BASE_URL` / `COMMSHUB_SERVICE_TOKEN`
  from the process env, then `secrets/.env.development` (refuses unless the run's environment is
  `development`), and runs `<cmd>` with them injected. It prints only `key: present|absent`. This is how
  the specialist runs live specs without ever reading the key, and why the env-guard hook never blocks
  it.
- `aegis messaging check --run <id>`: `contract: present (sha)`, `stubPort: free|busy`,
  `key: present|absent`. Used by the environment engineer.

### 4.5 `qa-messaging-specialist`

Tier 2, `modelTier: implementation`, tools `[Read, Write, Edit, Bash]`, dispatched by `qa-test-executor`
for `testTechnique: Messaging` and by `qa-run-specialist`. Same section order and no-op sentences as
`qa-realtime-specialist` (enforced by `p2b-profiles.test.ts`), with `hasMessagingIntegration`.

Process:
1. Profile gate: only a readable `hasMessagingIntegration: false` permits `specialist.no-op`; missing or
   invalid → `execution.blocked`, release `failed`.
2. `aegis messaging contract fetch`. Failure → `execution.blocked` (static and stub need it).
3. **Static layer.** Read the target's CommsHub client and every call site. Check, citing file:line and
   the contract field: send path is `{base}/events` and the base convention includes `/api/v1` once;
   body keys ⊆ schema properties; `event_id` always set; recipient field per channel; `Bearer` auth;
   dedupe via `Idempotency-Key` or `external_id`; response reads `scheduled[].message_id` and handles
   `skipped[]` and an empty `scheduled`; 4xx not retried, 429/5xx retried; every fired event id has its
   variables declared and sent non-empty; no full NRIC or other SPD in `template_variables`; code that
   waits for CommsHub callbacks is flagged (CommsHub sends none). Write the inventory of event ids and
   the flows that fire them into the work report.
4. Sandbox-first exploration of each flow (HANDBOOK/17 rule), then write
   `tests/qa/messaging/{flow}.messaging.spec.ts`.
5. **Stub layer.** Specs start the stub, trigger each flow through the app's API (Playwright
   `APIRequestContext`), and assert on `recorded()`: path, auth present, `valid === true`, the event id
   expected for the flow, complete non-empty variables. Failure-handling specs force `400`, `429`, `500`
   and `timeout` and assert the app's documented behaviour (no retry on 400; retry or queue on 5xx; the
   user-facing call still answers). The first spec is a wiring probe: if the app sends nothing to the
   stub within 30 s, `execution.blocked` "target not pointed at the stub" (with the env line it needs).
6. **Live layer**, via `aegis messaging exec`. Key absent → live recorded "not run: no key", static and
   stub results stand. Otherwise: `preflight()` (stop on `simulated !== true`, Sev1); `probeRegistered`
   for every event id from step 3 (unregistered → finding per id; channel vs the recipient field the
   code sends → finding on mismatch); then replay each recorded body through `toFakeRecipient` and
   `fire`, poll `getEvent` up to `dispatchTimeoutSeconds`: expect `sent` and `simulated: true`; `skipped`
   (with `skip_reason`), `failed` or still `scheduled` → finding. Honour `Retry-After` on 429.
7. Results per TC to `runs/{runId}/cases/{TC-ID}-result.json`; work report lists contract sha, layers
   run/not-run with reasons, every live `message_id`.

Writes (role row): `{testsDir}/messaging/**`, `{testsDir}/support/commshub.ts` (vendored, re-vendor only),
plus `SPECIALIST_COMMON`. Emits `test.passed`, `test.failed`, `specialist.no-op`, `execution.blocked`,
`sandbox.explored`, `messaging.live-preflight {simulated}`.

### 4.6 `qa-messaging-specialist-spv`

`[Read, Bash]`, `modelTier: validation`. Checklist:
1. Contract source recorded (repo, path, ref, sha) and the static layer ran.
2. Every static finding cites file:line and a contract field.
3. Every stub spec asserts path, auth, schema validity, event id and variables; none is assertion-free.
4. Failure-handling specs exist for 400, 429, 5xx and timeout.
5. Live: a preflight with `simulated: true` precedes every other live send; the run stopped on `false`.
6. Live recipients are only the two fakes.
7. No `chk_` string, `Authorization` value or `COMMSHUB_SERVICE_TOKEN` value in the work report,
   evidence, HAR or spec files (grep).
8. Environment is `development`.
9. No-op only with a readable `hasMessagingIntegration: false`.
10. A layer not run is reported "not run" with its reason, never as passed.
11. Spec naming `*.messaging.spec.ts`; sandbox-first followed.

### 4.7 Other agents and wiring

- `qa-environment-engineer` step 5: the Mailpit check becomes `aegis messaging check`; `stubPort` busy →
  `env.setup-failed`; it also vendors `commshub.ts`. The key's absence is reported, not a failure.
- `qa-test-designer`: `Messaging` when `hasMessagingIntegration` is true and the requirement sends a
  message (OTP, onboarding, notification, broadcast, digest).
- `qa-test-executor` + its SPV: route line `Messaging → qa-messaging-specialist`; `dispatches` updated.
- `TestTechniqueSchema`, `TEST_ROUTING.byTechnique`, `SPECIALISTS` (`messaging: {agent, mutates: true}`),
  `pipeline.yaml` (`routing.byTechnique`, `designerEmits`, `envSpecialists`, the `reviewedBy.none` escape
  renamed), `model-policy.yaml`, role table row + `SPVS`, `forbidden-strings.ts` pattern.
- `agent-memory/qa-email-specialist/` → `agent-memory/qa-messaging-specialist/` (empty lessons).
- `qa-closure-reporter` example text, `qa-smoke` skip list, `qa-dry-run` technique list,
  `qa-run-specialist` (`--specialist messaging`).
- Docs: HANDBOOK 01/03/04/06/07/12/17, `docs/D03-*`, `docs/D12-*` (the asserted environments row becomes
  `| Messaging testing | ✓ (stub + CommsHub dev) | ✗ | ✗ | ✗ |`), `CLAUDE.md` ports line,
  and `secrets/README.md` (`MAILPIT_URL` → `COMMSHUB_BASE_URL`, `COMMSHUB_SERVICE_TOKEN`). The README
  lists `.env.*.example` templates that do not exist in the repo; this slice adds
  `secrets/.env.development.example` with the two names and no values.

## 5. Error handling

| Situation | Result |
|---|---|
| `gh` fetch fails | `execution.blocked`; task released `failed` |
| Stub port busy | environment engineer `env.setup-failed` |
| App sends nothing to the stub in 30 s | `execution.blocked` "target not pointed at the stub" |
| Key absent | live "not run: no key"; static + stub stand |
| Preflight `simulated !== true` | stop all live sends; Sev1 finding "CommsHub tenant is live" |
| 429 | wait `Retry-After`, retry once per request |
| Still `scheduled` after timeout | finding "dispatch stalled"; continue |
| `UNKNOWN_EVENT_ID` | one finding per event id; other flows continue |
| `RECIPIENT_CONTACT_REQUIRED` on replay | finding "code sends {field}, event is {channel}" |

## 6. Testing the framework

- `packages/@qa/messaging` unit tests (jest, `__internal-tests__/messaging/*`): validator per keyword
  against fixtures cut from the real OpenAPI; strict-key refusal; recording redacts `Authorization`;
  `respondNext` kinds; `toFakeRecipient` and the `fire` refusal; `probeRegistered` mapping;
  `preflight` throws on `false`; nothing prints the token (spy on stdout/stderr).
- CLI: `messaging contract fetch` with a stubbed `gh` (success, network failure, bad YAML, sha
  recorded, nothing written on failure); `messaging exec` injects and never prints, refuses outside
  `development`; `messaging check`.
- Replaced suites: `p2b-profiles.test.ts` email block → messaging block (same structural assertions on
  the new prose); `target-profile.test.ts`, `cli-envelope.test.ts` (`--messaging` choices, stale
  `emailAdapter` refused), `run-state-compliance.test.ts`, `path-guard.test.ts`, `env-specialists.test.ts`,
  `role-table.test.ts` invariants unchanged.
- Gates: `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm test:smoke`, `pnpm aegis align` →
  `ratchet: ok`. Target: **no baseline growth**; renamed baseline keys are deleted and re-added under
  NEW-07 only if a rename makes a pre-existing violation re-key.

## 7. Rollout

1. PR `feat/commshub-messaging-specialist` → `main` of `lukydwisaputra/aegis`; owner review and merge.
2. Each project clone (e.g. `renci-volunteer-management/aegis`) runs `git pull && pnpm install`, removes
   `emailAdapter`/`ports.mailpit` from its own config if it diverged (the CLI refuses a stale key and
   names the fix), and sets `COMMSHUB_SERVICE_TOKEN` in the shell or `secrets/.env.development`.
3. First real run: Renci, `development`, app launched at the stub. Expected live findings today:
   `renci.organisation.registered` unregistered; Renci's delivery-status webhook route waits for
   callbacks CommsHub never sends.

## 8. Out of scope

- Testing CommsHub itself (its own repo has e2e).
- `testing`/`staging` environments and deployed targets.
- Changing a tenant's delivery mode or registering events (no API; CommsHub admin only).
- Direct-SMTP targets (§2, accepted consequence).
