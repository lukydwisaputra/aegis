import { createReadStream, existsSync, readFileSync, statSync, unwatchFile, watchFile } from "node:fs";
import { createInterface } from "node:readline";
import { AegisEventSchema, type AegisEvent } from "@qa/contracts";

// CO-01: every write goes through appendChained (chain.ts). This module only reads.

// ─── tail ─────────────────────────────────────────────────────────────────────

export type EventFilter = (event: AegisEvent) => boolean;

/**
 * Read all existing events from a bus file and yield them.
 * Optionally filter by event type or custom predicate.
 */
export async function* tail(
  busPath: string,
  filter?: EventFilter
): AsyncGenerator<AegisEvent> {
  if (!existsSync(busPath)) return;

  const stream = createReadStream(busPath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line);
      const parsed = AegisEventSchema.safeParse(raw);
      if (!parsed.success) continue;
      if (!filter || filter(parsed.data)) {
        yield parsed.data;
      }
    } catch {
      // Skip malformed lines
    }
  }
}

// ─── subscribe ────────────────────────────────────────────────────────────────

export type SubscriptionHandler = (event: AegisEvent) => void | Promise<void>;

export interface Subscription {
  unsubscribe(): void;
}

/**
 * Subscribe to new events as they are appended to the bus.
 * Uses fs.watchFile polling; calls handler for each new line added.
 * Returns a subscription with an unsubscribe() method.
 */
export function subscribe(
  busPath: string,
  filter: EventFilter,
  handler: SubscriptionHandler,
  pollIntervalMs = 200
): Subscription {
  let lastSize = existsSync(busPath) ? statSync(busPath).size : 0;
  let active = true;

  watchFile(busPath, { interval: pollIntervalMs }, async (_curr, _prev) => {
    if (!active) return;
    if (!existsSync(busPath)) return;
    const currentSize = statSync(busPath).size;
    if (currentSize <= lastSize) return;

    const buffer = Buffer.alloc(currentSize - lastSize);
    const fd = (await import("node:fs")).openSync(busPath, "r");
    (await import("node:fs")).readSync(fd, buffer, 0, buffer.length, lastSize);
    (await import("node:fs")).closeSync(fd);
    lastSize = currentSize;

    const newContent = buffer.toString("utf-8");
    for (const line of newContent.split("\n")) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line);
        const parsed = AegisEventSchema.safeParse(raw);
        if (!parsed.success) continue;
        if (filter(parsed.data)) {
          await handler(parsed.data);
        }
      } catch {
        // Skip malformed lines
      }
    }
  });

  return {
    unsubscribe() {
      active = false;
      unwatchFile(busPath);
    },
  };
}

// ─── readAll ──────────────────────────────────────────────────────────────────

/**
 * Synchronously read all events from a bus file.
 * Returns an empty array if the file does not exist.
 */
export function readAll(busPath: string, filter?: EventFilter): AegisEvent[] {
  if (!existsSync(busPath)) return [];
  const lines = readFileSync(busPath, "utf-8").split("\n");
  const events: AegisEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line);
      const parsed = AegisEventSchema.safeParse(raw);
      if (!parsed.success) continue;
      if (!filter || filter(parsed.data)) {
        events.push(parsed.data);
      }
    } catch {
      // Skip
    }
  }
  return events;
}

// ─── typeFilter helper ────────────────────────────────────────────────────────

export function typeFilter(...types: string[]): EventFilter {
  const set = new Set(types);
  return (e) => set.has(e.type);
}

export type { AegisEvent };
export * from "./chain.js";
