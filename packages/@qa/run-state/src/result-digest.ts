import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runDir } from "./paths.js";

/** The CLI's digest of a task's own files: how many, and one sha256 over their sorted paths and content hashes. */
export interface ResultDigest {
  files: number;
  sha256: string;
}

/** A task with more files than this gets no digest (and so no automatic acceptance): hashing a large evidence set is not worth a shortcut. */
export const MAX_DIGEST_FILES = 400;

const sha = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

/**
 * The case result files of the given cases, run-relative and sorted: `cases/{TC}-result.json` and the further files of the same case
 * (`{TC}-result-api.json`, `{TC}-configured-result.json`): a regular file of the cases folder named `{TC}-` followed by a name that holds
 * "result" and ends in .json. The case design `{TC}.json` and its Markdown are not results.
 */
export function caseResultFiles(root: string, runId: string, tcIds: readonly string[]): string[] {
  const dir = join(runDir(root, runId), "cases");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const want = [...new Set(tcIds)];
  const out: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    if (!want.some((tc) => name.startsWith(`${tc}-`) && name.slice(tc.length + 1).includes("result"))) continue;
    out.push(`cases/${name}`);
  }
  return out.sort();
}

/**
 * The digest of a task's recorded results at this moment, or null when the task names no case, one of its cases has no result file, there are too many
 * files (MAX_DIGEST_FILES), a file is not a regular file or cannot be read: the case result files of the cases of its latest dispatch. The set
 * depends on the dispatch only, never on what a work report lists, so two attempts of one task are comparable. A symbolic link is never read.
 * Reads only; never throws.
 */
export function taskDigest(root: string, runId: string, tcIds: readonly string[] | null): ResultDigest | null {
  try {
    if (tcIds === null || tcIds.length === 0) return null;
    const base = runDir(root, runId);
    const files = caseResultFiles(root, runId, tcIds);
    if (files.length === 0 || files.length > MAX_DIGEST_FILES) return null;
    // Every dispatched case has a recorded result: a case without one has nothing to carry forward.
    if (![...new Set(tcIds)].every((tc) => files.some((f) => f.startsWith(`cases/${tc}-`)))) return null;
    const lines: string[] = [];
    for (const rel of files) {
      const abs = join(base, rel);
      if (!lstatSync(abs).isFile()) return null;
      lines.push(`${rel}\u0000${sha(readFileSync(abs))}\n`);
    }
    return { files: files.length, sha256: sha(lines.join("")) };
  } catch {
    return null;
  }
}
