# NEW-07 — Provider-neutral messaging specialist (CommsHub adapter first) replaces Mailpit: Design

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
| D6 | The live key comes from the process environment, then `secrets/.env.development`, under the target's own env names; agents never see it (§4.4). | Owner |
| D7 | **Live replays what the stub recorded**, it does not need the app re-pointed. The app is launched once, at the stub; every request it sends is recorded; the live layer replays each recorded body against CommsHub dev with the recipient swapped for a fake one. One run covers all three layers. *(Refines the "per-run stub or live mode" discussed in chat: that needed a relaunch of the target between layers, which Aegis does not own.)* | Design, for owner review |
| D8 | Live sends go only to the configured fake recipients (`messaging.fakeRecipients`; defaults `qa-probe@example.com`, `+6500000000`). The helper refuses any other recipient and any fake that could be deliverable (§4.2). | Design |
| D9 | Every live batch starts with one preflight send that must come back `simulated: true`; `false` stops the run with a Sev1 finding. | Design, from the Renci incident |
| D10 | **Project-agnostic.** No project name, env var name, event id, URL prefix, country or key format is written into an agent, the SPV or the helper. Each comes from the target profile (detected) or `aegis.config.json` (overridable). Renci is only the first target. | Owner, 2026-10-06 |
| D11 | **Provider behind an adapter.** `@qa/messaging` defines a `MessagingAdapter` interface; CommsHub is its only implementation. A future provider is a new adapter object plus an `adapter` config value, with no agent or SPV rewrite. Other adapters are not built now. | Owner (D10), YAGNI on the rest |

Accepted consequence of D1/D2: a target that sends mail directly over SMTP or a mail SDK (not through
CommsHub) has no messaging coverage until an adapter for it exists (D11). No WerkDone target does this
today; the scanner records it (§4.1) so the gap is visible, not silent.

### 2.1 What varies per project, and where it comes from

| Varies per project | Example (Renci / slec) | Source | Override |
|---|---|---|---|
| Provider | `commshub` | profile `messaging.provider` | `messaging.adapter` |
| Env var holding the base URL | `COMMSHUB_BASE_URL` / `COMMHUB_API_URL` | profile `messaging.baseUrlEnv` | `messaging.env.baseUrl` |
| Env var holding the key | `COMMSHUB_SERVICE_TOKEN` / `COMMHUB_API_KEY` | profile `messaging.tokenEnv` | `messaging.env.token` |
| Whether the base URL includes the API prefix | `…/api/v1` | static layer, from the client code | none (a finding if inconsistent) |
| API prefix and paths | `/api/v1`, `/events`, `/events/{id}` | the contract (`servers`, `paths`) | contract location in config |
| Client files and call sites | `lib/integrations/commshub/*` | static layer, recorded in the work report | none |
| Event ids, variables, channels | `renci.*` / slec's ids | static layer + live registration probe | none |
| Flows that send | OTP, onboarding, broadcast | static layer + requirements | none |
| Fake recipients | `qa-probe@example.com`, `+6500000000` | config defaults | `messaging.fakeRecipients` |
| Key format to redact | `chk_…` | adapter (`keyPattern`) | none |
| Simulation check | `simulated: true` | adapter (`isSimulated`) | none |

## 3. Architecture

```
                 ┌──────────────── static ────────────────┐
 aegis messaging │ gh → {contract.repo}@{ref}:{contract.path} │──► runs/{id}/messaging/contract.json
 fetch-contract └────────────────────────────────────────┘        (adapter, sha, fetchedAt, openapi)
                                   │
 target app ── {baseUrlEnv}=http://127.0.0.1:{stubPort}{prefix?} ──► stub (tests/qa/support/messaging.ts)
   ▲  flows triggered by specs                                          validates vs contract, records
   │                                                                     │
   └────── tests/qa/messaging/*.messaging.spec.ts ◄── recorded() ────────┘
                                   │ replay (recipient → fake)
                                   ▼
                       aegis messaging exec -- <cmd>  (injects key, never prints it)
                                   │
                 provider dev (CommsHub: POST /events · GET /events/{id})
```

