import { lstatSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync, type Stats } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  ScenarioIdSchema,
  ScenarioSchema,
  StoryIdSchema,
  TestCaseIdSchema,
  TestCaseSchema,
  UserStorySchema,
  checkBrandExposure,
  type Scenario,
  type TestCase,
  type UserStory,
} from "@qa/contracts";
import { appendChained } from "@qa/event-bus";
import { assertCallerAllowed } from "../caller.js";
import { RunStateError } from "../errors.js";
import { maskPersonalData } from "../lint/mask.js";
import { busPath, runDir } from "../paths.js";
import { readRun, withRunLock } from "../run.js";
import { atomicWrite, iso } from "../util.js";
import { renderCaseMarkdown, renderScenarioMarkdown } from "./markdown.js";

// `aegis cases render`: the Markdown next to each case and scenario JSON of a run, rendered from the JSON (and the story JSON a scenario
// belongs to) by the pure renderers of markdown.ts. One reading of the run's files (inspect) serves the command, the read-only status the
// design barrier and the pre-gate lint use, so "stale" has one definition.
//
// What a render removes: only a TC-*.md / SCN-*.md whose JSON file is ABSENT (a case deleted or renamed during rework). The .md of a JSON
// that is present but skipped (invalid schema, file name, duplicate id, brand, symlink) is never touched: in runs created before this
// change it is often the only hand-written view of that case. It stays stale and its JSON stays invalid, so the design barrier and the
// gate lint keep refusing, and the next render after the JSON is fixed rewrites it.

export interface RenderArtefactsResult {
  runId: string;
  written: number;
  removed: number;
  unchanged: number;
  skipped: Array<{ file: string; reason: string }>;
}

export interface RenderingStatus {
  /** Run-relative paths of every .md that is missing, differs from its rendering, or has no valid JSON. Sorted. */
  stale: string[];
  /** Every case or scenario JSON (or directory, or .md in the way) that is skipped, with its reason. Sorted by file. Reasons never echo a value. */
  invalid: Array<{ file: string; reason: string }>;
}

type Kind = "cases" | "scenarios";

/** The part of a schema this file uses (the zod schemas of @qa/contracts), so run-state needs no zod dependency of its own. */
interface Parser {
  safeParse(v: unknown): { success: true; data: unknown } | { success: false; error: { issues: Array<{ path: Array<string | number>; code: string }> } };
}

interface Inspection {
  /** Run-relative .md path -> its current rendering, for every valid JSON. */
  rendered: Map<string, string>;
  /** Run-relative .md paths of the outputs whose file already holds exactly the rendering. */
  current: Set<string>;
  /** Run-relative TC-*.md / SCN-*.md paths whose JSON file is absent: a render removes them. */
  orphans: string[];
  /** Run-relative TC-*.md / SCN-*.md paths whose JSON is present but skipped: stale, and a render leaves them alone. */
  heldBack: string[];
  invalid: Array<{ file: string; reason: string }>;
  /** cases/ or scenarios/ is not a plain directory (a symbolic link): nothing is read from it and a render writes nothing at all. */
  directoryRefused: boolean;
}

/** The same cap as the pre-gate lint: a larger file is not read. */
const MAX_BYTES = 5 * 1024 * 1024;

const byFile = (a: { file: string }, b: { file: string }): number => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
const errCode = (e: unknown): string => (e as NodeJS.ErrnoException | null)?.code ?? "unknown";

