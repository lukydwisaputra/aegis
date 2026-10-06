import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { appendChained } from "@qa/event-bus";
import { ADAPTERS, DEFAULT_FAKE_RECIPIENTS, adapterFor, apiPrefix, fakeRecipientProblem, type MessagingContract, type MessagingPlan } from "@qa/messaging";
import { parse as parseYaml } from "yaml";
import { readRunConfig } from "./config.js";
import { RunStateError } from "./errors.js";
import { busPath, runDir } from "./paths.js";
import { readRun } from "./run.js";

/** aegis.config.json#messaging after validation (NEW-07). */
export interface MessagingConfig {
  adapter: string;
  stubPort: number;
  dispatchTimeoutSeconds: number;
  fakeRecipients: { email: string; phone: string };
  env: { baseUrl: string | null; token: string | null };
  /** aegis.config.json#messaging.<adapter> */
  adapterBlock: Record<string, unknown>;
}

const bad = (msg: string): never => {
  throw new RunStateError("invalid-input", msg);
};
const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const dig = (o: Record<string, unknown>, dotted: string): unknown => dotted.split(".").reduce<unknown>((cur, k) => obj(cur)[k], o);

/** Validates aegis.config.json#messaging; null when the block is absent. A leftover emailAdapter is refused. */
export function assertMessagingConfig(raw: Record<string, unknown>): MessagingConfig | null {
  if ("emailAdapter" in raw) bad("aegis.config.json#emailAdapter was removed (NEW-07): delete it and configure messaging.adapter instead");
  if (raw["messaging"] === undefined) return null;
  const m = obj(raw["messaging"]);
  const adapter = String(m["adapter"]);
  if (!(adapter in ADAPTERS)) bad(`unknown messaging adapter "${adapter}"; known: ${Object.keys(ADAPTERS).join(", ")}`);
  const int = (key: string, dflt: number, max: number): number => {
    const v = m[key] ?? dflt;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > max) bad(`aegis.config.json#messaging.${key} must be an integer 1-${max}`);
    return v as number;
  };
  const fakes = { ...DEFAULT_FAKE_RECIPIENTS, ...obj(m["fakeRecipients"]) } as { email: string; phone: string };
  for (const kind of ["email", "phone"] as const) {
    const problem = fakeRecipientProblem(kind, String(fakes[kind]));
    if (problem !== null) bad(`aegis.config.json#messaging.fakeRecipients.${kind}: ${problem}`);
  }
  const envBlock = obj(m["env"]);
  const name = (key: "baseUrl" | "token"): string | null => {
    const v = envBlock[key] ?? null;
    if (v !== null && (typeof v !== "string" || !ENV_NAME.test(v))) bad(`aegis.config.json#messaging.env.${key} must be null or an env var name`);
    return v as string | null;
  };
  const adapterBlock = obj(m[adapter]);
  for (const key of adapterFor(adapter).requiredConfig) {
    const v = dig(adapterBlock, key);
    if (typeof v !== "string" || v === "") bad(`aegis.config.json#messaging.${adapter}.${key} is required`);
  }
  return {
    adapter,
    stubPort: int("stubPort", 4010, 65535),
    dispatchTimeoutSeconds: int("dispatchTimeoutSeconds", 90, 3600),
    fakeRecipients: fakes,
    env: { baseUrl: name("baseUrl"), token: name("token") },
    adapterBlock,
  };
}

export function messagingPaths(root: string, runId: string): { dir: string; contract: string; plan: string } {
  const dir = join(runDir(root, runId), "messaging");
  return { dir, contract: join(dir, "contract.json"), plan: join(dir, "plan.json") };
}

function configOf(root: string): MessagingConfig {
  return readRunConfig(root).messaging ?? bad("aegis.config.json has no messaging block (NEW-07)");
}

type Gh = (args: string[]) => string;
const defaultGh: Gh = (args) => execFileSync("gh", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });

/** Fetches the adapter's contract through `gh`, writes runs/<id>/messaging/contract.json and records messaging.contract-fetched. */
export async function fetchContract(root: string, runId: string, caller: string, gh: Gh = defaultGh): Promise<{ adapter: string; sha: string; file: string }> {
  const cfg = configOf(root);
  const src = adapterFor(cfg.adapter).contractSource(cfg.adapterBlock);
  let raw: string;
  try {
    raw = gh(["api", `repos/${src.repo}/contents/${src.path}?ref=${encodeURIComponent(src.ref)}`]);
  } catch (e) {
    const why = String((e as { stderr?: unknown }).stderr ?? (e as Error).message).split("\n")[0]!.trim();
    return bad(`contract fetch failed: ${why}`);
  }
  const res = obj(JSON.parse(raw));
  const sha = String(res["sha"] ?? "");
  let openapi: Record<string, unknown>;
  try {
    openapi = obj(parseYaml(Buffer.from(String(res["content"] ?? ""), "base64").toString("utf-8")));
  } catch (e) {
    return bad(`contract fetch failed: ${src.path} is not YAML (${(e as Error).message})`);
  }
  if (sha === "" || openapi["paths"] === undefined) bad(`contract fetch failed: ${src.repo}/${src.path}@${src.ref} has no OpenAPI paths`);
  const contract: MessagingContract = { adapter: cfg.adapter, ...src, sha, fetchedAt: new Date().toISOString(), openapi };
  const p = messagingPaths(root, runId);
  mkdirSync(p.dir, { recursive: true });
  writeFileSync(p.contract, JSON.stringify(contract, null, 2) + "\n");
  await appendChained({ type: "messaging.contract-fetched", ts: new Date().toISOString(), runId, adapter: cfg.adapter, sha }, busPath(root, runId), { emittedBy: caller, runId });
  return { adapter: cfg.adapter, sha, file: p.contract };
}

