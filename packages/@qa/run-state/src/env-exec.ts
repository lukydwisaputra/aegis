import { spawn } from "node:child_process";
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
    if (m.secret && value.length >= 8) secrets.push(value);
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
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    forms.add(secret);
    forms.add(encodeURIComponent(secret));
    forms.add(JSON.stringify(secret).slice(1, -1));
    forms.add(Buffer.from(secret, "utf-8").toString("hex"));
    for (let offset = 0; offset < 3; offset++) {
      const b64 = Buffer.from("\0".repeat(offset) + secret, "utf-8").toString("base64").replace(/=+$/, "");
      const inner = b64.slice(Math.ceil((offset * 8) / 6), -1);
      if (inner.length >= 8) {
        forms.add(inner);
        forms.add(inner.replace(/\+/g, "-").replace(/\//g, "_"));
      }
    }
  }
  return [...forms].filter((f) => f.length >= 8).sort((x, y) => y.length - x.length);
}

/** Replaces every secret value in `text` with [redacted]. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join("[redacted]");
  return out;
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
      to.write(redactSecrets(buf.slice(0, -hold), forms));
      buf = buf.slice(-hold);
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
}

/**
 * Runs `cmd` in the target root with the allowlisted QA secrets injected; the child's output is redacted. A non-secret variable the
 * caller's own environment already sets is kept (an explicit override wins, for the app address); a secret one never is: the injected
 * value always reaches the child, so the redactor knows every secret the child holds. Records env.executed (the command redacted, the
 * exit code, the injected names) once the child exits. Resolves the child's exit code.
 */
export async function execWithEnv(root: string, runId: string, caller: string, cmd: string[], env: NodeJS.ProcessEnv = process.env): Promise<EnvExecResult> {
  if (cmd.length === 0) throw new RunStateError("invalid-input", "env exec needs a command after --");
  const info = envExecInfo(root, runId);
  const merged: NodeJS.ProcessEnv = { ...info.vars, ...env, ...info.forced };
  const forms = redactionForms(info.secrets);
  const exitCode = await new Promise<number>((done, fail) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd: info.cwd, env: merged, stdio: ["inherit", "pipe", "pipe"] });
    const piped = Promise.all([pipeRedacted(child.stdout!, process.stdout, forms), pipeRedacted(child.stderr!, process.stderr, forms)]);
    child.on("error", (e) => fail(new RunStateError("invalid-input", `cannot run ${cmd[0]}: ${e.message}`)));
    child.on("close", (code) => void piped.then(() => done(code ?? 1)));
  });
  // The audit record: who ran what, where, with which injected names. The command line is redacted like the output.
  await appendChained(
    { type: "env.executed", ts: new Date().toISOString(), runId, agent: caller, environment: info.environment, command: redactSecrets(cmd.join(" "), forms).slice(0, 600), exitCode, injected: info.injected },
    busPath(root, runId),
    { emittedBy: caller, runId }
  );
  return { exitCode, environment: info.environment, injected: info.injected, missing: info.missing };
}
