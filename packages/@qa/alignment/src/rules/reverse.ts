import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { pathExists } from "../load.js";
import { violation, type Model, type Violation } from "../types.js";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PLACEHOLDER = /^\{[^{}]+\}$/;

function list(m: Model, rel: string): string[] {
  try {
    return readdirSync(join(m.root, rel));
  } catch {
    return [];
  }
}

/** `packages/*`, `packages/@scope/*` and `apps/*` roots (the checker's own package excluded). */
function packageDirs(m: Model): string[] {
  const dirs: string[] = [];
  for (const scope of list(m, "packages")) {
    if (scope.startsWith("@")) for (const p of list(m, `packages/${scope}`)) dirs.push(`packages/${scope}/${p}`);
    else dirs.push(`packages/${scope}`);
  }
  for (const a of list(m, "apps")) dirs.push(`apps/${a}`);
  return dirs;
}

function sourceFiles(m: Model, dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(join(m.root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return sourceFiles(m, rel);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(e.name) && pathExists(m, rel) ? [rel] : [];
  });
}

function packageSources(m: Model): string {
  return packageDirs(m)
    .filter((d) => d !== "packages/@qa/alignment")
    .flatMap((d) => sourceFiles(m, `${d}/src`))
    .map((f) => {
      try {
        return readFileSync(join(m.root, f), "utf-8");
      } catch {
        return "";
      }
    })
    .join("\n");
}

/** Spec §8: top- and second-level aegis.config.json keys no contract lists and no package source reads (AUD-007). */
export function unusedConfigRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const refs = [...m.units.values()]
    .flatMap((u) => u.contract?.config ?? [])
    .filter((r) => r.startsWith("aegis.config.json#"))
    .map((r) => r.slice("aegis.config.json#".length).split("."));
  const src = packageSources(m);
  const keys: string[][] = [];
  for (const [k, v] of Object.entries(m.aegisConfig)) {
    keys.push([k]);
    if (v !== null && typeof v === "object" && !Array.isArray(v)) for (const k2 of Object.keys(v)) keys.push([k, k2]);
  }
  for (const key of keys) {
    const listed = refs.some((r) => key.every((s, i) => r[i] !== undefined && (r[i] === s || PLACEHOLDER.test(r[i]!))));
    const read = new RegExp(`\\b${escapeRe(key[key.length - 1]!)}\\b`).test(src);
    if (!listed && !read) {
      out.push(violation("CONFIG", "aegis.config.json", key.join("."), "unused", "aegis.config.json", 1, `aegis.config.json#${key.join(".")} is listed by no contract and read by no package source`));
    }
  }
  return out;
}

const PNPM_BUILTINS = new Set([
  "add", "approve-builds", "audit", "bin", "config", "create", "deploy", "dlx", "env", "exec", "fetch", "i", "import", "init",
  "install", "licenses", "link", "list", "ls", "outdated", "pack", "patch", "patch-commit", "prune", "publish", "rebuild",
  "remove", "rm", "root", "run", "setup", "start", "store", "test", "unlink", "up", "update", "why",
]);

