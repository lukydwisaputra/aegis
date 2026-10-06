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
  /** Where in a target to look for this provider's wiring (env names, hosts, calls), for the specialist's scan. */
  detectionHints: string;
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
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
  detectionHints: "env names COMMSHUB_* or COMMHUB_*, host commhub.*, POST …/events",
};

export const ADAPTERS: Readonly<Record<string, MessagingAdapter>> = { commshub: COMMSHUB };

export function adapterFor(id: string): MessagingAdapter {
  const a = ADAPTERS[id];
  if (a === undefined) throw new Error(`no messaging adapter "${id}"; known: ${Object.keys(ADAPTERS).join(", ")}`);
  return a;
}