## 4. Components

### 4.1 Target profile and scanner

- `packages/@qa/contracts/src/target-profile.ts`: `hasEmailFlows` → `hasMessagingIntegration: boolean`
  (required), plus a `messaging` object (strict):
  `{ provider: "commshub" | "direct-mail" | "none", baseUrlEnv: string | null, tokenEnv: string | null }`.
- `qa-context-scanner` step 19 is rewritten around **detection hints owned by each adapter**, not names
  written into the scanner. `MESSAGING_PROVIDERS` in `packages/@qa/contracts` lists the provider ids and `ADAPTERS` in
  `@qa/messaging` holds, per adapter, its hints; the scanner prose says "match the hints in that table" and the table is printed into the H4
  context. CommsHub's hints: env var names matching `COMMSHUB_*` or `COMMHUB_*`; a host matching
  `commhub.*`; a POST to a path ending `/events` built from such a variable. When one matches,
  `provider` is the adapter id, `hasMessagingIntegration` is true, and `baseUrlEnv`/`tokenEnv` are the
  env names the client reads (the one used as the fetch base, the one used in `Authorization`).
  `direct-mail` (flag false) when a mail SDK or SMTP env name from today's list is found and no adapter
  hint is. Otherwise `none`.

### 4.2 Config (`aegis.config.json`)

Removed: `emailAdapter`, `ports.mailpit`, `environments.testing.ephemeralProvisioning.mailpitPerInstance`.

Added:
```json
"messaging": {
  "adapter": "commshub",
  "stubPort": 4010,
  "dispatchTimeoutSeconds": 90,
  "fakeRecipients": { "email": "qa-probe@example.com", "phone": "+6500000000" },
  "env": { "baseUrl": null, "token": null },
  "commshub": {
    "contract": { "repo": "WerkDone-Pte-Ltd/wd-commhub", "path": "docs/08-commhub-events-api.yaml", "ref": "development" }
  }
}
```
Generic keys sit at the top of `messaging`; only adapter-specific keys sit under the adapter's id.
`env.*` `null` means "use the names the scanner detected"; a project whose client reads unusual names
sets them here. `fakeRecipients` must be undeliverable: the default phone is in Singapore's unassigned
`+65 0` range; a project in another country sets an unassigned number of its own. The helper refuses a
phone that is not E.164 and an email whose domain is not `example.com`, `example.org`, `example.net` or
ends in `.invalid`/`.test` (RFC 2606), so a typo cannot turn into a real recipient.
`environments.{testing,staging,production}.forbiddenSpecialists` gain `"messaging"` (production already
forbids `"email"`, renamed). `DEFAULT_ENVIRONMENT_SPECIALISTS` in `packages/@qa/contracts/src/specialists.ts`
matches.

`packages/@qa/run-state/src/config.ts`: `assertMailpitAdapter` → `assertMessagingConfig`: absent block is
fine; `adapter` not in `ADAPTERS` (`@qa/messaging`), a non-integer `stubPort`, a `fakeRecipients` value the
helper would refuse, or the adapter's block missing its required keys (CommsHub: `contract.repo`/
`path`/`ref`) → `RunStateError("invalid-input", …)`. A leftover `emailAdapter` key → `invalid-input`
naming the replacement, so a stale config is refused rather than ignored.

CLI `init` and `reconfigure`: `--email <adapter>` → `--messaging <adapter>` with `choices` read from `ADAPTERS` (today `["commshub"]`).

### 4.3 `@qa/messaging` package (vendored helper)

New package `packages/@qa/messaging`, added to `VENDORED_HELPERS` (`packages/@qa/run-state/src/vendor.ts`)
and `pipeline.yaml#sources.cli`; `aegis helpers vendor` copies its single `src/index.ts` to
`tests/qa/support/messaging.ts`. Dependency-free (Node 22 built-ins only), like the other vendored
helpers. The file has two parts: a provider-neutral core, and the adapter objects.

