import { Command } from "commander";
import { CLI_COMMANDS, findAegisRoot, recordCliRefusal, resolveCaller, resolveRunId, RunStateError } from "@qa/run-state";

export interface Ctx {
  root: string;
  caller: string;
}

export function context(): Ctx {
  return { root: findAegisRoot(), caller: resolveCaller() };
}

export function runIdFor(ctx: Ctx, explicit: string | undefined): string {
  return resolveRunId(ctx.root, explicit);
}

/** The command id of an action: `<group>.<verb>` (the Command is the action's last argument); the bare name at top level. */
export function commandIdOf(args: readonly unknown[]): string | null {
  const cmd = args[args.length - 1];
  if (!(cmd instanceof Command)) return null;
  const group = cmd.parent;
  return group !== null && group.parent !== null ? `${group.name()}.${cmd.name()}` : cmd.name();
}

/** The command words and option names the program defines (the root of `cmd`): vocabulary, never caller-typed values. */
export function vocabularyOf(cmd: Command): ReadonlySet<string> {
  let root = cmd;
  while (root.parent !== null) root = root.parent;
  const out = new Set<string>(["--help", "-h", "--version", "-V", "help"]);
  const walk = (c: Command): void => {
    out.add(c.name());
    for (const o of c.options) {
      if (o.long !== undefined) out.add(o.long);
      if (o.short !== undefined) out.add(o.short);
    }
    for (const sub of c.commands) walk(sub);
  };
  walk(root);
  return out;
}

function vocabularyOfArgs(args: readonly unknown[]): ReadonlySet<string> | undefined {
  const cmd = args[args.length - 1];
  return cmd instanceof Command ? vocabularyOf(cmd) : undefined;
}

/** The `--run` option of an action (commander passes the options object second to last). */
function runOptionOf(args: readonly unknown[]): string | undefined {
  const opts = args[args.length - 2];
  const run = opts !== null && typeof opts === "object" ? (opts as { run?: unknown }).run : undefined;
  return typeof run === "string" ? run : undefined;
}

/**
 * NEW-06: an agent's invalid-input or internal refusal goes on the run's chain as cli.refused (recordCliRefusal decides
 * whether it counts). Called after the envelope is written, and it never throws, so the command's outcome is unchanged.
 */
export async function noteRefusal(
  command: string | null,
  run: string | undefined,
  code: string,
  message: string,
  argv: readonly string[] = process.argv.slice(2),
  vocabulary?: ReadonlySet<string>
): Promise<void> {
  if (command === null) return;
  try {
    await recordCliRefusal(findAegisRoot(), { caller: resolveCaller(), run, argv, vocabulary }, { command, code, message });
  } catch {
    // No aegis root or no caller identity: there is no run to record on.
  }
}

/** A commander parse error (CO-04): the command is the leading words before the first option; `--run` when given. */
export async function noteParseRefusal(argv: readonly string[], message: string, program?: Command): Promise<void> {
  const words: string[] = [];
  for (const a of argv) {
    if (a.startsWith("-")) break;
    words.push(a);
  }
  const at = argv.findIndex((a) => a === "--run" || a.startsWith("--run="));
  const flag = at < 0 ? undefined : argv[at];
  const run = flag === undefined ? undefined : flag.includes("=") ? flag.slice("--run=".length) : argv[at + 1];
  await noteRefusal(words.length === 0 ? null : knownCommand(words), run, "invalid-input", message, argv, program === undefined ? undefined : vocabularyOf(program));
}

/** Top-level commands that are not a group of CLI_COMMANDS. */
const TOP_LEVEL = new Set(["align", "doctor", "init", "update", "reconfigure", "id"]);
const GROUPS: ReadonlySet<string> = new Set(CLI_COMMANDS.map((c) => c.split(".")[0]!));

/** Only a command the CLI knows is recorded: the leading words are what the caller typed, never a secret. */
function knownCommand(words: readonly string[]): string {
  const two = words.slice(0, 2).join(".");
  if ((CLI_COMMANDS as readonly string[]).includes(two)) return two;
  const first = words[0]!;
  return GROUPS.has(first) || TOP_LEVEL.has(first) ? first : "unknown-command";
}

/** Wrap a commander action: print the result as JSON; map refusals to exit 2, crashes to exit 1. */
export function action<A extends unknown[]>(fn: (...args: A) => unknown) {
  return async (...args: A): Promise<void> => {
    try {
      const out = await fn(...args);
      if (out !== undefined) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    } catch (e) {
      if (e instanceof RunStateError) {
        process.stderr.write(JSON.stringify({ error: e.code, message: e.message }) + "\n");
        process.exitCode = 2;
        await noteRefusal(commandIdOf(args), runOptionOf(args), e.code, e.message, process.argv.slice(2), vocabularyOfArgs(args));
        return;
      }
      if ((e as NodeJS.ErrnoException).code === "ELOCKED") {
        const message = `${(e as Error).message}; another aegis command holds this lock, retry`;
        process.stderr.write(JSON.stringify({ error: "busy", message }) + "\n");
        process.exitCode = 2;
        return;
      }
      process.stderr.write(JSON.stringify({ error: "internal", message: (e as Error).message }) + "\n");
      process.exitCode = 1;
      await noteRefusal(commandIdOf(args), runOptionOf(args), "internal", (e as Error).message, process.argv.slice(2), vocabularyOfArgs(args));
    }
  };
}