/** The names in a run directory, sorted (never filesystem order); none when it does not exist. */
function names(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/** Whether a run directory may be read: absent (nothing to read) or a real directory. A symbolic link is never followed. */
function directoryState(dir: string): "absent" | "ok" | string {
  try {
    const st = lstatSync(dir);
    if (st.isSymbolicLink()) return "symbolic link, not followed";
    return st.isDirectory() ? "ok" : "not a directory";
  } catch (e) {
    return errCode(e) === "ENOENT" ? "absent" : `cannot read: ${errCode(e)}`;
  }
}

const NOT_JSON = "not valid JSON";

/** The text of a regular file, or why it is not read: a symbolic link is never followed, a file over 5 MB is not read. */
function readRegular(abs: string): { text: string } | { reason: string } {
  let st;
  try {
    st = lstatSync(abs);
  } catch (e) {
    return { reason: `cannot read: ${errCode(e)}` };
  }
  if (st.isSymbolicLink()) return { reason: "symbolic link, not followed" };
  if (!st.isFile()) return { reason: "not a regular file" };
  if (st.size > MAX_BYTES) return { reason: "larger than 5 MB" };
  try {
    return { text: readFileSync(abs, "utf-8") };
  } catch (e) {
    return { reason: `cannot read: ${errCode(e)}` };
  }
}

/** A path segment of a schema issue, shown only when it is a plain key that carries no personal data and no framework name. */
function safeSegment(seg: string | number): string {
  if (typeof seg === "number") return String(seg);
  return /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(seg) && checkBrandExposure(seg) === null && maskPersonalData(seg).text === seg ? seg : "<key>";
}

/** The schema failure as the path and the issue code of its first two issues: never zod's message, which can quote the input value. */
function schemaReason(issues: ReadonlyArray<{ path: Array<string | number>; code: string }>): string {
  return `schema: ${issues.slice(0, 2).map((i) => `${i.path.map(safeSegment).join(".") || "(root)"}: ${i.code}`).join("; ")}`;
}

/**
 * The valid artefacts of one kind: `{dir}/{ID}.json` whose stem is an id of the kind (any other JSON, such as `TC-X-001-result.json`, is
 * not an artefact and is ignored), a regular file, valid against the schema, whose id equals the stem. Everything else is named in `invalid`.
 */
function readKind<T>(
  dir: string, kind: Kind, idSchema: Parser, schema: Parser, idOf: (v: T) => string, invalid: Inspection["invalid"]
): Map<string, T> {
  const out = new Map<string, T>();
  const all = names(dir);
  const stems = new Set(all.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -".json".length)));
  for (const name of all) {
    if (!name.endsWith(".json")) continue;
    const stem = name.slice(0, -".json".length);
    if (!idSchema.safeParse(stem).success) continue;
    const file = `${kind}/${name}`;
    const read = readRegular(join(dir, name));
    if ("reason" in read) { invalid.push({ file, reason: read.reason }); continue; }
    let raw: unknown;
    try {
      raw = JSON.parse(read.text);
    } catch {
      invalid.push({ file, reason: NOT_JSON }); // never the parser text: it echoes the input
      continue;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) { invalid.push({ file, reason: schemaReason(parsed.error.issues) }); continue; }
    // The id passed its id schema here, so it is safe to name.
    const id = idOf(parsed.data as T);
    if (id !== stem) {
      invalid.push({ file, reason: stems.has(id) ? `duplicate id ${id} (${kind}/${id}.json has it)` : `id ${id} differs from the file name ${stem}` });
      continue;
    }
    out.set(id, parsed.data as T);
  }
  return out;
}

/** The story a scenario belongs to, or undefined when it is missing, a symlink or invalid: the scenario then falls back to its title. */
function readStory(storiesDir: string | null, storyId: string | undefined, cache: Map<string, UserStory | undefined>): UserStory | undefined {
  if (storiesDir === null || storyId === undefined || !StoryIdSchema.safeParse(storyId).success) return undefined;
  if (cache.has(storyId)) return cache.get(storyId);
  let story: UserStory | undefined;
  const read = readRegular(join(storiesDir, `${storyId}.json`));
  if ("text" in read) {
    try {
      const parsed = UserStorySchema.safeParse(JSON.parse(read.text));
      if (parsed.success && parsed.data.id === storyId) story = parsed.data;
    } catch {
      // not JSON: treated as missing
    }
  }
  cache.set(storyId, story);
  return story;
}

const BRAND = "the rendered Markdown would name the framework or an agent (brand rule): reword the JSON";

/** Whether the .md at `abs` holds exactly `text` (a symbolic link or anything that is not a regular file never does). */
function holds(abs: string, text: string): boolean {
  try {
    return lstatSync(abs).isFile() && readFileSync(abs).equals(Buffer.from(text, "utf-8"));
  } catch {
    return false;
  }
}

/** lstat that answers null for a missing path and throws nothing. */
function lstatOrNull(abs: string): Stats | null {
  try {
    return lstatSync(abs);
  } catch {
    return null;
  }
}

/** Whether `{dir}/{stem}.json` exists in any form (a file, a symlink, a directory): only an absent JSON makes its .md an orphan. */
function jsonPresent(dir: string, stem: string): boolean {
  try {
    lstatSync(join(dir, `${stem}.json`));
    return true;
  } catch (e) {
    return errCode(e) !== "ENOENT";
  }
}

