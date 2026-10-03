import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { loadGuardContext } from "@qa/path-guard";
import { RunStateError } from "./errors.js";

/** The packages `aegis helpers vendor` copies into the target's QA tests (P2 spec §4.11.3, AUD-054). */
export const VENDORED_HELPERS = ["test-helpers", "supabase"] as const;
export type VendoredHelper = (typeof VENDORED_HELPERS)[number];

export interface VendorResult {
  /** Files written this time (new, or changed since the last copy). */
  written: string[];
  /** Files already identical to the package source. */
  unchanged: string[];
  /** Written files that existed with other content: a hand edit or an older copy, now overwritten. */
  drift: string[];
}

/** `--helpers test-helpers,supabase` → the distinct helper names; an empty or unknown name is invalid-input. */
export function parseHelperList(raw: string): VendoredHelper[] {
  const names = raw.split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (names.length === 0) throw new RunStateError("invalid-input", `--helpers names no helper; choose from ${VENDORED_HELPERS.join(", ")}`);
  for (const n of names) {
    if (!(VENDORED_HELPERS as readonly string[]).includes(n)) {
      throw new RunStateError("invalid-input", `unknown helper "${n}"; choose from ${VENDORED_HELPERS.join(", ")}`);
    }
  }
  return [...new Set(names)] as VendoredHelper[];
}

/** The first line of every copied file. */
export function vendoredHeader(name: VendoredHelper, version: string): string {
  return `// Vendored QA helper ${name} ${version}. Regenerated each cycle; do not edit.`;
}

function isLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** p with its nearest existing ancestor replaced by that ancestor's real path (symlinks resolved); a missing tail is kept. */
function realNearest(p: string): string {
  let cur = p;
  let tail = "";
  for (;;) {
    try {
      return join(realpathSync(cur), tail);
    } catch {
      const up = join(cur, "..");
      if (up === cur) return p;
      tail = join(basename(cur), tail);
      cur = up;
    }
  }
}

/**
 * Copy packages/@qa/<name>/src/index.ts to <testsDir>/support/<name>.ts for each helper, with the header line prepended.
 * Idempotent: an identical file is left alone; a different one is overwritten and reported as drift. The tests dir is the
 * one the write guard uses (path-guard loadGuardContext), so a misconfigured testsDir is refused before anything is written.
 * Nothing is written through a symlink: the tests dir, the support dir and each copy must be real, and the support dir's
 * real path must stay inside the target's real path.
 */
export function vendorHelpers(root: string, helpers: readonly VendoredHelper[]): VendorResult {
  let ctx: ReturnType<typeof loadGuardContext>;
  try {
    ctx = loadGuardContext(root);
  } catch (e) {
    throw new RunStateError("invalid-input", (e as Error).message);
  }
  const testsDir = ctx.testsDir;
  const supportDir = join(testsDir, "support");
  const refuse = (why: string): never => {
    throw new RunStateError("invalid-input", `refusing to write helpers: ${why}`);
  };
  if (isLink(testsDir)) refuse(`${testsDir} is a symlink`);
  if (isLink(supportDir)) refuse(`${supportDir} is a symlink`);
  const realTarget = realNearest(ctx.targetRoot);
  const realSupport = realNearest(supportDir);
  const rel = relative(realTarget, realSupport);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) refuse(`${supportDir} resolves outside the target`);

  const plan = helpers.map((name) => {
    const pkg = join(root, "packages", "@qa", name);
    const { version } = JSON.parse(readFileSync(join(pkg, "package.json"), "utf-8")) as { version: string };
    const file = join(supportDir, `${name}.ts`);
    if (isLink(file)) refuse(`${file} is a symlink`);
    return { file, content: `${vendoredHeader(name, version)}\n${readFileSync(join(pkg, "src", "index.ts"), "utf-8")}` };
  });

  const out: VendorResult = { written: [], unchanged: [], drift: [] };
  for (const { file, content } of plan) {
    const existed = existsSync(file);
    if (existed && readFileSync(file, "utf-8") === content) {
      out.unchanged.push(file);
      continue;
    }
    mkdirSync(supportDir, { recursive: true });
    writeFileSync(file, content, "utf-8");
    out.written.push(file);
    if (existed) out.drift.push(file);
  }
  return out;
}
