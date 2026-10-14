#!/usr/bin/env node
// check-executive-conditions: read-only checker of the three executive documents against the closure.
//
//   node scripts/check-executive-conditions.mjs --run=RUN-... [--dir=<folder with technical-report.pdf, signoff.pdf, executive-deck.pdf>]
//
// Extracts the text of each PDF with pdftotext, reads reports/closure/closure.json and the defect records of the run, and prints, for each
// of the three documents, a pass/fail table of checks (a) to (m) with the closure value and what was found. Every expectation is derived
// from closure.json (no run figure is written here). Exit 0 only when every check passes for every document; exit 1 when a check fails
// (the failing checks are listed); exit 2 for a usage error or a missing input; exit 3 when pdftotext is missing; exit 6 when the built
// packages are missing. It writes nothing. qa-executive-reporter, its reviewer, the orchestrator and the owner may run it.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "..");
// Test seam only, as in the report scripts: the agent never sets AEGIS_ROOT.
const AEGIS_ROOT = process.env.AEGIS_ROOT ? resolve(process.env.AEGIS_ROOT) : REPO;
const CONTRACTS = new URL("../packages/@qa/contracts/dist/index.js", import.meta.url);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => /^--([^=]+)(?:=(.*))?$/.exec(a)).filter(Boolean).map((m) => [m[1], m[2] ?? "true"]),
);
if (!args.run) {
  console.error("ERROR: --run=RUN-... is required\nusage: node scripts/check-executive-conditions.mjs --run=RUN-... [--dir=<folder with the three PDFs>]");
  process.exit(2);
}
const runDir = resolve(AEGIS_ROOT, "runs", args.run);
if (!existsSync(runDir)) {
  console.error(`ERROR: run directory not found: ${runDir}`);
  process.exit(2);
}
const dir = args.dir ? (isAbsolute(args.dir) ? args.dir : resolve(process.cwd(), args.dir)) : join(runDir, "reports", "executive");

// ─── pdftotext ───────────────────────────────────────────────────────────────

const probe = spawnSync("pdftotext", ["-v"], { encoding: "utf-8" });
if (probe.error) {
  console.error("ERROR: pdftotext is not installed or not on PATH, so the PDFs cannot be read. Install poppler (macOS: brew install poppler; Debian: apt-get install poppler-utils) and run the checker again. Nothing was checked.");
  process.exit(3);
}

const DOCS = [
  { key: "technical", label: "technical report", file: "technical-report.pdf" },
  { key: "signoff", label: "sign-off", file: "signoff.pdf" },
  { key: "deck", label: "deck", file: "executive-deck.pdf" },
];
const missing = DOCS.filter((d) => !existsSync(join(dir, d.file)));
if (missing.length > 0) {
  console.error(`ERROR: not found in ${dir}: ${missing.map((d) => d.file).join(", ")}`);
  process.exit(2);
}

let C;
try {
  C = await import(CONTRACTS.href);
} catch (err) {
  console.error(`ERROR: cannot load the built contracts package (${err.message}) - run pnpm build`);
  process.exit(6);
}
const { buildClosureView, findToolingWords, findPlainLanguage, checkBrandExposure, rewriteSectionReferences, rewriteNationalIdTerms } = C;

// ─── inputs ──────────────────────────────────────────────────────────────────

function readJson(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : null;
  } catch {
    return null;
  }
}
const closure = readJson(join(runDir, "reports", "closure", "closure.json"));
if (closure === null || typeof closure !== "object") {
  console.error(`ERROR: ${args.run}/reports/closure/closure.json is missing or not JSON`);
  process.exit(2);
}
const defectsDir = join(runDir, "defects");
const defects = existsSync(defectsDir) ? readdirSync(defectsDir).filter((f) => f.endsWith(".json")).map((f) => readJson(join(defectsDir, f))).filter((d) => d !== null) : null;
const coverage = readJson(join(runDir, "reports", "metrics", "coverage.json"));
const COUNT_KEYS = ["designed", "attempted", "passed", "failed", "partial", "blocked", "skipped", "unknown", "notAttempted"];
const rollupCounts = coverage && coverage.noData !== true && coverage.counts && COUNT_KEYS.every((k) => typeof coverage.counts[k] === "number") ? coverage.counts : null;
const view = buildClosureView({ closure, defects, rollupCounts, executionSummary: readJson(join(runDir, "execution-summary.json")) });

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const norm = (s) => s.replace(/\s+/g, " ").trim();
const rs = isObj(closure.resultsSummary) ? closure.resultsSummary : {};
const counts = isObj(rs.counts) ? rs.counts : {};
const metrics = isObj(closure.metrics) ? closure.metrics : {};
const ID_RE = /\b(?:DEF-\d{3}-[A-Z0-9]+-[A-Z0-9]+|TC-[A-Z0-9]+-\d{3}|OQ-\d+)\b/g;
const TC_RE = /\bTC-[A-Z0-9]+-\d{3}\b/g;

