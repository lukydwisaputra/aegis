import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { RunStateError } from "./errors.js";

const SKIP_DIRS = new Set(["node_modules", ".git"]);

/** `**` any segments, `*` within a segment, `?` one character; target-relative, posix separators. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function assertSafeGlob(glob: string): void {
  if (glob.trim() === "" || glob.startsWith("/") || glob.split("/").includes("..")) {
    throw new RunStateError("invalid-input", `intake source "${glob}" must be a target-relative glob without ".."`);
  }
}

// Walks the target; skips node_modules, .git, symlinks and the aegis root itself (it lives inside the target).
function walk(dir: string, rel: string, out: string[], skip: string): void {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (abs === skip) continue;
    const path = rel === "" ? name : `${rel}/${name}`;
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(abs, path, out, skip);
    } else if (st.isFile()) out.push(path);
  }
}

/**
 * Copy target files matching `globs` (aegis.config.json#intake.sources, or --intake) into `intakeDir`,
 * keeping their target-relative paths (spec §6.3). Always creates `intakeDir`; returns the copied paths.
 */
export function copyIntake(root: string, targetProjectRoot: string, globs: string[], intakeDir: string): string[] {
  globs.forEach(assertSafeGlob);
  mkdirSync(intakeDir, { recursive: true });
  const target = resolve(root, targetProjectRoot);
  if (globs.length === 0) return [];
  if (!existsSync(target)) throw new RunStateError("invalid-input", `targetProjectRoot ${target} does not exist; cannot copy intake sources`);
  const patterns = globs.map(globToRegExp);
  const files: string[] = [];
  walk(target, "", files, resolve(root));
  const copied = files.filter((f) => patterns.some((p) => p.test(f)));
  for (const f of copied) {
    const dest = join(intakeDir, f);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(target, f), dest);
  }
  return copied;
}