interface EnvNames { baseUrl: string; token: string; source: "config" | "profile" }

function envNames(root: string, runId: string, cfg: MessagingConfig): EnvNames {
  if (cfg.env.baseUrl !== null && cfg.env.token !== null) return { baseUrl: cfg.env.baseUrl, token: cfg.env.token, source: "config" };
  let profile: Record<string, unknown> = {};
  try {
    profile = obj(obj(JSON.parse(readFileSync(join(runDir(root, runId), "target-profile.json"), "utf-8")))["messaging"]);
  } catch {
    // an unreadable profile leaves the names unknown
  }
  const valid = (v: unknown): string | null => (typeof v === "string" && ENV_NAME.test(v) ? v : null);
  const baseUrl = cfg.env.baseUrl ?? valid(profile["baseUrlEnv"]);
  const token = cfg.env.token ?? valid(profile["tokenEnv"]);
  if (baseUrl === null || token === null) bad("messaging env names unknown: the profile detected none; set aegis.config.json#messaging.env.baseUrl and messaging.env.token");
  return { baseUrl: baseUrl!, token: token!, source: cfg.env.baseUrl !== null || cfg.env.token !== null ? "config" : "profile" };
}

/** Builds runs/<id>/messaging/plan.json from the adapter, the config, the profile and the fetched contract. Holds no secret. */
export function buildPlan(root: string, runId: string): MessagingPlan {
  const cfg = configOf(root);
  const p = messagingPaths(root, runId);
  if (!existsSync(p.contract)) bad("no contract for this run: run aegis messaging fetch-contract first");
  const contract = JSON.parse(readFileSync(p.contract, "utf-8")) as MessagingContract;
  const adapter = adapterFor(cfg.adapter);
  const names = envNames(root, runId, cfg);
  const prefix = apiPrefix(contract.openapi);
  const plan: MessagingPlan = {
    adapter: adapter.id,
    stubPort: cfg.stubPort,
    dispatchTimeoutSeconds: cfg.dispatchTimeoutSeconds,
    fakeRecipients: cfg.fakeRecipients,
    env: { baseUrl: names.baseUrl, token: names.token },
    prefix,
    wiringLine: `${names.baseUrl}=http://127.0.0.1:${cfg.stubPort}${prefix}`,
    operations: adapter.operations,
    recipientFields: [...adapter.recipientFields],
    staticChecklist: [...adapter.staticChecklist],
    probe: adapter.probeDescription,
  };
  writeFileSync(p.plan, JSON.stringify(plan, null, 2) + "\n");
  return plan;
}

/** KEY=VALUE lines of the aegis secrets file for the development environment; {} when absent. */
function secretsFile(root: string): Record<string, string> {
  const file = join(root, "secrets", [".env", "development"].join("."));
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/.exec(line);
    if (m === null) continue;
    const raw = m[2]!.trim();
    const quoted = /^(['"])(.*?)\1(?:\s+#.*)?$/.exec(raw);
    out[m[1]!] = quoted !== null ? quoted[2]! : raw.replace(/\s+#.*$/, "").trim();
  }
  return out;
}

function assertDevelopment(root: string, runId: string): void {
  const env = readRun(root, runId).environment;
  if (env !== "development") bad(`the messaging specialist runs only in the development environment (this run: ${env})`);
}

/** Variables `aegis messaging exec` injects, and whether a key was found. Values never leave this process except to the child. */
export function messagingEnv(root: string, runId: string, env: NodeJS.ProcessEnv = process.env): { vars: Record<string, string>; key: "present" | "absent"; cwd: string } {
  assertDevelopment(root, runId);
  const cfg = configOf(root);
  const names = envNames(root, runId, cfg);
  const file = secretsFile(root);
  const base = env[names.baseUrl] || file[names.baseUrl];
  const key = env[names.token] || file[names.token];
  const p = messagingPaths(root, runId);
  const vars: Record<string, string> = { AEGIS_MESSAGING_PLAN: p.plan, AEGIS_MESSAGING_CONTRACT: p.contract };
  if (base) Object.assign(vars, { [names.baseUrl]: base, AEGIS_MESSAGING_BASE_URL: base });
  if (key) Object.assign(vars, { [names.token]: key, AEGIS_MESSAGING_KEY: key });
  return { vars, key: base && key ? "present" : "absent", cwd: resolve(root, readRunConfig(root).targetProjectRoot) };
}

/** Runs `cmd` in the target root with the messaging variables injected; resolves the child's exit code. */
export function execWithMessaging(root: string, runId: string, cmd: string[]): Promise<{ exitCode: number; key: "present" | "absent" }> {
  if (cmd.length === 0) bad("messaging exec needs a command after --");
  const { vars, key, cwd } = messagingEnv(root, runId);
  return new Promise((done, fail) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd, env: { ...process.env, ...vars }, stdio: "inherit" });
    child.on("error", (e) => fail(new RunStateError("invalid-input", `cannot run ${cmd[0]}: ${e.message}`)));
    child.on("exit", (code) => done({ exitCode: code ?? 1, key }));
  });
}

