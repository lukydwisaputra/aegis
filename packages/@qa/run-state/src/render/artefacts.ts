import { lstatSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
import { busPath, runDir } from "../paths.js";
import { readRun, withRunLock } from "../run.js";
import { atomicWrite, formatIssues, iso } from "../util.js";
import { renderCaseMarkdown, renderScenarioMarkdown } from "./markdown.js";

// `aegis cases render`: the Markdown next to each case and scenario JSON of a run, rendered from the JSON (and the story JSON a scenario
// belongs to) by the pure renderers of markdown.ts. One reading of the run's files (inspect) serves the command, the read-only status the
// design barrier and the pre-gate lint use, so "stale" has one definition.

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
  /** Every case or scenario JSON that is skipped (symlink, schema, file name, duplicate id, brand), with its reason. Sorted by file. */
  invalid: Array<{ file: string; reason: string }>;
}

type Kind = "cases" | "scenarios";

/** The part of a schema this file uses (the zod schemas of @qa/contracts), so run-state needs no zod dependency of its own. */
interface Parser {
  safeParse(v: unknown): { success: true; data: unknown } | { success: false; error: { issues: Array<{ path: Array<string | number>; message: string }> } };
}

interface Inspection {
  /** Run-relative .md path -> its current rendering, for every valid JSON. */
  rendered: Map<string, string>;
  /** Run-relative .md paths of the outputs whose file already holds exactly the rendering. */
  current: Set<string>;
  /** Run-relative TC-*.md / SCN-*.md paths that have no valid JSON (a deleted case, a skipped JSON). */
  orphans: string[];
  invalid: Array<{ file: string; reason: string }>;
}

const byFile = (a: { file: string }, b: { file: string }): number => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);