**Core** (provider-neutral; the agent and the specs call only this):

| Export | Does |
|---|---|
| `loadContract(path)` | Reads `runs/{id}/messaging/contract.json`; returns `{adapter, openapi}`. |
| `startStub({port, contract})` | HTTP server on `127.0.0.1:port` serving every operation the adapter declares, at the paths and prefix the contract's `servers`/`paths` give. Requests are validated against the contract's JSON schema by a built-in validator covering `type`, `required`, `enum`, `pattern`, `format: email/date-time`, `additionalProperties: false`, `minItems`/`maxItems`, `oneOf`. Errors use the adapter's error envelope; successes a contract-shaped body; an internal stub error answers 500 `STUB_ERROR`. |
| `stub.respondNext(kind)` | Forces the next answer: `400`, `429` (with `Retry-After`), `500`, `timeout`. |
| `stub.recorded()` / `stub.reset()` | Requests seen: operation, method, path, headers (credential reduced to `<present>`), parsed body, validation result. |
| `send(body)` / `readBack(id)` | Live calls through the adapter. Base URL and key are read from `process.env` under the names `aegis messaging exec` injected. |
| `toFakeRecipient(body)` | Replaces every recipient field the adapter names with the configured fakes. `send` throws if a body still holds any other recipient. |
| `replay(bodies)` | Replays recorded bodies through `toFakeRecipient` and `send` (idempotency key prefix `qa-replay-`). The first body that yields a message is the preflight: it throws `NotSimulatedError` unless the adapter's `isSimulated` is true, before any other send. |
| `probeRegistered(id)` | The adapter's non-creating registration probe. |

