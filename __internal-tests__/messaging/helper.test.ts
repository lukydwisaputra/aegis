import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import {
  ADAPTERS, DEFAULT_FAKE_RECIPIENTS, FICTIONAL_PHONE_RANGES, NotSimulatedError, adapterFor, assertOnlyFakes, apiPrefix, fakeRecipientProblem, liveUrl,
  probeRegistered, replay, requestSchema, send, startStub, toFakeRecipient, validate, waitFinal,
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
    expect(fakeRecipientProblem('email', 'qa-probe@example.com')).toBeNull();
    expect(fakeRecipientProblem('email', 'qa@corp.invalid')).toBeNull();
    expect(fakeRecipientProblem('email', 'someone@gmail.com')).toMatch(/reserved/);
    expect(fakeRecipientProblem('phone', '+6500000000')).toBeNull();
    expect(fakeRecipientProblem('phone', '6500000000')).toMatch(/E\.164/);
  });
  it('toFakeRecipient swaps single and batch recipients and keeps the rest', () => {
    const out = toFakeRecipient({ event_id: 'e', recipient_phone: '+6591234567', recipients: [{ recipient_external_id: 'r', recipient_email: 'a@b.co' }] }, plan(), adapter) as any;
    expect(out.recipient_phone).toBe('+6500000000');
    expect(out.recipients[0]).toEqual({ recipient_external_id: 'r', recipient_email: 'qa-probe@example.com' });
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
        expect((stub.recorded()[0]!.body as any).recipient_email).toBe('qa-probe@example.com');
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

// ── final-review fixes (C2, M1, I1, I4, I5) ──

/** A provider stand-in whose read-back answer the test chooses; counts every message-creating POST. */
async function fakeProvider(readBack: { status: number; body: unknown }) {
  const posts: any[] = [];
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
      if (req.method === 'POST') {
        const b = JSON.parse(raw);
        posts.push(b);
        const n = Array.isArray(b.recipients) ? b.recipients.length : 1;
        res.writeHead(201, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ scheduled: Array.from({ length: n }, (_, i) => ({ message_id: `m${posts.length}-${i}` })) }));
      }
      res.writeHead(readBack.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(readBack.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/api/v1`, posts, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

const LIVE = { status: 200, body: { status: 'sent', simulated: false, delivery_log: [{ provider_code: 'whatsapp_cloud' }] } };
const SIMULATED = { status: 200, body: { status: 'sent', simulated: true, delivery_log: [{ provider_code: 'simulated' }] } };

describe('stub port', () => {
  it('a second stub on a busy port rejects naming the port, instead of crashing the process (I1)', async () => {
    const first = await startStub({ plan: plan(), contract });
    const port = Number(new URL(first.url).port);
    try {
      await expect(startStub({ plan: plan(), contract, port })).rejects.toThrow(`stub port ${port} busy`);
    } finally { await first.stop(); }
  });
});

describe('send validates the configured fakes themselves (I5)', () => {
  it('refuses a deliverable fake email or a non-E.164 fake phone even when the body holds exactly that fake', async () => {
    const provider = await fakeProvider(SIMULATED);
    const keep = { ...process.env };
    process.env.AEGIS_MESSAGING_BASE_URL = provider.url; process.env.AEGIS_MESSAGING_KEY = 'chk_livekeylivekey';
    try {
      const badEmail = plan({ fakeRecipients: { email: 'someone@gmail.com', phone: '+6500000000' } });
      await expect(send({ event_id: 'e', recipient_email: 'someone@gmail.com' }, { plan: badEmail })).rejects.toThrow(/reserved domain/);
      const badPhone = plan({ fakeRecipients: { email: 'qa-probe@example.com', phone: '6500000000' } });
      await expect(send({ event_id: 'e', recipient_phone: '6500000000' }, { plan: badPhone })).rejects.toThrow(/E\.164/);
      expect(provider.posts).toHaveLength(0);
    } finally { process.env = keep; await provider.close(); }
  });
});

describe('preflight verdict (C2, M1, I4)', () => {
  const tmp = () => fs.mkdtempSync(path.join(require('os').tmpdir(), 'aegis-preflight-'));
  const withLive = async (url: string, verdictFile: string | null, fn: () => Promise<void>) => {
    const keep = { ...process.env };
    process.env.AEGIS_MESSAGING_BASE_URL = url; process.env.AEGIS_MESSAGING_KEY = 'chk_livekeylivekey';
    if (verdictFile === null) delete process.env.AEGIS_MESSAGING_PREFLIGHT; else process.env.AEGIS_MESSAGING_PREFLIGHT = verdictFile;
    try { await fn(); } finally { process.env = keep; }
  };
  const body = (id: string) => ({ event_id: id, recipient_email: 'x@corp.co' });

  it('a live verdict stops every later send across replay() calls: exactly one message-creating POST', async () => {
    const provider = await fakeProvider(LIVE);
    const file = path.join(tmp(), 'preflight.json');
    fs.writeFileSync(file, '{}');
    try {
      await withLive(provider.url, file, async () => {
        const first = await replay([body('a'), body('b')], { plan: plan() }).then(() => null, (e) => e);
        expect(first).toBeInstanceOf(NotSimulatedError);
        expect(first.reason).toBe('live');
        const second = await replay([body('c')], { plan: plan() }).then(() => null, (e) => e);
        expect(second).toBeInstanceOf(NotSimulatedError);
        expect(second.reason).toBe('live');
        await expect(send(toFakeRecipient(body('d'), plan(), adapter), { plan: plan() })).rejects.toBeInstanceOf(NotSimulatedError);
      });
      expect(provider.posts).toHaveLength(1);
      expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ verdict: 'live', messageId: 'm1-0', adapter: 'commshub' });
    } finally { await provider.close(); }
  });

  it('a simulated verdict is written once and later replay() calls send without a second preflight', async () => {
    const provider = await fakeProvider(SIMULATED);
    const file = path.join(tmp(), 'preflight.json');
    try {
      await withLive(provider.url, file, async () => {
        await replay([body('a')], { plan: plan() });
        expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ verdict: 'simulated', messageId: 'm1-0', adapter: 'commshub' });
        const out = await replay([body('b')], { plan: plan() });
        expect(out[0]).toMatchObject({ eventId: 'b', simulated: true });
      });
      expect(provider.posts).toHaveLength(2);
    } finally { await provider.close(); }
  });

  it('a stored undecided verdict refuses before anything is sent', async () => {
    const provider = await fakeProvider(SIMULATED);
    const file = path.join(tmp(), 'preflight.json');
    fs.writeFileSync(file, JSON.stringify({ verdict: 'undecided', messageId: 'm0', adapter: 'commshub' }));
    try {
      await withLive(provider.url, file, async () => {
        const e = await replay([body('a')], { plan: plan() }).then(() => null, (x) => x);
        expect(e).toBeInstanceOf(NotSimulatedError);
        expect(e).toMatchObject({ reason: 'undecided', messageId: 'm0' });
      });
      expect(provider.posts).toHaveLength(0);
    } finally { await provider.close(); }
  });

  it('a read-back that is not done is undecided, never live (I4)', async () => {
    for (const readBack of [
      { status: 500, body: { code: 'INTERNAL_ERROR' } },
      { status: 200, body: { status: 'failed', simulated: true, delivery_log: [{ provider_code: 'simulated' }] } },
    ]) {
      const provider = await fakeProvider(readBack);
      const file = path.join(tmp(), 'preflight.json');
      try {
        await withLive(provider.url, file, async () => {
          // A 500 is polled until the timeout (PR #18 item 6), so keep the timeout short.
          const e = await replay([body('a'), body('b')], { plan: plan({ dispatchTimeoutSeconds: 1 }) }).then(() => null, (x) => x);
          expect(e).toBeInstanceOf(NotSimulatedError);
          expect(e.reason).toBe('undecided');
          expect(e.message).toMatch(/could not be confirmed/);
        });
        expect(provider.posts).toHaveLength(1);
        expect(JSON.parse(fs.readFileSync(file, 'utf-8')).verdict).toBe('undecided');
      } finally { await provider.close(); }
    }
  });

  it('a done read-back that is not simulated is live (I4)', async () => {
    const provider = await fakeProvider(LIVE);
    try {
      await withLive(provider.url, null, async () => {
        const e = await replay([body('a')], { plan: plan() }).then(() => null, (x) => x);
        expect(e).toMatchObject({ reason: 'live' });
        expect(e.message).toMatch(/not simulated/);
      });
    } finally { await provider.close(); }
  });

  it('the preflight carries exactly one recipient; the full batch follows a simulated verdict (M1)', async () => {
    const provider = await fakeProvider(SIMULATED);
    try {
      await withLive(provider.url, null, async () => {
        const batch = { event_id: 'b', recipients: [{ recipient_external_id: 'r1', recipient_email: 'a@corp.co' }, { recipient_external_id: 'r2', recipient_email: 'b@corp.co' }, { recipient_external_id: 'r3', recipient_email: 'c@corp.co' }] };
        const out = await replay([batch], { plan: plan() });
        expect(out.map((r) => r.simulated)).toEqual([true, true, true, true]);
      });
      expect(provider.posts.map((p) => p.recipients.length)).toEqual([1, 3]);
      expect(provider.posts[0].recipients[0]).toEqual({ recipient_external_id: 'r1', recipient_email: 'qa-probe@example.com' });
    } finally { await provider.close(); }
  });

  it('a live verdict on a one-recipient preflight never sends the batch (M1)', async () => {
    const provider = await fakeProvider(LIVE);
    try {
      await withLive(provider.url, null, async () => {
        const batch = { event_id: 'b', recipients: [{ recipient_email: 'a@corp.co' }, { recipient_email: 'b@corp.co' }] };
        await expect(replay([batch], { plan: plan() })).rejects.toBeInstanceOf(NotSimulatedError);
      });
      expect(provider.posts.map((p) => p.recipients.length)).toEqual([1]);
    } finally { await provider.close(); }
  });
});

// ── PR #18 review fixes (items 1, 6, 8, 9, 10) ──

describe('fake phone must sit in a fictional range (PR #18 item 1)', () => {
  it('refuses a real-looking E.164 mobile and names the allowed ranges', () => {
    const problem = fakeRecipientProblem('phone', '+6591234567');
    expect(problem).toMatch(/fictional/);
    for (const range of FICTIONAL_PHONE_RANGES) expect(problem).toContain(range.range);
    expect(fakeRecipientProblem('phone', '+65012345678')).toMatch(/fictional/);
    expect(fakeRecipientProblem('phone', '+12025550200')).toMatch(/fictional/);
  });
  it('accepts each fictional range, and the default fake phone is one of them', () => {
    for (const phone of ['+6500000000', '+6501234567', '+12025550123', '+12025550199', '+447700900123', '+61491570156']) {
      expect({ phone, problem: fakeRecipientProblem('phone', phone) }).toEqual({ phone, problem: null });
    }
    expect(fakeRecipientProblem('phone', DEFAULT_FAKE_RECIPIENTS.phone)).toBeNull();
    expect(FICTIONAL_PHONE_RANGES.map((r) => r.region)).toEqual(['Singapore', 'North America', 'UK', 'Australia']);
  });
  it('send refuses a plan whose fake phone is a real-looking mobile, before anything is sent', async () => {
    const provider = await fakeProvider(SIMULATED);
    const keep = { ...process.env };
    process.env.AEGIS_MESSAGING_BASE_URL = provider.url; process.env.AEGIS_MESSAGING_KEY = 'chk_livekeylivekey';
    delete process.env.AEGIS_MESSAGING_PREFLIGHT;
    try {
      const real = plan({ fakeRecipients: { email: 'qa-probe@example.com', phone: '+6591234567' } });
      await expect(send({ event_id: 'e', recipient_phone: '+6591234567' }, { plan: real })).rejects.toThrow(/fictional/);
      expect(provider.posts).toHaveLength(0);
    } finally { process.env = keep; await provider.close(); }
  });
});

/** A provider stand-in whose read-back answers follow `script` (the last one repeats); 'drop' destroys the socket. */
async function scriptedProvider(script: Array<{ status: number; body: unknown } | 'drop'>) {
  const posts: any[] = [];
  let reads = 0;
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
      if (req.method === 'POST') {
        posts.push(JSON.parse(raw));
        res.writeHead(201, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ scheduled: [{ message_id: `m${posts.length}` }] }));
      }
      const step = script[Math.min(reads, script.length - 1)]!;
      reads += 1;
      if (step === 'drop') return req.socket.destroy();
      res.writeHead(step.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(step.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/api/v1`, posts, reads: () => reads,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

describe('read-back polling (PR #18 item 6)', () => {
  const withProvider = async (url: string, verdictFile: string | null, fn: () => Promise<void>) => {
    const keep = { ...process.env };
    process.env.AEGIS_MESSAGING_BASE_URL = url; process.env.AEGIS_MESSAGING_KEY = 'chk_livekeylivekey';
    if (verdictFile === null) delete process.env.AEGIS_MESSAGING_PREFLIGHT; else process.env.AEGIS_MESSAGING_PREFLIGHT = verdictFile;
    try { await fn(); } finally { process.env = keep; }
  };

  it('a 404 right after the send is pending: polling continues to a simulated done', async () => {
    const provider = await scriptedProvider([{ status: 404, body: { code: 'NOT_FOUND' } }, SIMULATED]);
    const file = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'aegis-poll-')), 'preflight.json');
    try {
      await withProvider(provider.url, file, async () => {
        const out = await replay([{ event_id: 'a', recipient_email: 'x@corp.co' }], { plan: plan() });
        expect(out[0]).toMatchObject({ state: 'done', simulated: true });
      });
      expect(provider.reads()).toBe(2);
      expect(JSON.parse(fs.readFileSync(file, 'utf-8')).verdict).toBe('simulated');
    } finally { await provider.close(); }
  });

  it('a 5xx or a dropped connection is pending too, not a final problem', async () => {
    for (const first of [{ status: 503, body: { code: 'UNAVAILABLE' } }, 'drop'] as const) {
      const provider = await scriptedProvider([first, SIMULATED]);
      try {
        await withProvider(provider.url, null, async () => {
          expect(await waitFinal('m1', 5, { plan: plan() })).toMatchObject({ state: 'done' });
        });
        expect(provider.reads()).toBe(2);
      } finally { await provider.close(); }
    }
  });

  it('a read-back that never settles ends pending at the timeout, and the preflight is undecided', async () => {
    const provider = await scriptedProvider([{ status: 404, body: { code: 'NOT_FOUND' } }]);
    try {
      await withProvider(provider.url, null, async () => {
        expect(await waitFinal('m1', 1, { plan: plan() })).toMatchObject({ state: 'pending' });
        const e = await replay([{ event_id: 'a', recipient_email: 'x@corp.co' }], { plan: plan({ dispatchTimeoutSeconds: 1 }) }).then(() => null, (x) => x);
        expect(e).toBeInstanceOf(NotSimulatedError);
        expect(e.reason).toBe('undecided');
      });
    } finally { await provider.close(); }
  });

  it('401 and 403 are final: undecided at once, no polling', async () => {
    for (const status of [401, 403]) {
      const provider = await scriptedProvider([{ status, body: { code: 'UNAUTHORIZED' } }, SIMULATED]);
      try {
        await withProvider(provider.url, null, async () => {
          const started = Date.now();
          const e = await replay([{ event_id: 'a', recipient_email: 'x@corp.co' }], { plan: plan() }).then(() => null, (x) => x);
          expect(e).toBeInstanceOf(NotSimulatedError);
          expect(e.reason).toBe('undecided');
          expect(e.message).toMatch(/read-back ended problem/);
          expect(Date.now() - started).toBeLessThan(1500);
        });
        expect(provider.reads()).toBe(1);
      } finally { await provider.close(); }
    }
  });
});

