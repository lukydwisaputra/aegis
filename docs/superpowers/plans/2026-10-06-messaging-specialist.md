# NEW-07 Messaging Specialist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Mailpit email testing with a provider-neutral `qa-messaging-specialist` + SPV, CommsHub as the first adapter, testing a target's messaging integration in three layers (static contract check, local recording stub, simulated replay on the provider's dev).

**Architecture:** Provider-neutral vocabulary in `@qa/contracts`; a dependency-free vendored helper `@qa/messaging` (validator, recording stub, live replay, adapter objects); a `messaging.ts` module in `@qa/run-state` behind five `aegis messaging …` CLI commands that own the contract fetch, the plan, the key and the secret scan; agents name no provider, variable, event or country.

**Tech Stack:** TypeScript (ESM, Node 22), zod (contracts), commander (CLI), `yaml`, jest + ts-jest (`__internal-tests__`), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-06-commshub-messaging-specialist-design.md`

## Global Constraints

- Repo `/Users/lukydwisaputra/Desktop/QA/aegis`, branch `feat/commshub-messaging-specialist`. Every command below runs from that root unless stated.
- Commands: tests `pnpm -F @aegis/internal-tests exec jest <pattern>`; all tests `pnpm test`; `pnpm typecheck`; `pnpm build`; `pnpm aegis align` must end `ratchet: ok`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `@qa/messaging/src/index.ts` imports only `node:*` built-ins (it is copied verbatim into targets).
- The text between `// ── core ──` and `// ── adapters ──` in `@qa/messaging/src/index.ts`, `qa-messaging-specialist.md` and `qa-messaging-specialist-spv.md` contain none of: `commshub`, `CommsHub`, `COMMSHUB_`, `COMMHUB_`, `chk_`, `+65`, `renci`, `slec` (case-insensitive for words).
- No key value is ever printed, logged, written to an event or a work report. CLI output says only `present`/`absent`.
- Live sends only to configured fake recipients; defaults `aegis-probe@example.com`, `+6500000000`.
- The specialist runs only in environment `development`; `testing`, `staging`, `production` forbid `messaging`.
- No baseline growth in `__internal-tests__/alignment/baseline.yaml` (deleting stale entries is expected).
- The env-guard hook blocks Bash commands whose text names `.env` files: write any script that needs that path to a file first and run the file.
- Naming deviation from the spec, deliberate: the CLI is two levels deep (`commandIdOf` supports `<group>.<verb>`), so `aegis messaging contract fetch` is `aegis messaging fetch-contract`. Task 9 syncs the spec.

## Review Focus

1. **A key leaking through the stub or a work report.** A recorded request keeps `Authorization: Bearer chk_…` → recorded headers must show `<present>` only (Task 2 test `records the credential as present, never its value`).
2. **A replay whose first send is rejected** (e.g. `UNKNOWN_EVENT_ID`) must not count as the preflight; the next body becomes the preflight candidate (Task 2 test `a rejected first body does not satisfy the preflight`).
3. **A base URL with or without the API prefix** (`https://host/api/v1` vs `https://host`) must reach the same endpoint (Task 2 test `liveUrl joins the prefix exactly once`).
4. **A stale `emailAdapter` key in a project's config** must be refused with the fix named, not silently ignored (Task 3 test `refuses a leftover emailAdapter key and names the replacement`).
5. **A target whose client reads unusual env names** (slec-style `COMMHUB_API_URL`/`COMMHUB_API_KEY`) must get its own wiring line and injection (Task 3 test `second-target fixture: slec-style names`).

---

### Task 1: Contracts — messaging vocabulary, profile, routing, events

**Files:**
- Create: `packages/@qa/contracts/src/messaging.ts`
- Modify: `packages/@qa/contracts/src/index.ts`, `specialists.ts`, `routing.ts`, `artefacts.ts`, `target-profile.ts`, `events.ts`, `forbidden-strings.ts`
- Modify: `packages/@qa/run-state/src/caller.ts` (only `CLI_RECORDED_TYPES`)
- Test: `__internal-tests__/messaging/contracts.test.ts` (new); update `__internal-tests__/helpers/pipeline.ts` PROFILE fixture

**Interfaces:**
- Produces: `MESSAGING_PROVIDERS = ["commshub", "direct-mail", "none"] as const`, `MessagingProvider`, `MessagingProfileSchema`, `TargetProfile.hasMessagingIntegration: boolean`, `TargetProfile.messaging: {provider, baseUrlEnv: string|null, tokenEnv: string|null}`, `SPECIALISTS.messaging = {agent: "qa-messaging-specialist", mutates: true}`, technique `"Messaging"`, events `messaging.contract-fetched {adapter, sha}` and `messaging.live-preflight {adapter, simulated}`.

- [ ] **Step 1: Write the failing test** `__internal-tests__/messaging/contracts.test.ts`

```ts
import {
  AegisEventUnionSchema, DEFAULT_ENVIRONMENT_SPECIALISTS, MESSAGING_PROVIDERS, MessagingProfileSchema,
  SPECIALISTS, TEST_ROUTING, TargetProfileSchema, TestTechniqueSchema, routeTestCase,
} from '@qa/contracts';
import { CLI_RECORDED_TYPES } from '@qa/run-state';
import { PROFILE } from '../helpers/pipeline';

describe('messaging vocabulary (NEW-07)', () => {
  it('replaces the email specialist and technique', () => {
    expect(SPECIALISTS).not.toHaveProperty('email');
    expect(SPECIALISTS.messaging).toEqual({ agent: 'qa-messaging-specialist', mutates: true });
    expect(TestTechniqueSchema.options).toContain('Messaging');
    expect(TestTechniqueSchema.options).not.toContain('Email');
    expect(TEST_ROUTING.byTechnique).toMatchObject({ Messaging: 'qa-messaging-specialist' });
    expect(routeTestCase({ testType: ['E2E'], testTechnique: ['Messaging'] })).toEqual(['qa-ui-specialist', 'qa-messaging-specialist']);
  });

  it('forbids messaging everywhere but development by default', () => {
    expect(DEFAULT_ENVIRONMENT_SPECIALISTS.production.forbiddenSpecialists).toContain('messaging');
    for (const env of ['testing', 'staging'] as const) {
      expect((DEFAULT_ENVIRONMENT_SPECIALISTS[env] as { forbiddenSpecialists?: readonly string[] }).forbiddenSpecialists).toEqual(['messaging']);
    }
    expect(DEFAULT_ENVIRONMENT_SPECIALISTS.development).not.toHaveProperty('forbiddenSpecialists');
  });

  it('the profile carries the messaging flag and provider names, strictly', () => {
    expect(MESSAGING_PROVIDERS).toEqual(['commshub', 'direct-mail', 'none']);
    expect(TargetProfileSchema.safeParse(PROFILE).success).toBe(true);
    expect(TargetProfileSchema.safeParse({ ...PROFILE, hasEmailFlows: false }).success).toBe(false);
    expect(MessagingProfileSchema.safeParse({ provider: 'commshub', baseUrlEnv: 'X_URL', tokenEnv: 'X_KEY' }).success).toBe(true);
    expect(MessagingProfileSchema.safeParse({ provider: 'mailgun', baseUrlEnv: null, tokenEnv: null }).success).toBe(false);
    expect(MessagingProfileSchema.safeParse({ provider: 'none', baseUrlEnv: null, tokenEnv: null, extra: 1 }).success).toBe(false);
  });

  it('declares the two messaging events; the CLI records the contract fetch itself', () => {
    const base = { ts: '2026-10-06T00:00:00.000Z', runId: 'RUN-20261006-001' };
    expect(AegisEventUnionSchema.safeParse({ ...base, type: 'messaging.contract-fetched', adapter: 'commshub', sha: 'abc' }).success).toBe(true);
    expect(AegisEventUnionSchema.safeParse({ ...base, type: 'messaging.live-preflight', adapter: 'commshub', simulated: true }).success).toBe(true);
    expect(CLI_RECORDED_TYPES.has('messaging.contract-fetched')).toBe(true);
    expect(CLI_RECORDED_TYPES.has('messaging.live-preflight')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest messaging/contracts`
Expected: FAIL (`MESSAGING_PROVIDERS` undefined / `SPECIALISTS.email` present).

- [ ] **Step 3: Implement**

Create `packages/@qa/contracts/src/messaging.ts`:

```ts
import { z } from "zod";

/** NEW-07: providers a target can send messages through. An adapter id in @qa/messaging exists for each, except the two non-adapters. */
export const MESSAGING_PROVIDERS = ["commshub", "direct-mail", "none"] as const;
export type MessagingProvider = (typeof MESSAGING_PROVIDERS)[number];

/** The scanner's messaging finding: which provider, and the env names the target's client reads for base URL and key. */
export const MessagingProfileSchema = z
  .object({
    provider: z.enum(MESSAGING_PROVIDERS),
    baseUrlEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).nullable(),
    tokenEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).nullable(),
  })
  .strict();
export type MessagingProfile = z.infer<typeof MessagingProfileSchema>;
```

`index.ts`: add `export * from "./messaging.js";` after the `target-profile.js` line.

`target-profile.ts`: add `import { MessagingProfileSchema } from "./messaging.js";` and replace the two lines
```ts
  // P2b (AUD-051): a mail library, an SMTP_*/MAIL_* env var name, or Supabase auth; false makes the email specialist a no-op.
  hasEmailFlows: z.boolean(),
```
with
```ts
  // NEW-07: a messaging provider the target calls (adapter detection hints, @qa/messaging); false makes the messaging specialist a no-op.
  hasMessagingIntegration: z.boolean(),
  messaging: MessagingProfileSchema,
```

`artefacts.ts` `TestTechniqueSchema`: replace `"Email"` with `"Messaging"`.

`routing.ts` `byTechnique`: replace `Email: "qa-email-specialist",` with `Messaging: "qa-messaging-specialist",`.

`specialists.ts`: replace `email: { agent: "qa-email-specialist", mutates: true },` with `messaging: { agent: "qa-messaging-specialist", mutates: true },` and `DEFAULT_ENVIRONMENT_SPECIALISTS` with:
```ts
export const DEFAULT_ENVIRONMENT_SPECIALISTS = {
  development: { allowedSpecialists: ["*"] },
  // NEW-07: messaging runs only against a local target and the provider's dev tenant.
  testing: { allowedSpecialists: ["*"], forbiddenSpecialists: ["messaging"] },
  staging: { allowedSpecialists: ["*"], forbiddenSpecialists: ["messaging"] },
  production: { allowedSpecialists: ["ui", "api"], forbiddenSpecialists: ["database", "performance", "security", "messaging", "feature-flag"] },
} as const satisfies Record<string, EnvironmentSpecialistConfig>;
```

`events.ts`: after `SpecialistNoOpEventSchema` add
```ts
export const MessagingContractFetchedEventSchema = EventBase.extend({
  type: z.literal("messaging.contract-fetched"),
  adapter: z.string().min(1),
  sha: z.string().min(1),
});

export const MessagingLivePreflightEventSchema = EventBase.extend({
  type: z.literal("messaging.live-preflight"),
  adapter: z.string().min(1),
  simulated: z.boolean(),
});
```
and add both schemas to the `AegisEventUnionSchema` list right after `SpecialistNoOpEventSchema,`.

`forbidden-strings.ts`: replace the pattern `/qa-email-specialist/` with `/qa-messaging-specialist/`.

`packages/@qa/run-state/src/caller.ts`: `CLI_RECORDED_TYPES` gains `"messaging.contract-fetched"`:
```ts
export const CLI_RECORDED_TYPES: ReadonlySet<string> = new Set(["artifact.created", "env.specialist-blocked", "preflight.failed", "cli.refused", "messaging.contract-fetched"]);
```

`__internal-tests__/helpers/pipeline.ts` PROFILE: replace `hasEmailFlows: false` with `hasMessagingIntegration: false, messaging: { provider: 'none', baseUrlEnv: null, tokenEnv: null }`.

- [ ] **Step 4: Run tests**

Run: `pnpm -F @aegis/internal-tests exec jest messaging/contracts target-profile routing-vocab env-specialists contracts`
Expected: `messaging/contracts` PASS. `target-profile`, `env-specialists` will FAIL where they still assert email; fix each failing assertion by renaming `email`→`messaging`, `Email`→`Messaging`, `hasEmailFlows`→`hasMessagingIntegration` (and add the `messaging` object wherever a profile literal is built). Do not touch assertions about the scanner prose here; Task 6 rewrites that prose and those assertions (`target-profile.test.ts:77-101`) — mark them `it.skip` with `// NEW-07 Task 6` for now. Re-run until all listed suites pass.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/contracts packages/@qa/run-state/src/caller.ts __internal-tests__
git commit -m "feat(contracts): NEW-07 messaging vocabulary, profile flag and events replace email

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `@qa/messaging` — validator, stub, live replay, CommsHub adapter

**Files:**
- Create: `packages/@qa/messaging/package.json`, `packages/@qa/messaging/tsconfig.json`, `packages/@qa/messaging/src/index.ts`
- Create: `__internal-tests__/fixtures/messaging/commshub-openapi.json` (contract fixture, already in `contract.json` shape)
- Test: `__internal-tests__/messaging/helper.test.ts`