**`MessagingAdapter`** (one object per provider; CommsHub's is the only one):

| Member | CommsHub |
|---|---|
| `id` | `"commshub"` |
| `operations` | `send` = `POST {prefix}/events`, `readBack` = `GET {prefix}/events/{message_id}` (operation ids from the contract) |
| `auth(key)` | `Authorization: Bearer <key>` |
| `keyPattern` | `/chk_[A-Za-z0-9_-]{8,}/` (for redaction and the SPV grep) |
| `recipientFields` | `recipient_email`, `recipient_phone`, `recipients[].recipient_email`, `recipients[].recipient_phone` |
| `messageIds(sendResponse)` | `scheduled[].message_id` |
| `finalState(readBack)` | `sent`/`delivered` → done; `skipped` (+`skip_reason`), `failed`, `bounced`, `cancelled` → finding; `scheduled`/`processing` → keep polling |
| `isSimulated(readBack)` | `simulated === true` and every `delivery_log[].provider_code === "simulated"` |
| `probeRegistered(id)` | POST `{event_id: id}` only: `RECIPIENT_CONTACT_REQUIRED` → `{registered: true, channel}`; `UNKNOWN_EVENT_ID` → `{registered: false}`; creates nothing |
| `errorEnvelope` | `{error, code, details}` |
| `detectionHints` | §4.1 |

### 4.4 CLI

Every command reads the adapter from config and the env names from config, then the target profile
(§2.1). None names a provider or a variable in its own code path outside the adapter object.

- Commands are `<group>.<verb>`, so `fetch-contract` is one word (not `contract fetch`).
- `aegis messaging fetch-contract --run <id>`: fetches the adapter's contract (CommsHub: `gh api
  repos/{repo}/contents/{path}?ref={ref}`), converts YAML → JSON with `yaml` (already a dependency of
  `@qa/run-state`, which the CLI imports), writes `runs/{runId}/messaging/contract.json` with `{adapter,
  repo, path, ref, sha, fetchedAt, openapi}`, and appends `messaging.contract-fetched {adapter, sha}`.
  Failure → `invalid-input`/`internal` with the fetch reason; nothing written. `runs/*/messaging/` is a
  CLI-written path (role table, H1).
- `aegis messaging plan --run <id>`: prints, from the adapter object, what the specialist needs and no
  secret: operations and their paths, recipient fields, the static checklist (§4.5 step 3), the
  registration-probe description, the env names in force (`baseUrlEnv`, `tokenEnv`) and the stub wiring
  line for this target, e.g. `COMMSHUB_BASE_URL=http://127.0.0.1:4010/api/v1`. The agent prose says "run
  `aegis messaging plan` and follow it"; provider detail lives in code, where it is unit-tested.
- `aegis messaging exec --run <id> -- <cmd…>`: resolves the base URL and key under the env names in
  force, from the process env, then `secrets/.env.development` (refuses unless the run's environment is
  `development`), and runs `<cmd>` with them injected under those names and under the neutral
  `AEGIS_MESSAGING_BASE_URL` / `AEGIS_MESSAGING_KEY` the helper reads. It prints only `key:
  present|absent`, so the specialist runs live specs without reading the key and the env-guard hook never
  blocks it.
- `aegis messaging check --run <id>`: `contract: present (sha)`, `stubPort: free|busy`, `key:
  present|absent`, `env names: <baseUrlEnv>/<tokenEnv> (detected|config)`. Used by the environment
  engineer.
- `aegis messaging scan-secrets --run <id> <paths…>`: greps the paths for the adapter's `keyPattern`
  and for the resolved key value itself; prints only `file:line` hits, never the match, and returns `{hits, scanned, skipped}`; a non-empty `skipped` (missing,
  unreadable or too-large files) is not a clean scan. Used by the specialist before submitting and by the SPV.

### 4.5 `qa-messaging-specialist`

Tier 2, `modelTier: implementation`, tools `[Read, Write, Edit, Bash]`, dispatched by `qa-test-executor`
for `testTechnique: Messaging` and by `qa-run-specialist`. Same section order and no-op sentences as
`qa-realtime-specialist` (enforced by `p2b-profiles.test.ts`), with `hasMessagingIntegration`. The prose
names no provider, variable, event or country (D10); a test asserts it (§6).

Process:
1. Profile gate: only a readable `hasMessagingIntegration: false` permits `specialist.no-op`; missing or
   invalid → `execution.blocked`, release `failed`. A `messaging.provider` with no adapter →
   `execution.blocked` "no adapter for <provider>".
2. `aegis messaging fetch-contract`, then `aegis messaging plan`. Failure → `execution.blocked`.
3. **Static layer.** Find the target's messaging client and every call site (start from the files that
   read `baseUrlEnv`/`tokenEnv`). Check each item of the plan's static checklist, citing file:line and
   the contract field. Provider-neutral items, always: send and read-back paths match the contract with
   the prefix present exactly once across base URL and path; request keys ⊆ the contract schema;
   required fields always set; the recipient field matches the channel; auth header as the adapter
   states; a dedupe key on every send; the success response parsed for message ids, including an
   empty or partial result; 4xx not retried, 429 and 5xx retried or queued; every template variable
   declared and sent non-empty; no full national id or other SPD in variables; code that waits for
   provider callbacks the contract does not define is flagged. CommsHub's checklist adds its own items
   (e.g. `external_id` as half of the dedupe key, `skipped[]`). Record the inventory of event ids and
   the flows that fire them in the work report.
4. Sandbox-first exploration of each flow (HANDBOOK/17 rule), then write
   `tests/qa/messaging/{flow}.messaging.spec.ts`.
5. **Stub layer.** Specs start the stub, trigger each flow through the app's API (Playwright
   `APIRequestContext`), and assert on `recorded()`: operation and path, credential present, `valid ===
   true`, the event id expected for the flow, complete non-empty variables. Failure-handling specs force
   `400`, `429`, `500` and `timeout` and assert the app's documented behaviour (no retry on 400; retry or
   queue on 5xx; the user-facing call still answers). The first spec is a wiring probe: if the app sends
   nothing to the stub within 30 s, `execution.blocked` "target not pointed at the stub" with the plan's
   wiring line.
6. **Live layer**, via `aegis messaging exec`. Key absent → live recorded "not run: no key"; static and
   stub results stand. Otherwise: `probeRegistered` for
   every event id from step 3 (unregistered → finding per id; channel vs the recipient field the code
   sends → finding on mismatch; it creates nothing, so it runs before the preflight); then `replay()` the
   recorded bodies, whose first message is the preflight (stop on not-simulated, Sev1; the specialist emits
   `messaging.live-preflight` with `simulated: true|false`); each message is polled with `readBack` up to
   `dispatchTimeoutSeconds` and judged with the adapter's `finalState` and `isSimulated`. Honour `Retry-After` on 429.
7. `aegis messaging scan-secrets` over the work report draft, evidence and specs; any hit is fixed
   before submitting. Results per TC to `runs/{runId}/cases/{TC-ID}-result.json`; the work report lists
   adapter, contract sha, env names in force, layers run/not-run with reasons, every live message id.

Writes (role row): `{testsDir}/messaging/**`, `{testsDir}/support/messaging.ts` (vendored, re-vendor
only), plus `SPECIALIST_COMMON`. Emits `test.passed`, `test.failed`, `specialist.no-op`,
`execution.blocked`, `sandbox.explored`, `messaging.live-preflight {adapter, simulated}`.

### 4.6 `qa-messaging-specialist-spv`

`[Read, Bash]`, `modelTier: validation`. Provider-neutral like the worker; where a check depends on the
provider it runs a CLI command that reads the adapter. Checklist:
1. Adapter, contract source and sha are recorded, and the static layer ran.
2. Every static finding cites file:line and a contract field; every item of `aegis messaging plan`'s
   static checklist is answered.
3. Every stub spec asserts operation, credential presence, schema validity, event id and variables;
   none is assertion-free.
4. Failure-handling specs exist for 400, 429, 5xx and timeout.
5. Live: a preflight that the adapter judged simulated precedes every other live send; the run stopped
   on a non-simulated preflight.
6. Live recipients are only the configured fakes (`messaging.fakeRecipients`).
7. `aegis messaging scan-secrets` over the work report, evidence, HAR and spec files has no hits.
8. Environment is `development`.
9. No-op only with a readable `hasMessagingIntegration: false`.
10. A layer not run is reported "not run" with its reason, never as passed.
11. Spec naming `*.messaging.spec.ts`; sandbox-first followed.
12. Env names in force match the profile or a config override, and the stub wiring line in the work
    report uses them.

### 4.7 Other agents and wiring

- `qa-environment-engineer` step 5: the Mailpit check becomes `aegis messaging check`; `stubPort` busy →
  `env.setup-failed`; it also vendors `messaging.ts`. The key's absence is reported, not a failure.
- `qa-test-designer`: `Messaging` when `hasMessagingIntegration` is true and the requirement sends a
  message (an OTP, a link, a notification, a broadcast, a digest).
- `qa-test-executor` + its SPV: route line `Messaging → qa-messaging-specialist`; `dispatches` updated.
- `TestTechniqueSchema`, `TEST_ROUTING.byTechnique`, `SPECIALISTS` (`messaging: {agent, mutates: true}`),
  `MESSAGING_PROVIDERS` (new, `packages/@qa/contracts`) and `ADAPTERS` (`@qa/messaging`), `pipeline.yaml` (`routing.byTechnique`,
  `designerEmits`, `envSpecialists`, the `reviewedBy.none` escape renamed), `model-policy.yaml`, role
  table row + `SPVS`, `forbidden-strings.ts` pattern.
- `agent-memory/qa-email-specialist/` → `agent-memory/qa-messaging-specialist/` (empty lessons).
- `qa-closure-reporter` example text, `qa-smoke` skip list, `qa-dry-run` technique list,
  `qa-run-specialist` (`--specialist messaging`).
- Docs: HANDBOOK 01/03/04/06/07/12/17, `docs/D03-*`, `docs/D12-*` (the asserted environments row becomes
  `| Messaging testing | ✓ (stub + provider dev) | ✗ | ✗ | ✗ |`), `CLAUDE.md` ports line, and
  `secrets/README.md` (`MAILPIT_URL` → "the target's messaging base URL and key, under the env names
  `aegis messaging check` prints"). The README lists `.env.*.example` templates that do not exist in the
  repo; this slice adds `secrets/.env.development.example` with commented examples for CommsHub and no values.
- HANDBOOK gains a short "Adding a messaging adapter" section: implement `MessagingAdapter`, add its id
  and hints to `ADAPTERS`, add its config block validation, add unit tests; no agent edit.

## 5. Error handling

| Situation | Result |
|---|---|
| Contract fetch fails | `execution.blocked`; task released `failed` |
| Profile provider has no adapter | `execution.blocked` "no adapter for <provider>" |
| Env names neither detected nor configured | `execution.blocked` naming the two config keys to set |
| Stub port busy | environment engineer `env.setup-failed` |
| App sends nothing to the stub in 30 s | `execution.blocked` "target not pointed at the stub", with the wiring line |
| Key absent | live "not run: no key"; static + stub stand |
| Preflight not simulated | stop all live sends; Sev1 finding "provider tenant is live" |
| 429 | wait `Retry-After`, retry once per request |
| Still pending after `dispatchTimeoutSeconds` | finding "dispatch stalled"; continue |
| Event not registered (adapter probe) | one finding per event id; other flows continue |
| Recipient field does not match the event's channel | finding "code sends {field}, event is {channel}" |
| `scan-secrets` hit | worker fixes before submit; SPV requested-changes if it reaches review |

## 6. Testing the framework

- `packages/@qa/messaging` unit tests (jest, `__internal-tests__/messaging/*`): validator per keyword
  against fixtures cut from the real OpenAPI; strict-key refusal; recording redacts the credential;
  `respondNext` kinds; `toFakeRecipient` and the `send` refusal; fake-recipient validation (non-E.164,
  non-reserved domain refused); CommsHub adapter `probeRegistered`, `finalState`, `isSimulated`
  mapping; `replay` throws when the preflight is not simulated; nothing prints the key (spy on stdout/stderr).
- CLI: `messaging fetch-contract` with a stubbed `gh` (success, network failure, bad YAML, sha
  recorded, nothing written on failure); `messaging exec` injects and never prints, refuses outside
  `development`; `messaging check`; `messaging plan` output per adapter; `messaging scan-secrets`
  reports file:line and never the match.
- **Project-agnostic guard** (D10): a test fails if `qa-messaging-specialist.md`, its SPV or the core
  part of `@qa/messaging` contains a provider name, a `COMMSHUB_`/`COMMHUB_` name, `chk_`, a phone number
  or a project name; the only allowed place is the adapter objects and `ADAPTERS`.
- **Second-target fixture**: the scanner/plan tests run against two fixture targets with different env
  names (Renci-style `COMMSHUB_BASE_URL`/`COMMSHUB_SERVICE_TOKEN`, slec-style
  `COMMHUB_API_URL`/`COMMHUB_API_KEY`) and assert the detected names, the wiring line and `exec`'s
  injection for each.
- **Adapter seam test**: a fake second adapter registered only in the test proves the core never
  branches on `adapter.id`.
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
   names the fix), and puts the key under the name `aegis messaging check` prints, in the shell or
   `secrets/.env.development`.
3. First real run: Renci, `development`, app launched at the stub. Expected live findings today:
   `renci.organisation.registered` unregistered; Renci's delivery-status webhook route waits for
   callbacks CommsHub never sends.

## 8. Out of scope

- Testing CommsHub itself (its own repo has e2e).
- `testing`/`staging` environments and deployed targets.
- Changing a tenant's delivery mode or registering events (no API; CommsHub admin only).
- Adapters other than CommsHub, including direct SMTP (§2, D11): the seam exists, the adapters do not.