describe('send() under messaging exec needs the preflight first (PR #18 item 8)', () => {
  const body = { event_id: 'e', recipient_email: 'qa-probe@example.com' };
  const withEnv = async (url: string, verdictFile: string | null, fn: () => Promise<void>) => {
    const keep = { ...process.env };
    process.env.AEGIS_MESSAGING_BASE_URL = url; process.env.AEGIS_MESSAGING_KEY = 'chk_livekeylivekey';
    if (verdictFile === null) delete process.env.AEGIS_MESSAGING_PREFLIGHT; else process.env.AEGIS_MESSAGING_PREFLIGHT = verdictFile;
    try { await fn(); } finally { process.env = keep; }
  };

  it('refuses while the run has no verdict yet, and nothing reaches the provider', async () => {
    const provider = await fakeProvider(SIMULATED);
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'aegis-send-'));
    try {
      for (const file of [path.join(dir, 'fresh.json'), path.join(dir, 'missing.json')]) {
        if (file.endsWith('fresh.json')) fs.writeFileSync(file, '{}\n');
        await withEnv(provider.url, file, async () => {
          await expect(send(body, { plan: plan() })).rejects.toThrow('run replay() first: the first live message must be the preflight');
        });
      }
      expect(provider.posts).toHaveLength(0);
    } finally { await provider.close(); }
  });

  it('after replay() stores a simulated verdict, send() goes through', async () => {
    const provider = await fakeProvider(SIMULATED);
    const file = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'aegis-send-')), 'preflight.json');
    fs.writeFileSync(file, '{}\n');
    try {
      await withEnv(provider.url, file, async () => {
        await replay([{ event_id: 'a', recipient_email: 'x@corp.co' }], { plan: plan() });
        expect((await send(body, { plan: plan() })).status).toBe(201);
      });
      expect(provider.posts).toHaveLength(2);
    } finally { await provider.close(); }
  });

  it('without AEGIS_MESSAGING_PREFLIGHT send() behaves as before', async () => {
    const provider = await fakeProvider(SIMULATED);
    try {
      await withEnv(provider.url, null, async () => {
        expect(await send(body, { plan: plan() })).toMatchObject({ status: 201, messageIds: ['m1-0'] });
      });
      expect(provider.posts).toHaveLength(1);
    } finally { await provider.close(); }
  });
});

