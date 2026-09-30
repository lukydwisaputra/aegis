import { readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";

/** Packages whose dist `aegis align` executes. */
export const ALIGN_BUILD_INPUTS: readonly string[] = ["packages/@qa/contracts", "packages/@qa/run-state", "packages/@qa/alignment", "apps/cli"];

function newest(dir: string): number {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let t = 0;
  for (const e of entries) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

/** The first package whose `src` has a file newer than `dist/index.js`, or null when every build is fresh (AH-14). */
export function staleBuild(root: string, packages: readonly string[] = ALIGN_BUILD_INPUTS): string | null {
  for (const pkg of packages) {
    let built: number;
    try {
      built = statSync(join(root, pkg, "dist", "index.js")).mtimeMs;
    } catch {
      return `${pkg}: dist/index.js is missing`;
    }
    if (newest(join(root, pkg, "src")) > built) return `${pkg}: src is newer than dist`;
  }
  return null;
}
