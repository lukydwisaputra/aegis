import { existsSync } from "node:fs";
import { join } from "node:path";
import { ADAPTERS } from "@qa/messaging";
import { appendLedger, CLI_ONLY_RUN_GLOBS, envVerdict, loadGuardContext, roleOf } from "@qa/path-guard";
import { AGENT_ID, assertCallerAllowed, CLI_COMMANDS, type CliCommand } from "./caller.js";
import { readActiveRun } from "./paths.js";
import { readRun } from "./run.js";
import { iso } from "./util.js";

/** At most this many open gates, escalations or blocks are named one by one; the rest are counted. */
const MAX_LISTED = 10;

/** The CLI cheat-sheet (spec §4.2 H4, CO-11): every command with its flags, as `aegis <usage>`. */
export const CLI_USAGE: Readonly<Record<CliCommand, string>> = {
  "run.create": "run create --env <name> --module <CODES...> [--cycle full|smoke] [--health passed|failed|not-run] [--intake <globs...>]",
  "run.status": "run status [--run <id>]",
  "run.stop": "run stop --reason <text> [--run <id>]",
  "run.resume": "run resume [--acknowledge-integrity --reason <text>] [--run <id>]",
  "run.reissue": "run reissue --phase <id> --reason <text> [--run <id>]",
  "run.descope": "run descope --case <id> --reason <text> [--run <id>]",
  "event.append": "event append --type <type> --json '<fields>' [--run <id>]",
  "id.next": "id next --kind TC|DEF|STORY|REQ|RISK|AC [--module <CODE>] [--story <id> --category happy|rejection|edge] [--defect-type <t>]",
  "task.add": "task add --id <id> --title <text> --agent <qa-*> [--description <text>] [--run <id>]",
  "task.claim": "task claim --task <id> [--run <id>]",
  "task.release": "task release --task <id> --result done|failed [--run <id>]",
  "task.cancel": "task cancel --task <id> --reason <text> [--run <id>]",
  "task.list": "task list [--phase <id>] [--run <id>]",
  "work-report.submit": "work-report submit --file /dev/stdin [--run <id>]",
  "review.submit": "review submit --file /dev/stdin [--run <id>]",
  "integrity.verify": "integrity verify [--run <id>]",
  "integrity.repair-tail": "integrity repair-tail [--run <id>]",
  "phase.start": "phase start --phase <id> [--run <id>]",
  "phase.complete": "phase complete --phase <id> [--not-applicable] [--run <id>]",
  "gate.open": "gate open --gate G1|G2|G3 [--run <id>]",
  "gate.decide": "gate decide --gate G1|G2|G3 --decision approved|approved-with-conditions|rejected --note <text> [--reopen-phase <id>] [--run <id>]",
  "gate.auto-decide": "gate auto-decide --gate G2 [--run <id>]",
  "run.complete": "run complete [--run <id>]",
  "escalation.decide": "escalation decide --task <id> --decision retry|accept-with-risk|abort --reason <text> [--run <id>]",
  "helpers.vendor": "helpers vendor --helpers test-helpers[,supabase,messaging]",
  "messaging.fetch-contract": "messaging fetch-contract [--run <id>]",
  "messaging.plan": "messaging plan [--run <id>]",
  "messaging.check": "messaging check [--run <id>]",
  "messaging.scan-secrets": "messaging scan-secrets <paths...> [--run <id>]",
  "messaging.exec": "messaging exec [--run <id>] -- <command...>",
  "metrics.coverage": "metrics coverage [--run <id>]",
};

/** NEW-07: each messaging adapter with the hints that identify it in a target, so the scanner never hard-codes a provider. */
export const MESSAGING_ADAPTERS_LINE = `- Messaging adapters: ${Object.values(ADAPTERS).map((a) => `${a.id} (${a.detectionHints})`).join("; ")}.`;

/** NEW-06 (P2 spec §4.12, T10): the one framework-defect instruction every qa-* agent gets. */
export const FRAMEWORK_DEFECT_LINE =
  "- If an `aegis` command, skill, path or config key your instructions name is missing or behaves differently from your instructions, append `framework.defect-suspected` with the component, the symptom and the evidence (`event append --type framework.defect-suspected --json '{\"component\":…,\"symptom\":…,\"evidence\":[…]}'`). Then continue if you can, or release your task `failed` if you cannot. Never edit the framework to work around it.";

