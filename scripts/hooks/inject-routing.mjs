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
  const RULE = "## Aegis router\n- Router rule: QA work runs only through a /qa-* command. Framework development is not QA work: do it directly.";
  let text;
  let rs = null;
  try {
    rs = await import(pathToFileURL(join(REPO, "packages/@qa/run-state/dist/index.js")).href);
  } catch (e) {
    text = `${RULE}\n- Run context unavailable: the build is missing (${e.message}); run pnpm build (or pnpm install without --ignore-scripts).`;
  }
  if (rs !== null) {
    try {
      text = rs.routingContext(ROOT);
    } catch (e) {
      // A16: the real cause (a corrupt runs/.active or config), not a build problem.
      text = `${RULE}\n- Run context unavailable: ${e.message}; run /qa-health.`;
    }
  }
  // Claude Code caps hook additionalContext at 10,000 characters; 9,000 leaves room for the JSON around it.
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text.slice(0, 9000) } }));
} catch {
  // fail open
}
process.exit(0);