/** One read-only pass over cases/, scenarios/ and stories/: every rendering, which are current, the orphans and the invalid JSON. */
function inspect(root: string, runId: string): Inspection {
  const dir = runDir(root, runId);
  const invalid: Inspection["invalid"] = [];
  const rendered = new Map<string, string>();
  const readable: Record<Kind, boolean> = { cases: true, scenarios: true };
  let directoryRefused = false;
  for (const kind of ["cases", "scenarios"] as const) {
    const state = directoryState(join(dir, kind));
    if (state === "absent" || state === "ok") continue;
    invalid.push({ file: kind, reason: state });
    readable[kind] = false;
    directoryRefused = true;
  }
  const storiesDir = directoryState(join(dir, "stories")) === "ok" ? join(dir, "stories") : null;

  const parsedCases = readable.cases ? readKind<TestCase>(join(dir, "cases"), "cases", TestCaseIdSchema, TestCaseSchema, (c) => c.id, invalid) : new Map<string, TestCase>();
  const cases = new Map<string, TestCase>();
  for (const [id, tc] of parsedCases) {
    const text = renderCaseMarkdown(tc);
    if (checkBrandExposure(text) !== null) { invalid.push({ file: `cases/${id}.json`, reason: BRAND }); continue; }
    cases.set(id, tc);
    rendered.set(`cases/${id}.md`, text);
  }
  const scenarios = readable.scenarios ? readKind<Scenario>(join(dir, "scenarios"), "scenarios", ScenarioIdSchema, ScenarioSchema, (s) => s.scenarioId, invalid) : new Map<string, Scenario>();
  const stories = new Map<string, UserStory | undefined>();
  for (const [id, s] of scenarios) {
    const text = renderScenarioMarkdown(s, cases, readStory(storiesDir, s.storyId, stories));
    if (checkBrandExposure(text) !== null) { invalid.push({ file: `scenarios/${id}.json`, reason: BRAND }); continue; }
    rendered.set(`scenarios/${id}.md`, text);
  }
  // An .md path that is a directory (or another non-file) cannot be replaced by a rendering: named, never written.
  for (const rel of [...rendered.keys()]) {
    const st = lstatOrNull(join(dir, rel));
    if (st !== null && !st.isFile() && !st.isSymbolicLink()) {
      invalid.push({ file: rel, reason: "not a regular file: a rendering cannot replace it" });
      rendered.delete(rel);
    }
  }
  const current = new Set([...rendered].filter(([rel, text]) => holds(join(dir, rel), text)).map(([rel]) => rel));
  const orphans: string[] = [];
  const heldBack: string[] = [];
  for (const [kind, idSchema] of [["cases", TestCaseIdSchema], ["scenarios", ScenarioIdSchema]] as const) {
    if (!readable[kind]) continue;
    for (const name of names(join(dir, kind))) {
      const stem = name.slice(0, -".md".length);
      if (!name.endsWith(".md") || !idSchema.safeParse(stem).success) continue;
      const rel = `${kind}/${name}`;
      if (rendered.has(rel)) continue;
      const st = lstatOrNull(join(dir, rel));
      // A directory that happens to carry the name is not a rendering and is never removed.
      if (st === null || !(st.isFile() || st.isSymbolicLink())) continue;
      (jsonPresent(join(dir, kind), stem) ? heldBack : orphans).push(rel);
    }
  }
  return { rendered, current, orphans, heldBack, invalid: invalid.sort(byFile), directoryRefused };
}

/**
 * The renderings of the run's valid case and scenario JSON (run-relative .md path -> text) with the read-only status, from one pass:
 * the pre-gate lint uses it to skip a case .md that is exactly its rendering and to name a stale one. Reads only.
 */
export function renderingSnapshot(root: string, runId: string): RenderingStatus & { rendered: ReadonlyMap<string, string> } {
  const r = inspect(root, runId);
  const stale = [...[...r.rendered.keys()].filter((rel) => !r.current.has(rel)), ...r.orphans, ...r.heldBack].sort();
  return { rendered: r.rendered, stale, invalid: r.invalid };
}

/** The read-only twin of renderArtefacts: which .md files are not their rendering, and which JSON a render skips. Run-relative paths. */
export function renderingStatus(root: string, runId: string): RenderingStatus {
  const { stale, invalid } = renderingSnapshot(root, runId);
  return { stale, invalid };
}

/** The design barrier's problem, or null when every rendering is current and every JSON valid. Reads only. */
export function renderingProblem(root: string, runId: string): string | null {
  const { stale, invalid } = renderingStatus(root, runId);
  if (stale.length === 0 && invalid.length === 0) return null;
  const named = [...invalid.map((i) => `${i.file} (invalid: ${i.reason})`), ...stale.map((s) => `${s} (stale)`)];
  const total = named.length;
  return `the Markdown of the cases and scenarios is not current: ${invalid.length} invalid JSON, ${stale.length} stale .md (${named.slice(0, 5).join("; ")}${total > 5 ? `; and ${total - 5} more` : ""}); fix each invalid JSON, then run aegis cases render`;
}

