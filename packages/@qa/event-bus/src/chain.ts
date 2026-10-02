import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fstatSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import { AegisEventSchema, EventEnvelopeSchema, GENESIS_HASH } from "@qa/contracts";

const ENVELOPE_KEYS = new Set(["seq", "prevHash", "emittedBy", "runId"]);

/** Top-level fields of `event` the schema did not keep, except `allowed` (envelope keys). */
export function undeclaredFields(event: Record<string, unknown>, kept: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(event).filter((k) => !(k in kept) && !allowed.has(k));
}

/**
 * The bus refused an event on validation (schema, undeclared fields, caller-set envelope fields,
 * runId conflict, invalid context). Nothing was written. I/O and torn-tail failures stay plain Errors.
 */
export class EventBusRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventBusRefusal";
  }
}

export interface ChainContext {
  emittedBy: string;
  runId: string;
}

export interface ChainVerifyResult {
  ok: boolean;
  legacyLines: number;
  chainedLines: number;
  /** True when the file ends with an unterminated segment (in-flight or torn write); it is not counted or validated. */
  pendingTail: boolean;
  errors: string[];
}

export function hashLine(line: string): string {
  return createHash("sha256").update(line).digest("hex");
}

export function readLines(busPath: string): string[] {
  if (!existsSync(busPath)) return [];
  return readFileSync(busPath, "utf-8").split(/\r?\n/).filter((l) => l.length > 0);
}

function seqOf(line: string): number {
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
    const seq = (parsed as { seq?: unknown }).seq;
    return typeof seq === "number" && Number.isInteger(seq) && seq > 0 ? seq : 0;
  } catch {
    return 0;
  }
}

/** Seq of the nearest chained line scanning backward; 0 when there is none. */
function lastChainedSeq(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const seq = seqOf(lines[i]!);
    if (seq > 0) return seq;
  }
  return 0;
}

/**
 * Validate an event and append it with a hash-chain envelope.
 * Unlike append(), undeclared fields are rejected instead of silently stripped.
 */
export async function appendChained(
  event: Record<string, unknown>,
  busPath: string,
  ctx: ChainContext
): Promise<Record<string, unknown>> {
  const kept = validateChained(event, ctx);
  const dir = dirname(busPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(busPath)) appendFileSync(busPath, "", "utf-8");

  const release = await lockfile.lock(busPath, {
    stale: 5_000,
    retries: { retries: 50, minTimeout: 20, maxTimeout: 250 },
  });
  try {
    return appendChainedLocked(kept, busPath, ctx);
  } finally {
    await release();
  }
}

/** Validate an event for appendChained and return the schema-kept copy. Throws EventBusRefusal; writes nothing. */
function validateChained(event: Record<string, unknown>, ctx: ChainContext): Record<string, unknown> {
  const envelopeCheck = EventEnvelopeSchema.pick({ emittedBy: true, runId: true }).safeParse(ctx);
  if (!envelopeCheck.success) {
    throw new EventBusRefusal(`EventBus chain context invalid: ${envelopeCheck.error.message}`);
  }
  const spoofed = ["seq", "prevHash", "emittedBy"].filter((k) => k in event);
  if (spoofed.length > 0) {
    throw new EventBusRefusal(`EventBus: envelope field(s) are set by the bus, not the caller: ${spoofed.join(", ")}`);
  }
  if ("runId" in event && event["runId"] !== ctx.runId) {
    throw new EventBusRefusal(`EventBus: event.runId="${String(event["runId"])}" conflicts with caller runId="${ctx.runId}"`);
  }

  const parsed = AegisEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new EventBusRefusal(`EventBus schema validation failed: ${parsed.error.message}`);
  }
  const kept = parsed.data as Record<string, unknown>;
  const stripped = undeclaredFields(event, kept, ENVELOPE_KEYS);
  if (stripped.length > 0) {
    throw new EventBusRefusal(`EventBus: undeclared field(s) for "${String(kept["type"])}": ${stripped.join(", ")}`);
  }
  return kept;
}

/** The append itself. The caller holds the bus lock on `busPath`, and `kept` came from validateChained. */
function appendChainedLocked(kept: Record<string, unknown>, busPath: string, ctx: ChainContext): Record<string, unknown> {
  const raw = readFileSync(busPath, "utf-8");
  const needsNewline = raw.length > 0 && !raw.endsWith("\n");
  if (needsNewline) {
    const tail = raw.slice(raw.lastIndexOf("\n") + 1);
    try {
      JSON.parse(tail);
    } catch {
      throw new Error(
        `EventBus: torn tail — last line of ${busPath} is incomplete; the owner cuts it with \`AEGIS_AGENT=owner pnpm aegis integrity repair-tail\` (add --run <runId> for a run that is not active)`
      );
    }
  }
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const prev = lines[lines.length - 1];
  const record: Record<string, unknown> = {
    seq: lastChainedSeq(lines) + 1,
    prevHash: prev === undefined ? GENESIS_HASH : hashLine(prev),
    emittedBy: ctx.emittedBy,
    ...kept,
    runId: ctx.runId,
  };
  appendFileSync(busPath, (needsNewline ? "\n" : "") + JSON.stringify(record) + "\n", "utf-8");
  return record;
}

export interface CommittedLines {
  /** Newline-terminated lines only, in file order (empty lines dropped). */
  lines: string[];
  /** True when the file ends with an unterminated segment, which is excluded from `lines`. */
  pendingTail: boolean;
}

