import { accessSync, closeSync, constants, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeSync, type Stats } from "node:fs";
import { basename, join, relative } from "node:path";
import { loadGuardContext, within } from "@qa/path-guard";
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

const refuse = (why: string): never => {
  throw new RunStateError("invalid-input", `refusing to write helpers: ${why}`);
};

const isMissing = (e: unknown): boolean => {
  const code = (e as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
};

/** lstat that treats only a missing path as absent; any other error refuses (fail closed). */
function lstatOrNull(p: string): Stats | null {
  try {
    return lstatSync(p);
  } catch (e) {
    if (isMissing(e)) return null;
    return refuse(`cannot inspect ${p}: ${(e as Error).message}`);
  }
}

/** p with its nearest existing ancestor replaced by that ancestor's real path (symlinks resolved); a missing tail is kept. */
function realNearest(p: string): string {
  let cur = p;
  let tail = "";
  for (;;) {
    try {
      return join(realpathSync.native(cur), tail);
    } catch (e) {
      if (!isMissing(e)) return refuse(`cannot resolve ${cur}: ${(e as Error).message}`);
      const up = join(cur, "..");
      if (up === cur) return p;
      tail = join(basename(cur), tail);
      cur = up;
    }
  }
}

/** Open without following a symlink or blocking on a FIFO, check the handle, then replace the content. */
function writeCopy(file: string, content: string): void {
  let fd: number;
  try {
    fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o644);
  } catch (e) {
    return refuse(`cannot write ${file}: ${(e as Error).message}`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1) refuse(`${file} is not a plain single-link file`);
    ftruncateSync(fd, 0);
    const buf = Buffer.from(content, "utf-8");
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off, off);
  } catch (e) {
    if (e instanceof RunStateError) throw e;
    refuse(`cannot write ${file}: ${(e as Error).message}`);
  } finally {
    closeSync(fd);
  }
}

/**
 * Copy packages/@qa/<name>/src/index.ts to <testsDir>/support/<name>.ts for each helper, with the header line prepended.
 * Idempotent: an identical file is left alone; a different one is overwritten and reported as drift. The tests dir is the
 * one the write guard uses (path-guard loadGuardContext), so a misconfigured testsDir is refused before anything is written.
 * Everything is validated before the first write. No symlink may sit between the target root and a copy (the support dir's
 * real path must equal its lexical path under the target's real path), the support dir must be a directory, and each copy
 * must be absent or a plain single-link file, opened with O_NOFOLLOW.
 */
export function vendorHelpers(root: string, helpers: readonly VendoredHelper[]): VendorResult {
  let ctx: ReturnType<typeof loadGuardContext>;
  try {
    ctx = loadGuardContext(root);
  } catch (e) {
    throw new RunStateError("invalid-input", (e as Error).message);
  }
  const supportDir = join(ctx.testsDir, "support");

  const targetStat = lstatOrNull(ctx.targetRoot);
  if (targetStat === null || !isDirectoryFollowing(ctx.targetRoot)) refuse(`the target root ${ctx.targetRoot} is not a directory`);
  if (!within(ctx.targetRoot, supportDir)) refuse(`${supportDir} is outside the target`);
  const expected = join(realpathSync.native(ctx.targetRoot), relative(ctx.targetRoot, supportDir));
  const real = realNearest(supportDir);
  if (real !== expected) refuse(`${supportDir} does not match its real path ${real}`);
  const supportStat = lstatOrNull(supportDir);
  if (supportStat !== null && !supportStat.isDirectory()) refuse(`${supportDir} is not a directory`);

  const plan = helpers.map((name) => {
    // The package sources are framework files: a missing or unreadable one is a framework defect, left to throw (internal).
    const pkg = join(root, "packages", "@qa", name);
    const { version } = JSON.parse(readFileSync(join(pkg, "package.json"), "utf-8")) as { version: string };
    const content = `${vendoredHeader(name, version)}\n${readFileSync(join(pkg, "src", "index.ts"), "utf-8")}`;
    const file = join(supportDir, `${name}.ts`);
    const st = lstatOrNull(file);
    if (st !== null && (!st.isFile() || st.nlink !== 1)) refuse(`${file} is not a plain single-link file`);
    const same = st !== null && readDestination(file) === content;
    if (st !== null && !same) assertWritable(file);
    return { file, content, existed: st !== null, same };
  });

  const out: VendorResult = { written: [], unchanged: [], drift: [] };
  for (const { file, content, existed, same } of plan) {
    if (same) {
      out.unchanged.push(file);
      continue;
    }
    try {
      try {
        mkdirSync(supportDir, { recursive: true });
      } catch (e) {
        refuse(`cannot create ${supportDir}: ${(e as Error).message}`);
      }
      writeCopy(file, content);
    } catch (e) {
      if (e instanceof RunStateError && out.written.length > 0) {
        throw new RunStateError(e.code, `${e.message}; already written: [${out.written.join(", ")}]`);
      }
      throw e;
    }
    out.written.push(file);
    if (existed) out.drift.push(file);
  }
  return out;
}

/** statSync(p).isDirectory(), following symlinks; a dangling or unreadable link refuses (invalid-input). */
function isDirectoryFollowing(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch (e) {
    return refuse(`cannot resolve the target root ${p}: ${(e as Error).message}`);
  }
}

/** The current content of an existing copy in the target; unreadable is the target's state, not a framework defect. */
function readDestination(file: string): string {
  try {
    return readFileSync(file, "utf-8");
  } catch (e) {
    return refuse(`cannot read ${file}: ${(e as Error).message}`);
  }
}

/** An existing copy that will be overwritten must be writable, checked before the first write. */
function assertWritable(file: string): void {
  try {
    accessSync(file, constants.W_OK);
  } catch (e) {
    refuse(`cannot write ${file}: ${(e as Error).message}`);
  }
}
