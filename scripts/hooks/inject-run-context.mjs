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
        // The Claude Code session of this start (liveness: a resume from another session ends this instance).
        const session =
          typeof input.session_id === "string" && input.session_id !== ""
            ? input.session_id
            : typeof input.transcript_path === "string" && input.transcript_path.endsWith(".jsonl")
              ? input.transcript_path.split("/").pop().slice(0, -".jsonl".length)
              : undefined;
        text = rs.runContextFor(ROOT, input.agent_type, typeof input.agent_id === "string" ? input.agent_id : undefined, undefined, session);
        // A stale dist: the agent files drop CLAUDE.md at once but this build has no rules core to replace it.
        if (text && typeof rs.subagentRulesLines !== "function") {
          text += "\n- The build is older than the source (no rules core): before your first write read CLAUDE.md (Read/write policy, Brand exposure rule, ID format, Gitignore rule) and tell your dispatcher the owner must run pnpm build.";
        }
      } catch (e) {
        // A16: the real cause (an unreadable runs/.active, run directory or hooks/ ledger), not a build problem.
        // A stale dist without the export must still print the failure line.
        let name;
        try {
          name = typeof rs.projectNameOf === "function" ? rs.projectNameOf(ROOT) : undefined;
        } catch {
          name = undefined;
        }
        const core = typeof rs.subagentRulesLines === "function" ? rs.subagentRulesLines(name).join("\n") + "\n" : "";
        text = `${core}## Aegis run context unavailable (${e.message})\n- Report this to your dispatcher and stop; the owner checks it with /qa-health.`;
      }
    }
    // Claude Code caps hook additionalContext at 10,000 characters; 9,000 leaves room for the JSON around it.
    if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: text.slice(0, 9000) } }));
  }
} catch {
  // fail open
}
process.exit(0);
