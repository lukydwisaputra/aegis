import { spawn } from "node:child_process";
import { constants as osConstants } from "node:os";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import { readRunConfig, readSettings } from "./config.js";
import { RunStateError } from "./errors.js";
import { secretsFile } from "./messaging.js";
import { appendChained } from "@qa/event-bus";
import { busPath } from "./paths.js";
import { readRun } from "./run.js";

/**
 * The QA secrets a test runner may receive, and the names the target's own test fixtures read them under.
 * Nothing else in the secrets file is ever injected (no messaging key, no tokens): the list is the whole contract.
 */
export const ENV_EXEC_MAP: ReadonlyArray<{ from: string; to: readonly string[]; secret: boolean }> = [
  { from: "SUPABASE_URL", to: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"], secret: false },
  { from: "SUPABASE_ANON_KEY", to: ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"], secret: true },
  { from: "SUPABASE_SERVICE_ROLE_KEY", to: ["SUPABASE_SERVICE_ROLE_KEY"], secret: true },
  { from: "SUPABASE_JWT_SECRET", to: ["SUPABASE_JWT_SECRET"], secret: true },
  { from: "ENCRYPTION_DEV_KEY", to: ["ENCRYPTION_DEV_KEY"], secret: true },
  { from: "BLIND_INDEX_DEV_KEY", to: ["BLIND_INDEX_DEV_KEY"], secret: true },
  // The app's own address, for specs that build absolute URLs; an explicit value in the caller's environment still wins.
  { from: "APP_BASE_URL", to: ["NEXT_PUBLIC_APP_URL"], secret: false },
  // A disposable Postgres the developer RLS and invariant suites may rewrite (never the shared database).
  { from: "TEST_PG_URL", to: ["TEST_PG_URL"], secret: true },
];

export interface EnvExecInfo {
  environment: string;
  injected: string[];
  missing: string[];
  cwd: string;
  vars: Record<string, string>;
  /** The injected variables whose values are secrets: the caller's own environment never replaces these. */
  forced: Record<string, string>;
  secrets: string[];
}

/**
 * Variables `aegis env exec` injects for the run's environment: the allowlisted QA secrets under the target's own
 * names, plus NEXT_PUBLIC_APP_ENV (the environment name). Refuses a read-only environment (production is never mutated).
 */
export function envExecInfo(root: string, runId: string): EnvExecInfo {
  const environment = readRun(root, runId).environment;
  if (readSettings(root).readOnlyEnvironments.includes(environment)) {
    throw new RunStateError("invalid-input", `env exec is refused for the read-only environment ${environment}`);
  }
  const file = secretsFile(root, environment);
  const vars: Record<string, string> = { NEXT_PUBLIC_APP_ENV: environment };
  const injected: string[] = [];
  const missing: string[] = [];
  const secrets: string[] = [];
  const forced: Record<string, string> = {};
  for (const m of ENV_EXEC_MAP) {
    const value = file[m.from];
    if (value === undefined || value === "") {
      missing.push(m.from);
      continue;
    }
    for (const name of m.to) {
      vars[name] = value;
      if (m.secret) forced[name] = value;
    }
    injected.push(...m.to);
    if (m.secret && value.length >= 4) secrets.push(value);
  }
  return { environment, injected, missing, cwd: resolve(root, readRunConfig(root).targetProjectRoot), vars, forced, secrets };
}

/**
 * Every form of a secret the redactor looks for: the value, its base64 and base64url encodings at the three byte alignments a longer
 * string can put it at (the edge characters that depend on the neighbouring bytes are left out), its URL-encoded, JSON-escaped and hex
 * forms. A secret printed reversed, split across lines or run through a cipher is not recognised: no filter can promise that, so the
 * guarantee is "the usual ways a runner prints a credential", not "the agent can never learn it".
 */
export function redactionForms(secrets: readonly string[]): string[] {
  const forms = new Set<string>();
  // An encoding that differs from the value is kept at 4 characters or more for the forms that keep the value's own text (a percent-encoded
  // or JSON-escaped "p%40ss"); the hex and base64 forms are opaque, so they need 8 characters not to match by chance.
  const derived = (f: string, raw: string, min = 8): void => {
    if (f !== raw && f.length >= min) forms.add(f);
  };
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    forms.add(secret);
    const pct = encodeURIComponent(secret);
    derived(pct, secret, 4);
    derived(pct.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()), secret, 4);
    derived(JSON.stringify(secret).slice(1, -1), secret, 4);
    const hex = Buffer.from(secret, "utf-8").toString("hex");
    derived(hex, secret);
    derived(hex.toUpperCase(), secret);
    for (let offset = 0; offset < 3; offset++) {
      const b64 = Buffer.from("\0".repeat(offset) + secret, "utf-8").toString("base64").replace(/=+$/, "");
      const inner = b64.slice(Math.ceil((offset * 8) / 6), -1);
      derived(inner, secret);
      derived(inner.replace(/\+/g, "-").replace(/\//g, "_"), secret);
    }
  }
  return [...forms].sort((x, y) => y.length - x.length);
}

const redactors = new WeakMap<readonly string[], RegExp>();

/**
 * Replaces every secret form in `text` with [redacted], in one pass (longest form first at each position), so an inserted marker is
 * never scanned again by a later form: a four-character secret cannot cut "[redacted]" itself.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  if (secrets.length === 0) return text;
  let re = redactors.get(secrets);
  if (re === undefined) {
    const longestFirst = [...secrets].sort((x, y) => y.length - x.length);
    re = new RegExp(longestFirst.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
    redactors.set(secrets, re);
  }
  return text.replace(re, "[redacted]");
}

function pipeRedacted(from: Readable, to: NodeJS.WriteStream, forms: readonly string[]): Promise<void> {
  // With no newline in sight, keep back the longest form (and at least 256 characters) so a secret that straddles a flush is still seen whole.
  const hold = Math.max(256, ...forms.map((f) => f.length));
  let buf = "";
  from.setEncoding("utf-8");
  from.on("data", (chunk: string) => {
    buf += chunk;
    const cut = Math.max(buf.lastIndexOf("\n"), buf.lastIndexOf("\r"));
    if (cut >= 0) {
      to.write(redactSecrets(buf.slice(0, cut + 1), forms));
      buf = buf.slice(cut + 1);
    } else if (buf.length > 65_536 + hold) {
      // Redact the whole buffer first, then emit all but its last hold - 1 characters: a form that straddles the cut is either whole
      // (and already replaced) or has fewer than hold characters inside the buffer, so only the held tail can carry a part of one.
      const redacted = redactSecrets(buf, forms);
      to.write(redacted.slice(0, -(hold - 1)));
      buf = redacted.slice(-(hold - 1));
    }
  });
  return new Promise((done) => {
    from.on("end", () => {
      if (buf !== "") to.write(redactSecrets(buf, forms));
      done();
    });
  });
}

export interface EnvExecResult {
  exitCode: number;
  environment: string;
  injected: string[];
  missing: string[];
  /** false when the command ran but env.executed could not be appended (the failure is also written to stderr). */
  auditRecorded: boolean;
}

/**
 * Runs `cmd` in the target root with the allowlisted QA secrets injected; the child's output is redacted. A non-secret variable the
 * caller's own environment already sets is kept (an explicit override wins, for the app address); a secret one never is: the injected
 * value always reaches the child, so the redactor knows every secret the child holds. SIGINT, SIGTERM and SIGHUP are forwarded to the
 * child, so stopping the CLI stops the runner and the audit below is still written. Records env.executed (the command redacted, the
 * exit code, the injected names) once the child exits; when that append fails the command's exit code is still returned, with
 * `auditRecorded: false` and a message on stderr, because the tests already ran. Resolves the child's exit code.
 *
 * What this does NOT do: restrict what the command does with the credentials. The agent chooses the command, and a command that sends
 * $SUPABASE_SERVICE_ROLE_KEY to a network host or writes it to a file leaves no trace in the redacted output. The guarantee is the
 * usual ways a runner prints a credential are redacted, the callers are limited (caller.ts) and every run is recorded; it is not that an
 * agent can never move a credential somewhere else. Fixed runner entry points or egress control would be the next step.
 */
export async function execWithEnv(root: string, runId: string, caller: string, cmd: string[], env: NodeJS.ProcessEnv = process.env): Promise<EnvExecResult> {
  if (cmd.length === 0) throw new RunStateError("invalid-input", "env exec needs a command after --");
  const info = envExecInfo(root, runId);
  const merged: NodeJS.ProcessEnv = { ...info.vars, ...env, ...info.forced };
  const forms = redactionForms(info.secrets);
  const killAfterMs = Number(process.env["AEGIS_ENV_EXEC_KILL_MS"] ?? 10_000);
  const exitCode = await new Promise<number>((done, fail) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd: info.cwd, env: merged, stdio: ["inherit", "pipe", "pipe"] });
    let spawned = false;
    child.on("spawn", () => { spawned = true; });
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    let escalation: NodeJS.Timeout | undefined;
    // A stop signal for the CLI is a stop signal for the runner: forward it once, and if the runner is still there after killAfterMs
    // kill it, so the CLI (whose default signal exit these listeners replace) cannot be left waiting on a runner that ignores it. On a
    // terminal Ctrl-C already reached the runner through the foreground process group, so SIGINT is not sent a second time.
    const forward = (sig: NodeJS.Signals): void => {
      if (!(sig === "SIGINT" && process.stdin.isTTY)) child.kill(sig);
      escalation ??= setTimeout(() => void child.kill("SIGKILL"), killAfterMs);
      escalation.unref();
    };
    for (const sig of signals) process.on(sig, forward);
    const cleanup = (): void => {
      for (const sig of signals) process.off(sig, forward);
      if (escalation !== undefined) clearTimeout(escalation);
    };
    const piped = Promise.all([pipeRedacted(child.stdout!, process.stdout, forms), pipeRedacted(child.stderr!, process.stderr, forms)]);
    child.on("error", (e) => {
      // Node also emits "error" when a signal cannot be delivered; only a runner that never started is a failure to report.
      if (spawned) return;
      cleanup();
      fail(new RunStateError("invalid-input", `cannot run ${cmd[0]}: ${e.message}`));
    });
    child.on("close", (code, signal) => {
      cleanup();
      // A runner killed by a signal has no exit code: 128 + the signal number, as a shell reports it.
      void piped.then(() => done(code ?? (signal !== null ? 128 + (osConstants.signals[signal] ?? 0) : 1)));
    });
  });
  let auditRecorded = true;
  try {
    // The audit record: who ran what, where, with which injected names. The command line is redacted like the output.
    await appendChained(
      { type: "env.executed", ts: new Date().toISOString(), runId, agent: caller, environment: info.environment, command: redactSecrets(cmd.join(" "), forms).slice(0, 600), exitCode, injected: info.injected },
      busPath(root, runId),
      { emittedBy: caller, runId }
    );
  } catch (e) {
    auditRecorded = false;
    process.stderr.write(`aegis: env.executed could not be recorded (${(e as Error).message}); the command ran and exited ${exitCode}\n`);
  }
  return { exitCode, environment: info.environment, injected: info.injected, missing: info.missing, auditRecorded };
}
