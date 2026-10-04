import * as fs from 'fs';
import * as path from 'path';
import { AegisEventSchema, AegisEventUnionSchema } from '@qa/contracts';
import { isCliRecordedEventType } from '@qa/run-state';

// Fix round 2, I4: every event an agent appends is described with the fields its zod schema declares.
// Each "Events You Emit" bullet starts with the event type(s) in backticks. A bullet the CLI records names the
// command (`aegis review submit`, `aegis phase start`, …). Any other bullet is appended by the agent with
// `aegis event append`: it names exactly one event type and its payload as `{field, field, optional?}` — no
// undeclared field, every required field named. ts and runId are filled in by the CLI and never named.
const ROOT = path.join(__dirname, '..');
const AGENTS = path.join(ROOT, '.claude', 'agents');
const AUTO_FILLED = new Set(['type', 'ts', 'runId']);

type Shape = Record<string, { optional: boolean }>;
const SHAPES: Record<string, Shape> = {};
for (const option of AegisEventUnionSchema.options) {
  const shape = option.shape as Record<string, { isOptional(): boolean; value?: string }>;
  const type = shape.type!.value as string;
  SHAPES[type] = Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, { optional: v.isOptional() }]));
}

const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.md') ? [path.join(d, e.name)] : [],
  );
const FILES = walk(AGENTS).sort();

/** Top-level comma-separated items of a `{...}` list, braces/brackets/parens/quotes respected. */
function topLevelItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if ('{[('.includes(ch)) depth++;
    else if ('}])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      items.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() !== '') items.push(cur);
  return items.map((s) => s.trim()).filter(Boolean);
}

