import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as eventBus from '@qa/event-bus';
import { readLines, verifyChain } from '@qa/event-bus';
import { writeArtifact } from '@qa/reporters';

const REPO = path.join(__dirname, '..');
const RUN = 'RUN-20261002-001';
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-legacy-'));
  fs.writeFileSync(path.join(dir, 'aegis.config.json'), JSON.stringify({ targetProjectRoot: '..' }));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function filesUnder(rel: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'superpowers') continue;
      const p = path.join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|mjs|js|json|md|yaml)$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(REPO, rel));
  return out;
}

const artifact = (bus: string) => ({
  kind: 'test-plan',
  data: { id: 'TP-AUTH-001' },
  jsonPath: path.join(dir, 'runs', RUN, 'plan.json'),
  mdPath: path.join(dir, 'runs', RUN, 'plan.md'),
  aegisRoot: dir,
  busPath: bus,
  chain: { emittedBy: 'qa-test-planner', runId: RUN },
  renderMd: () => '# Test plan\n',
});

describe('CO-01: no unchained event writer is left', () => {
  it('@qa/event-bus exports no unchained append()', () => {
    expect((eventBus as unknown as Record<string, unknown>)['append']).toBeUndefined();
  });

  it('@qa/sandbox-manager is deleted and nothing names it', () => {
    expect(fs.existsSync(path.join(REPO, 'packages', '@qa', 'sandbox-manager'))).toBe(false);
    const hits = ['packages', 'apps', 'scripts', '.claude', 'HANDBOOK', 'docs']
      .flatMap(filesUnder)
      .filter((f) => fs.readFileSync(f, 'utf-8').includes('@qa/sandbox-manager'));
    expect(hits).toEqual([]);
  });

  it('A2: nothing but @qa/event-bus chain.ts writes an events.jsonl (repo-wide regression guard)', () => {
    const CHAIN = path.join(REPO, 'packages', '@qa', 'event-bus', 'src', 'chain.ts');
    const sources = [
      ...fs.readdirSync(path.join(REPO, 'packages', '@qa')).map((p) => path.join('packages', '@qa', p, 'src')),
      ...fs.readdirSync(path.join(REPO, 'apps')).map((a) => path.join('apps', a, 'src')),
      'scripts',
    ]
      .flatMap(filesUnder)
      .filter((f) => /\.(ts|mjs|js)$/.test(f) && f !== CHAIN);
    const WRITE = /\b(appendFileSync|writeFileSync|appendFile|writeFile|createWriteStream|openSync|truncateSync|ftruncateSync|writeSync|renameSync|copyFileSync|rmSync|unlinkSync)\s*\(([^;]*)/g;
    const offenders: string[] = [];
    for (const f of sources) {
      const text = fs.readFileSync(f, 'utf-8');
      // Names bound to the event log in this file: `const busPath = join(dir, "events.jsonl")`, `= busPath(root, id)`, …
      const names = new Set(['busPath']);
      for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*(?:events\.jsonl|busPath\s*\()/g)) names.add(m[1]!);
      for (const m of text.matchAll(WRITE)) {
        const args = m[2]!;
        if (m[1] === 'openSync' && /,\s*["']r["']/.test(args)) continue; // opened for reading
        const named = args.includes('events.jsonl') || [...names].some((n) => new RegExp(`(^|[^\\w$.])${n.replace(/\$/g, '\\$')}\\b`).test(args));
        if (named) offenders.push(`${path.relative(REPO, f)}: ${m[0]!.slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('A2: the guard itself catches a planted direct write (self-test of the scan)', () => {
    const planted = 'const log = join(runDir, "events.jsonl");\nappendFileSync(log, line);\nwriteFileSync(busPath(root, id), "x");\n';
    const names = new Set(['busPath']);
    for (const m of planted.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*(?:events\.jsonl|busPath\s*\()/g)) names.add(m[1]!);
    const hits = [...planted.matchAll(/\b(appendFileSync|writeFileSync)\s*\(([^;]*)/g)].filter((m) => [...names].some((n) => new RegExp(`(^|[^\\w$.])${n}\\b`).test(m[2]!)));
    expect(hits).toHaveLength(2);
  });

  it('writeArtifact records artifact.created on the hash chain', async () => {
    const bus = path.join(dir, 'runs', RUN, 'events.jsonl');
    await writeArtifact(artifact(bus));
    const [line] = readLines(bus);
    expect(JSON.parse(line!)).toMatchObject({ seq: 1, type: 'artifact.created', kind: 'test-plan', emittedBy: 'qa-test-planner', runId: RUN });
    expect(verifyChain(bus).ok).toBe(true);
  });

  it('writeArtifact refuses to append past a torn tail', async () => {
    const bus = path.join(dir, 'runs', RUN, 'events.jsonl');
    fs.mkdirSync(path.dirname(bus), { recursive: true });
    fs.writeFileSync(bus, '{"seq":1,"prevH');
    await expect(writeArtifact(artifact(bus))).rejects.toThrow(/torn tail/);
  });
});