/** The names in a run directory, sorted (never filesystem order); none when it does not exist. */
function names(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

const NOT_JSON = "not valid JSON";

/** The text of a regular file, or why it is not read: a symbolic link is never followed. */
function readRegular(abs: string): { text: string } | { reason: string } {
  let st;
  try {
    st = lstatSync(abs);
  } catch (e) {
    return { reason: `cannot read: ${(e as NodeJS.ErrnoException).code ?? "unknown"}` };
  }
  if (st.isSymbolicLink()) return { reason: "symbolic link, not followed" };
  if (!st.isFile()) return { reason: "not a regular file" };
  try {
    return { text: readFileSync(abs, "utf-8") };
  } catch (e) {
    return { reason: `cannot read: ${(e as NodeJS.ErrnoException).code ?? "unknown"}` };
  }
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
    if (!parsed.success) { invalid.push({ file, reason: `schema: ${formatIssues(parsed.error.issues.slice(0, 2))}` }); continue; }
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
function readStory(root: string, runId: string, storyId: string | undefined, cache: Map<string, UserStory | undefined>): UserStory | undefined {
  if (storyId === undefined || !StoryIdSchema.safeParse(storyId).success) return undefined;
  if (cache.has(storyId)) return cache.get(storyId);
  let story: UserStory | undefined;
  const read = readRegular(join(runDir(root, runId), "stories", `${storyId}.json`));
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

/** One read-only pass over cases/, scenarios/ and stories/: every rendering, which are current, the orphans and the invalid JSON. */
function inspect(root: string, runId: string): Inspection {
  const dir = runDir(root, runId);
  const invalid: Inspection["invalid"] = [];
  const rendered = new Map<string, string>();
  const parsedCases = readKind<TestCase>(join(dir, "cases"), "cases", TestCaseIdSchema, TestCaseSchema, (c) => c.id, invalid);
  const cases = new Map<string, TestCase>();
  for (const [id, tc] of parsedCases) {
    const text = renderCaseMarkdown(tc);
    if (checkBrandExposure(text) !== null) { invalid.push({ file: `cases/${id}.json`, reason: BRAND }); continue; }
    cases.set(id, tc);
    rendered.set(`cases/${id}.md`, text);
  }
  const scenarios = readKind<Scenario>(join(dir, "scenarios"), "scenarios", ScenarioIdSchema, ScenarioSchema, (s) => s.scenarioId, invalid);
  const stories = new Map<string, UserStory | undefined>();
  for (const [id, s] of scenarios) {
    const text = renderScenarioMarkdown(s, cases, readStory(root, runId, s.storyId, stories));
    if (checkBrandExposure(text) !== null) { invalid.push({ file: `scenarios/${id}.json`, reason: BRAND }); continue; }
    rendered.set(`scenarios/${id}.md`, text);
  }
  const current = new Set([...rendered].filter(([rel, text]) => holds(join(dir, rel), text)).map(([rel]) => rel));
  const orphans: string[] = [];
  for (const [kind, idSchema] of [["cases", TestCaseIdSchema], ["scenarios", ScenarioIdSchema]] as const) {
    for (const name of names(join(dir, kind))) {
      if (!name.endsWith(".md") || !idSchema.safeParse(name.slice(0, -".md".length)).success) continue;
      const rel = `${kind}/${name}`;
      if (rendered.has(rel)) continue;
      let st;
      try {
        st = lstatSync(join(dir, rel));
      } catch {
        continue;
      }
      // A directory that happens to carry the name is not a rendering and is never removed.
      if (st.isFile() || st.isSymbolicLink()) orphans.push(rel);
    }
  }
  return { rendered, current, orphans, invalid: invalid.sort(byFile) };
}

/**
 * The renderings of the run's valid case and scenario JSON (run-relative .md path -> text) with the read-only status, from one pass:
 * the pre-gate lint uses it to skip a case .md that is exactly its rendering and to name a stale one. Reads only.
 */
export function renderingSnapshot(root: string, runId: string): RenderingStatus & { rendered: ReadonlyMap<string, string> } {
  const r = inspect(root, runId);
  const stale = [...[...r.rendered.keys()].filter((rel) => !r.current.has(rel)), ...r.orphans].sort();
  return { rendered: r.rendered, stale, invalid: r.invalid };
}

/** The read-only twin of renderArtefacts: which .md files a render would change, and which JSON it would skip. Run-relative paths. */
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

function priorOf(abs: string): Prior {
  try {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) return { kind: "link", target: readlinkSync(abs) };
    return { kind: "file", bytes: readFileSync(abs) };
  } catch {
    return { kind: "none" };
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
 * remove every TC-*.md / SCN-*.md whose JSON is gone or skipped, and record one `cases.rendered` event when a file changed. Every output is
 * computed first; the writes, the removals and the event are all-or-nothing (a failure restores the previous bytes and rethrows).
 * A JSON that cannot be rendered is skipped and named; the others render anyway.
 */
export async function renderArtefacts(root: string, runId: string, caller: string, now?: Date): Promise<RenderArtefactsResult> {
  assertCallerAllowed(caller, "cases.render");
  return withRunLock(root, runId, async () => {
    assertMayRender(root, runId);
    const dir = runDir(root, runId);
    const r = inspect(root, runId);
    const writes = [...r.rendered].filter(([rel]) => !r.current.has(rel));
    const result = { runId, unchanged: r.current.size, skipped: r.invalid };
    if (writes.length === 0 && r.orphans.length === 0) return { ...result, written: 0, removed: 0 };
    const done: Array<{ abs: string; prior: Prior }> = [];
    try {
      for (const [rel, text] of writes) {
        const abs = join(dir, rel);
        done.push({ abs, prior: priorOf(abs) });
        atomicWrite(abs, text);
      }
      for (const rel of r.orphans) {
        const abs = join(dir, rel);
        done.push({ abs, prior: priorOf(abs) });
        rmSync(abs, { force: true });
      }
      const changed = [...writes.map(([rel]) => rel), ...r.orphans];
      const kinds = (["cases", "scenarios"] as const).filter((k) => changed.some((rel) => rel.startsWith(`${k}/`)));
      await appendChained(
        { type: "cases.rendered", ts: iso(now), agent: caller, kinds, written: writes.length, removed: r.orphans.length },
        busPath(root, runId),
        { emittedBy: caller, runId }
      );
    } catch (e) {
      for (const { abs, prior } of done.reverse()) restore(abs, prior);
      throw e;
    }
    return { ...result, written: writes.length, removed: r.orphans.length };
  });
}