/** `{a, b?, "c": 1, d: {...}}` → [{name: 'a', optional: false}, {name: 'b', optional: true}, …]. */
export function parseFields(list: string): Array<{ name: string; optional: boolean }> {
  const body = list.trim().replace(/^\{/, '').replace(/\}$/, '');
  return topLevelItems(body).map((item) => {
    const key = (item.split(':')[0] ?? '').trim().replace(/^["']|["']$/g, '');
    const optional = key.endsWith('?');
    return { name: key.replace(/\?$/, '').replace(/\[\]$/, ''), optional };
  });
}

/** The problems with one named payload against the event's schema. */
export function checkPayload(type: string, fields: Array<{ name: string; optional: boolean }>): string[] {
  const shape = SHAPES[type];
  if (!shape) return [`unknown event type ${type}`];
  const problems: string[] = [];
  const names = new Set(fields.map((f) => f.name));
  for (const f of fields) {
    if (AUTO_FILLED.has(f.name)) problems.push(`names ${f.name}, which the CLI fills in`);
    else if (!(f.name in shape)) problems.push(`undeclared field ${f.name}`);
    else if (f.optional && !shape[f.name]!.optional) problems.push(`marks required field ${f.name} optional`);
  }
  for (const [k, v] of Object.entries(shape)) {
    if (!v.optional && !AUTO_FILLED.has(k) && !names.has(k)) problems.push(`missing required field ${k}`);
  }
  return problems;
}

interface Bullet {
  file: string;
  line: string;
  types: string[];
  rest: string;
}

function bullets(file: string): Bullet[] {
  const txt = fs.readFileSync(file, 'utf-8');
  const m = /## Events You Emit\n([\s\S]*?)(?:\n## |$)/.exec(txt);
  if (!m) return [];
  const out: Bullet[] = [];
  for (const line of (m[1] ?? '').split('\n')) {
    if (!/^- /.test(line)) continue;
    const lead = /^- ((?:`[a-z][a-z0-9.-]*`(?:\s*(?:\/|,|and)\s*)?)+)(.*)$/.exec(line);
    out.push({
      file: path.relative(ROOT, file),
      line,
      types: lead ? [...(lead[1] ?? '').matchAll(/`([a-z][a-z0-9.-]*)`/g)].map((t) => t[1]!) : [],
      rest: lead ? (lead[2] ?? '') : line,
    });
  }
  return out;
}

const ALL = FILES.flatMap(bullets);
// A bullet recorded by a CLI command other than `aegis event append`.
const isCliBullet = (b: Bullet) => /^\s*—\s*(?:recorded by\s+)?`aegis (?!event append)[a-z]/.test(b.rest);

/** Every problem in the agent definitions, one line each — the list the test prints when it fails. */
function problems(): string[] {
  const out: string[] = [];
  for (const f of FILES) {
    if (bullets(f).length === 0) out.push(`${path.relative(ROOT, f)}: no "Events You Emit" bullets`);
  }
  for (const b of ALL) {
    const where = `${b.file}: ${b.line.slice(0, 90)}`;
    if (b.types.length === 0) {
      out.push(`${where} — does not start with a backticked event type`);
      continue;
    }
    for (const t of b.types) if (!SHAPES[t]) out.push(`${where} — unknown event type ${t}`);
    if (isCliBullet(b)) continue;
    if (b.types.length !== 1) {
      out.push(`${where} — an appended event gets its own bullet (found ${b.types.join(', ')})`);
      continue;
    }
    const type = b.types[0]!;
    if (isCliRecordedEventType(type)) out.push(`${where} — ${type} is CLI-recorded; name the command that records it`);
    const list = /`(\{[^`]*\})`/.exec(b.rest);
    if (!list) {
      out.push(`${where} — no \`{field, …}\` payload`);
      continue;
    }
    for (const p of checkPayload(type, parseFields(list[1]!))) out.push(`${where} — ${p}`);
  }
  // Inline examples elsewhere in the body: `aegis event append --type X --json '{...}'`.
  for (const f of FILES) {
    const txt = fs.readFileSync(f, 'utf-8');
    for (const m of txt.matchAll(/event append --type ([a-z][a-z0-9.-]*) --json '(\{[^']*\})'/g)) {
      let keys: string[];
      try {
        keys = Object.keys(JSON.parse(m[2]!));
      } catch {
        out.push(`${path.relative(ROOT, f)}: inline ${m[1]} example is not valid JSON`);
        continue;
      }
      const ps = checkPayload(m[1]!, keys.map((name) => ({ name, optional: false })));
      for (const p of ps) out.push(`${path.relative(ROOT, f)}: inline ${m[1]} example — ${p}`);
    }
  }
  return out;
}

describe('the payload parser', () => {
  it('reads plain, optional, JSON-style and nested fields', () => {
    expect(parseFields('{ step: "scan", artifact: "a, b.json" }')).toEqual([
      { name: 'step', optional: false },
      { name: 'artifact', optional: false },
    ]);
    expect(parseFields('{"totalDurationMs": n, "totalTokensUsed": n}').map((f) => f.name)).toEqual(['totalDurationMs', 'totalTokensUsed']);
    expect(parseFields('{specialistName, brief?: {missionGoal, lessonsRef}, tcIds?}')).toEqual([
      { name: 'specialistName', optional: false },
      { name: 'brief', optional: true },
      { name: 'tcIds', optional: true },
    ]);
  });

  it('flags an undeclared field, a missing required field and a required field marked optional', () => {
    expect(checkPayload('defect.opened', parseFields('{id, severity, priority, tcId}'))).toEqual([
      'undeclared field id',
      'undeclared field priority',
      'undeclared field tcId',
      'missing required field defectId',
      'missing required field module',
    ]);
    expect(checkPayload('defect.opened', parseFields('{defectId, severity?, module, testCaseId?}'))).toEqual([
      'marks required field severity optional',
    ]);
    expect(checkPayload('defect.opened', parseFields('{defectId, severity, module, testCaseId?}'))).toEqual([]);
  });
});

describe('agent "Events You Emit" lines match the event schemas', () => {
  it('finds bullets in every agent definition', () => {
    expect(FILES.length).toBeGreaterThan(40);
    expect(ALL.length).toBeGreaterThan(100);
  });

  it('every agent-appended event names exactly its schema fields', () => {
    expect(problems()).toEqual([]);
  });
});

describe('closure.report-drafted when coverage is unavailable', () => {
  const ev = { type: 'closure.report-drafted', ts: '2026-10-04T00:00:00.000Z', runId: 'RUN-20261004-001', openDefectCount: { Sev2: 1 } };
  it('accepts coveragePercent null, and a number 0–100', () => {
    expect(AegisEventSchema.safeParse({ ...ev, coveragePercent: null }).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...ev, coveragePercent: 92.5 }).success).toBe(true);
    expect(AegisEventSchema.safeParse({ ...ev, coveragePercent: 120 }).success).toBe(false);
  });
});
