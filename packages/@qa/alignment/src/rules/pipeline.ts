import { proseLines } from "../markdown.js";
import { violation, type Model, type Violation } from "../types.js";

const FILE = ".claude/pipeline.yaml";
type Line = { text: string; line: number };

const ROUTE_LINE = /^\s*[-*]\s+((?:`[^`]+`\s*,\s*)*`[^`]+`)\s*→\s*(qa-[a-z0-9-]+)/;

/** The `- `A`, `B` → qa-x` lines right after the heading line; null when the heading is absent or no route line follows. */
export function routeLines(lines: Line[], heading: RegExp): Array<{ value: string; agent: string; line: number }> | null {
  const at = lines.findIndex((l) => heading.test(l.text));
  if (at === -1) return null;
  const out: Array<{ value: string; agent: string; line: number }> = [];
  for (const l of lines.slice(at + 1)) {
    if (l.text.trim() === "") {
      if (out.length > 0) break;
      continue;
    }
    const m = ROUTE_LINE.exec(l.text);
    if (m === null) break;
    for (const v of m[1]!.matchAll(/`([^`]+)`/g)) out.push({ value: v[1]!, agent: m[2]!, line: l.line });
  }
  return out.length === 0 ? null : out;
}

const firstWord = (s: string) => (s.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");

const GATE = /\b(after|before)\s+([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*)\s+\(Gate\s+(\d+)\b/g;

/** Spec §4.5: routing, route targets, phase order, gates and designer vocabulary match their prose anchors. */
export function pipelineAnchorRule(m: Model): Violation[] {
  const p = m.pipeline;
  if (p === null) return [];
  const out: Violation[] = [];
  const exec = m.units.get("qa-test-executor");
  const orch = m.units.get("qa-orchestrator");
  const designer = m.units.get("qa-test-designer");

  // Routing tables: executor route lines under **By `testType`** / **By `testTechnique`**.
  const execLines = exec === undefined ? [] : proseLines(exec.source);
  const tables = [
    { dim: "byType", label: "testType", heading: /\*\*By `testType`\*\*/, table: p.routing.byType },
    { dim: "byTechnique", label: "testTechnique", heading: /\*\*By `testTechnique`\*\*/, table: p.routing.byTechnique },
  ];
  for (const { dim, label, heading, table } of tables) {
    const entries = Object.entries(table);
    const prose = routeLines(execLines, heading);
    if (prose === null) {
      if (entries.length > 0) out.push(violation("ROUTE", "pipeline", dim, "anchor-missing", exec?.file ?? FILE, 1, `qa-test-executor prose has no route lines under **By \`${label}\`**`));
      continue;
    }
    const pairs = new Set(prose.map((r) => `${r.value}→${r.agent}`));
    for (const [value, agent] of entries) {
      if (!pairs.has(`${value}→${agent}`)) out.push(violation("ROUTE", "pipeline", value, "route-not-in-prose", FILE, 1, `routing.${dim} sends ${value} to ${agent}; the executor's route lines do not`));
    }
    for (const r of prose) {
      if (table[r.value] !== r.agent) out.push(violation("ROUTE", "pipeline", r.value, "route-not-in-pipeline", exec!.file, r.line, `executor routes ${r.value} to ${r.agent}; routing.${dim} does not`));
    }
  }

  // Route targets must be dispatched by the executor.
  if (exec?.contract) {
    const dispatched = new Set(exec.contract.dispatches);
    for (const agent of new Set([...Object.values(p.routing.byType), ...Object.values(p.routing.byTechnique)])) {
      if (!dispatched.has(agent)) out.push(violation("ROUTE", "pipeline", agent, "target-not-dispatched", FILE, 1, `route target ${agent} is not in qa-test-executor dispatches`));
    }
  }

  // Phase order: the orchestrator's "Canonical order: A → B → …" line.
  const orchLines = orch === undefined ? [] : proseLines(orch.source);
  const order = orchLines.map((l) => ({ l, m: /Canonical order:\s*(.+)$/.exec(l.text) })).find((x) => x.m !== null);
  if (order === undefined) {
    if (p.phases.length > 0) out.push(violation("CONTRACT", "pipeline", "phases", "anchor-missing", orch?.file ?? FILE, 1, "qa-orchestrator prose has no `Canonical order:` line"));
  } else {
    const names = order.m![1]!.split(/\.\s|\.$/)[0]!.split("→").map(firstWord);
    const ids = p.phases.map((x) => x.id);
    for (let i = 0; i < Math.max(names.length, ids.length); i++) {
      if (names[i] === ids[i]) continue;
      out.push(violation("CONTRACT", "pipeline", ids[i] ?? names[i]!, "phase-order", orch!.file, order.l.line, `phase ${i + 1}: prose says ${names[i] ?? "(none)"}, pipeline.yaml says ${ids[i] ?? "(none)"}`));
    }
  }

  // Gates: "after X (Gate N" → gateAfter GN on X; "before X (Gate N" → on the phase before X.
  const stated = new Map<string, { expected: string | null; line: number }>();
  for (const l of orchLines) {
    for (const g of l.text.matchAll(GATE)) {
      const phase = firstWord(g[2]!);
      const at = p.phases.findIndex((x) => x.id === phase);
      const expected = g[1] === "after" ? (at === -1 ? null : phase) : at > 0 ? p.phases[at - 1]!.id : null;
      const gate = `G${g[3]}`;
      if (!stated.has(gate)) stated.set(gate, { expected, line: l.line });
    }
  }
  const gated = new Set(p.phases.flatMap((x) => (x.gateAfter !== undefined ? [x.gateAfter] : [])));
  if (stated.size === 0) {
    if (gated.size > 0) out.push(violation("CONTRACT", "pipeline", "gates", "anchor-missing", orch?.file ?? FILE, 1, "qa-orchestrator prose has no `after|before <Phase> (Gate N` sentence"));
  } else {
    for (const gate of [...new Set([...stated.keys(), ...gated])].sort()) {
      const actual = p.phases.filter((x) => x.gateAfter === gate).map((x) => x.id);
      const s = stated.get(gate);
      if (s === undefined) {
        out.push(violation("CONTRACT", "pipeline", gate, "gate-position", FILE, 1, `pipeline.yaml puts ${gate} after ${actual.join(", ")}; the orchestrator prose never places it`));
      } else if (actual.length !== 1 || actual[0] !== s.expected) {
        out.push(violation("CONTRACT", "pipeline", gate, "gate-position", orch!.file, s.line, `prose places ${gate} after ${s.expected ?? "(no phase)"}; pipeline.yaml puts it after ${actual.join(", ") || "(none)"}`));
      }
    }
  }

  // Designer vocabulary: a backticked value, or a value in a […] / (…) list on a line naming testType/testTechnique.
  const emits = [...new Set([...p.routing.designerEmits.testType, ...p.routing.designerEmits.testTechnique])];
  if (designer === undefined) {
    if (emits.length > 0) out.push(violation("ROUTE", "pipeline", "designerEmits", "anchor-missing", FILE, 1, "qa-test-designer does not exist"));
  } else {
    const lines = proseLines(designer.source);
    const ticked = new Set(lines.flatMap((l) => [...l.text.matchAll(/`([^`\n]+)`/g)].map((x) => x[1]!.trim())));
    const listed = new Set(
      lines
        .filter((l) => /\btest(Type|Technique)\b/.test(l.text))
        .flatMap((l) => [...l.text.matchAll(/\[([^\]]*)\]|\(([^)]*)\)/g)].flatMap((x) => (x[1] ?? x[2] ?? "").split(/[\s,/"'`]+/)))
        .filter(Boolean),
    );
    for (const v of emits) {
      if (!ticked.has(v) && !listed.has(v)) out.push(violation("ROUTE", "pipeline", v, "emit-not-in-prose", designer.file, 1, `designerEmits lists ${v}; qa-test-designer prose never names it as a testType/testTechnique value`));
    }
  }

  // Reachability: every emitted testType has a route (spec), every route is emitted (AUD-033).
  for (const v of p.routing.designerEmits.testType) {
    if (p.routing.byType[v] === undefined) out.push(violation("ROUTE", "pipeline", v, "unroutable-type", FILE, 1, `the designer emits testType ${v}; routing.byType has no route for it`));
  }
  const emittedTypes = new Set(p.routing.designerEmits.testType);
  const emittedTechniques = new Set(p.routing.designerEmits.testTechnique);
  for (const [v, agent] of Object.entries(p.routing.byType)) {
    if (!emittedTypes.has(v)) out.push(violation("ROUTE", "pipeline", v, "unreachable-route", FILE, 1, `routing.byType ${v} → ${agent} is unreachable: the designer never emits testType ${v}`));
  }
  for (const [v, agent] of Object.entries(p.routing.byTechnique)) {
    if (!emittedTechniques.has(v)) out.push(violation("ROUTE", "pipeline", v, "unreachable-route", FILE, 1, `routing.byTechnique ${v} → ${agent} is unreachable: the designer never emits testTechnique ${v}`));
  }
  return out;
}
