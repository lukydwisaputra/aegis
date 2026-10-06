import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import {
  ADAPTERS, DEFAULT_FAKE_RECIPIENTS, NotSimulatedError, adapterFor, assertOnlyFakes, apiPrefix, fakeRecipientProblem, liveUrl,
  probeRegistered, replay, requestSchema, send, startStub, toFakeRecipient, validate,
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

describe('recipient field patterns', () => {
  it('refuses a recipient field pattern it cannot address instead of passing vacuously', () => {
    const odd = { ...adapter, recipientFields: ['contact.email'] };
    expect(() => toFakeRecipient({ event_id: 'e', contact: { email: 'a@b.co' } }, plan(), odd)).toThrow(/unsupported recipient field pattern "contact\.email"/);
    expect(() => assertOnlyFakes({ event_id: 'e' }, plan(), odd)).toThrow(/unsupported recipient field pattern/);
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

describe('stub robustness', () => {
  it('answers 500 STUB_ERROR when handling throws, and keeps serving', async () => {
    const broken = JSON.parse(JSON.stringify(contract)) as MessagingContract;
    (broken.openapi as any).paths['/events'].post.requestBody.content['application/json'].schema = { $ref: 'other.json#/x' };
    const stub = await startStub({ plan: plan(), contract: broken });
    try {
      const r = await post(`${stub.url}/api/v1/events`, { event_id: 'e' });
      expect(r.status).toBe(500);
      expect(r.body.code).toBe('STUB_ERROR');
      expect(r.body.error).toMatch(/unsupported \$ref/);
      expect(stub.recorded()[0]!.errors[0]!.message).toMatch(/unsupported \$ref/);
      const next = await post(`${stub.url}/api/v1/events`, { event_id: 'e' });
      expect(next.status).toBe(500);
      const unknown = await post(`${stub.url}/api/v1/nope`, { event_id: 'e' });
      expect(unknown.status).toBe(404);
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


  it('send refuses a body whose recipient is not the configured fake, and nothing reaches the provider', async () => {
    const stub = await startStub({ plan: plan(), contract });
    try {
      await withEnv(`${stub.url}/api/v1`, async () => {
        await expect(send({ event_id: 'e', recipient_email: 'real@corp.com' }, { plan: plan() })).rejects.toThrow(/not the configured fake recipient/);
        await expect(send({ event_id: 'e', recipients: [{ recipient_external_id: 'r', recipient_phone: '+6591234567' }] }, { plan: plan() }))
          .rejects.toThrow(/not the configured fake recipient/);
      });
      expect(stub.recorded()).toHaveLength(0);
    } finally { await stub.stop(); }
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
  it('adapter exposes detection hints', () => {
    expect(adapterFor('commshub').detectionHints).toMatch(/COMMSHUB_/);
  });
});
