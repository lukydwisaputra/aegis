import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { baselineGrowth, escapesGrowth } from "../packages/@qa/alignment/src/growth.js";
import { baselineShrink, fileChanges, parseUnifiedDiff, unitNameOf, type ShrinkFinding, type SubjectIndex } from "../packages/@qa/alignment/src/shrink.js";

// Baseline guard (slice 1a' + 1a-H): added keys need the baseline-growth label; removed keys need a
// change outside the contract block of their subject's file, or the contract-only-fix label.
// Runs before `pnpm build`: import only dependency-free modules of @qa/alignment.

const BASELINE = "__internal-tests__/alignment/baseline.yaml";
const PIPELINE = ".claude/pipeline.yaml";

function git(args: string[]): string {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 256 * 1024 * 1024,
  });
}

function show(ref: string, file: string): string | null {
  try {
    return git(["show", `${ref}:${file}`]);
  } catch {
    return null;
  }
}

function couldNotRun(message: string): never {
  console.log(`::error title=Baseline guard COULD NOT RUN::${message}`);
  process.exit(2);
}

const i = process.argv.indexOf("--base");
const base = i >= 0 ? process.argv[i + 1] : undefined;
if (!base) {
  console.error("usage: check-baseline-growth --base <ref>");
  process.exit(2);
}

try {
  execFileSync("git", ["rev-parse", "--verify", "--quiet", `${base}^{commit}`], { stdio: "ignore" });
} catch {
  couldNotRun(`base ref ${base} not found (fetch-depth? push event with no base?)`);
}

function mergeBase(ref: string): string {
  try {
    return git(["merge-base", ref, "HEAD"]).trim();
  } catch {
    return couldNotRun(`no merge base between ${ref} and HEAD`);
  }
}

function readHead(file: string): string {
  try {
    return readFileSync(file, "utf-8");
  } catch (e) {
    return couldNotRun(`${file}: ${(e as Error).message}`);
  }
}

const mb = mergeBase(base);
const baseYaml = show(mb, BASELINE);
if (baseYaml === null) console.log(`baseline guard: ${BASELINE} absent on ${base}; guard not applicable`);
const headYaml = readHead(BASELINE);

function subjectIndex(): SubjectIndex {
  const units: Record<string, string> = {};
  const files = new Set<string>();
  for (const ref of ["HEAD", mb]) {
    for (const f of git(["ls-tree", "-r", "-z", "--name-only", ref]).split("\0").filter(Boolean)) {
      files.add(f);
      const name = unitNameOf(f, f.startsWith(".claude/agents/") ? show(ref, f) : null);
      if (name !== null && !(name in units)) units[name] = f;
    }
  }
  return { units, files };
}

function evaluate(): { added: string[]; shrunk: ShrinkFinding[] } {
  try {
    const patch = git(["diff", "--unified=0", "--no-renames", "--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/", mb, "HEAD"]);
    const changes = fileChanges(parseUnifiedDiff(patch), (f, side) => show(side === "base" ? mb : "HEAD", f));
    return {
      added: [
        ...baselineGrowth(baseYaml, headYaml),
        ...escapesGrowth(show(mb, PIPELINE), existsSync(PIPELINE) ? readFileSync(PIPELINE, "utf-8") : "").map((id) => `escapes:${id}`),
      ],
      shrunk: baselineShrink(baseYaml, headYaml, changes, subjectIndex()),
    };
  } catch (e) {
    return couldNotRun(e instanceof Error ? e.message : String(e));
  }
}

const { added, shrunk } = evaluate();
let fail = false;

if (added.length === 0) console.log("baseline guard: no new baseline keys");
else {
  for (const k of added) console.log(`  + ${k}`);
  const list = added.join(", ");
  if (process.env.ALLOW_BASELINE_GROWTH === "true") {
    console.log(`::warning title=Alignment baseline grew::label baseline-growth present; ${added.length} new key(s): ${list}`);
  } else {
    console.log(`::error title=Alignment baseline grew::${added.length} new key(s) without the baseline-growth label: ${list}`);
    fail = true;
  }
}

if (shrunk.length === 0) console.log("baseline guard: every removed key is justified by a prose change");
else {
  for (const s of shrunk) console.log(`  - ${s.key}  (subject ${s.subject}: ${s.files.join(", ") || "no subject file"})`);
  const list = shrunk.map((s) => s.key).join(", ");
  if (process.env.ALLOW_CONTRACT_ONLY_FIX === "true") {
    console.log(`::warning title=Baseline shrank without a prose change::label contract-only-fix present; ${shrunk.length} key(s): ${list}`);
  } else {
    console.log(
      `::error title=Baseline shrank without a prose change::${shrunk.length} removed key(s) with no change outside the contract block of their subject file; fix the prose or add the contract-only-fix label: ${list}`,
    );
    fail = true;
  }
}

process.exit(fail ? 1 : 0);
