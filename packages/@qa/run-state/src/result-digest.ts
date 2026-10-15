import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadGuardContext } from "@qa/path-guard";
import { specRefsOfFiles } from "./lint/specs.js";
import { runDir } from "./paths.js";

/** The CLI's digest of a task's own files: how many, and one sha256 over their sorted keys and content hashes. */
export interface ResultDigest {
  files: number;
  sha256: string;
}

/** A task with more files or bytes than this gets no digest (and so no automatic acceptance): hashing a large evidence set is not worth a shortcut. */
export const MAX_DIGEST_FILES = 2000;
export const MAX_DIGEST_BYTES = 128 * 1024 * 1024;
const MAX_NAMED_EVIDENCE = 300;
const MAX_DEPTH = 8;

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

/** Every string of a parsed document, bounded in depth. */
function stringsOf(v: unknown, out: string[], depth = 0): void {
  if (depth > MAX_DEPTH || out.length > 5000) return;
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsOf(x, out, depth + 1);
  else if (v !== null && typeof v === "object") for (const x of Object.values(v)) stringsOf(x, out, depth + 1);
}

/** The run-relative evidence paths a result document names (`evidence/...`, also as `runs/{runId}/evidence/...`), as written. */
function namedEvidence(runId: string, doc: unknown): string[] {
  const all: string[] = [];
  stringsOf(doc, all);
  const out = new Set<string>();
  for (const raw of all) {
    if (raw.length > 400 || /\s/.test(raw)) continue;
    let p = raw.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
    const marker = `runs/${runId}/`;
    const at = p.indexOf(marker);
    if (at >= 0) p = p.slice(at + marker.length);
    if (!p.startsWith("evidence/") || p.split("/").includes("..") || p === "evidence/") continue;
    out.add(p.replace(/\/+$/, ""));
  }
  return [...out].sort();
}

interface Collector {
  entries: Array<{ key: string; abs: string; size: number }>;
  bytes: number;
}

/** Adds the regular file or the regular files under the directory at `rel` (run-relative): false when a link is met, a name is missing or a limit is hit. */
function addRunPath(base: string, rel: string, c: Collector, mustExist: boolean): boolean {
  let at = base;
  const parts = rel.split("/");
  for (let i = 0; i < parts.length; i++) {
    at = join(at, parts[i]!);
    let st;
    try {
      st = lstatSync(at);
    } catch {
      return !mustExist;
    }
    if (st.isSymbolicLink()) return false;
    if (i < parts.length - 1 && !st.isDirectory()) return false;
  }
  return addNode(at, rel, c);
}

function addNode(abs: string, key: string, c: Collector): boolean {
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) return false;
  if (st.isFile()) {
    c.bytes += st.size;
    c.entries.push({ key, abs, size: st.size });
    return c.entries.length <= MAX_DIGEST_FILES && c.bytes <= MAX_DIGEST_BYTES;
  }
  if (!st.isDirectory()) return false;
  for (const name of readdirSync(abs).sort()) if (!addNode(join(abs, name), `${key}/${name}`, c)) return false;
  return true;
}

/**
 * The digest of a task's own files at this moment, or null when it cannot be determined or is too large (MAX_DIGEST_FILES, MAX_DIGEST_BYTES):
 * the case result files of the cases of its latest dispatch (each case needs one), the case designs, the spec files under the tests directory
 * that those files name (specRef, specFile, specFiles, automatedTestRef), and the evidence: every file under `evidence/{TC}/` of each case
 * and every evidence path a result file names. The set depends on the dispatch and on what the case and result files name, never on what a
 * work report lists, so two attempts of one task are comparable. A symbolic link is never followed (null); a spec that is named but missing,
 * a link or a secrets file, and an evidence path that is named but missing, make the set indeterminate (null: the SPV decides). A spec outside
 * the tests directory is not the QA team's to write and is left out. Reads only; never throws.
 */
export function taskDigest(root: string, runId: string, tcIds: readonly string[] | null): ResultDigest | null {
  try {
    if (tcIds === null || tcIds.length === 0) return null;
    const tcs = [...new Set(tcIds)];
    const base = runDir(root, runId);
    const results = caseResultFiles(root, runId, tcs);
    if (results.length === 0) return null;
    // Every dispatched case has a recorded result: a case without one has nothing to carry forward.
    if (!tcs.every((tc) => results.some((f) => f.startsWith(`cases/${tc}-`)))) return null;
    const c: Collector = { entries: [], bytes: 0 };
    const designs: string[] = [];
    for (const tc of tcs) {
      try {
        if (lstatSync(join(base, "cases", `${tc}.json`)).isFile()) designs.push(`cases/${tc}.json`);
      } catch {
        // a case without a design file in the run: nothing more to hash for it
      }
    }
    for (const rel of [...results, ...designs]) if (!addRunPath(base, rel, c, true)) return null;
    // Spec files named by the case designs and the result files.
    const refs = specRefsOfFiles(root, runId, [...designs, ...results]);
    if (refs.skipped.some((s) => s.reason !== "outside")) return null;
    if (refs.resolved.length > 0) {
      const targetRoot = loadGuardContext(root).targetRoot;
      for (const rel of refs.resolved) {
        const abs = join(targetRoot, rel);
        const st = lstatSync(abs);
        if (!st.isFile()) return null;
        c.bytes += st.size;
        c.entries.push({ key: `target:${rel}`, abs, size: st.size });
      }
    }
    // Evidence: the folder of each case and every evidence path a result file names.
    const named = new Set<string>();
    for (const rel of results) {
      let doc: unknown;
      try {
        doc = JSON.parse(readFileSync(join(base, rel), "utf-8"));
      } catch {
        return null;
      }
      for (const p of namedEvidence(runId, doc)) named.add(p);
    }
    if (named.size > MAX_NAMED_EVIDENCE) return null;
    for (const tc of tcs) if (!addRunPath(base, `evidence/${tc}`, c, false)) return null;
    for (const p of named) if (!p.startsWith(`evidence/`) || !addRunPath(base, p, c, true)) return null;
    // A file may be reached twice (a named path inside a case folder): hashed once.
    const unique = [...new Map(c.entries.map((e) => [e.key, e])).values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    if (unique.length > MAX_DIGEST_FILES || unique.reduce((n, e) => n + e.size, 0) > MAX_DIGEST_BYTES) return null;
    const lines: string[] = [];
    for (const e of unique) lines.push(`${e.key}\u0000${sha(readFileSync(e.abs))}\n`);
    return { files: unique.length, sha256: sha(lines.join("")) };
  } catch {
    return null;
  }
}