describe('nullable before composition keywords (PR #18 item 9)', () => {
  it('null passes a nullable schema whose allOf/anyOf/oneOf reference an object', () => {
    const root = { components: { schemas: { X: { type: 'object', required: ['a'] } } } };
    const ref = { $ref: '#/components/schemas/X' };
    for (const key of ['allOf', 'anyOf', 'oneOf']) {
      expect({ key, errors: validate({ nullable: true, [key]: [ref] }, null, root) }).toEqual({ key, errors: [] });
      expect(validate({ [key]: [ref] }, null, root).length).toBeGreaterThan(0);
    }
    expect(validate({ nullable: true, allOf: [ref] }, {}, root).length).toBeGreaterThan(0);
  });
});

describe('stub read-back channel (PR #18 item 10)', () => {
  it('takes the channel from the first recipient, top-level or recipients[0]', () => {
    const channel = (b: Record<string, unknown>) => (adapter.stubReadBack('m', b) as any).delivery_log[0].channel;
    expect(channel({ event_id: 'e', recipient_email: 'a@example.com' })).toBe('email');
    expect(channel({ event_id: 'e', recipient_phone: '+6500000000' })).toBe('sms');
    expect(channel({ event_id: 'e', recipients: [{ recipient_external_id: 'r', recipient_email: 'a@example.com' }] })).toBe('email');
    expect(channel({ event_id: 'e', recipients: [{ recipient_external_id: 'r', recipient_phone: '+6500000000' }] })).toBe('sms');
    expect((adapter.stubReadBack('m', { event_id: 'e', recipients: [{ recipient_email: 'a@example.com' }] }) as any).channels_allowed).toEqual(['email']);
  });
});
