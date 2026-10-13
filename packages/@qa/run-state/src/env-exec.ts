import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import { readRunConfig, readSettings } from "./config.js";
import { RunStateError } from "./errors.js";
import { secretsFile } from "./messaging.js";
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
  for (const m of ENV_EXEC_MAP) {
    const value = file[m.from];
    if (value === undefined || value === "") {
      missing.push(m.from);
      continue;
    }
    for (const name of m.to) vars[name] = value;
    injected.push(...m.to);
    if (m.secret && value.length >= 8) secrets.push(value);
  }
  return { environment, injected, missing, cwd: resolve(root, readRunConfig(root).targetProjectRoot), vars, secrets };
}

/** Replaces every secret value in `text` with [redacted]. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join("[redacted]");
  return out;
}

function pipeRedacted(from: Readable, to: NodeJS.WriteStream, secrets: readonly string[]): Promise<void> {
  let buf = "";
  from.setEncoding("utf-8");
  from.on("data", (chunk: string) => {
    buf += chunk;
    const cut = Math.max(buf.lastIndexOf("\n"), buf.lastIndexOf("\r"));
    if (cut >= 0) {
      to.write(redactSecrets(buf.slice(0, cut + 1), secrets));
      buf = buf.slice(cut + 1);
    } else if (buf.length > 65_536) {
      to.write(redactSecrets(buf.slice(0, -256), secrets));
      buf = buf.slice(-256);
    }
  });
  return new Promise((done) => {
    from.on("end", () => {
      if (buf !== "") to.write(redactSecrets(buf, secrets));
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
 * Runs `cmd` in the target root with the allowlisted QA secrets injected; the child's output is redacted. A variable the
 * caller's own environment already sets is kept (an explicit override wins). Resolves the child's exit code.
 */
export async function execWithEnv(root: string, runId: string, cmd: string[], env: NodeJS.ProcessEnv = process.env): Promise<EnvExecResult> {
  if (cmd.length === 0) throw new RunStateError("invalid-input", "env exec needs a command after --");
  const info = envExecInfo(root, runId);
  const merged: NodeJS.ProcessEnv = { ...info.vars, ...env };
  const exitCode = await new Promise<number>((done, fail) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd: info.cwd, env: merged, stdio: ["inherit", "pipe", "pipe"] });
    const piped = Promise.all([pipeRedacted(child.stdout!, process.stdout, info.secrets), pipeRedacted(child.stderr!, process.stderr, info.secrets)]);
    child.on("error", (e) => fail(new RunStateError("invalid-input", `cannot run ${cmd[0]}: ${e.message}`)));
    child.on("close", (code) => void piped.then(() => done(code ?? 1)));
  });
  return { exitCode, environment: info.environment, injected: info.injected, missing: info.missing };
}