export interface MessagingCheck {
  contract: { present: boolean; sha: string | null };
  stubPort: { port: number; free: boolean };
  key: "present" | "absent";
  envNames: EnvNames | null;
}

const portFree = (port: number): Promise<boolean> =>
  new Promise((done) => {
    const s = createServer();
    s.once("error", () => done(false));
    s.listen(port, "127.0.0.1", () => s.close(() => done(true)));
  });

/** Setup facts for the environment engineer: presence only, never a value. */
export async function checkMessaging(root: string, runId: string, env: NodeJS.ProcessEnv = process.env): Promise<MessagingCheck> {
  const cfg = configOf(root);
  const p = messagingPaths(root, runId);
  const sha = existsSync(p.contract) ? String(obj(JSON.parse(readFileSync(p.contract, "utf-8")))["sha"] ?? "") || null : null;
  let names: EnvNames | null = null;
  let key: "present" | "absent" = "absent";
  try {
    names = envNames(root, runId, cfg);
    const file = secretsFile(root);
    key = env[names.token] || file[names.token] ? "present" : "absent";
  } catch {
    names = null;
  }
  return { contract: { present: sha !== null, sha }, stubPort: { port: cfg.stubPort, free: await portFree(cfg.stubPort) }, key, envNames: names };
}

const MAX_SCAN_BYTES = 5 * 1024 * 1024;
export type SkipReason = "missing" | "too-large" | "unreadable";
export interface SkippedFile { file: string; reason: SkipReason }

/** Collects the regular files under p; a symlink is ignored, anything not scanned is listed in `skipped`. */
function walk(p: string, files: string[], skipped: SkippedFile[]): void {
  let st;
  try {
    st = lstatSync(p);
  } catch (e) {
    skipped.push({ file: p, reason: (e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable" });
    return;
  }
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) {
    let entries: string[];
    try {
      entries = readdirSync(p);
    } catch {
      skipped.push({ file: p, reason: "unreadable" });
      return;
    }
    for (const e of entries) if (e !== "node_modules" && e !== ".git") walk(join(p, e), files, skipped);
  } else if (st.isFile()) {
    if (st.size > MAX_SCAN_BYTES) skipped.push({ file: p, reason: "too-large" });
    else files.push(p);
  }
}

export interface ScanResult {
  hits: Array<{ file: string; line: number; kind: "key-pattern" | "key-value" }>;
  /** Files actually read. */
  scanned: number;
  /** Paths not scanned and why: a clean result is only clean for what was scanned. */
  skipped: SkippedFile[];
}

/** file:line of every key-pattern or key-value occurrence under `paths`; the match itself is never returned. */
export function scanSecrets(root: string, runId: string, paths: string[], env: NodeJS.ProcessEnv = process.env): ScanResult {
  const cfg = configOf(root);
  const pattern = adapterFor(cfg.adapter).keyPattern;
  let value: string | undefined;
  try {
    const names = envNames(root, runId, cfg);
    value = env[names.token] || secretsFile(root)[names.token];
  } catch {
    value = undefined;
  }
  const files: string[] = [];
  const skipped: SkippedFile[] = [];
  for (const p of paths) walk(resolve(p), files, skipped);
  const hits: ScanResult["hits"] = [];
  let scanned = 0;
  for (const file of files.sort()) {
    let text: string;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      skipped.push({ file, reason: "unreadable" });
      continue;
    }
    scanned++;
    text.split("\n").forEach((line, i) => {
      if (pattern.test(line)) hits.push({ file, line: i + 1, kind: "key-pattern" });
      else if (value !== undefined && value.length >= 8 && line.includes(value)) hits.push({ file, line: i + 1, kind: "key-value" });
    });
  }
  return { hits, scanned, skipped };
}