// ─── what the closure says (every figure read from closure.json) ──────────────

const figures = {
  designed: num(counts.designed) ?? num(metrics.designed),
  passed: view.cases.passed ?? num(counts.passed),
  failed: view.cases.failed ?? num(counts.failed),
  blocked: view.cases.blocked ?? num(counts.blocked),
  partial: view.cases.partial ?? num(counts.partial),
  passRate: view.cases.passRate ?? num(rs.passRate) ?? num(metrics.passRate),
  outOfScope: num(counts.outOfScope) ?? num(metrics.outOfScope) ?? num(coverage?.counts?.outOfScope) ?? (view.outOfScope.length > 0 ? view.outOfScope.length : null),
};
const descoped = view.outOfScope;
const open = view.openItems;
const headline = view.defects;
const exits = view.exitCriteria;
const metCount = exits.filter((c) => c.met).length;
const falseCases = view.falsePasses.map((f) => f.case);
const falseIds = [...new Set(falseCases.flatMap((c) => c.match(TC_RE) ?? []))];
const falsePasses = isObj(closure.falsePasses) ? closure.falsePasses : {};
const wrongSteps = view.wrongStepNotes;
const ownItems = view.ownMistakes?.items ?? [];
const findings = Array.isArray(closure.complianceFindings) ? closure.complianceFindings.filter(isObj) : [];
const gapsTotal = view.compliance?.totalGaps ?? null;
const highTotal = view.compliance?.totalHighGaps ?? null;
const openQuestionTotal = view.openQuestions.reduce((a, g) => a + g.questions.length, 0);
const recon = (() => {
  const list = Array.isArray(closure.reconciliations) ? closure.reconciliations : [];
  const r = list.find((x) => isObj(x) && typeof x.point === "string" && /case figures|case counts|pass rate/i.test(x.point) && str(x.statement) !== null);
  return isObj(r) ? str(r.statement) : str(metrics.passRateBasisNote);
})();
const knownIds = new Set([...(JSON.stringify(closure).match(ID_RE) ?? []), ...(defects ?? []).flatMap((d) => (typeof d?.id === "string" ? [d.id] : []))]);

// ─── document text ───────────────────────────────────────────────────────────

function extract(file) {
  const r = spawnSync("pdftotext", ["-enc", "UTF-8", file, "-"], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error(`ERROR: pdftotext failed on ${file}: ${r.stderr}`);
    process.exit(2);
  }
  return r.stdout;
}
// An identifier the PDF wrapped after a hyphen ("DEF-001-VOL- EXP") is joined again; nothing else is touched.
const flatten = (raw) => norm(raw).replace(/\b((?:DEF|TC|OQ)(?:-[A-Z0-9]+)*-) (?=[A-Z0-9])/g, "$1");

// ─── helpers for the checks ──────────────────────────────────────────────────

const sub = (what, ok, expected, found) => ({ what, ok, expected, found });
const has = (flat, text) => text !== null && flat.includes(flatten(text));
const valueRe = (value) => new RegExp(`(?<![\\d.])${String(value).replace(/\./g, "\\.")}(?![\\d])`);
/** True when `value` is written within `win` characters of a match of `label`. */
function near(flat, label, value, win = 70) {
  const v = typeof value === "string" ? new RegExp(value) : valueRe(value);
  for (const m of flat.matchAll(new RegExp(label.source, label.flags.includes("g") ? label.flags : `${label.flags}g`))) {
    const seg = flat.slice(Math.max(0, m.index - win), m.index + m[0].length + win);
    if (v.test(seg)) return true;
  }
  return false;
}
const quote = (s, n = 60) => (s.length > n ? `${s.slice(0, n)}...` : s);

const SEVERITY_WORD = (sev) => /\(([A-Za-z]+)\)/.exec(sev)?.[1] ?? sev;

// ─── the checks: each returns sub-checks; the row passes when all do ─────────