**Interfaces:**
- Produces (exact exports): `validate(schema, value, root, path?) → SchemaError[]`; `apiPrefix(openapi) → string`; `requestSchema(openapi, op) → JsonSchema | null`; `loadContract(file?) → MessagingContract`; `loadPlan(file?) → MessagingPlan`; `fakeRecipientProblem(kind, value) → string | null`; `DEFAULT_FAKE_RECIPIENTS`; `toFakeRecipient(body, plan, adapter) → body`; `assertOnlyFakes(body, plan, adapter)`; `startStub({plan, contract, port?}) → Promise<Stub>`; `liveUrl(base, prefix, path) → string`; `send(body, opts?)`; `readBack(id)`; `waitFinal(id, timeoutSeconds)`; `probeRegistered(id)`; `replay(bodies, opts?) → ReplayResult[]`; `NotSimulatedError`; `ADAPTERS`; `adapterFor(id)`; types `MessagingAdapter`, `MessagingPlan`, `MessagingContract`, `Operation`, `Stub`, `Recorded`.
- `MessagingPlan` JSON shape (written by Task 3's `buildPlan`): `{adapter, stubPort, dispatchTimeoutSeconds, fakeRecipients:{email,phone}, env:{baseUrl,token}, prefix, wiringLine, operations:{send,readBack}, recipientFields, staticChecklist, probe}`.
- `MessagingContract` JSON shape (written by Task 3's `fetchContract`): `{adapter, repo, path, ref, sha, fetchedAt, openapi}`.

- [ ] **Step 1: Package scaffolding**

`packages/@qa/messaging/package.json`:
```json
{
  "name": "@qa/messaging",
  "version": "1.0.0",
  "description": "Provider-neutral messaging test helper: contract validator, recording stub, simulated live replay (NEW-07)",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": { "build": "tsc", "dev": "tsc --watch" },
  "dependencies": {},
  "devDependencies": {}
}
```
`packages/@qa/messaging/tsconfig.json`: copy `packages/@qa/test-helpers/tsconfig.json` verbatim.
Run `pnpm install` so the workspace links it.

- [ ] **Step 2: Contract fixture** `__internal-tests__/fixtures/messaging/commshub-openapi.json`

Authored from CommsHub `development`@418f357 `lib/api/schemas.ts` (`fireEventSchema`) because GitHub was unreachable when this plan was written; replace with a real `aegis messaging fetch-contract` output when it is reachable and keep the tests green.

```json
{
  "adapter": "commshub",
  "repo": "WerkDone-Pte-Ltd/wd-commhub",
  "path": "docs/08-commhub-events-api.yaml",
  "ref": "development",
  "sha": "fixture-418f357",
  "fetchedAt": "2026-10-06T00:00:00.000Z",
  "openapi": {
    "openapi": "3.1.0",
    "servers": [{ "url": "https://commhub.dev.werkdone.com/api/v1" }],
    "paths": {
      "/events": {
        "post": {
          "requestBody": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/FireEvent" } } } }
        }
      },
      "/events/{message_id}": { "get": {} }
    },
    "components": {
      "schemas": {
        "Variables": { "type": "object", "additionalProperties": { "type": "string" } },
        "Recipient": {
          "type": "object",
          "additionalProperties": false,
          "required": ["recipient_external_id"],
          "properties": {
            "recipient_external_id": { "type": "string", "minLength": 1 },
            "recipient_email": { "type": "string", "format": "email" },
            "recipient_phone": { "type": "string", "pattern": "^\\+[1-9]\\d{6,14}$" },
            "template_variables": { "$ref": "#/components/schemas/Variables" }
          }
        },
        "FireEvent": {
          "type": "object",
          "additionalProperties": false,
          "required": ["event_id"],
          "properties": {
            "event_id": { "type": "string", "minLength": 1 },
            "occurs_at": { "type": "string", "format": "date-time" },
            "timezone": { "type": "string" },
            "external_id": { "type": "string" },
            "recipient_external_id": { "type": "string" },
            "recipient_email": { "type": "string", "format": "email" },
            "recipient_phone": { "type": "string", "pattern": "^\\+[1-9]\\d{6,14}$" },
            "template_variables": { "$ref": "#/components/schemas/Variables" },
            "attachments": { "type": "array" },
            "recipients": { "type": "array", "minItems": 1, "maxItems": 500, "items": { "$ref": "#/components/schemas/Recipient" } }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Write the failing tests** `__internal-tests__/messaging/helper.test.ts`

```ts
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import {
  ADAPTERS, DEFAULT_FAKE_RECIPIENTS, NotSimulatedError, adapterFor, apiPrefix, fakeRecipientProblem, liveUrl,
  probeRegistered, replay, requestSchema, startStub, toFakeRecipient, validate,
  type MessagingContract, type MessagingPlan,
} from '@qa/messaging';

const ROOT = path.join(__dirname, '..', '..');
const contract = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'messaging', 'commshub-openapi.json'), 'utf-8')) as MessagingContract;
const adapter = adapterFor('commshub');
const plan = (over: Partial<MessagingPlan> = {}): MessagingPlan => ({
  adapter: 'commshub', stubPort: 0, dispatchTimeoutSeconds: 5, fakeRecipients: { ...DEFAULT_FAKE_RECIPIENTS },
  env: { baseUrl: 'APP_MSG_URL', token: 'APP_MSG_KEY' }, prefix: '/api/v1', wiringLine: 'APP_MSG_URL=http://127.0.0.1:0/api/v1',
  operations: adapter.operations, recipientFields: [...adapter.recipientFields], staticChecklist: [...adapter.staticChecklist],
  probe: adapter.probeDescription, ...over,
});
const fire = requestSchema(contract.openapi, adapter.operations.send)!;
const post = async (url: string, body: unknown, headers: Record<string, string> = { authorization: 'Bearer chk_secretsecret' }) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};

describe('validate', () => {
  it('accepts a contract-valid body and refuses an unknown key, a missing field and a bad pattern', () => {
    expect(validate(fire, { event_id: 'a.b', recipient_email: 'x@example.com', template_variables: { n: 'v' } }, contract.openapi)).toEqual([]);
    expect(validate(fire, { event_id: 'a', channels_allowed: ['sms'] }, contract.openapi).map((e) => e.path)).toEqual(['$.channels_allowed']);
    expect(validate(fire, { recipient_email: 'x@example.com' }, contract.openapi)[0]!.message).toMatch(/required/);
    expect(validate(fire, { event_id: 'a', recipient_phone: '6512345678' }, contract.openapi)[0]!.path).toBe('$.recipient_phone');
    expect(validate(fire, { event_id: 'a', recipients: [] }, contract.openapi)[0]!.message).toMatch(/fewer than 1/);
  });
  it('apiPrefix reads the servers pathname', () => {
    expect(apiPrefix(contract.openapi)).toBe('/api/v1');
    expect(apiPrefix({})).toBe('');
  });
});

describe('fake recipients', () => {
  it('refuses anything that could be delivered', () => {
    expect(fakeRecipientProblem('email', 'aegis-probe@example.com')).toBeNull();
    expect(fakeRecipientProblem('email', 'qa@corp.invalid')).toBeNull();
    expect(fakeRecipientProblem('email', 'someone@gmail.com')).toMatch(/reserved/);
    expect(fakeRecipientProblem('phone', '+6500000000')).toBeNull();
    expect(fakeRecipientProblem('phone', '6500000000')).toMatch(/E\.164/);
  });
  it('toFakeRecipient swaps single and batch recipients and keeps the rest', () => {
    const out = toFakeRecipient({ event_id: 'e', recipient_phone: '+6591234567', recipients: [{ recipient_external_id: 'r', recipient_email: 'a@b.co' }] }, plan(), adapter) as any;
    expect(out.recipient_phone).toBe('+6500000000');
    expect(out.recipients[0]).toEqual({ recipient_external_id: 'r', recipient_email: 'aegis-probe@example.com' });
    expect(out.event_id).toBe('e');
  });
});

describe('stub', () => {
  it('records the credential as present, never its value, and validates against the contract', async () => {
    const stub = await startStub({ plan: plan(), contract });
    try {
      const ok = await post(`${stub.url}/api/v1/events`, { event_id: 'e.x', recipient_email: 'u@example.com', template_variables: { a: '1' } });
      expect(ok.status).toBe(201);
      expect(ok.body.scheduled[0].message_id).toEqual(expect.any(String));
      const bad = await post(`${stub.url}/api/v1/events`, { event_id: 'e', to: '+65' });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('VALIDATION_ERROR');
      const noAuth = await post(`${stub.url}/api/v1/events`, { event_id: 'e' }, {});
      expect(noAuth.status).toBe(401);
      const rec = stub.recorded();
      expect(rec).toHaveLength(3);
      expect(rec[0]).toMatchObject({ operation: 'send', prefixed: true, credential: 'present', valid: true });
      expect(rec[1]).toMatchObject({ valid: false });
      expect(rec[2]).toMatchObject({ credential: 'absent' });
      expect(JSON.stringify(rec)).not.toContain('chk_secretsecret');
      const back = await fetch(`${stub.url}/api/v1/events/${ok.body.scheduled[0].message_id}`, { headers: { authorization: 'Bearer chk_secretsecret' } });
      expect((await back.json() as any).simulated).toBe(true);
    } finally { await stub.stop(); }
  });

  it('serves the unprefixed path too and records which one the app used', async () => {
    const stub = await startStub({ plan: plan(), contract });
    try {
      expect((await post(`${stub.url}/events`, { event_id: 'e' })).status).toBe(201);
      expect(stub.recorded()[0]).toMatchObject({ operation: 'send', prefixed: false });
      expect((await post(`${stub.url}/api/v1/v1/messages`, { event_id: 'e' })).status).toBe(404);
      expect(stub.recorded()[1]).toMatchObject({ operation: 'unknown' });
    } finally { await stub.stop(); }
  });

  it('forces 400, 429 with Retry-After, 500 and a timeout once each', async () => {
    const stub = await startStub({ plan: plan(), contract });
    try {
      for (const [kind, status] of [['400', 400], ['429', 429], ['500', 500]] as const) {
        stub.respondNext(kind);
        const r = await fetch(`${stub.url}/api/v1/events`, { method: 'POST', headers: { authorization: 'Bearer k', 'content-type': 'application/json' }, body: '{"event_id":"e"}' });
        expect(r.status).toBe(status);
        if (kind === '429') expect(r.headers.get('retry-after')).toBe('1');
      }
      stub.respondNext('timeout');
      await expect(fetch(`${stub.url}/api/v1/events`, { method: 'POST', headers: { authorization: 'Bearer k' }, body: '{"event_id":"e"}', signal: AbortSignal.timeout(300) })).rejects.toThrow();
      expect((await post(`${stub.url}/api/v1/events`, { event_id: 'e' })).status).toBe(201);
    } finally { await stub.stop(); }
  });
});

describe('live replay (a stub stands in for the provider)', () => {
  const withEnv = async (url: string, fn: () => Promise<void>) => {
    const keep = { ...process.env };
    process.env.AEGIS_MESSAGING_BASE_URL = url; process.env.AEGIS_MESSAGING_KEY = 'chk_livekeylivekey';
    try { await fn(); } finally { process.env = keep; }
  };

  it('liveUrl joins the prefix exactly once', () => {
    expect(liveUrl('https://h/api/v1', '/api/v1', '/events')).toBe('https://h/api/v1/events');
    expect(liveUrl('https://h/api/v1/', '/api/v1', '/events')).toBe('https://h/api/v1/events');
    expect(liveUrl('https://h', '/api/v1', '/events')).toBe('https://h/api/v1/events');
  });

  it('replays recorded bodies to fake recipients and reports simulated delivery', async () => {
    const stub = await startStub({ plan: plan(), contract });
    try {
      await withEnv(`${stub.url}/api/v1`, async () => {
        const out = await replay([{ event_id: 'a', recipient_email: 'real@corp.com', template_variables: { x: '1' } }], { plan: plan() });
        expect(out[0]).toMatchObject({ eventId: 'a', state: 'done', simulated: true });
        expect((stub.recorded()[0]!.body as any).recipient_email).toBe('aegis-probe@example.com');
      });
    } finally { await stub.stop(); }
  });

  it('a rejected first body does not satisfy the preflight; a live provider stops the run', async () => {
    const server = http.createServer((req, res) => {
      let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
        if (req.method === 'POST') {
          const b = JSON.parse(raw);
          if (b.event_id === 'unknown') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"code":"UNKNOWN_EVENT_ID","error":"x"}'); }
          res.writeHead(201, { 'content-type': 'application/json' }); return res.end('{"scheduled":[{"message_id":"m1"}]}');
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"status":"sent","simulated":false,"delivery_log":[{"provider_code":"whatsapp_cloud"}]}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      await withEnv(`http://127.0.0.1:${port}/api/v1`, async () => {
        await expect(replay([{ event_id: 'unknown', recipient_email: 'x@y.co' }, { event_id: 'ok', recipient_email: 'x@y.co' }], { plan: plan() }))
          .rejects.toBeInstanceOf(NotSimulatedError);
      });
    } finally { server.close(); }
  });

  it('probeRegistered maps the adapter answers and creates nothing', async () => {
    const stub = await startStub({ plan: plan(), contract });
    try {
      await withEnv(`${stub.url}/api/v1`, async () => {
        stub.respondNext('400');
        await expect(probeRegistered('x', { plan: plan() })).rejects.toThrow(/unexpected probe answer/);
      });
    } finally { await stub.stop(); }
    expect(adapter.probeResult(400, { code: 'RECIPIENT_CONTACT_REQUIRED', details: { channel: 'sms' } })).toEqual({ registered: true, channel: 'sms' });
    expect(adapter.probeResult(400, { code: 'UNKNOWN_EVENT_ID' })).toEqual({ registered: false, channel: null });
  });
});

