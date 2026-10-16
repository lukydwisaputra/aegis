import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';

/**
 * Test hygiene: the patterns behind this suite's flaky tests, refused at the source (HANDBOOK 14.12).
 *
 * Each rule reads the TypeScript syntax tree of every test file and helper under __internal-tests__ (code in a string, such as a
 * child process's script, is not code of the test and is never read). A reviewed exception carries `// hygiene-ok: <reason>` on
 * the flagged line or on the line above it; the reason is required.
 */

const DIR = __dirname;
const SELF = path.join(DIR, 'test-hygiene.test.ts');

export type RuleId = 'wall-clock-bound' | 'real-timer' | 'real-date' | 'unseeded-random' | 'floating-promise' | 'stale-build-skip' | 'env-leak' | 'same-ms-claim';
export interface Hit { file: string; line: number; rule: RuleId; text: string }

const OK = /\/\/\s*hygiene-ok:\s*\S/;

function testFiles(dir = DIR, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'fixtures') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) testFiles(p, acc);
    else if (e.name.endsWith('.ts') && p !== SELF) acc.push(p);
  }
  return acc.sort();
}

const isCall = (n: ts.Node, obj: string, prop: string): n is ts.CallExpression =>
  ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === prop && n.expression.expression.getText() === obj;
const isClockRead = (n: ts.Node): boolean =>
  isCall(n, 'Date', 'now') || isCall(n, 'performance', 'now') || isCall(n, 'process.hrtime', 'bigint') || (ts.isCallExpression(n) && n.expression.getText() === 'process.hrtime');
const isNewDateNow = (n: ts.Node): boolean => ts.isNewExpression(n) && n.expression.getText() === 'Date' && (n.arguments?.length ?? 0) === 0;
const DATE_PARTS = new Set(['getFullYear', 'getMonth', 'getDate', 'getDay', 'getUTCFullYear', 'getUTCMonth', 'getUTCDate', 'getUTCDay', 'toDateString', 'toLocaleDateString']);
const envKey = (n: ts.Node): string | null => {
  if (ts.isPropertyAccessExpression(n) && n.expression.getText() === 'process.env') return n.name.text;
  if (ts.isElementAccessExpression(n) && n.expression.getText() === 'process.env' && ts.isStringLiteral(n.argumentExpression)) return n.argumentExpression.text;
  return null;
};

/**
 * The task of a statement that writes a hook-ledger claim stamped by the real clock (else null): the test files' ledger(agentId, type,
 * 'claim', task) helper with no time argument, or appendLedger(..., { ts: new Date().toISOString(), kind: 'claim', taskId, ... }).
 */
function realClockLedgerClaimTask(st: ts.Statement): string | null {
  if (!ts.isExpressionStatement(st)) return null;
  let e: ts.Expression = st.expression;
  if (ts.isAwaitExpression(e)) e = e.expression;
  if (!ts.isCallExpression(e) || !ts.isIdentifier(e.expression)) return null;
  const args = e.arguments;
  const text = (x: ts.Expression | undefined) => (x !== undefined && ts.isStringLiteral(x) ? x.text : null);
  if (e.expression.text === 'ledger') return args.length <= 4 && text(args[2]) === 'claim' ? text(args[3]) : null;
  if (e.expression.text !== 'appendLedger') return null;
  const obj = args[2];
  if (obj === undefined || !ts.isObjectLiteralExpression(obj)) return null;
  const prop = (name: string) => obj.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === name)?.initializer;
  const kind = prop('kind');
  const stamp = prop('ts');
  return text(kind) === 'claim' && stamp !== undefined && /^new Date\(\)\.toISOString\(\)$/.test(stamp.getText()) ? text(prop('taskId')) : null;
}