const CHECKS = [
  {
    id: "a", name: "case figures",
    run: ({ flat }) => [
      ["designed", figures.designed, /designed/i], ["passed", figures.passed, /pass/i], ["failed", figures.failed, /fail/i],
      ["blocked", figures.blocked, /block/i], ["partial", figures.partial, /partial|partly|in part/i], ["out of scope", figures.outOfScope, /out of scope/i],
    ].flatMap(([label, value, re]) => (value === null ? [] : [sub(label, near(flat, re, value), `${label} ${value}`, near(flat, re, value) ? "found" : "not found near the label")]))
      .concat(figures.passRate === null ? [] : [sub("pass rate", new RegExp(`(?<![\\d.])${String(figures.passRate).replace(".", "\\.")}\\s*%`).test(flat), `pass rate ${figures.passRate}%`, "")]),
  },
  {
    id: "b", name: "out-of-scope cases with their reason", only: ["technical", "signoff"],
    run: ({ flat, key }) =>
      descoped.map((o) => {
        const reason = key === "signoff" ? rewriteNationalIdTerms(rewriteSectionReferences(o.reason)) : rewriteSectionReferences(o.reason);
        const idOk = flat.includes(o.caseId);
        const reasonOk = has(flat, reason);
        return sub(o.caseId, idOk && reasonOk, `${o.caseId} with reason "${quote(o.reason)}"`, !idOk ? "case id not found" : reasonOk ? "id and reason found" : "id found, reason not found");
      }),
  },
  {
    id: "c", name: "open application defects",
    run: ({ flat, key }) => {
      if (key === "deck") {
        const out = [sub("open count", near(flat, /open|remain/i, open.length), `${open.length} open application defects`, "")];
        const split = new Map();
        for (const o of open) split.set(SEVERITY_WORD(o.severity), (split.get(SEVERITY_WORD(o.severity)) ?? 0) + 1);
        for (const [word, n] of split) out.push(sub(`${word} count`, new RegExp(`(?<![\\d.])${n} ${word}\\b`).test(flat), `${n} ${word}`, ""));
        return out;
      }
      return open.map((o) => {
        const at = flat.indexOf(`${o.id}, ${o.severity}`);
        const idAt = at >= 0 ? at : flat.indexOf(o.id);
        const sevOk = at >= 0;
        const segment = idAt >= 0 ? flat.slice(idAt, idAt + 900) : "";
        const awaitsOk = o.awaits === null || /Awaits:/.test(segment.split(/DEF-\d{3}-/).slice(0, 2).join(""));
        return sub(o.id, idAt >= 0 && sevOk && awaitsOk, `${o.id}, ${o.severity}${o.awaits ? ", Awaits" : ""}`, idAt < 0 ? "id not found" : !sevOk ? "id found without its severity word" : awaitsOk ? "id, severity word and Awaits found" : "no Awaits after the id");
      });
    },
  },
  {
    id: "d", name: "fixed, reframed, report withdrawn",
    run: ({ flat }) =>
      [["fixed", headline.fixed, /fixed/i], ["reframed", headline.reframed, /reframed/i], ["report withdrawn", headline.reportWithdrawn, /withdrawn/i]]
        .flatMap(([label, value, re]) => (value === null ? [] : [sub(label, near(flat, re, value), `${label} ${value}`, "")])),
  },
  {
    id: "e", name: "exit criteria count, unmet reasons, qualification",
    run: ({ flat, key }) => {
      if (exits.length === 0) return [];
      const out = [sub("count", new RegExp(`(?<![\\d.])${metCount} of ${exits.length}\\b`).test(flat), `${metCount} of ${exits.length} exit criteria are met`, "")];
      exits.forEach((c, i) => {
        if (!c.met) {
          const ok = key === "deck" ? new RegExp(`criteri(?:on|a)[^.]{0,40}(?<![\\d.])${i + 1}\\b`, "i").test(flat) : has(flat, rewriteSectionReferences(c.evidence ?? ""));
          out.push(sub(`criterion ${i + 1} not met`, c.evidence === null && key !== "deck" ? true : ok, key === "deck" ? `criterion ${i + 1} named as not met` : `reason "${quote(c.evidence ?? "")}"`, ok ? "found" : "not found"));
        } else if (c.qualification !== null) {
          const ok = key === "deck" ? /qualification/i.test(flat) : has(flat, rewriteSectionReferences(c.qualification));
          out.push(sub(`criterion ${i + 1} qualification`, ok, key === "deck" ? "the word qualification" : `"${quote(c.qualification)}"`, ok ? "found" : "not found"));
        }
      });
      return out;
    },
  },
  {
    id: "f", name: "false passes: our own mistakes, cases, wrong step",
    run: ({ flat, key }) => {
      const out = [sub("own mistakes", /our own mistakes?/i.test(flat), "the phrase \"our own mistakes\"", "")];
      if (key === "deck") return out.concat(wrongSteps.length > 0 ? [sub("wrong step", /wrong (?:test )?step/i.test(flat), "the words \"wrong step\"", "")] : []);
      const note = str(falsePasses.note);
      if (note !== null) out.push(sub("falsePasses.note", has(flat, rewriteSectionReferences(note)), `falsePasses.note "${quote(note)}"`, ""));
      const mech = str(falsePasses.mechanism);
      if (mech !== null) out.push(sub("falsePasses.mechanism", has(flat, rewriteSectionReferences(mech)), `falsePasses.mechanism "${quote(mech)}"`, ""));
      for (const id of falseIds) out.push(sub(id, flat.includes(id), `${id} (false pass)`, flat.includes(id) ? "found" : "case id not found"));
      for (const w of wrongSteps) out.push(sub(`${w.key}.wrongStep`, has(flat, rewriteSectionReferences(w.wrongStep)), `${w.key}.wrongStep "${quote(w.wrongStep)}"`, ""));
      return out;
    },
  },
  {
    id: "g", name: "own mistakes corrected",
    run: ({ flat, key }) => {
      if (ownItems.length === 0) return [];
      if (key === "deck") return [sub("own mistakes of the cycle", /our own (?:errors?|mistakes?)/i.test(flat), "the phrase \"our own errors\" or \"our own mistakes\"", "")];
      return ownItems.flatMap((m) => {
        const ids = m.case.match(TC_RE) ?? [];
        const ok = ids.length > 0 ? ids.every((id) => flat.includes(id)) : flat.includes(m.case);
        return [sub(m.case, ok && has(flat, rewriteSectionReferences(m.what)), `${m.case} with its text`, ok ? "found" : "case id not found")];
      });
    },
  },
  {
    id: "h", name: "compliance totals and no verdict",
    run: ({ flat }) => {
      const out = [sub("no compliance verdict", /no compliance verdict/i.test(flat), "the sentence that there is no compliance verdict", "")];
      if (gapsTotal !== null) out.push(sub("gaps", new RegExp(`(?<![\\d.])${gapsTotal}\\s+(?:test-)?coverage gaps`, "i").test(flat), `${gapsTotal} coverage gaps (sum of complianceFindings[].coverageGaps)`, ""));
      if (highTotal !== null) out.push(sub("rated high", new RegExp(`(?<![\\d.])${highTotal}(?: of them| of these)? rated high`, "i").test(flat), `${highTotal} rated high (count of highRatedGaps)`, ""));
      return out;
    },
  },
  {
    id: "i", name: "open questions",
    run: ({ flat, key }) => {
      const out = [sub("count", openQuestionTotal === 0 ? true : near(flat, /question/i, openQuestionTotal, 60), `${openQuestionTotal} open questions`, "")];
      if (key === "technical") {
        for (const g of view.openQuestions) {
          out.push(sub(`group ${g.audience}`, flat.includes(`For ${g.audience} (${g.questions.length})`), `heading "For ${g.audience} (${g.questions.length})"`, ""));
          for (const q of g.questions) if (q.id !== "") out.push(sub(q.id, flat.includes(q.id), `${q.id} under ${g.audience}`, flat.includes(q.id) ? "found" : "id not found"));
        }
      }
      return out;
    },
  },
  {
    id: "j", name: "no placeholder used as a number",
    run: ({ raw, flat }) => {
      const bad = [];
      raw.split("\n").forEach((line, i) => {
        const l = line.trim();
        if (/\b(?:undefined|NaN|null)\b|\bn\/a\b/i.test(l)) bad.push(`line ${i + 1}: "${quote(l, 80)}"`);
        else if (/\bnot available\b/i.test(l) && l.replace(/not available/gi, "").trim().split(/\s+/).filter(Boolean).length <= 6) bad.push(`line ${i + 1}: "${quote(l, 80)}"`);
      });
      for (const m of flat.matchAll(/(?:(?:Passed|Failed|Blocked|Skipped|Partial|Pass Rate|Total|Fixed|Reframed|Skipped|Open application defects|Total Tests)[: ]+not available)|not available (?:coverage|test-coverage|rated high|checks?\b|passed|failed|blocked|partly|defects?\b|%)/gi)) bad.push(`"${m[0]}"`);
      return [sub("placeholders", bad.length === 0, "no \"not available\", \"n/a\", \"undefined\", \"NaN\" or \"null\" where a figure belongs", bad.length === 0 ? "none" : bad.slice(0, 5).join("; "))];
    },
  },
  {
    id: "k", name: "wording classes",
    run: ({ raw, flat, key }) => {
      const lines = raw.split("\n");
      const hits = [];
      lines.forEach((line, i) => {
        for (const h of findToolingWords(line)) hits.push(`tier 1, line ${i + 1}: "${h.phrase}"`);
        if (key !== "technical") for (const h of findPlainLanguage(line, "")) hits.push(`tier 2, line ${i + 1}: "${h.phrase}"`);
      });
      for (const h of findToolingWords(flat)) if (!hits.some((x) => x.endsWith(`"${h.phrase}"`))) hits.push(`tier 1, across lines: "${h.phrase}"`);
      const leak = checkBrandExposure(raw);
      if (leak) hits.push(`framework or agent name (${leak})`);
      for (const [re, what] of [[/Closed Defects/i, "\"Closed Defects\""], [/totalOpened/, "\"totalOpened\""], [/\bno[- ]ship\b|ship\s*\/\s*no[- ]ship/i, "a ship / no-ship word"], [/\b[STFGM]\d{7}[A-Z]\b/, "a national ID number"]]) {
        const m = re.exec(flat);
        if (m) hits.push(`${what}: "${m[0]}"`);
      }
      if (key !== "technical" && /\bNRIC\b/.test(flat)) hits.push("the term \"NRIC\" (write: values shaped like national ID numbers)");
      return [sub(key === "technical" ? "tier 1" : "tier 1 and tier 2", hits.length === 0, key === "technical" ? "no bookkeeping names, paths, ports, hosts, framework names, Closed Defects, totalOpened, ship / no-ship words" : "tier 1 as above and the plain-language list", hits.length === 0 ? "none" : `${hits.length}: ${hits.slice(0, 5).join("; ")}`)];
    },
  },
  {
    id: "l", name: "identifiers intact",
    run: ({ flat }) => {
      const found = [...new Set(flat.match(ID_RE) ?? [])];
      const unknown = found.filter((id) => !knownIds.has(id));
      const mangled = [...flat.matchAll(/\b(?:DEF-\d{3}|TC)-[A-Z0-9]+-[a-z][\w-]*/g)].map((m) => m[0]);
      return [sub("ids exist in the closure or the defect records", unknown.length === 0, `${found.length} ids, all in the closure or the defect records`, unknown.length === 0 ? "all known" : `unknown: ${unknown.slice(0, 5).join(", ")}`),
        sub("no rewritten id", mangled.length === 0, "no id with a lowercase part", mangled.length === 0 ? "none" : mangled.slice(0, 5).join(", "))];
    },
  },
  {
    id: "m", name: "one reconciliation", only: ["technical", "signoff"],
    run: ({ flat, key }) => {
      if (recon === null) return [];
      const text = flatten(key === "signoff" ? rewriteNationalIdTerms(rewriteSectionReferences(recon)) : rewriteSectionReferences(recon));
      const n = text === "" ? 0 : flat.split(text).length - 1;
      const labels = (flat.match(/Reconciliation:/g) ?? []).length;
      return [sub("reconciliation printed once", n === 1 && labels <= 1, `the closure's reconciliation "${quote(recon)}" exactly once`, `${n} time${n === 1 ? "" : "s"}, ${labels} "Reconciliation:" label${labels === 1 ? "" : "s"}`)];
    },
  },
];