/** A render never touches a run that is not running, has a stop request or is completed, whoever asks (the owner included). */
function assertMayRender(root: string, runId: string): void {
  const state = readRun(root, runId);
  if (state.stopRequested) throw new RunStateError("stop-requested", `run ${runId} has a stop request; nothing is rendered`);
  if (state.status === "completed") throw new RunStateError("run-not-active", `run ${runId} is completed; a completed run is never re-rendered`);
  if (state.status !== "running") throw new RunStateError("run-not-active", `run ${runId} is "${state.status}"; the Markdown is rendered only while it is running`);
}

type Prior = { kind: "file"; bytes: Buffer } | { kind: "link"; target: string } | { kind: "none" };

/** What a path holds before the render, to restore it on a failure. Only a missing path is "none"; any other read error refuses the render. */
function priorOf(abs: string, rel: string): Prior {
  try {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) return { kind: "link", target: readlinkSync(abs) };
    return { kind: "file", bytes: readFileSync(abs) };
  } catch (e) {
    if (errCode(e) === "ENOENT") return { kind: "none" };
    throw new RunStateError("invalid-input", `cannot read ${rel} to keep its previous bytes (${errCode(e)}): nothing was written; make the file readable and render again`);
  }
}

/** Put a file back as it was before the render (best effort per file: one failed restore never stops the others). */
function restore(abs: string, prior: Prior): void {
  try {
    if (prior.kind === "none") { rmSync(abs, { force: true }); return; }
    if (prior.kind === "link") { rmSync(abs, { force: true }); symlinkSync(prior.target, abs); return; }
    const tmp = `${abs}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      writeFileSync(tmp, prior.bytes, { flag: "wx" });
      renameSync(tmp, abs);
    } finally {
      rmSync(tmp, { force: true });
    }
  } catch {
    // keep restoring the others; the error that caused the restore is rethrown
  }
}

/**
 * `aegis cases render` (qa-test-designer, qa-orchestrator and the owner): write the Markdown next to each valid case and scenario JSON,
 * remove every TC-*.md / SCN-*.md whose JSON file is absent, and record one `cases.rendered` event when a file changed. The .md of a
 * JSON that is present but skipped is left as it is. Every output and every previous state is computed first; the writes, the removals and
 * the event are all-or-nothing (a failure restores the previous bytes and rethrows). A JSON that cannot be rendered is skipped and named;
 * the others render anyway. A symlinked cases/ or scenarios/ directory is named and nothing is written.
 */
export async function renderArtefacts(root: string, runId: string, caller: string, now?: Date): Promise<RenderArtefactsResult> {
  assertCallerAllowed(caller, "cases.render");
  return withRunLock(root, runId, async () => {
    assertMayRender(root, runId);
    const dir = runDir(root, runId);
    const r = inspect(root, runId);
    const writes = r.directoryRefused ? [] : [...r.rendered].filter(([rel]) => !r.current.has(rel));
    const removals = r.directoryRefused ? [] : r.orphans;
    const result = { runId, unchanged: r.current.size, skipped: r.invalid };
    if (writes.length === 0 && removals.length === 0) return { ...result, written: 0, removed: 0 };
    // Every previous state is read before the first write: a file that cannot be read refuses the render with nothing written.
    const priors = new Map<string, Prior>();
    for (const rel of [...writes.map(([w]) => w), ...removals]) priors.set(rel, priorOf(join(dir, rel), rel));
    const done: Array<{ abs: string; prior: Prior }> = [];
    try {
      for (const [rel, text] of writes) {
        const abs = join(dir, rel);
        done.push({ abs, prior: priors.get(rel)! });
        atomicWrite(abs, text);
      }
      for (const rel of removals) {
        const abs = join(dir, rel);
        done.push({ abs, prior: priors.get(rel)! });
        rmSync(abs, { force: true });
      }
      const changed = [...writes.map(([rel]) => rel), ...removals];
      const kinds = (["cases", "scenarios"] as const).filter((k) => changed.some((rel) => rel.startsWith(`${k}/`)));
      await appendChained(
        { type: "cases.rendered", ts: iso(now), agent: caller, kinds, written: writes.length, removed: removals.length },
        busPath(root, runId),
        { emittedBy: caller, runId }
      );
    } catch (e) {
      for (const { abs, prior } of done.reverse()) restore(abs, prior);
      throw e;
    }
    return { ...result, written: writes.length, removed: removals.length };
  });
}
