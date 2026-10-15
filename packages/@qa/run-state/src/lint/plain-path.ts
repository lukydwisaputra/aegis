import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/**
 * Whether `rel` is `kind` ("file" or "any": a regular file or a directory) of the run directory `dir` reached through no symbolic link: no
 * component after the run directory is a link (its real path is the run's real path plus `rel`), so a link in the middle of a path
 * (reports/closure/linkdir/x.md) never reads a file outside the run. An absolute path or one with `..` is never one.
 */
function plain(dir: string, relative: string, kind: "file" | "any"): boolean {
  const rel = kind === "any" ? relative.replace(/\/+$/, "") : relative;
  if (rel === "" || isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) return false;
  try {
    const abs = join(dir, rel);
    if (realpathSync(abs) !== join(realpathSync(dir), rel)) return false;
    const st = lstatSync(abs);
    return st.isFile() || (kind === "any" && st.isDirectory());
  } catch {
    return false;
  }
}

/** A regular file of the run directory, through no symbolic link (see plain). */
export const plainRunFile = (dir: string, rel: string): boolean => plain(dir, rel, "file");

/** A regular file or a directory of the run directory, through no symbolic link (see plain): where a defect's evidence entry may point. */
export const plainRunPath = (dir: string, rel: string): boolean => plain(dir, rel, "any");