describe('project-agnostic core (D10)', () => {
  it('names no provider, variable, key format, country or project outside the adapters', () => {
    const src = fs.readFileSync(path.join(ROOT, 'packages/@qa/messaging/src/index.ts'), 'utf-8');
    const core = src.slice(src.indexOf('// ── core ──'), src.indexOf('// ── adapters ──'));
    expect(core.length).toBeGreaterThan(2000);
    expect(core).not.toMatch(/commshub|COMMS?HUB_|chk_|\+65|renci|slec/i);
    expect(/^import .* from "node:/m.test(src)).toBe(true);
    expect(src.split('\n').filter((l) => /^import /.test(l) && !/from "node:/.test(l))).toEqual([]);
  });
  it('every adapter id is a profile provider', () => {
    const { MESSAGING_PROVIDERS } = require('@qa/contracts');
    for (const id of Object.keys(ADAPTERS)) expect(MESSAGING_PROVIDERS).toContain(id);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest messaging/helper`
Expected: FAIL (`Cannot find module '@qa/messaging'` or missing exports).

- [ ] **Step 5: Implement** `packages/@qa/messaging/src/index.ts`

```ts
// @qa/messaging (NEW-07): provider-neutral messaging test helper. `aegis helpers vendor` copies this file to
// <testsDir>/support/messaging.ts; it imports Node built-ins only. Specs run under `aegis messaging exec`, which sets
// AEGIS_MESSAGING_PLAN, AEGIS_MESSAGING_CONTRACT and, when a key is available, AEGIS_MESSAGING_BASE_URL/_KEY.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

// ── core ──

export type JsonSchema = { [key: string]: unknown };
export interface SchemaError { path: string; message: string }
export interface Operation { method: "GET" | "POST"; path: string }

export interface MessagingContract {
  adapter: string; repo: string; path: string; ref: string; sha: string; fetchedAt: string; openapi: JsonSchema;
}

export interface MessagingPlan {
  adapter: string;
  stubPort: number;
  dispatchTimeoutSeconds: number;
  fakeRecipients: { email: string; phone: string };
  env: { baseUrl: string; token: string };
  prefix: string;
  wiringLine: string;
  operations: { send: Operation; readBack: Operation };
  recipientFields: string[];
  staticChecklist: string[];
  probe: string;
}

export type FinalState = "done" | "pending" | "problem";

/** One provider. Everything provider-specific lives in an object of this shape, in the adapters section below. */
export interface MessagingAdapter {
  id: string;
  label: string;
  operations: { send: Operation; readBack: Operation };
  /** Keys the adapter's block in aegis.config.json#messaging.<id> must carry, dotted. */
  requiredConfig: readonly string[];
  contractSource(block: Record<string, unknown>): { repo: string; path: string; ref: string };
  authHeader(key: string): [string, string];
  hasAuth(headers: Record<string, string | string[] | undefined>): boolean;
  keyPattern: RegExp;
  /** Recipient fields, dotted; `list[].field` addresses every element of an array. */
  recipientFields: readonly string[];
  messageIds(sendResponse: unknown): string[];
  finalState(readBack: unknown): FinalState;
  isSimulated(readBack: unknown): boolean;
  probeBody(id: string): Record<string, unknown>;
  probeResult(status: number, body: unknown): { registered: boolean; channel: string | null };
  errorBody(code: string, message: string, details?: unknown): unknown;
  idsForSend(body: Record<string, unknown>): number;
  stubSendResponse(body: Record<string, unknown>, ids: string[]): unknown;
  stubReadBack(id: string, body: Record<string, unknown>): unknown;
  eventIdOf(body: unknown): string;
  staticChecklist: readonly string[];
  probeDescription: string;
}

// ─ JSON Schema subset (what provider contracts use) ─

function resolveRef(ref: string, root: JsonSchema): JsonSchema {
  if (!ref.startsWith("#/")) throw new Error(`unsupported $ref ${ref}`);
  let cur: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    cur = (cur as Record<string, unknown> | undefined)?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  if (cur === undefined || cur === null || typeof cur !== "object") throw new Error(`unresolved $ref ${ref}`);
  return cur as JsonSchema;
}

const typeOf = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" && Number.isInteger(v) ? "integer" : typeof v;
const typeMatches = (t: string, v: unknown): boolean => t === typeOf(v) || (t === "number" && typeOf(v) === "integer");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const isUri = (s: string): boolean => {
  try { new URL(s); return true; } catch { return false; }
};

/** Errors of `value` against `schema` ($ref resolved in `root`); empty when valid. */
export function validate(schema: JsonSchema, value: unknown, root: JsonSchema, path = "$"): SchemaError[] {
  if (typeof schema["$ref"] === "string") return validate(resolveRef(schema["$ref"], root), value, root, path);
  const errors: SchemaError[] = [];
  const fail = (message: string, at = path): void => { errors.push({ path: at, message }); };
  const passes = (s: JsonSchema): boolean => validate(s, value, root, path).length === 0;
  for (const s of (schema["allOf"] as JsonSchema[] | undefined) ?? []) errors.push(...validate(s, value, root, path));
  const anyOf = schema["anyOf"] as JsonSchema[] | undefined;
  if (anyOf !== undefined && !anyOf.some(passes)) fail("matches no anyOf branch");
  const oneOf = schema["oneOf"] as JsonSchema[] | undefined;
  if (oneOf !== undefined) {
    const n = oneOf.filter(passes).length;
    if (n !== 1) fail(`matches ${n} oneOf branches, expected 1`);
  }
  if (schema["not"] !== undefined && passes(schema["not"] as JsonSchema)) fail("matches a forbidden schema");
  if (value === null && schema["nullable"] === true) return errors;
  if (schema["type"] !== undefined) {
    const types = Array.isArray(schema["type"]) ? (schema["type"] as string[]) : [schema["type"] as string];
    if (!types.some((t) => typeMatches(t, value))) {
      fail(`expected ${types.join("|")}, got ${typeOf(value)}`);
      return errors;
    }
  }
  const en = schema["enum"] as unknown[] | undefined;
  if (en !== undefined && !en.some((e) => e === value)) fail(`not one of ${JSON.stringify(en)}`);
  if ("const" in schema && schema["const"] !== value) fail(`must equal ${JSON.stringify(schema["const"])}`);
  if (typeof value === "string") {
    const { minLength, maxLength, pattern, format } = schema as { minLength?: number; maxLength?: number; pattern?: string; format?: string };
    if (minLength !== undefined && value.length < minLength) fail(`shorter than ${minLength}`);
    if (maxLength !== undefined && value.length > maxLength) fail(`longer than ${maxLength}`);
    if (pattern !== undefined && !new RegExp(pattern, "u").test(value)) fail(`does not match ${pattern}`);
    if (format === "email" && !EMAIL.test(value)) fail("not an email");
    if (format === "date-time" && !DATE_TIME.test(value)) fail("not an RFC 3339 date-time");
    if (format === "uri" && !isUri(value)) fail("not a URI");
  }
  if (typeof value === "number") {
    const { minimum, maximum } = schema as { minimum?: number; maximum?: number };
    if (minimum !== undefined && value < minimum) fail(`below ${minimum}`);
    if (maximum !== undefined && value > maximum) fail(`above ${maximum}`);
  }
  if (Array.isArray(value)) {
    const { minItems, maxItems, items } = schema as { minItems?: number; maxItems?: number; items?: JsonSchema };
    if (minItems !== undefined && value.length < minItems) fail(`fewer than ${minItems} items`);
    if (maxItems !== undefined && value.length > maxItems) fail(`more than ${maxItems} items`);
    if (items !== undefined) value.forEach((v, i) => errors.push(...validate(items, v, root, `${path}[${i}]`)));
  }
  if (typeOf(value) === "object") {
    const obj = value as Record<string, unknown>;
    const props = (schema["properties"] as Record<string, JsonSchema> | undefined) ?? {};
    for (const r of (schema["required"] as string[] | undefined) ?? []) if (!(r in obj)) fail(`required property missing: ${r}`, `${path}.${r}`);
    const extra = schema["additionalProperties"];
    for (const [k, v] of Object.entries(obj)) {
      if (k in props) errors.push(...validate(props[k]!, v, root, `${path}.${k}`));
      else if (extra === false) fail("unknown property", `${path}.${k}`);
      else if (extra !== undefined && extra !== true) errors.push(...validate(extra as JsonSchema, v, root, `${path}.${k}`));
    }
  }
  return errors;
}

/** The path part of the contract's first server URL, without a trailing slash; "" when there is none. */
export function apiPrefix(openapi: JsonSchema): string {
  const url = ((openapi["servers"] as Array<{ url?: string }> | undefined) ?? [])[0]?.url;
  if (url === undefined) return "";
  return new URL(url, "http://placeholder").pathname.replace(/\/+$/, "");
}

/** The JSON request-body schema of an operation, or null when the contract declares none. */
export function requestSchema(openapi: JsonSchema, op: Operation): JsonSchema | null {
  const paths = (openapi["paths"] as Record<string, Record<string, JsonSchema>> | undefined) ?? {};
  const body = paths[op.path]?.[op.method.toLowerCase()]?.["requestBody"] as JsonSchema | undefined;
  const content = (body?.["content"] as Record<string, { schema?: JsonSchema }> | undefined)?.["application/json"];
  return content?.schema ?? null;
}

const readJson = <T>(file: string | undefined, what: string): T => {
  if (file === undefined || file === "") throw new Error(`${what} path unknown: run the spec through \`aegis messaging exec\``);
  return JSON.parse(readFileSync(file, "utf-8")) as T;
};
export const loadContract = (file = process.env["AEGIS_MESSAGING_CONTRACT"]): MessagingContract => readJson(file, "contract");
export const loadPlan = (file = process.env["AEGIS_MESSAGING_PLAN"]): MessagingPlan => readJson(file, "plan");

// ─ Fake recipients ─

const RESERVED_EMAIL = /@(example\.(com|org|net)|[^@\s]+\.(invalid|test|example))$/i;
const E164 = /^\+[1-9]\d{6,14}$/;

/** Why a fake recipient could reach a person; null when it is safe (RFC 2606 domain, E.164 phone). */
export function fakeRecipientProblem(kind: "email" | "phone", value: string): string | null {
  if (kind === "email") return RESERVED_EMAIL.test(value) ? null : `${value} is not on a reserved domain (example.com/.org/.net, .invalid, .test, .example)`;
  return E164.test(value) ? null : `${value} is not an E.164 number`;
}

const kindOf = (field: string): "email" | "phone" => (/mail/i.test(field) ? "email" : "phone");

function eachRecipient(body: Record<string, unknown>, fields: readonly string[], fn: (holder: Record<string, unknown>, key: string, field: string) => void): void {
  for (const field of fields) {
    const m = /^(\w+)\[\]\.(\w+)$/.exec(field);
    if (m === null) {
      if (field in body) fn(body, field, field);
      continue;
    }
    const list = body[m[1]!];
    if (Array.isArray(list)) for (const item of list) if (item !== null && typeof item === "object" && m[2]! in item) fn(item as Record<string, unknown>, m[2]!, field);
  }
}

/** A copy of `body` with every recipient field replaced by the plan's fake recipients. */
export function toFakeRecipient(body: unknown, plan: MessagingPlan, adapter: MessagingAdapter): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  eachRecipient(copy, adapter.recipientFields, (holder, key, field) => { holder[key] = plan.fakeRecipients[kindOf(field)]; });
  return copy;
}

/** Throws unless every recipient field in `body` holds the plan's fake recipient. */
export function assertOnlyFakes(body: Record<string, unknown>, plan: MessagingPlan, adapter: MessagingAdapter): void {
  eachRecipient(body, adapter.recipientFields, (holder, key, field) => {
    if (holder[key] !== plan.fakeRecipients[kindOf(field)]) throw new Error(`refusing to send: ${field} is not the configured fake recipient`);
  });
}

// ─ Recording stub ─

export type ForcedReply = "400" | "429" | "500" | "timeout";
export interface Recorded {
  operation: "send" | "readBack" | "unknown";
  method: string;
  path: string;
  prefixed: boolean;
  credential: "present" | "absent";
  body: unknown;
  valid: boolean;
  errors: SchemaError[];
}
export interface Stub {
  url: string;
  recorded(): Recorded[];
  reset(): void;
  respondNext(kind: ForcedReply): void;
  stop(): Promise<void>;
}

/** `/events/{message_id}` → /^\/events\/([^/]+)$/ (braces are not escaped, so the placeholder survives the first replace). */
const templateRe = (p: string): RegExp => new RegExp(`^${p.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "([^/]+)")}$`);

async function readBody(req: IncomingMessage): Promise<string> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw;
}

/** A local stand-in for the provider: validates every request against the contract and records it. */
export async function startStub(opts: { plan?: MessagingPlan; contract?: MessagingContract; port?: number } = {}): Promise<Stub> {
  const plan = opts.plan ?? loadPlan();
  const contract = opts.contract ?? loadContract();
  const adapter = adapterFor(plan.adapter);
  const sendSchema = requestSchema(contract.openapi, adapter.operations.send);
  const readRe = templateRe(adapter.operations.readBack.path);
  const prefix = apiPrefix(contract.openapi);
  const log: Recorded[] = [];
  const messages = new Map<string, Record<string, unknown>>();
  const forced: ForcedReply[] = [];
  const held = new Set<ServerResponse>();
  const reply = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

  const server = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      const full = new URL(req.url ?? "/", "http://stub").pathname;
      const prefixed = prefix !== "" && full.startsWith(`${prefix}/`);
      const p = prefixed ? full.slice(prefix.length) : full;
      const method = req.method ?? "GET";
      const credential = adapter.hasAuth(req.headers) ? "present" : "absent";
      let body: unknown = null;
      let parseError = false;
      if (raw !== "") {
        try { body = JSON.parse(raw); } catch { parseError = true; }
      }
      const isSend = method === adapter.operations.send.method && p === adapter.operations.send.path;
      const isRead = method === adapter.operations.readBack.method && readRe.test(p);
      const entry: Recorded = { operation: isSend ? "send" : isRead ? "readBack" : "unknown", method, path: full, prefixed, credential, body, valid: false, errors: [] };
      log.push(entry);
      if (!isSend && !isRead) return reply(res, 404, adapter.errorBody("NOT_FOUND", `no route ${method} ${full}`));
      if (credential === "absent") return reply(res, 401, adapter.errorBody("UNAUTHORIZED", "Invalid or missing API key"));
      if (isRead) {
        const id = readRe.exec(p)![1]!;
        const sent = messages.get(id);
        entry.valid = true;
        return sent === undefined ? reply(res, 404, adapter.errorBody("NOT_FOUND", "unknown message")) : reply(res, 200, adapter.stubReadBack(id, sent));
      }
      const force = forced.shift();
      if (force === "timeout") { held.add(res); return; }
      if (force === "400") return reply(res, 400, adapter.errorBody("VALIDATION_ERROR", "forced by test"));
      if (force === "429") return reply(res, 429, adapter.errorBody("RATE_LIMITED", "forced by test"), { "retry-after": "1" });
      if (force === "500") return reply(res, 500, adapter.errorBody("INTERNAL_ERROR", "forced by test"));
      if (parseError) {
        entry.errors = [{ path: "$", message: "invalid JSON" }];
        return reply(res, 400, adapter.errorBody("INVALID_JSON", "invalid JSON"));
      }
      entry.errors = sendSchema === null ? [] : validate(sendSchema, body, contract.openapi);
      entry.valid = entry.errors.length === 0;
      if (!entry.valid) return reply(res, 400, adapter.errorBody("VALIDATION_ERROR", "invalid request", { fields: entry.errors.map((e) => e.path) }));
      const b = body as Record<string, unknown>;
      const ids = Array.from({ length: adapter.idsForSend(b) }, () => randomUUID());
      for (const id of ids) messages.set(id, b);
      return reply(res, 201, adapter.stubSendResponse(b, ids));
    })();
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? plan.stubPort, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    recorded: () => log.map((r) => ({ ...r })),
    reset: () => { log.length = 0; messages.clear(); forced.length = 0; },
    respondNext: (kind) => { forced.push(kind); },
    stop: () => new Promise<void>((resolve) => {
      for (const r of held) r.destroy();
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

// ─ Live calls (provider dev tenant) ─

/** base + prefix + path, with the prefix present exactly once whether or not the base already ends with it. */
export function liveUrl(base: string, prefix: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const has = prefix === "" || new URL(b).pathname.replace(/\/+$/, "").endsWith(prefix);
  return `${b}${has ? "" : prefix}${path}`;
}

function liveEnv(): { base: string; key: string } {
  const base = process.env["AEGIS_MESSAGING_BASE_URL"];
  const key = process.env["AEGIS_MESSAGING_KEY"];
  if (!base || !key) throw new Error("live layer not configured: no base URL or key (run through `aegis messaging exec`)");
  return { base, key };
}

interface LiveCtx { plan?: MessagingPlan }
const ctxOf = (o: LiveCtx = {}): { plan: MessagingPlan; adapter: MessagingAdapter } => {
  const plan = o.plan ?? loadPlan();
  return { plan, adapter: adapterFor(plan.adapter) };
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function call(method: string, url: string, key: string, adapter: MessagingAdapter, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const [h, v] = adapter.authHeader(key);
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, {
      method,
      headers: { [h]: v, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const parsed = await r.json().catch(() => null);
    if (r.status !== 429 || attempt > 0) return { status: r.status, body: parsed };
    await sleep(Math.min(60, Number(r.headers.get("retry-after") ?? "1") || 1) * 1000);
  }
}

/** POST one body to the provider. Refuses any body whose recipients are not the plan's fakes. */
export async function send(body: Record<string, unknown>, o: LiveCtx & { idempotencyKey?: string } = {}): Promise<{ status: number; body: unknown; messageIds: string[] }> {
  const { plan, adapter } = ctxOf(o);
  assertOnlyFakes(body, plan, adapter);
  const { base, key } = liveEnv();
  const r = await call("POST", liveUrl(base, plan.prefix, adapter.operations.send.path), key, adapter, body, o.idempotencyKey ? { "idempotency-key": o.idempotencyKey } : {});
  return { ...r, messageIds: r.status < 300 ? adapter.messageIds(r.body) : [] };
}

export async function readBack(id: string, o: LiveCtx = {}): Promise<{ status: number; body: unknown }> {
  const { plan, adapter } = ctxOf(o);
  const { base, key } = liveEnv();
  const path = adapter.operations.readBack.path.replace(/\{[^}]+\}/, encodeURIComponent(id));
  return call("GET", liveUrl(base, plan.prefix, path), key, adapter);
}

/** Polls a message until the adapter calls it final, or the timeout passes ("pending"). */
export async function waitFinal(id: string, timeoutSeconds: number, o: LiveCtx = {}): Promise<{ state: FinalState; body: unknown }> {
  const { adapter } = ctxOf(o);
  const until = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const r = await readBack(id, o);
    const state = r.status === 200 ? adapter.finalState(r.body) : "problem";
    if (state !== "pending" || Date.now() >= until) return { state, body: r.body };
    await sleep(2000);
  }
}

/** The adapter's registration probe for one event id; creates nothing. */
export async function probeRegistered(eventId: string, o: LiveCtx = {}): Promise<{ registered: boolean; channel: string | null }> {
  const { plan, adapter } = ctxOf(o);
  const { base, key } = liveEnv();
  const r = await call("POST", liveUrl(base, plan.prefix, adapter.operations.send.path), key, adapter, adapter.probeBody(eventId));
  return adapter.probeResult(r.status, r.body);
}

export class NotSimulatedError extends Error {
  constructor(readonly messageId: string, readonly reason: "live" | "undecided") {
    super(`provider tenant is not simulated (${reason}): message ${messageId}`);
    this.name = "NotSimulatedError";
  }
}

export interface ReplayResult {
  eventId: string;
  status: number;
  messageIds: string[];
  state: FinalState | "rejected";
  simulated: boolean | null;
  detail: unknown;
}

/**
 * Replays recorded bodies to the fake recipients. The first body that yields a message is the preflight: unless the
 * adapter judges it simulated, NotSimulatedError stops the replay before any other send.
 */
export async function replay(bodies: unknown[], o: LiveCtx & { stamp?: string } = {}): Promise<ReplayResult[]> {
  const { plan, adapter } = ctxOf(o);
  const stamp = o.stamp ?? String(Date.now());
  const out: ReplayResult[] = [];
  let preflightDone = false;
  for (const [i, raw] of bodies.entries()) {
    const body = toFakeRecipient(raw, plan, adapter);
    const r = await send(body, { ...o, plan, idempotencyKey: `aegis-replay-${stamp}-${i}` });
    const eventId = adapter.eventIdOf(body);
    if (r.messageIds.length === 0) {
      out.push({ eventId, status: r.status, messageIds: [], state: "rejected", simulated: null, detail: r.body });
      continue;
    }
    for (const id of r.messageIds) {
      const final = await waitFinal(id, plan.dispatchTimeoutSeconds, { ...o, plan });
      const simulated = final.state === "pending" ? null : adapter.isSimulated(final.body);
      if (!preflightDone) {
        if (simulated !== true) throw new NotSimulatedError(id, simulated === null ? "undecided" : "live");
        preflightDone = true;
      }
      out.push({ eventId, status: r.status, messageIds: r.messageIds, state: final.state, simulated, detail: final.body });
    }
  }
  return out;
}

// ── adapters ──

/** Defaults for aegis.config.json#messaging.fakeRecipients (country-specific, so outside the core). */
export const DEFAULT_FAKE_RECIPIENTS = { email: "aegis-probe@example.com", phone: "+6500000000" } as const;

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {});

const COMMSHUB: MessagingAdapter = {
  id: "commshub",
  label: "CommsHub",
  operations: { send: { method: "POST", path: "/events" }, readBack: { method: "GET", path: "/events/{message_id}" } },
  requiredConfig: ["contract.repo", "contract.path", "contract.ref"],
  contractSource: (block) => {
    const c = rec(block["contract"]);
    return { repo: String(c["repo"]), path: String(c["path"]), ref: String(c["ref"]) };
  },
  authHeader: (key) => ["authorization", `Bearer ${key}`],
  hasAuth: (h) => /^Bearer\s+\S+/.test(String(h["authorization"] ?? "")),
  keyPattern: /chk_[A-Za-z0-9_-]{8,}/,
  recipientFields: ["recipient_email", "recipient_phone", "recipients[].recipient_email", "recipients[].recipient_phone"],
  messageIds: (r) => ((rec(r)["scheduled"] as unknown[] | undefined) ?? []).map((s) => rec(s)["message_id"]).filter((x): x is string => typeof x === "string"),
  finalState: (b) => {
    const s = rec(b)["status"];
    if (s === "sent" || s === "delivered") return "done";
    if (s === "scheduled" || s === "processing") return "pending";
    return "problem";
  },
  isSimulated: (b) => rec(b)["simulated"] === true && ((rec(b)["delivery_log"] as unknown[] | undefined) ?? []).every((l) => rec(l)["provider_code"] === "simulated"),
  probeBody: (id) => ({ event_id: id }),
  probeResult: (status, body) => {
    const code = rec(body)["code"];
    if (code === "RECIPIENT_CONTACT_REQUIRED") {
      const ch = rec(rec(body)["details"])["channel"];
      return { registered: true, channel: typeof ch === "string" ? ch : null };
    }
    if (code === "UNKNOWN_EVENT_ID") return { registered: false, channel: null };
    throw new Error(`unexpected probe answer ${status} ${String(code)}`);
  },
  errorBody: (code, message, details) => ({ error: message, code, ...(details === undefined ? {} : { details }) }),
  idsForSend: (b) => (Array.isArray(b["recipients"]) ? b["recipients"].length : 1),
  stubSendResponse: (b, ids) => ({
    event_id: b["event_id"],
    ...(b["external_id"] === undefined ? {} : { external_id: b["external_id"] }),
    scheduled: ids.map((message_id) => ({ event_id: b["event_id"], message_id, scheduled_at: new Date().toISOString(), status: "scheduled" })),
  }),
  stubReadBack: (id, b) => {
    const channel = b["recipient_email"] !== undefined ? "email" : "sms";
    return {
      message_id: id, event_id: b["event_id"], status: "sent", skip_reason: null, channels_allowed: [channel], simulated: true,
      delivery_log: [{ id: randomUUID(), channel, provider_code: "simulated", provider_message_id: `SIM-${id}`, status: "sent", error_code: null, error_message: null }],
    };
  },
  eventIdOf: (b) => String(rec(b)["event_id"] ?? ""),
  staticChecklist: [
    "Sends go to POST {prefix}/events and nothing else (no /messages or other legacy path).",
    "The body uses only keys of the contract's request schema: the schema is strict, an unknown key is 400 VALIDATION_ERROR.",
    "recipient_phone is E.164; recipients[] is never combined with the single recipient_* fields.",
    "Every send that can repeat carries an Idempotency-Key header or an external_id; external_id carries no personal data.",
    "occurs_at (RFC 3339, UTC, ending in Z) is sent for anchor-timed events.",
    "A 201 with an empty scheduled[] or a skipped[] entry is treated as accepted-not-sent, never as delivered.",
    "Every scheduled[].message_id is stored: there is no lookup by external_id, read-back needs the id.",
    "No code waits for a delivery webhook from the provider: it sends none; status is read with GET {prefix}/events/{message_id}.",
    "template_variables carry no full national id (refused with FULL_NRIC_NOT_PERMITTED) and every declared variable is sent non-empty.",
    "429 is retried after Retry-After; other 4xx are not retried.",
  ],
  probeDescription: "POST {prefix}/events with only event_id: RECIPIENT_CONTACT_REQUIRED means registered (details.channel is its channel), UNKNOWN_EVENT_ID means not registered. Creates nothing.",
};

export const ADAPTERS: Readonly<Record<string, MessagingAdapter>> = { commshub: COMMSHUB };

export function adapterFor(id: string): MessagingAdapter {
  const a = ADAPTERS[id];
  if (a === undefined) throw new Error(`no messaging adapter "${id}"; known: ${Object.keys(ADAPTERS).join(", ")}`);
  return a;
}
```

Note: the core references `adapterFor` declared in the adapters section; it is only called at run time, after the module has initialised.

- [ ] **Step 6: Run tests until they pass**

Run: `pnpm -F @aegis/internal-tests exec jest messaging/helper`
Expected: PASS (all describe blocks). Then `pnpm -F @qa/messaging build` → no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/@qa/messaging __internal-tests__/messaging/helper.test.ts __internal-tests__/fixtures/messaging pnpm-lock.yaml
git commit -m "feat(messaging): NEW-07 provider-neutral helper with recording stub, simulated replay and CommsHub adapter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Run-state — config, contract fetch, plan, check, scan-secrets, exec

**Files:**
- Create: `packages/@qa/run-state/src/messaging.ts`
- Modify: `packages/@qa/run-state/src/config.ts`, `index.ts`, `vendor.ts`, `caller.ts`, `packages/@qa/run-state/package.json`
- Test: `__internal-tests__/messaging/run-state.test.ts`; update `run-state-compliance.test.ts:164-171`

**Interfaces:**
- Consumes: `adapterFor`, `ADAPTERS`, `DEFAULT_FAKE_RECIPIENTS`, `fakeRecipientProblem`, `apiPrefix`, `MessagingPlan`, `MessagingContract` (Task 2); `MessagingProfileSchema` (Task 1).
- Produces: `assertMessagingConfig(raw): MessagingConfig | null`; `RunConfig.messaging: MessagingConfig | null`; `fetchContract(root, runId, caller, gh?) → {adapter, sha, file}`; `buildPlan(root, runId) → MessagingPlan`; `checkMessaging(root, runId) → Promise<MessagingCheck>`; `scanSecrets(root, runId, paths) → {hits}`; `messagingEnv(root, runId, env?) → {vars, key: "present"|"absent", cwd}`; `messagingPaths(root, runId) → {dir, contract, plan}`; `VENDORED_HELPERS` includes `"messaging"`; CLI ids `messaging.fetch-contract|plan|check|scan-secrets|exec`.

- [ ] **Step 1: Write the failing test** `__internal-tests__/messaging/run-state.test.ts`

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CLI_COMMANDS, SINGLE_AGENT_COMMANDS, VENDORED_HELPERS, assertCallerAllowed, assertMessagingConfig, buildPlan,
  checkMessaging, fetchContract, messagingEnv, messagingPaths, scanSecrets,
} from '@qa/run-state';

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'messaging', 'commshub-openapi.json'), 'utf-8'));
const BLOCK = { adapter: 'commshub', commshub: { contract: { repo: 'o/r', path: 'docs/api.yaml', ref: 'development' } } };
const RUN = 'RUN-20261006-001';

function sandbox(profileMessaging: object, environment = 'development', extraConfig: object = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-msg-'));
  fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify({ targetProjectRoot: '..', testsDir: '../tests/qa', messaging: BLOCK, ...extraConfig }));
  fs.mkdirSync(path.join(root, 'runs', RUN), { recursive: true });
  fs.writeFileSync(path.join(root, 'runs', RUN, 'run.json'), JSON.stringify({ runId: RUN, cycleType: 'full', environment, status: 'running' }));
  fs.writeFileSync(path.join(root, 'runs', RUN, 'target-profile.json'), JSON.stringify({ hasMessagingIntegration: true, messaging: profileMessaging }));
  return root;
}
const yamlOf = (o: unknown): string => require('yaml').stringify(o);
const fakeGh = (openapi: object) => (args: string[]) => {
  expect(args[0]).toBe('api');
  expect(args[1]).toBe('repos/o/r/contents/docs/api.yaml?ref=development');
  return JSON.stringify({ sha: 'deadbeef', encoding: 'base64', content: Buffer.from(yamlOf(openapi)).toString('base64') });
};

describe('assertMessagingConfig', () => {
  it('fills defaults and accepts the CommsHub block', () => {
    const c = assertMessagingConfig({ messaging: BLOCK })!;
    expect(c).toMatchObject({ adapter: 'commshub', stubPort: 4010, dispatchTimeoutSeconds: 90, fakeRecipients: { email: 'aegis-probe@example.com', phone: '+6500000000' }, env: { baseUrl: null, token: null } });
    expect(assertMessagingConfig({})).toBeNull();
  });
  it('refuses a leftover emailAdapter key and names the replacement', () => {
    expect(() => assertMessagingConfig({ emailAdapter: 'mailpit' })).toThrow(/emailAdapter was removed.*messaging\.adapter/);
  });
  it('refuses an unknown adapter, a bad port, a deliverable fake and a missing adapter key', () => {
    expect(() => assertMessagingConfig({ messaging: { ...BLOCK, adapter: 'mailgun' } })).toThrow(/unknown messaging adapter "mailgun"/);
    expect(() => assertMessagingConfig({ messaging: { ...BLOCK, stubPort: 70000 } })).toThrow(/stubPort/);
    expect(() => assertMessagingConfig({ messaging: { ...BLOCK, fakeRecipients: { email: 'me@gmail.com', phone: '+6500000000' } } })).toThrow(/reserved domain/);
    expect(() => assertMessagingConfig({ messaging: { adapter: 'commshub', commshub: { contract: { repo: 'o/r' } } } })).toThrow(/messaging\.commshub\.contract\.path/);
    expect(() => assertMessagingConfig({ messaging: { ...BLOCK, env: { baseUrl: 'lower', token: null } } })).toThrow(/messaging\.env\.baseUrl/);
  });
});

describe('fetch-contract and plan', () => {
  it('writes contract.json with the sha and builds a plan with the detected env names (Renci-style)', async () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'COMMSHUB_BASE_URL', tokenEnv: 'COMMSHUB_SERVICE_TOKEN' });
    const r = await fetchContract(root, RUN, 'qa-messaging-specialist', fakeGh(FIXTURE.openapi));
    expect(r).toMatchObject({ adapter: 'commshub', sha: 'deadbeef' });
    const saved = JSON.parse(fs.readFileSync(messagingPaths(root, RUN).contract, 'utf-8'));
    expect(saved).toMatchObject({ adapter: 'commshub', repo: 'o/r', ref: 'development', sha: 'deadbeef' });
    expect(fs.readFileSync(path.join(root, 'runs', RUN, 'events.jsonl'), 'utf-8')).toContain('"messaging.contract-fetched"');
    const plan = buildPlan(root, RUN);
    expect(plan).toMatchObject({ adapter: 'commshub', prefix: '/api/v1', env: { baseUrl: 'COMMSHUB_BASE_URL', token: 'COMMSHUB_SERVICE_TOKEN' }, wiringLine: 'COMMSHUB_BASE_URL=http://127.0.0.1:4010/api/v1' });
    expect(plan.staticChecklist.length).toBeGreaterThan(5);
    expect(JSON.parse(fs.readFileSync(messagingPaths(root, RUN).plan, 'utf-8'))).toEqual(plan);
  });

  it('second-target fixture: slec-style names', async () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'COMMHUB_API_URL', tokenEnv: 'COMMHUB_API_KEY' });
    await fetchContract(root, RUN, 'qa-messaging-specialist', fakeGh(FIXTURE.openapi));
    expect(buildPlan(root, RUN).wiringLine).toBe('COMMHUB_API_URL=http://127.0.0.1:4010/api/v1');
    const env = messagingEnv(root, RUN, { COMMHUB_API_URL: 'https://x/api/v1', COMMHUB_API_KEY: 'chk_abcdefghij' });
    expect(env.key).toBe('present');
    expect(env.vars).toMatchObject({ COMMHUB_API_URL: 'https://x/api/v1', AEGIS_MESSAGING_BASE_URL: 'https://x/api/v1', AEGIS_MESSAGING_KEY: 'chk_abcdefghij' });
  });

  it('config env names override the profile; unknown names refuse with the keys to set', async () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: null, tokenEnv: null });
    await fetchContract(root, RUN, 'qa-messaging-specialist', fakeGh(FIXTURE.openapi));
    expect(() => buildPlan(root, RUN)).toThrow(/messaging\.env\.baseUrl and messaging\.env\.token/);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'aegis.config.json'), 'utf-8'));
    cfg.messaging.env = { baseUrl: 'MY_URL', token: 'MY_KEY' };
    fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify(cfg));
    expect(buildPlan(root, RUN).env).toEqual({ baseUrl: 'MY_URL', token: 'MY_KEY' });
  });

  it('a failed fetch writes nothing', async () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' });
    await expect(fetchContract(root, RUN, 'qa-messaging-specialist', () => { throw Object.assign(new Error('x'), { stderr: 'Could not resolve host\nmore' }); }))
      .rejects.toThrow(/contract fetch failed: Could not resolve host/);
    expect(fs.existsSync(messagingPaths(root, RUN).contract)).toBe(false);
  });
});

describe('exec env, check and scan-secrets', () => {
  it('without a key, the plan and contract paths are still injected and the key is absent', () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' });
    const env = messagingEnv(root, RUN, {});
    expect(env.key).toBe('absent');
    expect(env.vars).toHaveProperty('AEGIS_MESSAGING_PLAN', messagingPaths(root, RUN).plan);
    expect(env.vars).not.toHaveProperty('AEGIS_MESSAGING_KEY');
  });
  it('refuses outside development', () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' }, 'testing');
    expect(() => messagingEnv(root, RUN, {})).toThrow(/only in the development environment/);
  });
  it('check reports presence only', async () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' });
    const c = await checkMessaging(root, RUN, { A_KEY: 'chk_abcdefghij' });
    expect(c).toMatchObject({ contract: { present: false, sha: null }, key: 'present', envNames: { baseUrl: 'A_URL', token: 'A_KEY', source: 'profile' } });
    expect(JSON.stringify(c)).not.toContain('chk_abcdefghij');
  });
  it('scan-secrets reports file:line for the key pattern and the key value, never the match', () => {
    const root = sandbox({ provider: 'commshub', baseUrlEnv: 'A_URL', tokenEnv: 'A_KEY' });
    const dir = path.join(root, 'out');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'a.json'), 'ok\n"auth":"Bearer chk_leakedleaked"\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'x\ny\nsecret-value-123\n');
    const r = scanSecrets(root, RUN, [dir], { A_KEY: 'secret-value-123' });
    expect(r.hits).toEqual([
      { file: path.join(dir, 'a.json'), line: 2, kind: 'key-pattern' },
      { file: path.join(dir, 'b.txt'), line: 3, kind: 'key-value' },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/chk_leaked|secret-value/);
  });
});

describe('registration', () => {
  it('vendors the helper and registers the CLI commands with their callers', () => {
    expect(VENDORED_HELPERS).toContain('messaging');
    for (const id of ['messaging.fetch-contract', 'messaging.plan', 'messaging.check', 'messaging.scan-secrets', 'messaging.exec']) expect(CLI_COMMANDS).toContain(id);
    expect(SINGLE_AGENT_COMMANDS['messaging.exec']).toBe('qa-messaging-specialist');
    expect(SINGLE_AGENT_COMMANDS['messaging.check']).toBe('qa-environment-engineer');
    expect(() => assertCallerAllowed('owner', 'messaging.exec')).toThrow(/agent-only/);
    expect(() => assertCallerAllowed('qa-messaging-specialist-spv', 'messaging.scan-secrets')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest messaging/run-state`
Expected: FAIL (missing exports).

- [ ] **Step 3: Implement**

`packages/@qa/run-state/package.json` `dependencies`: add `"@qa/messaging": "workspace:*"`; run `pnpm install`.

`caller.ts`: append to `CLI_COMMANDS` (before `] as const;`):
```ts
  "messaging.fetch-contract",
  "messaging.plan",
  "messaging.check",
  "messaging.scan-secrets",
  "messaging.exec",
```
and replace `SINGLE_AGENT_COMMANDS` with:
```ts
// Agent-only commands that one named agent runs (P2 spec §4.11.3): the environment engineer copies the QA helpers in Env-auth.
// NEW-07: the messaging specialist owns its contract, plan and key; the environment engineer checks the setup.
export const SINGLE_AGENT_COMMANDS: Readonly<Partial<Record<CliCommand, string>>> = {
  "helpers.vendor": "qa-environment-engineer",
  "messaging.fetch-contract": "qa-messaging-specialist",
  "messaging.plan": "qa-messaging-specialist",
  "messaging.exec": "qa-messaging-specialist",
  "messaging.check": "qa-environment-engineer",
};
```

`vendor.ts`: `export const VENDORED_HELPERS = ["test-helpers", "supabase", "messaging"] as const;` and the `parseHelperList` comment example stays. Update `__internal-tests__/helpers-vendor.test.ts:52` expected dir listing to `['messaging.js', 'supabase.js', 'test-helpers.js']`.

`config.ts`: delete `assertMailpitAdapter` and its call; add `import { assertMessagingConfig, type MessagingConfig } from "./messaging.js";`, add `messaging: MessagingConfig | null;` to `RunConfig`, and in `readRunConfig` replace `assertMailpitAdapter(raw["emailAdapter"]);` with `const messaging = assertMessagingConfig(raw);` and add `messaging,` to the returned object.

Create `packages/@qa/run-state/src/messaging.ts`:

```ts
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { appendChained } from "@qa/event-bus";
import { ADAPTERS, DEFAULT_FAKE_RECIPIENTS, adapterFor, apiPrefix, fakeRecipientProblem, type MessagingContract, type MessagingPlan } from "@qa/messaging";
import { parse as parseYaml } from "yaml";
import { readRunConfig } from "./config.js";
import { RunStateError } from "./errors.js";
import { busPath, runDir } from "./paths.js";
import { readRun } from "./run.js";

/** aegis.config.json#messaging after validation (NEW-07). */
export interface MessagingConfig {
  adapter: string;
  stubPort: number;
  dispatchTimeoutSeconds: number;
  fakeRecipients: { email: string; phone: string };
  env: { baseUrl: string | null; token: string | null };
  /** aegis.config.json#messaging.<adapter> */
  adapterBlock: Record<string, unknown>;
}

const bad = (msg: string): never => {
  throw new RunStateError("invalid-input", msg);
};
const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const dig = (o: Record<string, unknown>, dotted: string): unknown => dotted.split(".").reduce<unknown>((cur, k) => obj(cur)[k], o);

/** Validates aegis.config.json#messaging; null when the block is absent. A leftover emailAdapter is refused. */
export function assertMessagingConfig(raw: Record<string, unknown>): MessagingConfig | null {
  if ("emailAdapter" in raw) bad("aegis.config.json#emailAdapter was removed (NEW-07): delete it and configure messaging.adapter instead");
  if (raw["messaging"] === undefined) return null;
  const m = obj(raw["messaging"]);
  const adapter = String(m["adapter"]);
  if (!(adapter in ADAPTERS)) bad(`unknown messaging adapter "${adapter}"; known: ${Object.keys(ADAPTERS).join(", ")}`);
  const int = (key: string, dflt: number, max: number): number => {
    const v = m[key] ?? dflt;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > max) bad(`aegis.config.json#messaging.${key} must be an integer 1-${max}`);
    return v as number;
  };
  const fakes = { ...DEFAULT_FAKE_RECIPIENTS, ...obj(m["fakeRecipients"]) } as { email: string; phone: string };
  for (const kind of ["email", "phone"] as const) {
    const problem = fakeRecipientProblem(kind, String(fakes[kind]));
    if (problem !== null) bad(`aegis.config.json#messaging.fakeRecipients.${kind}: ${problem}`);
  }
  const envBlock = obj(m["env"]);
  const name = (key: "baseUrl" | "token"): string | null => {
    const v = envBlock[key] ?? null;
    if (v !== null && (typeof v !== "string" || !ENV_NAME.test(v))) bad(`aegis.config.json#messaging.env.${key} must be null or an env var name`);
    return v as string | null;
  };
  const adapterBlock = obj(m[adapter]);
  for (const key of adapterFor(adapter).requiredConfig) {
    const v = dig(adapterBlock, key);
    if (typeof v !== "string" || v === "") bad(`aegis.config.json#messaging.${adapter}.${key} is required`);
  }
  return {
    adapter,
    stubPort: int("stubPort", 4010, 65535),
    dispatchTimeoutSeconds: int("dispatchTimeoutSeconds", 90, 3600),
    fakeRecipients: fakes,
    env: { baseUrl: name("baseUrl"), token: name("token") },
    adapterBlock,
  };
}

export function messagingPaths(root: string, runId: string): { dir: string; contract: string; plan: string } {
  const dir = join(runDir(root, runId), "messaging");
  return { dir, contract: join(dir, "contract.json"), plan: join(dir, "plan.json") };
}

function configOf(root: string): MessagingConfig {
  return readRunConfig(root).messaging ?? bad("aegis.config.json has no messaging block (NEW-07)");
}

type Gh = (args: string[]) => string;
const defaultGh: Gh = (args) => execFileSync("gh", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });

/** Fetches the adapter's contract through `gh`, writes runs/<id>/messaging/contract.json and records messaging.contract-fetched. */
export async function fetchContract(root: string, runId: string, caller: string, gh: Gh = defaultGh): Promise<{ adapter: string; sha: string; file: string }> {
  const cfg = configOf(root);
  const src = adapterFor(cfg.adapter).contractSource(cfg.adapterBlock);
  let raw: string;
  try {
    raw = gh(["api", `repos/${src.repo}/contents/${src.path}?ref=${encodeURIComponent(src.ref)}`]);
  } catch (e) {
    const why = String((e as { stderr?: unknown }).stderr ?? (e as Error).message).split("\n")[0]!.trim();
    return bad(`contract fetch failed: ${why}`);
  }
  const res = obj(JSON.parse(raw));
  const sha = String(res["sha"] ?? "");
  let openapi: Record<string, unknown>;
  try {
    openapi = obj(parseYaml(Buffer.from(String(res["content"] ?? ""), "base64").toString("utf-8")));
  } catch (e) {
    return bad(`contract fetch failed: ${src.path} is not YAML (${(e as Error).message})`);
  }
  if (sha === "" || openapi["paths"] === undefined) bad(`contract fetch failed: ${src.repo}/${src.path}@${src.ref} has no OpenAPI paths`);
  const contract: MessagingContract = { adapter: cfg.adapter, ...src, sha, fetchedAt: new Date().toISOString(), openapi };
  const p = messagingPaths(root, runId);
  mkdirSync(p.dir, { recursive: true });
  writeFileSync(p.contract, JSON.stringify(contract, null, 2) + "\n");
  await appendChained({ type: "messaging.contract-fetched", ts: new Date().toISOString(), runId, adapter: cfg.adapter, sha }, busPath(root, runId), { emittedBy: caller, runId });
  return { adapter: cfg.adapter, sha, file: p.contract };
}

interface EnvNames { baseUrl: string; token: string; source: "config" | "profile" }

function envNames(root: string, runId: string, cfg: MessagingConfig): EnvNames {
  if (cfg.env.baseUrl !== null && cfg.env.token !== null) return { baseUrl: cfg.env.baseUrl, token: cfg.env.token, source: "config" };
  let profile: Record<string, unknown> = {};
  try {
    profile = obj(obj(JSON.parse(readFileSync(join(runDir(root, runId), "target-profile.json"), "utf-8")))["messaging"]);
  } catch {
    // an unreadable profile leaves the names unknown
  }
  const baseUrl = cfg.env.baseUrl ?? (profile["baseUrlEnv"] as string | null | undefined) ?? null;
  const token = cfg.env.token ?? (profile["tokenEnv"] as string | null | undefined) ?? null;
  if (baseUrl === null || token === null) bad("messaging env names unknown: the profile detected none; set aegis.config.json#messaging.env.baseUrl and messaging.env.token");
  return { baseUrl: baseUrl!, token: token!, source: cfg.env.baseUrl !== null || cfg.env.token !== null ? "config" : "profile" };
}

/** Builds runs/<id>/messaging/plan.json from the adapter, the config, the profile and the fetched contract. Holds no secret. */
export function buildPlan(root: string, runId: string): MessagingPlan {
  const cfg = configOf(root);
  const p = messagingPaths(root, runId);
  if (!existsSync(p.contract)) bad("no contract for this run: run aegis messaging fetch-contract first");
  const contract = JSON.parse(readFileSync(p.contract, "utf-8")) as MessagingContract;
  const adapter = adapterFor(cfg.adapter);
  const names = envNames(root, runId, cfg);
  const prefix = apiPrefix(contract.openapi);
  const plan: MessagingPlan = {
    adapter: adapter.id,
    stubPort: cfg.stubPort,
    dispatchTimeoutSeconds: cfg.dispatchTimeoutSeconds,
    fakeRecipients: cfg.fakeRecipients,
    env: { baseUrl: names.baseUrl, token: names.token },
    prefix,
    wiringLine: `${names.baseUrl}=http://127.0.0.1:${cfg.stubPort}${prefix}`,
    operations: adapter.operations,
    recipientFields: [...adapter.recipientFields],
    staticChecklist: [...adapter.staticChecklist],
    probe: adapter.probeDescription,
  };
  writeFileSync(p.plan, JSON.stringify(plan, null, 2) + "\n");
  return plan;
}

/** KEY=VALUE lines of the aegis secrets file for the development environment; {} when absent. */
function secretsFile(root: string): Record<string, string> {
  const file = join(root, "secrets", [".env", "development"].join("."));
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m !== null) out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function assertDevelopment(root: string, runId: string): void {
  const env = readRun(root, runId).environment;
  if (env !== "development") bad(`the messaging specialist runs only in the development environment (this run: ${env})`);
}

/** Variables `aegis messaging exec` injects, and whether a key was found. Values never leave this process except to the child. */
export function messagingEnv(root: string, runId: string, env: NodeJS.ProcessEnv = process.env): { vars: Record<string, string>; key: "present" | "absent"; cwd: string } {
  assertDevelopment(root, runId);
  const cfg = configOf(root);
  const names = envNames(root, runId, cfg);
  const file = secretsFile(root);
  const base = env[names.baseUrl] || file[names.baseUrl];
  const key = env[names.token] || file[names.token];
  const p = messagingPaths(root, runId);
  const vars: Record<string, string> = { AEGIS_MESSAGING_PLAN: p.plan, AEGIS_MESSAGING_CONTRACT: p.contract };
  if (base) Object.assign(vars, { [names.baseUrl]: base, AEGIS_MESSAGING_BASE_URL: base });
  if (key) Object.assign(vars, { [names.token]: key, AEGIS_MESSAGING_KEY: key });
  return { vars, key: base && key ? "present" : "absent", cwd: resolve(root, readRunConfig(root).targetProjectRoot) };
}

/** Runs `cmd` in the target root with the messaging variables injected; resolves the child's exit code. */
export function execWithMessaging(root: string, runId: string, cmd: string[]): Promise<{ exitCode: number; key: "present" | "absent" }> {
  if (cmd.length === 0) bad("messaging exec needs a command after --");
  const { vars, key, cwd } = messagingEnv(root, runId);
  return new Promise((done, fail) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd, env: { ...process.env, ...vars }, stdio: "inherit" });
    child.on("error", (e) => fail(new RunStateError("invalid-input", `cannot run ${cmd[0]}: ${e.message}`)));
    child.on("exit", (code) => done({ exitCode: code ?? 1, key }));
  });
}

