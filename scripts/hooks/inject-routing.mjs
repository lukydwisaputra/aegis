#!/usr/bin/env node
// H3 inject-routing (P0 spec §4.2): UserPromptSubmit. Gives the main thread the router rule and the active run.
// Never blocks a prompt: every failure exits 0.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.on("uncaughtException", () => process.exit(0));
process.on("unhandledRejection", () => process.exit(0));

try {
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const ROOT = process.env.AEGIS_ROOT ? resolve(process.env.AEGIS_ROOT) : REPO; // test seam only

  JSON.parse(readFileSync(0, "utf-8"));
  let text;
  try {
    const rs = await import(pathToFileURL(join(REPO, "packages/@qa/run-state/dist/index.js")).href);
    text = rs.routingContext(ROOT);
  } catch (e) {
    text = `## Aegis router\n- Router rule: QA work runs only through a /qa-* command. Framework development is not QA work: do it directly. (Run context unavailable: ${e.message}; run pnpm install.)`;
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text.slice(0, 9000) } }));
} catch {
  // fail open
}
process.exit(0);
