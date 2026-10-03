#!/usr/bin/env node
// H4 inject-run-context (P0 spec §4.2): SubagentStart. Gives a qa-* agent its run, environment verdict, paths and CLI
// cheat-sheet as additional context, and records its start in the hook ledger. Never blocks: every failure exits 0.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.on("uncaughtException", () => process.exit(0));
process.on("unhandledRejection", () => process.exit(0));

try {
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const ROOT = process.env.AEGIS_ROOT ? resolve(process.env.AEGIS_ROOT) : REPO; // test seam only

  const input = JSON.parse(readFileSync(0, "utf-8"));
  if (input !== null && typeof input === "object" && typeof input.agent_type === "string" && /^qa-[a-z0-9-]+$/.test(input.agent_type)) {
    let text;
    try {
      const rs = await import(pathToFileURL(join(REPO, "packages/@qa/run-state/dist/index.js")).href);
      text = rs.runContextFor(ROOT, input.agent_type, typeof input.agent_id === "string" ? input.agent_id : undefined);
    } catch (e) {
      text = `## Aegis run context unavailable (${e.message})\n- Run pnpm install (its prepare script builds the CLI); until then every write you attempt is denied.`;
    }
    if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: text.slice(0, 9000) } }));
  }
} catch {
  // fail open
}
process.exit(0);