export interface MessagingCheck {
  contract: { present: boolean; sha: string | null };
  stubPort: { port: number; free: boolean };
  key: "present" | "absent";
  envNames: EnvNames | null;
}

const portFree = (port: number): Promise<boolean> =>
  new Promise((done) => {
    const s = createServer();
    s.once("error", () => done(false));
    s.listen(port, "127.0.0.1", () => s.close(() => done(true)));
  });

/** Setup facts for the environment engineer: presence only, never a value. */
export async function checkMessaging(root: string, runId: string, env: NodeJS.ProcessEnv = process.env): Promise<MessagingCheck> {
  const cfg = configOf(root);
  const p = messagingPaths(root, runId);
  const sha = existsSync(p.contract) ? String(obj(JSON.parse(readFileSync(p.contract, "utf-8")))["sha"] ?? "") || null : null;
  let names: EnvNames | null = null;
  let key: "present" | "absent" = "absent";
  try {
    names = envNames(root, runId, cfg);
    const file = secretsFile(root);
    key = env[names.token] || file[names.token] ? "present" : "absent";
  } catch {
    names = null;
  }
  return { contract: { present: sha !== null, sha }, stubPort: { port: cfg.stubPort, free: await portFree(cfg.stubPort) }, key, envNames: names };
}

function walk(p: string, out: string[]): void {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) if (e !== "node_modules" && e !== ".git") walk(join(p, e), out);
  } else if (st.isFile() && st.size <= 5 * 1024 * 1024) out.push(p);
}