// ─── run and print ───────────────────────────────────────────────────────────

const failures = [];
for (const d of DOCS) {
  const raw = extract(join(dir, d.file));
  const flat = flatten(raw);
  console.log(`\n== ${d.label} (${d.file}) ==`);
  const rows = [];
  for (const check of CHECKS) {
    if (check.only && !check.only.includes(d.key)) {
      rows.push({ id: check.id, name: check.name, status: "n/a", closure: "not required of this document", found: "" });
      continue;
    }
    const subs = check.run({ raw, flat, key: d.key });
    const bad = subs.filter((s) => !s.ok);
    rows.push({
      id: check.id, name: check.name, status: bad.length === 0 ? "PASS" : "FAIL",
      closure: subs.length === 0 ? "nothing in the closure to check" : subs.slice(0, 3).map((s) => s.expected).join("; ") + (subs.length > 3 ? `; +${subs.length - 3} more` : ""),
      found: `${subs.length - bad.length} of ${subs.length} found`,
    });
    for (const s of bad) failures.push(`${d.label}: (${check.id}) ${check.name}: ${s.what}: expected ${s.expected}${s.found ? `; found: ${s.found}` : ""}`);
  }
  const w = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) console.log(` (${r.id}) ${r.name.padEnd(w)}  ${r.status.padEnd(4)}  ${r.found.padEnd(14)}  ${quote(r.closure, 110)}`);
}

if (failures.length > 0) {
  console.log(`\nFAILED: ${failures.length} failing check${failures.length === 1 ? "" : "s"}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nOK: every check passes for every document");
