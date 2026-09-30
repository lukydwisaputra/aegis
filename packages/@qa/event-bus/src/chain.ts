import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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

  const dir = dirname(busPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(busPath)) appendFileSync(busPath, "", "utf-8");

  const release = await lockfile.lock(busPath, {
    stale: 5_000,
    retries: { retries: 50, minTimeout: 20, maxTimeout: 250 },
  });
  try {
    const raw = readFileSync(busPath, "utf-8");
    const needsNewline = raw.length > 0 && !raw.endsWith("\n");
    if (needsNewline) {
      const tail = raw.slice(raw.lastIndexOf("\n") + 1);
      try {
        JSON.parse(tail);
      } catch {
        throw new Error(`EventBus: torn tail — last line of ${busPath} is incomplete; owner must repair or acknowledge`);
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
  } finally {
    await release();
  }
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