/** file:line of every key-pattern or key-value occurrence under `paths`; the match itself is never returned. */
export function scanSecrets(root: string, runId: string, paths: string[], env: NodeJS.ProcessEnv = process.env): { hits: Array<{ file: string; line: number; kind: "key-pattern" | "key-value" }> } {
  const cfg = configOf(root);
  const pattern = adapterFor(cfg.adapter).keyPattern;
  let value: string | undefined;
  try {
    const names = envNames(root, runId, cfg);
    value = env[names.token] || secretsFile(root)[names.token];
  } catch {
    value = undefined;
  }
  const files: string[] = [];
  for (const p of paths) if (existsSync(p)) walk(resolve(p), files);
  const hits: Array<{ file: string; line: number; kind: "key-pattern" | "key-value" }> = [];
  for (const file of files.sort()) {
    readFileSync(file, "utf-8").split("\n").forEach((text, i) => {
      if (pattern.test(text)) hits.push({ file, line: i + 1, kind: "key-pattern" });
      else if (value !== undefined && value.length >= 8 && text.includes(value)) hits.push({ file, line: i + 1, kind: "key-value" });
    });
  }
  return { hits };
}
```

`index.ts`: add `export * from "./messaging.js";` after `export * from "./vendor.js";`.

`run-state-compliance.test.ts:164-171`: replace the `emailAdapter: 'gmail'` expectation with `emailAdapter: 'mailpit'` refused with `/emailAdapter was removed/`.

- [ ] **Step 4: Run tests**

Run: `pnpm -F @aegis/internal-tests exec jest messaging/run-state run-state-compliance helpers-vendor`
Expected: PASS. If `helpers-vendor` checks every vendored file is dependency-free or brand-clean, `messaging` must satisfy it as written; fix the helper, not the test.

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/run-state __internal-tests__ pnpm-lock.yaml
git commit -m "feat(run-state): NEW-07 messaging config, contract fetch, plan, check, scan-secrets and exec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: CLI — `aegis messaging …`, `init`/`reconfigure --messaging`

**Files:**
- Create: `apps/cli/src/commands/messaging.ts`
- Modify: `apps/cli/src/program.ts`, `apps/cli/src/commands/init.ts`, `apps/cli/src/commands/reconfigure.ts`, `apps/cli/package.json` (add `"@qa/messaging": "workspace:*"`)
- Test: update `__internal-tests__/cli-envelope.test.ts:55-67, 140-158`; new cases in `__internal-tests__/messaging/cli.test.ts`

**Interfaces:**
- Consumes: Task 3 functions; `action`, `context`, `runIdFor` from `./_io.js`; `assertCallerAllowed`.

- [ ] **Step 1: Write the failing test** `__internal-tests__/messaging/cli.test.ts`

```ts
import { buildProgram } from '../../apps/cli/src/program';

