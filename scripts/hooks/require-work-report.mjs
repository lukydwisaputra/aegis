#!/usr/bin/env node
// H2 require-work-report (P0 spec §4.2): SubagentStop. A qa-* worker stops only after its claimed task has a work
// report (a fresh one not yet released is released done for it); an SPV only after its review. Records token.used.
// Exit 2 with the reason on stderr keeps the subagent working. Every other path fails open: exit 0, with any warning
// on stdout as {"systemMessage": …}. Nothing here may leak exit 1 (it would not block, but would read as a crash).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const warnings = [];

function allowAndExit() {
  if (warnings.length > 0) process.stdout.write(JSON.stringify({ systemMessage: warnings.join("\n") }) + "\n");
  process.exit(0);
}

const oneLine = (e) => String(e && e.message ? e.message : e).split("\n")[0];

// Fail open on anything unexpected (decision 3): the phase barrier still refuses unreported or unreviewed work.
const crash = (e) => {
  warnings.push(`aegis stop check: internal error (${oneLine(e)}); stop allowed`);
  allowAndExit();
};
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT = process.env.AEGIS_ROOT ? resolve(process.env.AEGIS_ROOT) : REPO; // test seam only

let input = null;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  allowAndExit();
}
if (input === null || typeof input !== "object" || Array.isArray(input)) allowAndExit();

// agent_id is the subagent signal; agent_type alone is the main thread (a --agent session), which H2 never holds.
const agentId = typeof input.agent_id === "string" && input.agent_id !== "" ? input.agent_id : null;
const agentType = typeof input.agent_type === "string" ? input.agent_type : "";
if (agentId === null || !/^qa-[a-z0-9-]+$/.test(agentType)) allowAndExit();

let rs;
try {
  rs = await import(pathToFileURL(join(REPO, "packages/@qa/run-state/dist/index.js")).href);
} catch (e) {
  warnings.push(`aegis stop check unavailable (${oneLine(e)}); stop allowed: run pnpm build (or pnpm install without --ignore-scripts, whose prepare script builds the hook packages)`);
  allowAndExit();
}

try {
  const verdict = await rs.checkSubagentStop(ROOT, {
    agentId,
    agentType,
    ...(typeof input.transcript_path === "string" && input.transcript_path !== "" ? { transcriptPath: input.transcript_path } : {}),
  });
  warnings.push(...verdict.warnings.map((w) => `aegis stop check: ${w}`));
  if (verdict.block) {
    process.stderr.write([...warnings, `aegis stop check: ${verdict.reason}`].join("\n") + "\n");
    process.exit(2);
  }
} catch (e) {
  warnings.push(`aegis stop check: internal error (${oneLine(e)}); stop allowed`);
}
allowAndExit();
