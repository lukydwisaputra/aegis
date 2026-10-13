import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { IntakeReference } from "./config.js";
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
export function copyIntake(root: string, targetProjectRoot: string, sources: string[], intakeDir: string): string[] {
  // Paths are target-relative: a leading "./" names the same files, so it is stripped (the walk never yields one).
  const globs = sources.map((g) => g.replace(/^(?:\.\/)+/, ""));
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

function headSha(dir: string): string | null {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export interface CopiedReference {
  name: string;
  root: string;
  sha: string | null;
  files: string[];
}

/**
 * Copy each pinned reference repository (aegis.config.json#intake.references) into `intake/references/{name}/`,
 * keeping paths relative to the reference root, and write `intake/references/{name}.provenance.json` with the
 * resolved root, the checkout's HEAD sha and the copied paths. A reference whose `sha` does not equal HEAD is refused:
 * the run would read a different baseline than the one pinned. All references are checked before any is copied.
 */
export function copyIntakeReferences(root: string, references: IntakeReference[], intakeDir: string): CopiedReference[] {
  const resolved = references.map((ref) => {
    const globs = ref.sources.map((g) => g.replace(/^(?:\.\/)+/, ""));
    globs.forEach(assertSafeGlob);
    const dir = resolve(root, ref.root);
    if (!existsSync(dir)) throw new RunStateError("invalid-input", `intake reference ${ref.name}: ${dir} does not exist`);
    const sha = headSha(dir);
    if (ref.sha !== undefined && sha !== ref.sha) {
      throw new RunStateError("invalid-input", `intake reference ${ref.name}: ${dir} is at ${sha ?? "no git HEAD"}, pinned ${ref.sha}`);
    }
    return { ref, globs, dir, sha };
  });
  return resolved.map(({ ref, globs, dir, sha }) => {
    const dest = join(intakeDir, "references", ref.name);
    mkdirSync(dest, { recursive: true });
    const patterns = globs.map(globToRegExp);
    const files: string[] = [];
    walk(dir, "", files, resolve(root));
    const copied = files.filter((f) => patterns.some((p) => p.test(f)));
    for (const f of copied) {
      mkdirSync(dirname(join(dest, f)), { recursive: true });
      copyFileSync(join(dir, f), join(dest, f));
    }
    const provenance = { name: ref.name, root: dir, sha, pinned: ref.sha ?? null, sources: ref.sources, files: copied };
    writeFileSync(join(intakeDir, "references", `${ref.name}.provenance.json`), JSON.stringify(provenance, null, 2) + "\n", "utf-8");
    return { name: ref.name, root: dir, sha, files: copied };
  });
}
