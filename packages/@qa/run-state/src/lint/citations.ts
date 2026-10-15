import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runDir } from "../paths.js";
import { finding, isPlain, snippet } from "./data-util.js";
import { MAX_TEXT_BYTES } from "./mask.js";
import { plainRunFile, plainRunPath } from "./plain-path.js";
import type { Finding } from "./text.js";

/**
 * citation-dangling (warning): a citation in the closure or a compliance file that points at nothing in the run.
 * - An open question `OQ-n` must be an id of closure.json#openQuestions (checked only when the closure lists its questions: a closure that
 *   states only a count, as the older runs do, gives nothing to resolve against).
 * - A `cases/...` path must name a case file of this run (the path, or the path with `.json`), reached through no symbolic link. A glob
 *   (`*`), a name that is not case-file shaped (TC-..., .json, .md: "test cases/scenarios" is prose), a path under another run's `runs/RUN-.../` prefix and a longer path that merely contains `cases/` (tests/qa/cases/...) are not
 *   citations of this run.
 * Reads the parsed string values of the JSON files (a key is never a citation) and the text of the Markdown files; one finding per file
 * and citation, with the id or the path as a short masked snippet. Reads only.
 */
const DANGLING = "this citation names nothing in the run: cite an open question the closure lists, and a case file that exists, or remove it";

const OQ = /\bOQ-\d+\b/g;
/** A name that looks like a case file: TC-... or a .json/.md file. Prose such as "test cases/scenarios" is not a citation. */
const CASE_NAME = /^(?:TC-[A-Z]{2,8}-\d+|.*\.(?:json|md)$)/;
const CASE_PATH = /(?<![A-Za-z0-9_.\-/])(?:runs\/(RUN-[A-Za-z0-9-]+)\/)?cases\/([A-Za-z0-9_.\-/*]+)/g;

function listFiles(dir: string, rel: string, ext: RegExp): string[] {
  try {
    return readdirSync(join(dir, rel)).filter((n) => ext.test(n)).sort().map((n) => `${rel}/${n}`);
  } catch {
    return [];
  }
}

function read(dir: string, rel: string): string | undefined {
  if (!plainRunFile(dir, rel)) return undefined;
  try {
    if (lstatSync(join(dir, rel)).size > MAX_TEXT_BYTES) return undefined;
    return readFileSync(join(dir, rel), "utf-8");
  } catch {
    return undefined;
  }
}

/** The string values of a parsed JSON document. */
function values(v: unknown, out: string[]): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) values(x, out);
  else if (isPlain(v)) for (const x of Object.values(v)) values(x, out);
  return out;
}

/** The ids of closure.json#openQuestions, or null when the closure does not list its questions. */
function openQuestionIds(dir: string): Set<string> | null {
  const raw = read(dir, "reports/closure/closure.json");
  if (raw === undefined) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlain(doc) || !Array.isArray(doc["openQuestions"])) return null;
  return new Set((doc["openQuestions"] as unknown[]).flatMap((q) => (isPlain(q) && typeof q["id"] === "string" ? [q["id"]] : [])));
}

export function citationFindings(root: string, runId: string): Finding[] {
  const dir = runDir(root, runId);
  const questions = openQuestionIds(dir);
  const files = [
    ...listFiles(dir, "reports/closure", /\.(?:json|md)$/),
    ...listFiles(dir, "reports/compliance", /\.(?:json|md)$/),
  ];
  const out: Finding[] = [];
  for (const rel of files) {
    const raw = read(dir, rel);
    if (raw === undefined) continue;
    let texts: string[];
    if (rel.endsWith(".json")) {
      try {
        texts = values(JSON.parse(raw), []);
      } catch {
        continue; // not JSON: the closure and compliance checks report that
      }
    } else {
      texts = [raw];
    }
    const seen = new Set<string>();
    const add = (cited: string, context: string): void => {
      if (seen.has(cited)) return;
      seen.add(cited);
      out.push(finding("citation-dangling", "warning", rel, DANGLING, context));
    };
    for (const text of texts) {
      if (questions !== null) {
        for (const m of text.matchAll(OQ)) if (!questions.has(m[0])) add(m[0], `${snippet(m[0])} is not an open question of the closure`);
      }
      for (const m of text.matchAll(CASE_PATH)) {
        if (m[1] !== undefined && m[1] !== runId) continue; // another run's case
        const path = m[2]!.replace(/[.,;:)\]]+$/, "");
        if (path === "" || path.includes("*") || path.endsWith("/")) continue;
        if (!CASE_NAME.test(path.split("/").pop()!)) continue;
        const caseRel = `cases/${path}`;
        if (!plainRunPath(dir, caseRel) && !plainRunPath(dir, `${caseRel}.json`)) add(caseRel, snippet(caseRel));
      }
    }
  }
  return out;
}