/** One read of the log, split the way verification sees it. Pure read; never writes. */
export function readCommittedLines(busPath: string): CommittedLines {
  let raw = existsSync(busPath) ? readFileSync(busPath, "utf-8") : "";
  let pendingTail = false;
  if (raw.length > 0 && !raw.endsWith("\n")) {
    pendingTail = true;
    raw = raw.slice(0, raw.lastIndexOf("\n") + 1);
  }
  return { lines: raw.split(/\r?\n/).filter((l) => l.length > 0), pendingTail };
}

/** Recompute the chain and validate every chained line. Pure read; never writes. */
export function verifyChain(busPath: string): ChainVerifyResult {
  return verifyCommittedLines(readCommittedLines(busPath));
}

/** verifyChain over an already-read snapshot, so callers can verify and hash the same bytes. */
export function verifyCommittedLines({ lines, pendingTail }: CommittedLines): ChainVerifyResult {
  const errors: Array<{ line: number; message: string }> = [];
  let legacyLines = 0;
  let chainedLines = 0;
  let chainStarted = false;
  let expectedSeq = 1;

  lines.forEach((line, i) => {
    const n = i + 1;
    let obj: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        errors.push({ line: n, message: "not a JSON object" });
        return;
      }
      obj = parsed as Record<string, unknown>;
    } catch {
      errors.push({ line: n, message: "invalid JSON" });
      return;
    }

    if (typeof obj["seq"] !== "number") {
      if (chainStarted) errors.push({ line: n, message: "unchained event after chain start" });
      else legacyLines++;
      return;
    }

    chainStarted = true;
    chainedLines++;
    const env = EventEnvelopeSchema.safeParse(obj);
    if (!env.success) {
      errors.push({ line: n, message: `invalid envelope (${env.error.issues.map((x) => x.path.join(".")).join(", ")})` });
      return;
    }
    if (env.data.seq !== expectedSeq) {
      errors.push({ line: n, message: `seq ${env.data.seq}, expected ${expectedSeq}` });
    }
    expectedSeq = env.data.seq + 1;

    const expectedPrev = i === 0 ? GENESIS_HASH : hashLine(lines[i - 1]!);
    if (env.data.prevHash !== expectedPrev) {
      errors.push({ line: n, message: "prevHash mismatch (previous line altered, removed or inserted)" });
    }

    const { seq: _seq, prevHash: _prevHash, emittedBy: _emittedBy, ...event } = obj;
    if (!AegisEventSchema.safeParse(event).success) {
      errors.push({ line: n, message: `event schema invalid for type "${String(obj["type"])}"` });
    }
  });

  const messages = errors.map((e) => `line ${e.line}: ${e.message}`);
  return { ok: messages.length === 0, legacyLines, chainedLines, pendingTail, errors: messages };
}

export interface TornTail {
  /** The unterminated bytes after the last newline. */
  bytes: Buffer;
  sha256: string;
}

export interface TornTailRecord {
  removedBytes: number;
  removedSha256: string;
  /** Bytes of the log that stay (up to and including the last newline). */
  keptBytes: number;
  /** Chain seq of the last committed event before the cut; the record gets atSeq + 1. */
  atSeq: number;
}

export interface TornTailRepair {
  tail: TornTail;
  /** The appended record, or null when no `record` builder was given. */
  record: Record<string, unknown> | null;
}

/**
 * CO-02: cut a torn final segment (unterminated and not a whole JSON line) off the log, under ONE bus-lock hold so no
 * append is in flight and the cut and its record are atomic. `keep` receives the bytes before the file is truncated,
 * must make them durable synchronously, and throws to abort the cut. When `record` is given, its event is validated
 * before the cut and appended under the same lock. Returns null when the log ends cleanly or its unterminated tail is
 * a whole JSON line (the next append terminates it).
 */
export async function repairTornTail(
  busPath: string,
  keep: (tail: TornTail) => void,
  record?: { ctx: ChainContext; event: (info: TornTailRecord) => Record<string, unknown> }
): Promise<TornTailRepair | null> {
  if (!existsSync(busPath)) return null;
  const release = await lockfile.lock(busPath, { stale: 5_000, retries: { retries: 50, minTimeout: 20, maxTimeout: 250 } });
  try {
    const fd = openSync(busPath, "r+");
    let tail: TornTail;
    let pending: Record<string, unknown> | null = null;
    try {
      const raw = readFileSync(fd);
      if (raw.length === 0 || raw[raw.length - 1] === 0x0a) return null;
      const cut = raw.lastIndexOf(0x0a) + 1;
      const bytes = Buffer.from(raw.subarray(cut));
      try {
        JSON.parse(bytes.toString("utf-8"));
        return null;
      } catch {
        // torn: cut it below
      }
      tail = { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
      const kept = keep(tail) as unknown;
      if (kept !== null && typeof kept === "object" && typeof (kept as { then?: unknown }).then === "function") {
        throw new Error("EventBus: repairTornTail keep must be synchronous; nothing was cut");
      }
      if (record !== undefined) {
        const lines = raw.subarray(0, cut).toString("utf-8").split(/\r?\n/).filter((l) => l.length > 0);
        pending = validateChained(
          record.event({ removedBytes: bytes.length, removedSha256: tail.sha256, keptBytes: cut, atSeq: lastChainedSeq(lines) }),
          record.ctx
        );
      }
      if (fstatSync(fd).size !== raw.length) {
        throw new Error(`EventBus: ${busPath} changed while it was being repaired; nothing was cut`);
      }
      ftruncateSync(fd, cut);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const appended = pending !== null && record !== undefined ? appendChainedLocked(pending, busPath, record.ctx) : null;
    return { tail, record: appended };
  } finally {
    await release();
  }
}