describe('aegis messaging (NEW-07)', () => {
  it('registers the five subcommands', () => {
    const messaging = buildProgram().commands.find((c) => c.name() === 'messaging')!;
    expect(messaging.commands.map((c) => c.name()).sort()).toEqual(['check', 'exec', 'fetch-contract', 'plan', 'scan-secrets']);
  });
  it('init and reconfigure offer --messaging with the adapter ids, and no --email', () => {
    const p = buildProgram();
    for (const name of ['init', 'reconfigure']) {
      const cmd = p.commands.find((c) => c.name() === name)!;
      expect(cmd.options.map((o) => o.long)).not.toContain('--email');
      expect(cmd.options.find((o) => o.long === '--messaging')!.argChoices).toEqual(['commshub']);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @aegis/internal-tests exec jest messaging/cli`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/cli/src/commands/messaging.ts`:
```ts
import { Command } from "commander";
import { assertCallerAllowed, buildPlan, checkMessaging, execWithMessaging, fetchContract, scanSecrets } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

/** NEW-07: the messaging specialist's contract, plan, key and secret scan. Output never holds a key value. */
export function messagingCommand(): Command {
  const messaging = new Command("messaging").description("Messaging-integration testing: provider contract, plan, live key");

  messaging
    .command("fetch-contract")
    .description("Fetch the provider contract named in aegis.config.json#messaging into runs/<id>/messaging/contract.json")
    .option("--run <runId>", "run id (default: the active run)")
    .action(action(async (o: { run?: string }) => {
      const ctx = context();
      assertCallerAllowed(ctx.caller, "messaging.fetch-contract");
      return fetchContract(ctx.root, runIdFor(ctx, o.run), ctx.caller);
    }));

  messaging
    .command("plan")
    .description("Write and print runs/<id>/messaging/plan.json: operations, env names, stub wiring line, static checklist")
    .option("--run <runId>", "run id (default: the active run)")
    .action(action((o: { run?: string }) => {
      const ctx = context();
      assertCallerAllowed(ctx.caller, "messaging.plan");
      return buildPlan(ctx.root, runIdFor(ctx, o.run));
    }));

  messaging
    .command("check")
    .description("Report contract, stub port and key presence (never a value)")
    .option("--run <runId>", "run id (default: the active run)")
    .action(action((o: { run?: string }) => {
      const ctx = context();
      assertCallerAllowed(ctx.caller, "messaging.check");
      return checkMessaging(ctx.root, runIdFor(ctx, o.run));
    }));

  messaging
    .command("scan-secrets")
    .description("Report file:line of any provider key in the given paths (never the match)")
    .option("--run <runId>", "run id (default: the active run)")
    .argument("<paths...>", "files or directories to scan")
    .action(action((paths: string[], o: { run?: string }) => {
      const ctx = context();
      assertCallerAllowed(ctx.caller, "messaging.scan-secrets");
      return scanSecrets(ctx.root, runIdFor(ctx, o.run), paths);
    }));

  messaging
    .command("exec")
    .description("Run a command in the target root with the plan, contract and (when found) the live key injected")
    .option("--run <runId>", "run id (default: the active run)")
    .argument("<command...>", "the command, after --")
    .action(action(async (cmd: string[], o: { run?: string }) => {
      const ctx = context();
      assertCallerAllowed(ctx.caller, "messaging.exec");
      const r = await execWithMessaging(ctx.root, runIdFor(ctx, o.run), cmd);
      process.exitCode = r.exitCode;
      return r;
    }));

  return messaging;
}
```
`program.ts`: `import { messagingCommand } from "./commands/messaging.js";` and add `messagingCommand()` after `helpersCommand()` in the list.

`init.ts`: replace line 15 option with
```ts
    .addOption(new Option("--messaging <adapter>", "messaging provider adapter").choices(Object.keys(ADAPTERS)).default("commshub"))
```
(import `ADAPTERS` from `@qa/messaging`); `InitOptions.email: string` → `messaging: string`; in the template object replace `emailAdapter: opts.email,` with
```ts
    messaging: {
      adapter: opts.messaging,
      stubPort: 4010,
      dispatchTimeoutSeconds: 90,
      fakeRecipients: { email: "aegis-probe@example.com", phone: "+6500000000" },
      env: { baseUrl: null, token: null },
      commshub: { contract: { repo: "WerkDone-Pte-Ltd/wd-commhub", path: "docs/08-commhub-events-api.yaml", ref: "development" } },
    },
```
and delete `mailpit: { smtp: 1025, http: 8025 },`. Where the init template builds `environments`, it reads `DEFAULT_ENVIRONMENT_SPECIALISTS` already; no change.

`reconfigure.ts`: import `assertMessagingConfig` instead of `assertMailpitAdapter`, `ADAPTERS` from `@qa/messaging`; replace the `--email` option and its comment with
```ts
    // NEW-07: the messaging adapter; a config still carrying emailAdapter is refused until it is removed.
    .addOption(new Option("--messaging <adapter>", "change the messaging provider adapter").choices(Object.keys(ADAPTERS)))
```
replace the two lines handling `opts.email` with
```ts
      if (opts.messaging) config.messaging = { ...(config.messaging as Record<string, unknown> | undefined), adapter: opts.messaging };
      // A stale emailAdapter or an invalid messaging block is refused, not rewritten.
      assertMessagingConfig(config);
```
and `ReconfigureOptions.email` → `messaging?: string`.

`cli-envelope.test.ts`: in the `argChoices` cases replace `--email`/`['mailpit']` with `--messaging`/`['commshub']` and `gmail` with `mailgun` ("Allowed choices are commshub"); the reconfigure stale-config case writes `emailAdapter: 'mailpit'` and expects `/emailAdapter was removed/`; the repair case deletes `emailAdapter` from the file and runs `reconfigure --messaging commshub`, expecting success.

- [ ] **Step 4: Run tests**

Run: `pnpm -F @aegis/internal-tests exec jest messaging/cli cli-envelope agent-cli-callers cli-refused` then `pnpm -F aegis-cli build` (or `pnpm build`).
Expected: PASS; build clean.

- [ ] **Step 5: Commit**

```bash
git add apps/cli __internal-tests__ pnpm-lock.yaml
git commit -m "feat(cli): NEW-07 aegis messaging commands; init and reconfigure take --messaging

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Path guard — role row, SPV, CLI-only `messaging/`

**Files:**
- Modify: `packages/@qa/path-guard/src/roles.ts`, `packages/@qa/path-guard/src/guard.ts`
- Test: `__internal-tests__/messaging/path-guard.test.ts` (new); update `path-guard.test.ts:101-104`

- [ ] **Step 1: Write the failing test**

```ts
import { roleOf, roleWritable } from '@qa/path-guard';

const p = { aegisRoot: '/r/aegis', targetRoot: '/r', testsDir: '/r/tests/qa', runDir: '/r/aegis/runs/RUN-20261006-001' };
describe('messaging roles (NEW-07)', () => {
  it('the specialist writes its specs, not the vendored helper or the CLI-written run files', () => {
    expect(roleOf('qa-email-specialist')).toBeUndefined();
    expect(roleOf('qa-messaging-specialist')).toMatchObject({ kind: 'specialist', spv: 'qa-messaging-specialist-spv', mutatesEnvIn: 'any' });
    expect(roleOf('qa-messaging-specialist-spv')).toMatchObject({ kind: 'spv', writes: [] });
    expect(roleWritable('qa-messaging-specialist', '/r/tests/qa/messaging/otp.messaging.spec.ts', p)).toBe(true);
    expect(roleWritable('qa-messaging-specialist', '/r/tests/qa/support/messaging.ts', p)).toBe(false);
    expect(roleWritable('qa-messaging-specialist', '/r/aegis/runs/RUN-20261006-001/messaging/plan.json', p)).toBe(false);
  });
});
```
plus a case in the guard tests' style asserting that a main-thread or agent `Write` to `runs/RUN-…/messaging/contract.json` is denied as CLI-only (copy the nearest existing `integrity/` CLI-only case in `path-guard-guard.test.ts` and change the path).

- [ ] **Step 2: Run to verify it fails** — `pnpm -F @aegis/internal-tests exec jest messaging/path-guard` → FAIL.

- [ ] **Step 3: Implement**

`roles.ts`: replace `specialist("email", ["{testsDir}/email/**", "{testsDir}/support/mailpit.ts"]),` with `specialist("messaging", ["{testsDir}/messaging/**"]),` (alphabetical position: after `feature-flag`... keep the list order the file uses: insert after `exploratory`/before `performance` is fine, but keep `email`'s old slot to minimise diff). In `SPVS` replace `"qa-email-specialist-spv"` with `"qa-messaging-specialist-spv"`.

`guard.ts`: add `"messaging"` to `CLI_ONLY_RUN_DIRS`, add `|(^|\/)messaging\/` to `DYNAMIC_CLI_ONLY` after `(^|\/)integrity\/`, and add the run glob for `messaging/**` wherever `CLI_ONLY_RUN_GLOBS` lists `integrity/**` (search: `grep -n "integrity" packages/@qa/path-guard/src/guard.ts`). `path-guard.test.ts:101-104`: `forbiddenSpecialists: ['qa-messaging-specialist']`, `'messaging'` → `specialist-blocked`.

- [ ] **Step 4: Run** `pnpm -F @aegis/internal-tests exec jest path-guard role-table messaging/path-guard` → PASS (role-table needs Task 6's agent files to exist; if `role-table` fails only on "one row per agent file", continue: Task 6 fixes it).

- [ ] **Step 5: Commit**

```bash
git add packages/@qa/path-guard __internal-tests__
git commit -m "feat(path-guard): NEW-07 messaging specialist row, SPV, CLI-only run messaging dir

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Agents, pipeline, model policy, skills

**Files:**
- Create: `.claude/agents/tier2-specialist/qa-messaging-specialist.md`, `.claude/agents/spv/qa-messaging-specialist-spv.md`
- Delete: `.claude/agents/tier2-specialist/qa-email-specialist.md`, `.claude/agents/spv/qa-email-specialist-spv.md`
- Move: `agent-memory/qa-email-specialist/` → `agent-memory/qa-messaging-specialist/` (`git mv`)
- Modify: `.claude/pipeline.yaml`, `.claude/model-policy.yaml`, `.claude/agents/crosscutting/qa-context-scanner.md`, `.claude/agents/tier1-phase/qa-environment-engineer.md`, `qa-test-designer.md`, `qa-test-executor.md`, `.claude/agents/spv/qa-test-executor-spv.md`, `.claude/agents/tier1-phase/qa-closure-reporter.md`, `.claude/skills/qa-run-specialist/SKILL.md`, `.claude/skills/qa-smoke/SKILL.md`, `.claude/skills/qa-dry-run/SKILL.md`
- Test: rewrite the email blocks of `__internal-tests__/p2b-profiles.test.ts` (lines 94-307) as messaging blocks; un-skip and rewrite `target-profile.test.ts:77-101`

- [ ] **Step 1: Write the failing tests** — replace the two describes `the email specialist detects…` and `Mailpit is the only inbox` in `p2b-profiles.test.ts` with:

```ts
describe('the messaging specialist detects, no-ops, and stays project-agnostic (NEW-07)', () => {
  const FILE = '.claude/agents/tier2-specialist/qa-messaging-specialist.md';
  const SPV = '.claude/agents/spv/qa-messaging-specialist-spv.md';
  const md = (): string => read(FILE);

  it('reports a no-op exactly when the profile shows no messaging integration', () => {
    const process = section(md(), 'Process');
    expect(process).toMatch(/1\. \*\*Check for a messaging integration\.\*\* Read `runs\/\{runId\}\/target-profile\.json#hasMessagingIntegration`\. Only the literal boolean `false` in a readable profile permits a no-op: emit `specialist\.no-op`[^\n]*release the task `done`[^\n]*missing, unreadable or schema-invalid, or `hasMessagingIntegration` is not a boolean, emit `execution\.blocked`[^\n]*release the task `failed`/);
    expect(section(md(), 'Quality Standards \\(SPV rejects if violated\\)')).toContain('A `specialist.no-op` without a readable `hasMessagingIntegration: false`');
    expect(section(md(), 'Quality Standards \\(SPV rejects if violated\\)').split('\n').filter((l) => /no-op/.test(l))).toHaveLength(1);
    expect(section(md(), 'Your Role')).toContain('Never report a no-op while `hasMessagingIntegration` is true.');
  });

  it('worker and reviewer name no provider, env var, key format, country or project (D10)', () => {
    for (const f of [FILE, SPV]) expect(read(f)).not.toMatch(/commshub|COMMS?HUB_|chk_|\+65|renci|slec|mailpit|gmail/i);
  });

  it('drives every provider detail through the CLI', () => {
    const process = section(md(), 'Process');
    for (const cmd of ['aegis messaging fetch-contract', 'aegis messaging plan', 'aegis messaging exec', 'aegis messaging scan-secrets']) expect(process).toContain(cmd);
    const c = contractOf(md());
    expect(paths(c.reads)).toEqual(expect.arrayContaining(['{run}/target-profile.json', '{run}/messaging/plan.json', '{run}/messaging/contract.json']));
    expect(paths(c.reads).some((x) => x.startsWith('secrets/'))).toBe(false);
    expect(paths(c.writes)).toContain('{tests}/qa/messaging/{flow}.messaging.spec.ts');
    expect(c.emits.map((e) => e.event)).toEqual(expect.arrayContaining(['specialist.no-op', 'execution.blocked', 'messaging.live-preflight']));
  });

  it('the reviewer checks the preflight, the fakes and the secret scan', () => {
    const checklist = section(read(SPV), 'Review Checklist');
    expect(checklist).toContain('A `specialist.no-op` is legitimate only when `target-profile.json` is readable and `hasMessagingIntegration` is `false`');
    expect(checklist).toContain('aegis messaging scan-secrets');
    expect(checklist).toContain('messaging.fakeRecipients');
    expect(checklist).toMatch(/preflight/);
    expect(paths(contractOf(read(SPV)).reads)).toEqual(expect.arrayContaining(['{run}/target-profile.json', '{run}/messaging/plan.json']));
  });

  it('only the CLI writes the vendored helper', () => {
    const p = { aegisRoot: '/r/aegis', targetRoot: '/r', testsDir: '/r/tests/qa', runDir: '/r/aegis/runs/RUN-20261006-001' };
    for (const a of ['qa-messaging-specialist', 'qa-ui-specialist', 'qa-environment-engineer']) expect(roleWritable(a, '/r/tests/qa/support/messaging.ts', p)).toBe(false);
  });
});

describe('Mailpit is gone (NEW-07)', () => {
  it('no agent, skill, CLI source, config or environment doc names Mailpit', () => {
    const files = tracked().filter((f) => /^(\.claude\/|apps\/cli\/src\/|packages\/@qa\/[^/]+\/src\/|docs\/D\d|HANDBOOK\/|secrets\/README|CLAUDE\.md|aegis\.config\.json)/.test(f));
    expect(files.filter((f) => /mailpit/i.test(read(f)))).toEqual([]);
    expect(read('docs/D12-environments-overview.md')).toContain('| Messaging testing | ✓ (stub + provider dev) | ✗ | ✗ | ✗ |');
  });
  it('the environment engineer checks messaging setup only when the profile shows an integration', () => {
    expect(read('.claude/agents/tier1-phase/qa-environment-engineer.md')).toContain('If `target-profile.json#hasMessagingIntegration` is true: run `aegis messaging check`');
  });
});
```
Also update the two cross-worker tests (`both specialists name their profile field…`, `both workers never no-op…`) to use the messaging file and `hasMessagingIntegration` instead of the email file and `hasEmailFlows`, delete `worker and reviewer state one recipient rule…` and the email half of `both SPVs judge a no-op…` (keep its realtime assertions), and delete the `the helper in the prose works against the Mailpit HTTP API` block. In `designer` assertions (≈ line 223) replace the Email sentence with the new designer sentence from Step 3.

- [ ] **Step 2: Run** `pnpm -F @aegis/internal-tests exec jest p2b-profiles` → FAIL (files missing).

- [ ] **Step 3: Write the agents**

`.claude/agents/tier2-specialist/qa-messaging-specialist.md` (the `model:` line is stamped in Step 5; write `model: claude-sonnet-5` as the realtime specialist has):

````markdown
---
name: qa-messaging-specialist
description: Tests a target's integration with its messaging provider in three layers — the client code against the provider's published contract, a local recording stub the app is pointed at, and a replay of the recorded requests to the provider's development tenant with fake recipients and simulated delivery. Runs as no-op when the target profile shows no messaging integration (hasMessagingIntegration false). Forbidden outside the development environment. Dispatched by qa-test-executor for test cases carrying testTechnique: Messaging.
modelTier: implementation
model: claude-sonnet-5
tools: [Read, Write, Edit, Bash]
knowledge_refs:
  - knowledge/synthesis/api-testing.md
  - knowledge/synthesis/playwright-patterns.md
  - agent-memory/qa-messaging-specialist/lessons.md
---

# QA Messaging Specialist

## Your Role

You test how the target sends messages (email, SMS, chat) through its messaging provider. The target never delivers a message itself: it calls the provider's API. You check that call three ways: the client code against the provider's contract, the requests the running app actually sends to a local stub, and the same requests replayed to the provider's development tenant, where delivery is simulated and every recipient is a configured fake.

Everything about the provider, its paths, its key and this target's env var names comes from `aegis messaging plan`. You never write a provider name, an env var name, a key or a real recipient into a spec, a note or a report.

If `target-profile.json#hasMessagingIntegration` is false (the scanner found no messaging provider the target calls), emit `specialist.no-op`, then submit your work report and release the task `done` (Task Protocol steps 3–4). A no-op is a result, not a failed task. Never report a no-op while `hasMessagingIntegration` is true.

You run only in the `development` environment; the CLI refuses the messaging commands anywhere else.

## Inputs

- Test case batch (`testTechnique: Messaging`)
- `runs/{runId}/target-profile.json` — `hasMessagingIntegration`, `messaging.provider`, `messaging.baseUrlEnv`, `messaging.tokenEnv`
- `runs/{runId}/messaging/contract.json` — the provider contract, written by `aegis messaging fetch-contract`
- `runs/{runId}/messaging/plan.json` — written by `aegis messaging plan`: operations, recipient fields, static checklist, stub wiring line, fake recipients
- `aegis/aegis.config.json` — `messaging.stubPort`, `messaging.dispatchTimeoutSeconds`, `messaging.fakeRecipients`
- `tests/qa/support/messaging.ts` — the vendored helper (`startStub`, `replay`, `probeRegistered`); the environment engineer copies it, you never edit it
- `agent-memory/qa-messaging-specialist/lessons.md`

## Outputs

- `tests/qa/messaging/{flow}.messaging.spec.ts` — one spec file per messaging flow
- `runs/{runId}/cases/{TC-ID}-result.json` — per TC: layer results, findings with file:line, live message ids

## Process

1. **Check for a messaging integration.** Read `runs/{runId}/target-profile.json#hasMessagingIntegration`. Only the literal boolean `false` in a readable profile permits a no-op: emit `specialist.no-op` with the reason `target-profile.json#hasMessagingIntegration is false`, then submit your work report and release the task `done` (Task Protocol steps 3–4). When the profile is missing, unreadable or schema-invalid, or `hasMessagingIntegration` is not a boolean, emit `execution.blocked` with the reason, submit your work report and release the task `failed`: unknown never means skip.

2. **Fetch the contract and the plan.** Run `aegis messaging fetch-contract`, then `aegis messaging plan`, and read `runs/{runId}/messaging/plan.json`. A refusal from either (no adapter for the provider, contract unreachable, env names unknown) → emit `execution.blocked` with the refusal text, submit your work report and release the task `failed`.

3. **Static layer.** Find the target's messaging client and every call site; start from the files that read the plan's `env.baseUrl` and `env.token`. Check, citing file:line and the contract field each time: the send and read-back paths match the contract with the API prefix present exactly once across base URL and path; request keys are a subset of the contract's request schema; required fields are always set; the recipient field matches the channel; the auth header is the one the plan states; every send carries a dedupe key; the success response is parsed for message ids, including an empty or partial result; 4xx is not retried, 429 and 5xx are retried or queued; every template variable is declared and sent non-empty; no full national id or other sensitive personal data travels in a variable; no code waits for provider callbacks the contract does not define. Then answer every item of the plan's `staticChecklist`. Record the inventory of event ids, their variables and the flows that fire them in your work report.

4. **Explore in the sandbox before writing any final spec.** Prototype each flow trigger and its stub assertions in `sandbox/{date}-{slug}/` first, then port the validated version to `tests/qa/messaging/{flow}.messaging.spec.ts`. Emit `sandbox.explored { specialist, artifactPath, targetSpecRef }` for every spec you commit.

5. **Stub layer.** Run specs with `aegis messaging exec -- npx playwright test tests/qa/messaging`. Each spec starts the stub with `startStub()`, triggers one flow through the app's API (Playwright `APIRequestContext`) and asserts on `stub.recorded()`: the operation and path, credential `present`, `valid === true`, the event id expected for the flow, and complete non-empty variables. Failure-handling specs call `stub.respondNext('400' | '429' | '500' | 'timeout')` and assert the app's behaviour: no retry on 400, retry or queue on 5xx and 429, and the user-facing call still answers. The first spec is a wiring probe: when the app sends nothing to the stub within 30 seconds, emit `execution.blocked` "target not pointed at the stub" with the plan's `wiringLine`, submit your work report and release the task `failed`.

6. **Live layer.** Still under `aegis messaging exec`. When the exec output says `key: absent`, record the live layer as "not run: no key" in every TC result; the static and stub results stand. Otherwise: call `probeRegistered` for every event id from step 3 (an unregistered id is one finding; a channel that does not match the recipient field the code sends is one finding), then `replay()` the bodies the stub recorded. The helper swaps every recipient for the configured fakes and refuses any other. The first replayed message is the preflight: emit `messaging.live-preflight { adapter, simulated }`; when `replay()` throws `NotSimulatedError`, stop all live work, record a Sev1 finding "provider tenant is not simulated" with the message id, and continue with the static and stub results. A result whose `state` is `problem` or `pending`, or `rejected`, is a finding with its detail.

7. **Scan before you submit.** Run `aegis messaging scan-secrets` over `tests/qa/messaging`, your result files and your work-report draft. Any hit is removed before you submit. Write results per TC to `runs/{runId}/cases/{TC-ID}-result.json`. Your work report lists the adapter, the contract sha, the env names in force, the layers run and not run with reasons, and every live message id.

## Quality Standards (SPV rejects if violated)

- A `specialist.no-op` without a readable `hasMessagingIntegration: false`, or messaging tests skipped without a `specialist.no-op` when that flag is false
- A static finding without file:line and a contract field, or a `staticChecklist` item left unanswered
- A stub spec that does not assert operation, credential presence, validity, event id and variables
- A live send before a simulated preflight, or a live recipient other than the configured fakes
- A key, an auth header value or a real recipient in any spec, result, evidence or work report
- A layer reported as passed when it did not run
- Tests run outside the development environment
- A committed spec contains zero assertions (every spec must carry at least one assertion that can fail — no assertion-free "smoke" scripts)

## Task Protocol

Prefix every command with your name, for example `AEGIS_AGENT=qa-messaging-specialist pnpm aegis task claim --task <taskId>`. Your dispatch brief names the task id (`T-<phase>-<n>`).

1. **Claim before any other work:** `aegis task claim --task <taskId>`. A refusal — stop requested, run not running, environment forbids you, specialist cap reached, or the task is not yours — ends your turn: report the refusal text to your dispatcher and change nothing. A refusal saying `already-claimed` means you hold the task from an interrupted dispatch: continue the work without claiming it again.
2. **Record events through the CLI.** Append every event under "Events You Emit" with `aegis event append --type <type> --json '<fields>'`; the CLI adds `ts`, `runId` and your name. You never write the run's event log yourself, and you never append `run.*`, `task.*`, `gate.*`, `review.*`, `integrity.*` or `escalation.*` events, nor `artifact.created`, `env.specialist-blocked`, `preflight.failed` or `messaging.contract-fetched`: the commands that own them record those.
3. **Submit your work report.** Pipe one `WorkReportSchema` object into `aegis work-report submit --file /dev/stdin`: `id` (`WR-<taskId>`), `taskId`, `agent` (`qa-messaging-specialist`), `startedAt` and `completedAt` (UTC ISO strings ending in `Z`), `summary` (20–300 characters), `approach` (10–500 characters), `decisions[]` (each `{choice, reason, alternativesConsidered[]}`), `uncertainties[]` (each `{topic, impact, wouldUnblockBy?}`, impact `low`, `medium` or `high`), `lessonsApplied[]` (lesson ids from your lessons file; empty when none applied, with the reason in `approach`), `evidence[]` and `artifactsProduced[]`. The CLI stores it as the next attempt; you never write report files yourself.
4. **Release:** `aegis task release --task <taskId> --result done`. Use `--result failed` only when you could not complete the task (a missing input, an unreachable environment, a refused tool): it opens an owner escalation. Failing tests and findings are results, not a failed task — record them and release `done`. The release is refused until this claim has a work report.
5. **Rework.** Your SPV reviews only after the release. When it requests changes the CLI reopens the task, except on the third rejection in a round, which escalates to the owner instead (the CLI does that, not you). After a reopen your dispatcher re-dispatches you with the `CorrectiveInstruction`: claim the same task id again and repeat steps 1–4.

## Events You Emit

- `test.passed` — per passing TC: `{testCaseId, specialist}`
- `test.failed` — per failing TC: `{testCaseId, specialist, firstAssertionFailure, evidencePaths}`
- `specialist.no-op` — `{ specialist, reason }`, when `target-profile.json#hasMessagingIntegration` is false
- `execution.blocked` — `{ reason }`, when the profile is missing or invalid, the contract or plan is refused, or the app is not pointed at the stub; followed by the work report and a `failed` release
- `sandbox.explored` — one per spec: `{specialist, artifactPath, targetSpecRef}`
- `messaging.live-preflight` — `{adapter, simulated}`, once per live layer, after the first replayed message

## Contract (machine-checked)

```yaml
# Static index of the prose above for the alignment checker — not instructions; the prose governs. Tokens: {run}=runs/{runId}, {tests}=<target>/tests, {target}=target app root, {aegis}=this repo.
contract: 1
phase: execution
dispatchedBy: [qa-test-executor, qa-run-specialist]
reviewedBy: qa-messaging-specialist-spv
reads:
  - "{run}/target-profile.json"
  - "{run}/messaging/contract.json"
  - "{run}/messaging/plan.json"
  - "{tests}/qa/support/messaging.ts"
  - aegis.config.json
  - agent-memory/qa-messaging-specialist/lessons.md
writes:
  - "{tests}/qa/messaging/{flow}.messaging.spec.ts"
  - "{run}/cases/{TC-ID}-result.json"
  - "sandbox/{date}-{slug}/**"
emits:
  - {event: test.passed, via: append}
  - {event: test.failed, via: append}
  - {event: specialist.no-op, via: append}
  - {event: execution.blocked, via: append}
  - {event: sandbox.explored, via: append}
  - {event: messaging.live-preflight, via: append}
  - {event: messaging.contract-fetched, via: "cli:messaging.fetch-contract"}
awaits: []
cli: [task.claim, work-report.submit, task.release, event.append, messaging.fetch-contract, messaging.plan, messaging.exec, messaging.scan-secrets]
runs: []
dispatches: []
config:
  - aegis.config.json#messaging.stubPort
  - aegis.config.json#messaging.dispatchTimeoutSeconds
  - aegis.config.json#messaging.fakeRecipients
```
````

`.claude/agents/spv/qa-messaging-specialist-spv.md` — copy the frontmatter shape, `## Review Process`, `## Verdict` and `## Task Protocol` sections from `.claude/agents/spv/qa-realtime-specialist-spv.md` (read it first), changing the agent names to `qa-messaging-specialist(-spv)`, `modelTier: validation` / `model:` as the realtime SPV has, the description to "Reviews qa-messaging-specialist work reports. Validates the static contract check, stub-spec assertions, the simulated preflight before any live send, fake-only recipients, the secret scan, no-op legitimacy and the development-only rule. Emits CorrectiveInstruction on findings.", and the `## Inputs` to the specialist's work reports, `target-profile.json`, `runs/{runId}/messaging/plan.json`, `runs/{runId}/messaging/contract.json`, `tests/qa/messaging/**`, `aegis.config.json`, `events.jsonl` and the specialist's lessons file. The `## Review Checklist` is exactly:

```markdown
## Review Checklist

1. **Contract recorded.** The work report names the adapter, the contract repo, path, ref and sha, and the static layer ran; otherwise requested-changes.
2. **Static findings cite their source.** Every static finding cites file:line and a contract field, and every item of the `staticChecklist` in `runs/{runId}/messaging/plan.json` is answered; otherwise requested-changes.
3. **Stub specs assert the request.** Every `*.messaging.spec.ts` asserts the operation, credential `present`, `valid === true`, the event id and the variables; an assertion-free spec = requested-changes.
4. **Failure handling covered.** Specs force 400, 429, 500 and a timeout and assert the app's behaviour for each; a missing kind = requested-changes.
5. **Simulated preflight first.** In `events.jsonl` a `messaging.live-preflight` with `simulated: true` precedes every other live result; a live result after `simulated: false`, or none recorded while live results exist = requested-changes.
6. **Fake recipients only.** Every live recipient is one of `aegis.config.json#messaging.fakeRecipients`; any other = requested-changes.
7. **No secret anywhere.** Run `aegis messaging scan-secrets` over `tests/qa/messaging`, the result files and the evidence directories; any hit = requested-changes.
8. **Development only.** The run's environment is `development`; any other = requested-changes.
9. **No-op legitimacy.** A `specialist.no-op` is legitimate only when `target-profile.json` is readable and `hasMessagingIntegration` is `false`; a missing or unreadable profile, or `true`, = requested-changes.
10. **Not run is not passed.** A layer that did not run is reported "not run" with its reason; reporting it passed = requested-changes.
11. **Naming and sandbox.** Specs are `tests/qa/messaging/{flow}.messaging.spec.ts`, each with a `sandbox.explored` event; otherwise requested-changes.
12. **Env names in force.** The env names in the work report match `plan.json#env`, and any stub wiring line quoted uses them; otherwise requested-changes.
```

Its contract block: `phase: spv`, `dispatchedBy: [qa-test-executor]`, `reviewedBy: {none: "not stated in prose"}`, `reviews: [qa-messaging-specialist]`, reads `"{run}/reports/work/qa-messaging-specialist*.json"`, `"{run}/target-profile.json"`, `"{run}/messaging/plan.json"`, `"{run}/messaging/contract.json"`, `"{tests}/qa/messaging/**"`, `"aegis.config.json"`, `"{run}/events.jsonl"`, `"agent-memory/qa-messaging-specialist/lessons.md"`; writes `[]`; emits the three `review.*` via `"cli:review.submit"`; `cli: [review.submit, messaging.scan-secrets]`; `config: ["aegis.config.json#messaging.fakeRecipients", "aegis.config.json#environments.production.forbiddenSpecialists"]`.

Then:
```bash
git rm .claude/agents/tier2-specialist/qa-email-specialist.md .claude/agents/spv/qa-email-specialist-spv.md
git mv agent-memory/qa-email-specialist agent-memory/qa-messaging-specialist
```

- [ ] **Step 4: Wire the other agents, pipeline, policy and skills** (exact replacements; `grep -rn "email\|Email\|mailpit\|Mailpit" .claude` afterwards must show none in these files):

- `.claude/model-policy.yaml:51` `qa-email-specialist` → `qa-messaging-specialist`; `:82` `qa-email-specialist-spv` → `qa-messaging-specialist-spv`.
- `.claude/pipeline.yaml`: `byTechnique.Email: qa-email-specialist` → `Messaging: qa-messaging-specialist`; in `designerEmits.testTechnique` `Email` → `Messaging`; `envSpecialists.email: qa-email-specialist` → `messaging: qa-messaging-specialist`; `sources.cli` gains `"{run}/messaging/**"` and `"{tests}/qa/support/messaging.ts"`; escape `{unit: qa-email-specialist-spv, …}` → `{unit: qa-messaging-specialist-spv, field: reviewedBy.none, reason: "not stated in prose"}`.
- `qa-context-scanner.md` step 19: replace the whole "Email flows" step with:
  `19. **Messaging integration.** Match the detection hints of each messaging adapter (\`aegis messaging\` adapters; the CLI cheat-sheet lists them): env var names and hosts that identify a provider, and the send call built from them. When an adapter's hints match, set \`messaging.provider\` to its id, \`hasMessagingIntegration\` to true, and \`messaging.baseUrlEnv\` / \`messaging.tokenEnv\` to the env names the client reads for the request's base URL and for its auth header. When no adapter matches but a mail library (\`nodemailer\`, \`resend\`, \`@sendgrid/mail\`, \`@sendgrid/*\`, \`postmark\`, \`mailgun.js\`, \`mailgun-js\`, \`@react-email/*\`, \`@aws-sdk/client-ses\`) or an env name matching \`*SMTP*\`, \`*MAIL*\`, \`RESEND_*\`, \`SENDGRID_*\`, \`POSTMARK_*\` or \`MAILGUN_*\` is found, set \`messaging.provider\` to \`direct-mail\` and \`hasMessagingIntegration\` to false. Otherwise \`none\` and false, with both env names null. When \`hasMessagingIntegration\` is false, the messaging specialist reports a no-op.`
  and in its example profile replace `"hasEmailFlows": true` with `"hasMessagingIntegration": true, "messaging": {"provider": "commshub", "baseUrlEnv": "COMMSHUB_BASE_URL", "tokenEnv": "COMMSHUB_SERVICE_TOKEN"}`. Because the scanner prose must not hard-code hints, add to `packages/@qa/run-state/src/hook-context.ts` `CLI_USAGE` one line: `aegis messaging adapters: commshub (env names COMMSHUB_* or COMMHUB_*, host commhub.*, POST …/events)` — generated from a `detectionHints` string on each adapter (add `detectionHints: "env names COMMSHUB_* or COMMHUB_*, host commhub.*, POST …/events"` to the `MessagingAdapter` interface and COMMSHUB in Task 2's file, adapters section).
- `qa-environment-engineer.md`: line 29 `emailAdapter` → `messaging`; step 5 sentence → `If \`target-profile.json#hasMessagingIntegration\` is true: run \`aegis messaging check\`; a busy \`stubPort\` = emit \`env.setup-failed\`; a missing contract or key is reported in your env report, not a failure.`; step 3b `aegis helpers vendor --helpers test-helpers,supabase` → add `,messaging` when `hasMessagingIntegration` is true; contract `config:` `aegis.config.json#emailAdapter` → `aegis.config.json#messaging.stubPort`; contract `cli:` gains `messaging.check`.
- `qa-test-designer.md:103,105`: technique list `Email` → `Messaging`; sentence → ``- `Messaging` when target-profile.json `hasMessagingIntegration` is true and the requirement sends a message (an OTP, a link, a notification, a broadcast, a digest)``.
- `qa-test-executor.md:76` ``- `Email` → qa-email-specialist`` → ``- `Messaging` → qa-messaging-specialist``; contract `dispatches` email pair → messaging pair. `qa-test-executor-spv.md:33` same mapping.
- `qa-closure-reporter.md:157` example "…tested via Mailpit but not with real Gmail routing" → "…tested against the provider's development tenant with simulated delivery, not against real inboxes".
- Skills: `qa-run-specialist/SKILL.md:19` `email` → `messaging`; `qa-smoke/SKILL.md:27` `email` → `messaging`; `qa-dry-run/SKILL.md:25` `Email` → `Messaging`.

- [ ] **Step 5: Stamp models and rewrite the scanner tests**

Run the `_qa-build-agents` skill (or `pnpm qa-build-agents` if defined in `package.json`) so both new files carry the policy model. Rewrite `target-profile.test.ts:77-101` (un-skip): assert the scanner step 19 text contains every mail library and env pattern listed above, `MESSAGING_PROVIDERS` order, and that the example profile parses with `TargetProfileSchema`.

- [ ] **Step 6: Run** `pnpm -F @aegis/internal-tests exec jest p2b-profiles target-profile role-table agent-frontmatter agent-cli-callers agent-event-payloads routing-vocab executor-events event-type-drift brand-exposure` → PASS.

- [ ] **Step 7: Commit**

```bash
git add -A .claude agent-memory __internal-tests__ packages/@qa/messaging packages/@qa/run-state/src/hook-context.ts
git commit -m "feat(agents): NEW-07 qa-messaging-specialist and SPV replace the email pair

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Config, docs, HANDBOOK, secrets

**Files:**
- Modify: `aegis.config.json`, `CLAUDE.md`, `secrets/README.md`, `HANDBOOK/01-what-is-this.md`, `03-architecture.md`, `04-stlc-walkthrough.md`, `06-agents.md`, `07-templates-and-standardization.md`, `12-cicd-operations.md`, `17-operating-ruleset.md`, `docs/D03-agent-workflow-diagram.md`, `docs/D12-cicd-stage-map.md`, `docs/D12-env-safety-and-prod.md`, `docs/D12-environments-overview.md`, `HANDBOOK.md` (TOC via `pnpm qa-build-toc`)
- Create: the secrets example file for development (write it with the Write tool: `secrets/` + `.env.development.example`)

- [ ] **Step 1:** `aegis.config.json`: delete `"emailAdapter": "mailpit",`, the `"mailpitPerInstance": true` line (and the comma before it), and `"mailpit": { "smtp": 1025, "http": 8025 },`; add after `"packageManager"`:
```json
  "messaging": {
    "adapter": "commshub",
    "stubPort": 4010,
    "dispatchTimeoutSeconds": 90,
    "fakeRecipients": { "email": "aegis-probe@example.com", "phone": "+6500000000" },
    "env": { "baseUrl": null, "token": null },
    "commshub": { "contract": { "repo": "WerkDone-Pte-Ltd/wd-commhub", "path": "docs/08-commhub-events-api.yaml", "ref": "development" } }
  },
```
`environments.testing` and `.staging` gain `"forbiddenSpecialists": ["messaging"]`; `production.forbiddenSpecialists` `"email"` → `"messaging"`.

- [ ] **Step 2:** Docs: replace every Mailpit/email-specialist mention found by `grep -rn -i "mailpit\|email-specialist\|Email flow\|hasEmailFlows" HANDBOOK docs/D*.md CLAUDE.md secrets/README.md` with the messaging equivalent. Fixed strings:
  - `docs/D12-environments-overview.md` row → `| Messaging testing | ✓ (stub + provider dev) | ✗ | ✗ | ✗ |`
  - `CLAUDE.md` ports line: `ports — dashboard (3030), dashboardApi (3031), Mailpit (8025), k6 (5665)` → `ports — dashboard (3030), dashboardApi (3031), k6 (5665); the messaging stub port is messaging.stubPort (4010)`
  - `secrets/README.md` list item `MAILPIT_URL` → `The target's messaging base URL and key, under the env names \`aegis messaging check\` prints (development only)`
  - HANDBOOK 06 rows "Email flow test cases (Mailpit)" → "Messaging-integration test cases (contract, stub, simulated provider dev)"; agent names updated.
  - Add to `HANDBOOK/06-agents.md` a subsection `### Adding a messaging adapter`: "Implement a `MessagingAdapter` object in the adapters section of `packages/@qa/messaging/src/index.ts`, add it to `ADAPTERS`, add its id to `MESSAGING_PROVIDERS` in `packages/@qa/contracts/src/messaging.ts`, list its required config keys in `requiredConfig`, and add unit tests beside `__internal-tests__/messaging/helper.test.ts`. No agent or SPV changes."
  Secrets example file content (Write tool):
```
# Development secrets for aegis (copy to the same name without .example; never commit the copy).
# The messaging specialist reads the target's messaging base URL and key under the env names
# `aegis messaging check` prints. Example for a CommsHub target:
# COMMSHUB_BASE_URL=
# COMMSHUB_SERVICE_TOKEN=
```
Then `pnpm qa-build-toc`.

- [ ] **Step 3: Run** `pnpm -F @aegis/internal-tests exec jest p2b-profiles final-wave-docs run-id-docs brand-exposure` → PASS.

- [ ] **Step 4: Commit**

```bash
git add -A aegis.config.json CLAUDE.md HANDBOOK HANDBOOK.md docs secrets
git commit -m "docs: NEW-07 messaging replaces Mailpit in config, HANDBOOK, environment docs and secrets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Whole-repo gates and the alignment ratchet

- [ ] **Step 1:** `pnpm build` → clean. `pnpm typecheck` → clean.
- [ ] **Step 2:** `pnpm test` → all suites pass. Any remaining failure mentioning `email`/`Email`/`Mailpit` is a leftover rename: fix the source, never loosen the assertion.
- [ ] **Step 3:** `pnpm test:smoke` → pass.
- [ ] **Step 4:** `pnpm aegis align`. Expected end: `ratchet: ok`. For each `stale` entry (fixed, still in the baseline) delete it from `__internal-tests__/alignment/baseline.yaml`. For each unexpected violation: fix the contract or prose (e.g. a `config:` ref not named in prose, a `cli:` id not used in prose). Do not add baseline entries.
- [ ] **Step 5:** Commit `chore(align): NEW-07 drop stale baseline entries` with the attribution line.

---

### Task 9: Spec sync and matrix status

- [ ] **Step 1:** In the spec, replace `aegis messaging contract fetch` with `aegis messaging fetch-contract`, `commshub.ts`/`contract.json` file names already match; note under §4.4 "commands are `<group>.<verb>`, so fetch-contract is one word".
- [ ] **Step 2:** Matrix row NEW-07 status → `fixed — feat/commshub-messaging-specialist (agents, @qa/messaging, aegis messaging CLI); first real run pending (Renci, development)`.
- [ ] **Step 3:** Commit `docs(spec): NEW-07 sync CLI names and matrix status` with the attribution line.