function knownScripts(m: Model): Set<string> {
  const out = new Set(PNPM_BUILTINS);
  const files = ["package.json", "__internal-tests__/package.json", ...packageDirs(m).map((d) => `${d}/package.json`)];
  for (const f of files.filter((x) => pathExists(m, x))) {
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(readFileSync(join(m.root, f), "utf-8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    const obj = (v: unknown) => (v !== null && typeof v === "object" ? Object.keys(v) : []);
    for (const s of obj(pkg["scripts"])) out.add(s);
    for (const d of [...obj(pkg["dependencies"]), ...obj(pkg["devDependencies"])]) out.add(d.split("/").pop()!); // package bins
  }
  return out;
}

/** `pnpm <name>` inside backtick spans and fenced code; fenced comment lines are prose. */
function pnpmNames(source: string): Array<{ name: string; line: number }> {
  const out: Array<{ name: string; line: number }> = [];
  let fence = false;
  source.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\r$/, "");
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    const spans = fence ? (line.trim().startsWith("#") ? [] : [line]) : [...line.matchAll(/`([^`\n]+)`/g)].map((x) => x[1]!);
    for (const s of spans) for (const x of s.matchAll(/(?:^|[\s;&|(])pnpm\s+(?:run\s+)?([a-z][a-z0-9:_-]*)/g)) out.push({ name: x[1]!, line: i + 1 });
  });
  return out;
}

/** Spec §8: `@qa/<name>` must be a package under packages/@qa/; `pnpm <script>` a root/workspace script, bin or pnpm command (AUD-066/073). */
export function docNameRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const scripts = knownScripts(m);
  for (const x of m.pipeline?.externalScripts ?? []) scripts.add(x);
  for (const { file, source } of m.docs) {
    const seen = new Set<string>();
    source.split("\n").forEach((line, i) => {
      for (const x of line.matchAll(/@qa\/([a-z0-9-]+)/g)) {
        const detail = `@qa/${x[1]}`;
        if (seen.has(detail) || pathExists(m, `packages/@qa/${x[1]}`)) continue;
        seen.add(detail);
        out.push(violation("DOC-REF", file, detail, "unknown-package", file, i + 1, `${detail} is not a package in packages/@qa/`));
      }
    });
    for (const { name, line } of pnpmNames(source)) {
      if (scripts.has(name) || seen.has(`pnpm:${name}`)) continue;
      seen.add(`pnpm:${name}`);
      out.push(violation("DOC-REF", file, name, "unknown-script", file, line, `pnpm ${name} is not a root or workspace script, bin or pnpm command`));
    }
  }
  return out;
}

const TIER_DIRS: Array<[RegExp, string]> = [
  [/orchestrator/i, "orchestrator"],
  [/devops/i, "tier2-5-devops"],
  [/phase/i, "tier1-phase"],
  [/specialist/i, "tier2-specialist"],
  [/spv/i, "spv"],
  [/compliance/i, "compliance"],
  [/cross/i, "crosscutting"],
];

/** Spec §8: "N agents" claims equal the agent file count; tier-table counts equal the files per tier directory (AUD-075). */
export function countRule(m: Model): Violation[] {
  const out: Violation[] = [];
  const agentUnits = [...m.units.values()].filter((u) => u.kind === "agent");
  const perDir = new Map<string, number>();
  for (const u of agentUnits) {
    const d = u.file.split("/")[2] ?? "";
    perDir.set(d, (perDir.get(d) ?? 0) + 1);
  }
  for (const { file, source } of m.docs) {
    const seen = new Set<string>();
    let countCol = -1;
    source.split("\n").forEach((line, i) => {
      for (const c of line.matchAll(/\b(\d{2,}) agents\b/g)) {
        const claim = `${c[1]} agents`;
        const near = line.slice(0, c.index).split(/\s+/).slice(-6).join(" "); // the 5 words before the number
        if (/\blite\b[^,.;:()|]*$/i.test(near) && !/\bfull\b/i.test(near)) continue; // a lite-profile subset, not the total
        if (Number(c[1]) === agentUnits.length || seen.has(claim)) continue;
        seen.add(claim);
        out.push(violation("DOC-REF", file, claim, "count-mismatch", file, i + 1, `${file} claims ${claim}; .claude/agents has ${agentUnits.length} agent files`));
      }
      if (!line.startsWith("|")) {
        countCol = -1;
        return;
      }
      const cells = line.split("|").slice(1, -1).map((x) => x.trim());
      if (cells[0] === "Tier") {
        countCol = cells.indexOf("Count");
        return;
      }
      if (countCol < 0) return;
      const n = Number(cells[countCol]);
      const dir = TIER_DIRS.find(([re]) => re.test(cells[0] ?? ""))?.[1];
      if (dir === undefined || !Number.isInteger(n)) return;
      const actual = perDir.get(dir) ?? 0;
      const claim = `${dir}=${n}`;
      if (n === actual || seen.has(claim)) return;
      seen.add(claim);
      out.push(violation("DOC-REF", file, claim, "count-mismatch", file, i + 1, `${file} tier row "${cells[0]}" claims ${n}; .claude/agents/${dir} has ${actual}`));
    });
  }
  return out;
}
