import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { baselineGrowth } from "../packages/@qa/alignment/src/growth.js";

const BASELINE = "__internal-tests__/alignment/baseline.yaml";

const i = process.argv.indexOf("--base");
const base = i >= 0 ? process.argv[i + 1] : undefined;
if (!base) {
  console.error("usage: check-baseline-growth --base <ref>");
  process.exit(2);
}

try {
  execFileSync("git", ["rev-parse", "--verify", "--quiet", `${base}^{commit}`], { stdio: "ignore" });
} catch {
  console.log(`::error title=Baseline-growth guard COULD NOT RUN::base ref ${base} not found (fetch-depth?)`);
  process.exit(2);
}

let baseYaml: string | null;
try {
  baseYaml = execFileSync("git", ["show", `${base}:${BASELINE}`], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
} catch {
  console.log(`baseline-growth: ${BASELINE} absent on ${base}; guard not applicable`);
  baseYaml = null;
}

let added: string[];
try {
  added = baselineGrowth(baseYaml, readFileSync(BASELINE, "utf-8"));
} catch (e) {
  console.log(`::error title=Baseline-growth guard COULD NOT RUN::${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
if (added.length === 0) {
  console.log("baseline-growth: no new baseline keys");
  process.exit(0);
}

for (const k of added) console.log(`  + ${k}`);
const list = added.join(", ");
if (process.env.ALLOW_BASELINE_GROWTH === "true") {
  console.log(`::warning title=Alignment baseline grew::label baseline-growth present; ${added.length} new key(s): ${list}`);
  process.exit(0);
}
console.log(`::error title=Alignment baseline grew::${added.length} new key(s) without the baseline-growth label: ${list}`);
process.exit(1);