function allowedFor(agent: string): CliCommand[] {
  return CLI_COMMANDS.filter((cmd) => {
    try {
      assertCallerAllowed(agent, cmd);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * H4 inject-run-context (spec §4.2): what a qa-* subagent needs before its first tool call — the active run, its
 * environment verdict, absolute paths, writable globs, the exact CLI prefix and the commands it may run. Records the
 * agent instance's start in the hook ledger. Null for agents that are not qa-*.
 */
export function runContextFor(root: string, agentType: string, agentId?: string, now?: Date): string | null {
  if (!AGENT_ID.test(agentType)) return null;
  const prefix = `AEGIS_AGENT=${agentType} pnpm aegis`;
  const lines = ["## Aegis run context (SubagentStart hook)"];
  const runId = readActiveRun(root);
  if (runId === null) {
    lines.push("- No active run: commands that need a run refuse until your dispatcher creates or resumes one; report that and stop.");
  } else {
    // First, so a context that cannot be built (a corrupt config) never loses the start H2 times an SPV from.
    if (agentId !== undefined && agentId !== "") appendLedger(root, runId, { ts: iso(now), agentId, agentType, kind: "start" });
    // A16: a context that cannot be loaded (a corrupt aegis.config.json) is reported with its own cause, not as a build problem.
    let ctx: ReturnType<typeof loadGuardContext> | null = null;
    try {
      ctx = loadGuardContext(root);
    } catch (e) {
      lines.push(`- Configuration unreadable (${(e as Error).message}): every write you attempt is denied until the owner repairs aegis.config.json; report this to your dispatcher and stop.`);
    }
    try {
      const state = readRun(root, runId);
      lines.push(`- Active run: ${runId} (status ${state.status}, phase ${state.currentPhase ?? "none"}, environment ${state.environment}).`);
      if (ctx !== null) {
        const verdict = envVerdict(agentType, state.currentPhase, state.environment, ctx.envPolicy);
        lines.push(
          verdict.allowed
            ? `- Environment verdict: ${agentType} is allowed in ${state.environment}.`
            : `- Environment verdict: BLOCKED — ${verdict.reason} every write you attempt is denied and aegis task claim refuses you: report this to your dispatcher and stop.`
        );
      }
    } catch (e) {
      lines.push(`- Active run: ${runId}, but its run.json is unreadable (${(e as Error).message}); report this to your dispatcher and stop.`);
    }
    lines.push(
      ctx === null
        ? `- Paths: run ${join(root, "runs", runId)}; sandbox ${join(root, "sandbox")}.`
        : `- Paths: run ${ctx.runDir ?? join(root, "runs", runId)}; QA tests ${ctx.testsDir}; target ${ctx.targetRoot}; sandbox ${join(root, "sandbox")}.`
    );
  }
  const role = roleOf(agentType);
  const writes = role === undefined ? "nothing (no row in the path-guard role table)" : role.writes.length === 0 ? "nothing directly — you work through the CLI" : role.writes.join(", ");
  lines.push(`- You may write: ${writes} ({run} = the run directory, {testsDir} = the QA tests directory, {target} = the target root).`);
  lines.push(`- Never write these, which the CLI owns (the PreToolUse hook denies the write): runs/.active and, inside a run, ${CLI_ONLY_RUN_GLOBS.join(", ")}.`);
  lines.push(FRAMEWORK_DEFECT_LINE);
  lines.push(`- Prefix every CLI call exactly as shown; the hook denies a missing or different AEGIS_AGENT. Commands you may run:`);
  for (const cmd of allowedFor(agentType)) lines.push(`  - \`${prefix} ${CLI_USAGE[cmd]}\``);
  lines.push(MESSAGING_ADAPTERS_LINE);
  return lines.join("\n");
}

/**
 * H3 inject-routing (spec §4.2, §4.3): the router rule and the active run, for the main thread on every prompt.
 * The routing table itself is `.claude/routing.yaml` (P0c-2); it is named only when it exists.
 */
export function routingContext(root: string): string {
  const lines = [
    "## Aegis router (UserPromptSubmit hook)",
    "- Router rule: QA work runs only through a /qa-* command, which dispatches qa-orchestrator. The main thread never does the QA work itself and never hand-writes QA artefacts (runs/**, tests/qa/**) outside a /qa-* command (the PreToolUse hook denies it). For a QA request, if no command fits, say so and propose one.",
    "- Framework development (Aegis agents, skills, packages or HANDBOOK, on a branch) is not QA work: do it directly, do not route it.",
    existsSync(join(root, ".claude", "routing.yaml"))
      ? "- Routing table: .claude/routing.yaml — pick the ready command whose intent matches; ask when two fit."
      : "- Pick the /qa-* command whose description matches the request (/qa-help lists them); ask when two fit.",
  ];
  const runId = readActiveRun(root);
  if (runId === null) {
    lines.push("- Active run: none.");
    return lines.join("\n");
  }
  const list = (items: string[]): string => (items.length > MAX_LISTED ? `${items.slice(0, MAX_LISTED).join(", ")} and ${items.length - MAX_LISTED} more` : items.join(", "));
  try {
    const s = readRun(root, runId);
    lines.push(`- Active run: ${runId} — status ${s.status}, phase ${s.currentPhase ?? "none"}, environment ${s.environment}${s.stopRequested ? ", stop requested" : ""}.`);
    const open = Object.entries(s.gates).filter(([, g]) => g?.status === "open").map(([id]) => id);
    if (open.length > 0) lines.push(`- Open gate: ${list(open)} — the owner decides it with /qa-gate-decide.`);
    const escalations = s.blockedBy.filter((c) => c.kind === "escalation").map((c) => c.taskId ?? "?");
    if (escalations.length > 0) lines.push(`- Open escalation: ${list(escalations)} — decide it with /qa-escalation.`);
    const other = s.blockedBy.filter((c) => c.kind !== "escalation").map((c) => `${c.kind}: ${c.reason}`);
    if (other.length > 0) lines.push(`- Blocked: ${list(other)} — see /qa-resume.`);
  } catch (e) {
    lines.push(`- Active run: ${runId}, run.json unreadable (${(e as Error).message}); run /qa-health.`);
  }
  return lines.join("\n");
}