/**
 * The syntactic rules over one source text.
 *  wall-clock-bound: a clock read minus a variable (an elapsed time: Date.now() - t0, performance.now() - t0, hrtime - t0). A constant
 *    offset (Date.now() - 60_000, Date.now() - n * 60_000) builds a fixture time and is not flagged.
 *  real-timer: setTimeout, setInterval or setImmediate called by the test (a real sleep that orders or races work).
 *  real-date: a calendar part of the real clock (new Date().getUTCDate(), Date.now() into toDateString, new Date().toISOString()
 *    cut to its day): the test changes on a day, month or year boundary and in another timezone.
 *  unseeded-random: Math.random.
 *  stale-build-skip: a staleBuild skip not forced off under CI (process.env.CI on the same line).
 *  env-leak: a process.env key assigned in a file that never deletes that key and never restores process.env as a whole.
 *  same-ms-claim: a real-clock ledger claim of a task after a CLI claim of that task in the same block (realClockLedgerClaimTask).
 */
export function syntacticHits(file: string, text: string): Hit[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = text.split('\n');
  const hits: Hit[] = [];
  const at = (n: ts.Node, rule: RuleId) => {
    const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
    if (OK.test(lines[line] ?? '') || OK.test(lines[line - 1] ?? '')) return;
    hits.push({ file: path.relative(DIR, file), line: line + 1, rule, text: (lines[line] ?? '').trim().slice(0, 160) });
  };
  const assigned = new Map<string, ts.Node>();
  const deleted = new Set<string>();
  let wholeEnvRestored = false;
  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.MinusToken && isClockRead(n.left)) {
      const r = n.right;
      if (ts.isIdentifier(r) || ts.isPropertyAccessExpression(r) || ts.isCallExpression(r)) at(n, 'wall-clock-bound');
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ['setTimeout', 'setInterval', 'setImmediate'].includes(n.expression.text)) at(n, 'real-timer');
    if (ts.isPropertyAccessExpression(n) && DATE_PARTS.has(n.name.text) && (isNewDateNow(n.expression) || isClockRead(n.expression))) at(n, 'real-date');
    if (isCall(n, 'Math', 'random')) at(n, 'unseeded-random');
    if (ts.isCallExpression(n) && n.expression.getText() === 'staleBuild' && path.relative(DIR, file) !== path.join('alignment', 'report.test.ts')) {
      const line = lines[sf.getLineAndCharacterOfPosition(n.getStart(sf)).line] ?? '';
      if (!/process\.env(\.CI|\['CI'\]|\["CI"\])/.test(line)) at(n, 'stale-build-skip');
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const k = envKey(n.left);
      if (k !== null && !assigned.has(k)) assigned.set(k, n);
      if (n.left.getText() === 'process.env') wholeEnvRestored = true;
    }
    if (ts.isDeleteExpression(n)) {
      const k = envKey(n.expression);
      if (k !== null) deleted.add(k);
    }
    // new Date().toISOString().slice(0, 10): the real day.
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['slice', 'substring', 'substr'].includes(n.expression.name.text)) {
      const inner = n.expression.expression;
      if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text === 'toISOString' && isNewDateNow(inner.expression.expression)) {
        const end = n.arguments[1];
        if (end !== undefined && ts.isNumericLiteral(end) && Number(end.text) <= 10) at(n, 'real-date');
      }
    }
    // same-ms-claim: in one block, a hook-ledger claim stamped from the real clock after a CLI claim (claimTask) of the same block. The
    // holder search takes a ledger claim at or before the task's claimedAt, so a later claim stamped in the same millisecond becomes the
    // holder (the m5 flake). A later claim needs an explicit later time (new Date(Date.now() + 1_000)).
    if (ts.isBlock(n) || ts.isSourceFile(n)) {
      const claimed = new Set<string>();
      for (const st of n.statements) {
        const task = realClockLedgerClaimTask(st);
        if (task !== null && claimed.has(task)) at(st, 'same-ms-claim');
        // A CLI claim on the real clock: four arguments (a fifth is its time, stamped apart by the test).
        for (const m of st.getText(sf).matchAll(/\bclaimTask\([^,()]+,[^,()]+,\s*'([^']+)',\s*[^,()]+\)/g)) claimed.add(m[1]!);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!wholeEnvRestored) for (const [k, n] of assigned) if (!deleted.has(k)) at(n, 'env-leak');
  return hits;
}

const isPromiseType = (t: ts.Type): boolean => {
  if (t.isUnion()) return t.types.some(isPromiseType);
  const s = t.getSymbol() ?? t.aliasSymbol;
  return s !== undefined && (s.getName() === 'Promise' || s.getName() === 'PromiseLike');
};

/**
 * floating-promise: an expression statement whose value is a promise and that is neither awaited nor returned: an unawaited
 * expect(...).rejects, or a call into the code under test that runs on after the test ended (into the next test's root). A
 * `void` in front of a promise is flagged too: in a test it only hides the same thing.
 */
export function floatingPromiseHits(files: string[]): Hit[] {
  const program = ts.createProgram(files, {
    module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, target: ts.ScriptTarget.ES2022, strict: true,
    skipLibCheck: true, noEmit: true, esModuleInterop: true, types: ['jest', 'node'], typeRoots: [path.join(DIR, '..', 'node_modules', '@types')],
    baseUrl: DIR, paths: { '@qa/*': ['../packages/@qa/*/src/index'] },
  });
  const checker = program.getTypeChecker();
  const hits: Hit[] = [];
  const wanted = new Set(files);
  for (const sf of program.getSourceFiles()) {
    if (!wanted.has(sf.fileName)) continue;
    const lines = sf.text.split('\n');
    const at = (n: ts.Node) => {
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
      if (OK.test(lines[line] ?? '') || OK.test(lines[line - 1] ?? '')) return;
      hits.push({ file: path.relative(DIR, sf.fileName), line: line + 1, rule: 'floating-promise', text: (lines[line] ?? '').trim().slice(0, 160) });
    };
    const visit = (n: ts.Node): void => {
      if (ts.isExpressionStatement(n)) {
        const e = n.expression;
        // An assignment keeps the handle (awaited later); anything else whose value is a promise is dropped.
        const kept = ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken;
        if (!kept && !ts.isAwaitExpression(e) && !ts.isVoidExpression(e) && isPromiseType(checker.getTypeAtLocation(e))) at(n);
      }
      if (ts.isVoidExpression(n) && isPromiseType(checker.getTypeAtLocation(n.expression))) at(n);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return hits;
}

const show = (hits: Hit[]) => hits.map((h) => `${h.file}:${h.line} [${h.rule}] ${h.text}`);

describe('test hygiene: the flaky-test patterns are refused in the test sources', () => {
  const files = testFiles();

  it('scans every test file and helper', () => {
    expect(files.length).toBeGreaterThan(150);
    expect(files.some((f) => f.endsWith(path.join('helpers', 'hooks.ts')))).toBe(true);
  });

  it('no wall-clock bound, real timer, real calendar date, unseeded random, unforced stale-build skip or leaked env key without a reviewed reason', () => {
    expect(show(files.flatMap((f) => syntacticHits(f, fs.readFileSync(f, 'utf8'))))).toEqual([]);
  });

  it('no floating promise', () => {
    expect(show(floatingPromiseHits(files))).toEqual([]);
  }, 180_000); // one type-checked program over the test tree

  it('every reviewed exception names a reason', () => {
    const bare = files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => [f, i + 1, l] as const))
      .filter(([, , l]) => /hygiene-ok\b/.test(l) && !OK.test(l))
      .map(([f, n]) => `${path.relative(DIR, f)}:${n}`);
    expect(bare).toEqual([]);
  });
});

describe('test hygiene: each rule catches its pattern and passes its look-alike', () => {
  const ids = (text: string) => syntacticHits(path.join(DIR, 'sample.test.ts'), text).map((h) => h.rule);
  it.each([
    ['const t0 = Date.now(); run(); expect(Date.now() - t0).toBeLessThan(5_000);', ['wall-clock-bound']],
    ['const t0 = performance.now(); expect(performance.now() - t0).toBeLessThan(5);', ['wall-clock-bound']],
    ['const t0 = process.hrtime.bigint(); const ms = process.hrtime.bigint() - t0;', ['wall-clock-bound']],
    ['await new Promise((r) => setTimeout(r, 300)); await finish();', ['real-timer']],
    ['setInterval(() => undefined, 10);', ['real-timer']],
    ["expect(id).toBe(`RUN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-001`);", ['real-date']],
    ['const d = new Date().getUTCDate();', ['real-date']],
    ['const pick = Math.random() > 0.5;', ['unseeded-random']],
    ['const stale = staleBuild(ROOT);', ['stale-build-skip']],
    ["process.env['X_KEY'] = '1';", ['env-leak']],
    ["it('x', async () => { await claimTask(root, runId, 'T-1', UI); ledger('a1', UI, 'claim', 'T-1'); });", ['same-ms-claim']],
    ["it('x', async () => { await claimTask(root, runId, 'T-1', UI); appendLedger(root, runId, { ts: new Date().toISOString(), agentId: 'a1', agentType: UI, kind: 'claim', taskId: 'T-1' }); });", ['same-ms-claim']],
  ])('flags: %s', (text, want) => {
    expect(ids(text)).toEqual(want);
  });
  it.each([
    'const old = new Date(Date.now() - 60_000).toISOString();',
    'const at = new Date(Date.now() - minutes * 60_000);',
    'const code = `setTimeout(() => process.exit(7), 300)`;',
    'const t0 = Date.now(); expect(Date.now() - t0).toBeLessThan(5_000); // hygiene-ok: catastrophic-only bound on CPU-bound work',
    '// hygiene-ok: holds the lock for the waiter\nawait new Promise((r) => setTimeout(r, 400));',
    'const stamp = new Date().toISOString();',
    "const stale = process.env.CI ? null : staleBuild(ROOT);",
    "process.env['X_KEY'] = '1'; afterEach(() => { delete process.env['X_KEY']; });",
    'const keep = process.env; process.env = { ...keep, X_KEY: "1" }; process.env.X_KEY = "2"; process.env = keep;',
    "it('x', async () => { ledger('a1', UI, 'claim', 'T-1'); await claimTask(root, runId, 'T-1', UI); });",
    "it('x', async () => { await claimTask(root, runId, 'T-1', UI); ledger('a1', UI, 'claim', 'T-1', new Date(Date.now() + 1_000).toISOString()); });",
    "it('x', async () => { await claimTask(root, runId, 'T-3', API); ledger('a1', UI, 'claim', 'T-2'); await claimTask(root, runId, 'T-2', UI); });",
    "it('x', async () => { await claimTask(root, runId, 'T-1', UI, new Date(Date.now() - 1_000)); ledger('a1', UI, 'claim', 'T-1'); });",
  ])('passes: %s', (text) => {
    expect(ids(text)).toEqual([]);
  });
  it('a hygiene-ok without a reason does not count', () => {
    expect(ids('setTimeout(r, 5); // hygiene-ok:')).toEqual(['real-timer']);
  });
  it('a floating promise and an unawaited rejects are caught; awaited ones and a kept handle are not', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-hygiene-'));
    try {
      const f = path.join(dir, 'probe.test.ts');
      fs.writeFileSync(f, [
        'const work = async () => 1;',
        "it('x', async () => {",
        '  work();',
        '  expect(work()).resolves.toBe(1);',
        '  void work();',
        '  await work();',
        '  await expect(work()).resolves.toBe(1);',
        '  const kept = work(); await kept;',
        '});',
      ].join('\n'));
      expect(floatingPromiseHits([f]).map((h) => h.line)).toEqual([3, 4, 5]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
