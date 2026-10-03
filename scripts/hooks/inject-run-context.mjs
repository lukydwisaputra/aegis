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
    let rs = null;
    try {
      rs = await import(pathToFileURL(join(REPO, "packages/@qa/run-state/dist/index.js")).href);
    } catch (e) {
      text = `## Aegis run context unavailable: the build is missing (${e.message})\n- The owner must run pnpm build (or pnpm install without --ignore-scripts); until then every write you attempt is denied: report this to your dispatcher and stop.`;
    }
    if (rs !== null) {
      try {
        text = rs.runContextFor(ROOT, input.agent_type, typeof input.agent_id === "string" ? input.agent_id : undefined);
      } catch (e) {
        // A16: the real cause (an unreadable runs/.active, run directory or hooks/ ledger), not a build problem.
        text = `## Aegis run context unavailable (${e.message})\n- Report this to your dispatcher and stop; the owner checks it with /qa-health.`;
      }
    }
    // Claude Code caps hook additionalContext at 10,000 characters; 9,000 leaves room for the JSON around it.
    if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: text.slice(0, 9000) } }));
  }
} catch {
  // fail open
}
process.exit(0);
