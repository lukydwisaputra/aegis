import { GENESIS_HASH, type RunState } from "@qa/contracts";
import { hashLine, verifyCommittedLines, type ChainVerifyResult, type CommittedLines } from "@qa/event-bus";

export type IntegrityAcknowledgement = NonNullable<RunState["integrityAcknowledged"]>;
export type IntegrityCheckpoint = NonNullable<RunState["integrityCheckpoint"]>;

export const ACK_PREFIX_ALTERED = "acknowledged prefix altered";

function parseObject(line: string | undefined): Record<string, unknown> | null {
  if (line === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** sha256 of lines 1..n joined by "\n" (sha256("") when n is 0). */
export function prefixHash(lines: string[], n: number): string {
  return hashLine(lines.slice(0, n).join("\n"));
}

/**
 * Every integrity error of a run-state log, before any acknowledgement is applied:
 * chain errors, plus the run-level rules a chain check alone cannot see (an overwritten,
 * emptied or truncated log still forms a valid chain).
 */
export function logErrors(
  snap: CommittedLines,
  checkpoint: IntegrityCheckpoint | undefined
): { chain: ChainVerifyResult; errors: string[] } {
  const chain = verifyCommittedLines(snap);
  const errors = [...chain.errors];
  if (chain.chainedLines === 0) errors.push("log has no chained events");
  if (chain.legacyLines > 0) errors.push(`legacy or hand-written lines in a chained run (${chain.legacyLines})`);
  const first = parseObject(snap.lines[0]);
  if (first === null || first["seq"] !== 1 || first["type"] !== "run.created") {
    errors.push("log does not start with run.created");
  }
  if (checkpoint !== undefined) {
    const line = snap.lines.find((l) => parseObject(l)?.["seq"] === checkpoint.seq);
    if (line === undefined || hashLine(line) !== checkpoint.lineHash) {
      // CO-03: name the pinned line, so an acknowledged checkpoint error never matches a later change of the same seq.
      errors.push(`log truncated or rewritten before checkpoint seq ${checkpoint.seq} (line ${checkpoint.lineHash.slice(0, 12)})`);
    }
  }
  return { chain, errors };
}

/** What an owner acknowledges: the whole current log, pinned by hash, and its exact errors. */
export function acknowledgementOf(snap: CommittedLines, errors: string[]): IntegrityAcknowledgement {
  const throughLine = snap.lines.length;
  const last = snap.lines[throughLine - 1];
  return {
    throughLine,
    lineHash: last === undefined ? GENESIS_HASH : hashLine(last),
    prefixHash: prefixHash(snap.lines, throughLine),
    errors: [...errors],
  };
}

/**
 * Drop only the errors the owner acknowledged. If the acknowledged prefix no longer
 * hashes the same, nothing is dropped and the alteration is itself an error.
 */
export function applyAcknowledgement(
  snap: CommittedLines,
  errors: string[],
  ack: IntegrityAcknowledgement | undefined
): string[] {
  if (ack === undefined) return errors;
  const n = ack.throughLine;
  const line = snap.lines[n - 1];
  const lineOk = n === 0 ? ack.lineHash === GENESIS_HASH : line !== undefined && hashLine(line) === ack.lineHash;
  if (!lineOk || prefixHash(snap.lines, n) !== ack.prefixHash) return [...errors, ACK_PREFIX_ALTERED];
  const known = new Set(ack.errors);
  return errors.filter((e) => !known.has(e));
}

/** The last committed line as a checkpoint, when it is a chained line. */
export function checkpointOf(snap: CommittedLines): IntegrityCheckpoint | undefined {
  const line = snap.lines[snap.lines.length - 1];
  const seq = parseObject(line)?.["seq"];
  if (line === undefined || typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) return undefined;
  return { seq, lineHash: hashLine(line) };
}

/** The checkpoint of a line appendChained has just written (it writes JSON.stringify(record) verbatim). */
export function checkpointOfRecord(record: Record<string, unknown>): IntegrityCheckpoint {
  const seq = record["seq"];
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) throw new Error("appendChained returned a record without a seq");
  return { seq, lineHash: hashLine(JSON.stringify(record)) };
}
