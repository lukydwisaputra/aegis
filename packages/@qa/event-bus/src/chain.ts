import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import { AegisEventSchema, EventEnvelopeSchema, GENESIS_HASH } from "@qa/contracts";

const ENVELOPE_KEYS = new Set(["seq", "prevHash", "emittedBy", "runId"]);

export interface ChainContext {
  emittedBy: string;
  runId: string;
}

export interface ChainVerifyResult {
  ok: boolean;
  legacyLines: number;
  chainedLines: number;
  errors: string[];
}

export function hashLine(line: string): string {
  return createHash("sha256").update(line).digest("hex");
}

export function readLines(busPath: string): string[] {
  if (!existsSync(busPath)) return [];
  return readFileSync(busPath, "utf-8").split(/\r?\n/).filter((l) => l.length > 0);
}

function seqOf(line: string | undefined): number {
  if (line === undefined) return 0;
  try {
    const seq = (JSON.parse(line) as { seq?: unknown }).seq;
    return typeof seq === "number" ? seq : 0;
  } catch {
    return 0;
  }
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
    throw new Error(`EventBus chain context invalid: ${envelopeCheck.error.message}`);
  }
  if ("runId" in event && event["runId"] !== ctx.runId) {
    throw new Error(`EventBus: event.runId="${String(event["runId"])}" conflicts with caller runId="${ctx.runId}"`);
  }

  const parsed = AegisEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new Error(`EventBus schema validation failed: ${parsed.error.message}`);
  }
  const kept = parsed.data as Record<string, unknown>;
  const stripped = Object.keys(event).filter((k) => !(k in kept) && !ENVELOPE_KEYS.has(k));
  if (stripped.length > 0) {
    throw new Error(`EventBus: undeclared field(s) for "${String(kept["type"])}": ${stripped.join(", ")}`);
  }

  const dir = dirname(busPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(busPath)) appendFileSync(busPath, "", "utf-8");

  const release = await lockfile.lock(busPath, {
    stale: 5_000,
    retries: { retries: 20, minTimeout: 20, maxTimeout: 250 },
  });
  try {
    const raw = readFileSync(busPath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    const prev = lines[lines.length - 1];
    const record: Record<string, unknown> = {
      seq: seqOf(prev) + 1,
      prevHash: prev === undefined ? GENESIS_HASH : hashLine(prev),
      emittedBy: ctx.emittedBy,
      ...kept,
      runId: ctx.runId,
    };
    const needsNewline = raw.length > 0 && !raw.endsWith("\n");
    appendFileSync(busPath, (needsNewline ? "\n" : "") + JSON.stringify(record) + "\n", "utf-8");
    return record;
  } finally {
    await release();
  }
}

/** Recompute the chain and validate every chained line. Pure read; never writes. */
export function verifyChain(busPath: string, opts: { ignoreThroughLine?: number } = {}): ChainVerifyResult {
  const lines = readLines(busPath);
  const errors: Array<{ line: number; message: string }> = [];
  let legacyLines = 0;
  let chainedLines = 0;
  let chainStarted = false;
  let expectedSeq = 1;

  lines.forEach((line, i) => {
    const n = i + 1;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
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

  const cutoff = opts.ignoreThroughLine ?? 0;
  const kept = errors.filter((e) => e.line > cutoff).map((e) => `line ${e.line}: ${e.message}`);
  return { ok: kept.length === 0, legacyLines, chainedLines, errors: kept };
}
