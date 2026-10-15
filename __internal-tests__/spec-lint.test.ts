import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { addTask, claimTask, completePhase, completePhaseWithWarnings, createRun, readRun, reissueRun, releaseTask, runDir, specFindings, specRefs, SPEC_RULES, startPhase, submitWorkReport, writeRun, type Finding } from '@qa/run-state';
import { PHASE_IDS } from '@qa/contracts';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';
import { fastForward, ORCH, TS, workTask } from './helpers/pipeline';

// The barrier computes the spec lint before it takes run.lock: the wrapper records that the lock was free while it ran.
const lockFree: boolean[] = [];
jest.mock('../packages/@qa/run-state/src/lint/specs', () => {
  const actual = jest.requireActual('../packages/@qa/run-state/src/lint/specs');
  return {
    ...actual,
    specFindings: jest.fn(async (root: string, runId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { withRunLock } = require('../packages/@qa/run-state/src/run');
      lockFree.push(await withRunLock(root, runId, async () => true));
      return actual.specFindings(root, runId);
    }),
  };
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lintSpy = (require('../packages/@qa/run-state/src/lint/specs') as { specFindings: jest.Mock }).specFindings;

// Task 5: the spec lint reads the spec files the result files name (specRef, specFile, automatedTestRef) with the TypeScript compiler API.
// The fixtures are the shapes of the three real runs: the renci and slec specs the replay read (see the report of the task).

let t: TmpAegis;
let runId: string;
let target: string;
const FIXTURE = "import { test, expect } from '../../fixtures/auth.fixture';\n";
const POM = "import { LoginPage } from '../../pages/login/login.page';\n";
const SHOT = "test.afterEach(async ({}, testInfo) => afterEachShot(driven, testInfo));\n";

beforeEach(async () => {
  lockFree.length = 0;
  t = makeAegisRoot();
  target = `${t.root}-target`;
  fs.mkdirSync(path.join(target, 'tests', 'qa', 'fixtures'), { recursive: true });
  fs.writeFileSync(path.join(target, 'tests', 'qa', 'fixtures', 'auth.fixture.ts'), 'export const test = {};\n');
  const cfg = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), targetProjectRoot: target, testsDir: path.join(target, 'tests', 'qa') }));
  runId = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId;
});
afterEach(() => {
  t.cleanup();
  fs.rmSync(target, { recursive: true, force: true });
});

const spec = (rel: string, body: string) => {
  const f = path.join(target, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
};
const put = (rel: string, v: unknown) => {
  const f = path.join(runDir(t.root, runId), rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 2));
};
const result = (tc: string, extra: Record<string, unknown>) => put(`cases/${tc}-result.json`, { id: tc, status: 'passed', ...extra });
const setRules = (rules: object) => {
  const cfg = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), reportRules: { ...rules, disable: [...((rules as { disable?: string[] }).disable ?? []), 'env-probe'] } }));
};
const SPEC = 'tests/qa/specs/login/ui.spec.ts';
/** The findings of one spec file as one passed result names it. */
async function lint(body: string, rel = SPEC): Promise<Finding[]> {
  spec(rel, body);
  result('TC-AUTH-001', { specRef: rel });
  return specFindings(t.root, runId);
}
const ids = (fs_: Finding[]) => fs_.map((f) => f.rule).sort();

describe('spec-wait-for-timeout', () => {
  it('a waitForTimeout call is reported with its line; the word in a comment is not (the real slec comments)', async () => {
    const found = await lint(`${FIXTURE}${POM}${SHOT}\n// never a waitForTimeout(1000) here\ntest('t', async ({ page }) => {\n  await page.waitForTimeout((seconds + 5) * 1000);\n  await expect(page).toHaveURL('/');\n});\n`);
    expect(found.filter((f) => f.rule === 'spec-wait-for-timeout')).toEqual([expect.objectContaining({ file: SPEC, line: 7, severity: SPEC_RULES['spec-wait-for-timeout'] })]);
  });
  it('a spec with web-first waits is clean', async () => {
    expect(ids(await lint(`${FIXTURE}${POM}${SHOT}test('t', async ({ page }) => {\n  await expect(page.getByRole('button')).toBeVisible();\n});\n`))).toEqual([]);
  });
});

describe('spec-fixture-import', () => {
  const body = (imp: string) => `${imp}${POM}${SHOT}test('t', async ({ page }) => {\n  await expect(page).toHaveURL('/');\n});\n`;
  it('a UI spec that imports test from @playwright/test instead of the QA fixture is reported', async () => {
    const found = await lint(body("import { test, expect } from '@playwright/test';\n"));
    expect(found.filter((f) => f.rule === 'spec-fixture-import')).toEqual([expect.objectContaining({ file: SPEC, line: 1 })]);
  });
  it('the fixture import, a type-only import of Page and expect-only imports are clean', async () => {
    expect(ids(await lint(body("import { test, expect } from '../../fixtures/auth.fixture';\nimport type { Page } from '@playwright/test';\n")))).not.toContain('spec-fixture-import');
    expect(ids(await lint(body("import { test } from '../../fixtures/auth.fixture';\nimport { expect } from '@playwright/test';\n")))).not.toContain('spec-fixture-import');
  });
  it('an API or contract spec with no page may import from @playwright/test (the real renci contract spec)', async () => {
    const found = await lint("import { test, expect, request } from '@playwright/test';\ntest('t', async () => {\n  const ctx = await request.newContext();\n  expect((await ctx.get('/x')).status()).toBe(200);\n});\n", 'tests/qa/contract/standin.contract.spec.ts');
    expect(ids(found)).toEqual([]);
  });
  it('a spec outside the UI specialist folder that drives a page with its own login may import from @playwright/test (the real slec messaging specs)', async () => {
    const found = await lint(body("import { test, expect } from '@playwright/test';\n"), 'tests/qa/messaging/t8-commhub.messaging.spec.ts');
    expect(ids(found)).not.toContain('spec-fixture-import');
    expect(ids(found)).not.toContain('spec-afterEach-screenshot');
    expect(ids(found)).not.toContain('spec-raw-page');
  });
  it('a project with no auth fixture has nothing to import: not reported', async () => {
    fs.rmSync(path.join(target, 'tests', 'qa', 'fixtures'), { recursive: true });
    expect(ids(await lint(body("import { test, expect } from '@playwright/test';\n")))).not.toContain('spec-fixture-import');
  });
});

describe('spec-trivial-assertion', () => {
  it.each([
    ['expect(true).toBe(true)', 'the real renci selfcheck line'],
    ['expect(1).toBe(1)', 'a number against itself'],
    ["expect('ok').toEqual('ok')", 'a string against itself'],
    ['expect(true).toBeTruthy()', 'toBeTruthy on a literal'],
    ['expect(false).toBeFalsy()', 'toBeFalsy on a literal'],
    ['expect(null).toBeNull()', 'null is null'],
  ])('%s is reported (%s)', async (line) => {
    const found = await lint(`import { test, expect } from '@playwright/test';\ntest('t', async () => {\n  ${line};\n});\n`, 'tests/qa/api/x.api.spec.ts');
    expect(found.filter((f) => f.rule === 'spec-trivial-assertion')).toEqual([expect.objectContaining({ line: 3 })]);
  });
  it.each(['expect(res.status()).toBe(200)', 'expect(true).toBe(ok)', 'expect(1).toBe(2)', 'expect(count).toBeTruthy()', 'expect(false).toBe(true)'])('%s is not', async (line) => {
    const found = await lint(`import { test, expect } from '@playwright/test';\ntest('t', async () => {\n  ${line};\n});\n`, 'tests/qa/api/x.api.spec.ts');
    expect(ids(found)).not.toContain('spec-trivial-assertion');
  });
  it('the phrase in a comment is not an assertion (the real slec comment)', async () => {
    const found = await lint("import { test } from '@playwright/test';\n// `expect(true).toBe(true)` placeholder with the real oracle only described\ntest('t', async () => {});\n", 'tests/qa/api/x.api.spec.ts');
    expect(ids(found)).toEqual([]);
  });
});

describe('spec-swallowed-cleanup', () => {
  const api = (body: string) => `import { test } from '@playwright/test';\n${body}`;
  it('a swallowed catch inside a cleanup hook or a finally block is reported', async () => {
    const a = await lint(api("test.afterEach(async () => {\n  await fresh.end().catch(() => undefined);\n});\n"), 'tests/qa/api/a.api.spec.ts');
    expect(a.filter((f) => f.rule === 'spec-swallowed-cleanup')).toEqual([expect.objectContaining({ line: 3 })]);
    const b = await lint(api("test('t', async () => {\n  try {\n    await x();\n  } finally {\n    await db.query('rollback').catch(() => {});\n  }\n});\n"), 'tests/qa/api/b.api.spec.ts');
    expect(ids(b)).toContain('spec-swallowed-cleanup');
  });
  it('an empty catch block in afterAll and in a function named cleanup is reported', async () => {
    const a = await lint(api("test.afterAll(async () => {\n  try {\n    await drop();\n  } catch {}\n});\n"), 'tests/qa/api/a.api.spec.ts');
    expect(ids(a)).toContain('spec-swallowed-cleanup');
    const b = await lint(api("async function cleanupRows() {\n  try {\n    await drop();\n  } catch (e) {\n  }\n}\n"), 'tests/qa/api/b.api.spec.ts');
    expect(ids(b)).toContain('spec-swallowed-cleanup');
  });
  it('a best-effort screenshot and an empty catch that states its reason are not (the real slec afterEach hooks and cleanups)', async () => {
    const a = await lint(api("test.afterEach(async ({ adminPage }, testInfo) => {\n  await adminPage.screenshot({ path: 'x.png' }).catch(() => undefined);\n});\n"), 'tests/qa/api/a.api.spec.ts');
    expect(ids(a)).not.toContain('spec-swallowed-cleanup');
    const b = await lint(api("test.afterAll(async () => {\n  try {\n    await drop();\n  } catch {\n    // cleanup must never fail the test it is protecting\n  }\n});\n"), 'tests/qa/api/b.api.spec.ts');
    expect(ids(b)).not.toContain('spec-swallowed-cleanup');
  });
  it('a catch that records or rethrows, and a swallowed catch outside any cleanup (a json parse), are not', async () => {
    const a = await lint(api("test.afterEach(async () => {\n  await fresh.end().catch((e) => { failures.push(e); });\n});\n"), 'tests/qa/api/a.api.spec.ts');
    expect(ids(a)).not.toContain('spec-swallowed-cleanup');
    const b = await lint(api("test('t', async () => {\n  const parsed = await r.json().catch(() => null);\n  expect(parsed).toBeNull();\n});\n"), 'tests/qa/api/b.api.spec.ts');
    expect(ids(b)).not.toContain('spec-swallowed-cleanup');
  });
});

describe('spec-afterEach-screenshot', () => {
  const ui = (hook: string) => `${FIXTURE}${POM}${hook}test('t', async ({ page }) => {\n  await expect(page).toHaveURL('/');\n});\n`;
  it('a UI spec with no afterEach hook is reported', async () => {
    expect(ids(await lint(ui('')))).toContain('spec-afterEach-screenshot');
  });
  it('an afterEach hook that takes no screenshot is reported', async () => {
    expect(ids(await lint(ui("test.afterEach(async () => {\n  await cleanup();\n});\n")))).toContain('spec-afterEach-screenshot');
  });
  it('the real helper hook and an inline page.screenshot are clean', async () => {
    expect(ids(await lint(ui(SHOT)))).not.toContain('spec-afterEach-screenshot');
    expect(ids(await lint(ui("test.afterEach(async ({ page }, testInfo) => {\n  await page.screenshot({ path: 'x.png' });\n});\n")))).not.toContain('spec-afterEach-screenshot');
  });
  it('an afterEach that writes an evidence file is accepted (the real slec hooks write an evidence record per test)', async () => {
    expect(ids(await lint(ui("test.afterEach(async ({}, testInfo) => {\n  await writeFile(join(RUN_EVIDENCE_DIR, `TC-OTP-035_${testInfo.status}.txt`), 'x');\n});\n")))).not.toContain('spec-afterEach-screenshot');
  });
  it('a spec outside the UI specialist folder that opens a page is not checked for the hook', async () => {
    expect(ids(await lint(ui(''), 'tests/qa/api/session.api.spec.ts'))).not.toContain('spec-afterEach-screenshot');
  });
  it('a spec that opens no page (API, database) needs no screenshot', async () => {
    expect(ids(await lint("import { test, expect } from '@playwright/test';\ntest('t', async ({ request }) => {\n  expect((await request.get('/x')).status()).toBe(200);\n});\n", 'tests/qa/api/a.api.spec.ts'))).toEqual([]);
  });
});

describe('spec-raw-page', () => {
  it('page calls in a spec that imports no Page Object are reported once, with the count', async () => {
    const found = await lint(`${FIXTURE}${SHOT}test('t', async ({ page }) => {\n  await page.goto('/login');\n  await page.getByRole('button', { name: 'Go' }).click();\n  await expect(page).toHaveURL('/');\n});\n`);
    const raw = found.filter((f) => f.rule === 'spec-raw-page');
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ file: SPEC, line: 4 });
    expect(raw[0]!.context).toContain('2 page calls');
  });
  it('a fixture page named for its role is a page too (adminPage.getByRole in the real slec afterEach); a Page Object instance is not', async () => {
    const raw = await lint(`${FIXTURE}${SHOT}test('t', async ({ adminPage }) => {\n  await adminPage.getByRole('row').click();\n  await usersPage.findAndDeleteStaffBy('x');\n});\n`);
    expect(raw.find((f) => f.rule === 'spec-raw-page')!.context).toContain('1 page call,');
  });
  it('the same calls with a Page Object imported are clean', async () => {
    const found = await lint(`${FIXTURE}${POM}${SHOT}test('t', async ({ page }) => {\n  await page.goto('/login');\n});\n`);
    expect(ids(found)).not.toContain('spec-raw-page');
  });
  it('a Page Object imported as a named page file from the real tree is clean', async () => {
    const found = await lint(`${FIXTURE}import { AdminRoutePage } from '../../pages/_shared/admin-route.page';\n${SHOT}test('t', async ({ page }) => {\n  await page.goto('/x');\n});\n`);
    expect(ids(found)).not.toContain('spec-raw-page');
  });
});

describe('spec-e2e-suffix', () => {
  const caseFile = (id: string, testType: unknown) => put(`cases/${id}.json`, { id, testType });
  it('an E2E case whose spec is not named for the journey is reported; the e2e name and other types are not', async () => {
    caseFile('TC-AUTH-001', 'E2E');
    const found = await lint(`${FIXTURE}${POM}${SHOT}test('t', async () => {});\n`);
    expect(found.filter((f) => f.rule === 'spec-e2e-suffix')).toEqual([expect.objectContaining({ file: SPEC, line: 1 })]);
    caseFile('TC-AUTH-001', 'E2E');
    expect(ids(await lint(`${FIXTURE}${POM}${SHOT}test('t', async () => {});\n`, 'tests/qa/specs/login/login.e2e.spec.ts'))).not.toContain('spec-e2e-suffix');
    caseFile('TC-AUTH-001', ['Functional']);
    expect(ids(await lint(`${FIXTURE}${POM}${SHOT}test('t', async () => {});\n`, SPEC))).not.toContain('spec-e2e-suffix');
    caseFile('TC-AUTH-001', ['Functional', 'E2E']);
    expect(ids(await lint(`${FIXTURE}${POM}${SHOT}test('t', async () => {});\n`, SPEC))).toContain('spec-e2e-suffix');
  });
});

describe('where the spec references come from (the real shapes)', () => {
  const R = (rel: string) => spec(rel, "import { test } from '@playwright/test';\ntest('t', async () => {});\n");
  beforeEach(() => ['tests/qa/api/a.api.spec.ts', 'tests/qa/api/b.api.spec.ts', 'tests/qa/specs/x/ui.spec.ts', 'tests/qa/messaging/c.messaging.spec.ts', 'tests/qa/integration/d.db.test.ts'].forEach(R));
  const resolved = () => specRefs(t.root, runId).resolved.sort();

  it('a plain path, a path#name and a prose entry with two paths and parenthesised notes (R12, R06, S05)', () => {
    result('TC-A-001', { specRef: 'tests/qa/api/a.api.spec.ts' });
    result('TC-A-002', { specRef: 'tests/qa/specs/x/ui.spec.ts#TC-A-002 the title of the test (retest)' });
    result('TC-A-003', { specRef: 'tests/qa/integration/d.db.test.ts (step 1 now non-skipped; the .skip describe stays, tests/qa/api/b.api.spec.ts covers the rest)' });
    expect(resolved()).toEqual(['tests/qa/api/a.api.spec.ts', 'tests/qa/api/b.api.spec.ts', 'tests/qa/integration/d.db.test.ts', 'tests/qa/specs/x/ui.spec.ts']);
  });
  it('specFile as a string, as an array (S05) and nested under a sub-result key', () => {
    result('TC-A-001', { specFile: 'tests/qa/api/a.api.spec.ts' });
    result('TC-A-002', { specFile: ['tests/qa/api/b.api.spec.ts', 'tests/qa/messaging/c.messaging.spec.ts'] });
    result('TC-A-003', { subResults: { stub: { specFile: 'tests/qa/specs/x/ui.spec.ts' } }, results: [{ specRef: 'tests/qa/integration/d.db.test.ts' }] });
    expect(resolved()).toHaveLength(5);
  });
  it('an object under specRef is searched for its paths; a null specRef (R06) names nothing', () => {
    result('TC-A-001', { specRef: { primary: 'tests/qa/api/a.api.spec.ts', also: ['tests/qa/api/b.api.spec.ts'] } });
    result('TC-A-002', { specRef: null });
    expect(resolved()).toEqual(['tests/qa/api/a.api.spec.ts', 'tests/qa/api/b.api.spec.ts']);
  });
  it('a case file names its automatedTestRef; a developer test outside the tests directory is not a QA spec', () => {
    put('cases/TC-A-001.json', { id: 'TC-A-001', testType: 'API', automatedTestRef: 'tests/qa/api/a.api.spec.ts#rls' });
    put('cases/TC-A-002.json', { id: 'TC-A-002', automatedTestRef: 'tests/rls/security-guard.test.ts#rls' });
    result('TC-A-003', { specRef: 'tests/e2e/broadcast-no-autofire.spec.ts#a developer test, run read-only' });
    result('TC-A-004', { specRef: 'tests/qa/specs/gone/ui.spec.ts' });
    const refs = specRefs(t.root, runId);
    expect(refs.resolved).toEqual(['tests/qa/api/a.api.spec.ts']);
    expect(refs.skipped.map((s) => s.reason).sort()).toEqual(['missing', 'outside', 'outside']);
  });
  it('a missing file is counted, never a finding', async () => {
    result('TC-A-001', { specRef: 'tests/qa/specs/gone/ui.spec.ts' });
    expect(specRefs(t.root, runId)).toMatchObject({ resolved: [], skipped: [{ ref: 'tests/qa/specs/gone/ui.spec.ts', reason: 'missing' }] });
    expect(await specFindings(t.root, runId)).toEqual([]);
  });
  it('a path out of the tests directory by .., an absolute path and a symbolic link are never read', () => {
    const outside = path.join(target, 'secret.spec.ts');
    fs.writeFileSync(outside, 'expect(true).toBe(true);\n');
    fs.symlinkSync(outside, path.join(target, 'tests', 'qa', 'api', 'link.api.spec.ts'));
    fs.mkdirSync(path.join(target, 'elsewhere'));
    fs.writeFileSync(path.join(target, 'elsewhere', 'd.spec.ts'), 'expect(true).toBe(true);\n');
    fs.symlinkSync(path.join(target, 'elsewhere'), path.join(target, 'tests', 'qa', 'linkdir'));
    result('TC-A-001', { specRef: ['tests/qa/../secret.spec.ts', outside, 'tests/qa/api/link.api.spec.ts', 'tests/qa/linkdir/d.spec.ts'] });
    const refs = specRefs(t.root, runId);
    expect(refs.resolved).toEqual([]);
    expect(refs.skipped).toHaveLength(4);
  });
  it('a secrets file is never read even when named like a spec', () => {
    spec('tests/qa/secrets/.env.spec.ts', 'expect(true).toBe(true);\n');
    result('TC-A-001', { specRef: 'tests/qa/secrets/.env.spec.ts' });
    expect(specRefs(t.root, runId).resolved).toEqual([]);
  });
  it('a smoke run is not linted', async () => {
    const smoke = (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'smoke' }, 'owner')).runId;
    const f = path.join(runDir(t.root, smoke), 'cases');
    fs.mkdirSync(f, { recursive: true });
    spec('tests/qa/api/t.api.spec.ts', "test('t', async () => {\n  expect(true).toBe(true);\n});\n");
    fs.writeFileSync(path.join(f, 'TC-A-001-result.json'), JSON.stringify({ specRef: 'tests/qa/api/t.api.spec.ts' }));
    expect(await specFindings(t.root, smoke)).toEqual([]);
  });
});

describe('the findings and the owner exceptions', () => {
  const BAD = "import { test, expect } from '@playwright/test';\ntest('t', async () => {\n  await page.waitForTimeout(500);\n  expect(true).toBe(true);\n});\n";
  it('a finding carries ids and a short cut snippet, never the whole code line', async () => {
    const long = `await page.waitForTimeout(${'1 + '.repeat(40)}1);`;
    const found = await lint(`import { test } from '@playwright/test';\ntest('t', async () => {\n  ${long}\n});\n`, 'tests/qa/api/a.api.spec.ts');
    const f = found.find((x) => x.rule === 'spec-wait-for-timeout')!;
    expect(f.context.length).toBeLessThanOrEqual(80);
    expect(JSON.stringify(f)).not.toContain('1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1');
    expect(f.kind).toBe('data');
  });
  it('one rule id and the group spec-checks in reportRules.disable lift the rules', async () => {
    expect(ids(await lint(BAD, 'tests/qa/api/a.api.spec.ts'))).toEqual(['spec-trivial-assertion', 'spec-wait-for-timeout']);
    setRules({ disable: ['spec-wait-for-timeout'] });
    expect(ids(await specFindings(t.root, runId))).toEqual(['spec-trivial-assertion']);
    setRules({ disable: ['spec-checks'] });
    expect(await specFindings(t.root, runId)).toEqual([]);
  });
  it('every rule id has a severity and joins the group', () => {
    expect(Object.keys(SPEC_RULES).sort()).toEqual(['spec-afterEach-screenshot', 'spec-e2e-suffix', 'spec-fixture-import', 'spec-raw-page', 'spec-swallowed-cleanup', 'spec-trivial-assertion', 'spec-wait-for-timeout']);
  });
  it('a file that is not valid TypeScript gives no finding and no throw', async () => {
    expect(await lint('const = = ;\n', 'tests/qa/api/a.api.spec.ts')).toEqual([]);
  });
});

describe('every hook loads @qa/run-state: typescript is loaded only when the spec lint runs', () => {
  const dist = path.join(__dirname, '..', 'packages', '@qa', 'run-state', 'dist', 'index.js');
  const probe = (code: string) => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, DIST: dist } });
    if (r.status !== 0) throw new Error(`probe failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const loaded = "import { createRequire } from 'node:module'; const r = createRequire(import.meta.url); const has = () => Object.keys(r.cache).some((k) => /[\\\\/]node_modules[\\\\/]typescript[\\\\/]lib[\\\\/]typescript\\.js$/.test(k));";
  it('importing the package does not load typescript', () => {
    expect(probe(`${loaded} const m = await import(process.env.DIST); console.log(typeof m.specFindings, has());`)).toBe('function false');
  });
  it('the spec lint loads it (the control: the probe can see the module)', () => {
    const code = `${loaded} const m = await import(process.env.DIST); const fs = await import('node:fs'); const os = await import('node:os'); const p = await import('node:path');
      const base = fs.mkdtempSync(p.join(os.tmpdir(), 'probe-')); const root = p.join(base, 'aegis'); const target = p.join(base, 'target');
      fs.mkdirSync(p.join(target, 'tests', 'qa', 'api'), { recursive: true }); fs.mkdirSync(root);
      fs.writeFileSync(p.join(target, 'tests', 'qa', 'api', 'a.api.spec.ts'), "test('t', async () => {\\n  await page.waitForTimeout(5);\\n});\\n");
      fs.writeFileSync(p.join(root, 'aegis.config.json'), JSON.stringify({ parallelism: { maxSpecialists: 2 }, environments: { development: { url: 'http://localhost:5173', mutating: true } }, targetProjectRoot: target, testsDir: p.join(target, 'tests', 'qa'), reportRules: { disable: ['env-probe'] } }));
      process.env.AEGIS_COUNTERS_PATH = p.join(root, '.counters.json');
      const run = await m.createRun(root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner');
      fs.mkdirSync(p.join(root, 'runs', run.runId, 'cases'), { recursive: true });
      fs.writeFileSync(p.join(root, 'runs', run.runId, 'cases', 'TC-A-001-result.json'), JSON.stringify({ specRef: 'tests/qa/api/a.api.spec.ts' }));
      const found = await m.specFindings(root, run.runId); console.log(found.length, has());`;
    expect(probe(code)).toBe('1 true');
  });
});

describe('the severities the replay of the three real runs decided', () => {
  it('only the rules with no hit on a passed spec of the replay are errors (task report: trivial assertion and the UI fixture import)', () => {
    expect(Object.entries(SPEC_RULES).filter(([, v]) => v === 'error').map(([k]) => k).sort()).toEqual(['spec-fixture-import', 'spec-trivial-assertion']);
    expect(SPEC_RULES['spec-wait-for-timeout']).toBe('warning');
  });
});

describe('the Execution barrier', () => {
  const GOOD = "import { test, expect } from '@playwright/test';\ntest('t', async ({ request }) => {\n  expect((await request.get('/x')).status()).toBe(200);\n});\n";
  const TRIVIAL = "import { test, expect } from '@playwright/test';\ntest('t', async () => {\n  expect(true).toBe(true);\n});\n";
  const SLEEP = "import { test, expect } from '@playwright/test';\ntest('t', async ({ page }) => {\n  await page.waitForTimeout(500);\n});\n";
  async function executionActive() {
    fastForward(t.root, runId, 'execution', { G1: { status: 'approved', decisions: 1 } });
    await startPhase(t.root, runId, 'execution', ORCH);
    await workTask(t.root, runId, 'T-execution-1', 'qa-test-executor', 'qa-test-executor-spv');
    put('execution-summary.json', { totals: { passed: 1, failed: 0, blocked: 0 } });
    put('rtm.json', { rows: [{ requirementId: 'REQ-ATT-01', testCaseIds: ['TC-ATT-001'], testStatus: 'Covered' }], defectMap: [] });
    put('cases/TC-ATT-001.json', { id: 'TC-ATT-001' });
  }
  const refusal = () => completePhase(t.root, runId, 'execution', ORCH).then(() => new Error('completed'), (e: Error) => e);

  it('a trivial assertion in a spec the results name refuses the phase while a specialist can still fix it; a clean spec completes', async () => {
    await executionActive();
    spec('tests/qa/api/a.api.spec.ts', TRIVIAL);
    put('cases/TC-ATT-001-result.json', { status: 'passed', specRef: 'tests/qa/api/a.api.spec.ts' });
    const e = await refusal();
    expect(e.message).toContain('tests/qa/api/a.api.spec.ts:3 spec-trivial-assertion');
    expect(e.message).toContain('spec-checks');
    spec('tests/qa/api/a.api.spec.ts', GOOD);
    const done = await completePhaseWithWarnings(t.root, runId, 'execution', ORCH);
    expect(done.state.phases['execution']!.status).toBe('completed');
    expect(done.warnings).toEqual([]);
  });

  it('a warning rule (the sleep) never refuses: it goes to the barrier warning channel and its phase file', async () => {
    await executionActive();
    spec('tests/qa/api/a.api.spec.ts', SLEEP);
    put('cases/TC-ATT-001-result.json', { status: 'passed', specRef: 'tests/qa/api/a.api.spec.ts' });
    const done = await completePhaseWithWarnings(t.root, runId, 'execution', ORCH);
    expect(done.warnings.map((f) => f.rule)).toEqual(['spec-wait-for-timeout']);
    expect(done.warningsReport).toBe('reports/lint/phase-execution.json');
    expect(JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), done.warningsReport!), 'utf8')).findings[0]).toMatchObject({ rule: 'spec-wait-for-timeout', file: 'tests/qa/api/a.api.spec.ts' });
  });

  it('the group spec-checks or one rule id in reportRules.disable lifts the refusal', async () => {
    await executionActive();
    spec('tests/qa/api/a.api.spec.ts', TRIVIAL);
    put('cases/TC-ATT-001-result.json', { status: 'passed', specRef: 'tests/qa/api/a.api.spec.ts' });
    expect((await refusal()).message).toContain('spec-trivial-assertion');
    setRules({ disable: ['spec-trivial-assertion'] });
    await expect(completePhase(t.root, runId, 'execution', ORCH)).resolves.toBeDefined();
  });

  it('the spec lint runs once per completion, with the run lock free', async () => {
    await executionActive();
    spec('tests/qa/api/a.api.spec.ts', TRIVIAL);
    put('cases/TC-ATT-001-result.json', { status: 'passed', specRef: 'tests/qa/api/a.api.spec.ts' });
    lintSpy.mockClear();
    await refusal();
    expect(lintSpy).toHaveBeenCalledTimes(1);
    await refusal();
    expect(lintSpy).toHaveBeenCalledTimes(2);
    expect(lockFree).toEqual([true, true]);
  });

  it('a scoped reissue: a spec only cases outside the reissued list name keeps its error as a warning', async () => {
    await executionActive();
    spec('tests/qa/api/a.api.spec.ts', TRIVIAL);
    spec('tests/qa/api/b.api.spec.ts', TRIVIAL);
    put('cases/TC-ATT-001-result.json', { status: 'passed', specRef: 'tests/qa/api/a.api.spec.ts' });
    put('cases/TC-ATT-002.json', { id: 'TC-ATT-002' });
    put('cases/TC-ATT-002-result.json', { status: 'passed', specRef: 'tests/qa/api/b.api.spec.ts' });
    expect((await specFindings(t.root, runId)).map((f) => `${f.file}|${f.severity}`)).toEqual(['tests/qa/api/a.api.spec.ts|error', 'tests/qa/api/b.api.spec.ts|error']);
    const s = readRun(t.root, runId);
    const phases = { ...s.phases };
    for (const id of PHASE_IDS) phases[id] = { status: 'completed' };
    writeRun(t.root, { ...s, status: 'completed', phases, gates: { G1: { status: 'approved', decisions: 1 }, G2: { status: 'approved', decisions: 1 }, G3: { status: 'approved', decisions: 1 } } } as never);
    await reissueRun(t.root, runId, { phase: 'execution', reason: 'Re-run one case', cases: ['TC-ATT-001'] }, 'owner');
    expect((await specFindings(t.root, runId)).map((f) => `${f.file}|${f.severity}`)).toEqual(['tests/qa/api/a.api.spec.ts|error', 'tests/qa/api/b.api.spec.ts|warning']);
  });
});

describe('a specialist sees the spec lint when it submits; the errors are stamped, nothing is refused', () => {
  const UI = 'qa-ui-specialist';
  const wr = (extra: Record<string, unknown>) => ({ taskId: 'T-exec-1', agent: UI, startedAt: TS, completedAt: TS, summary: 'Wrote the login specs for the submit lint test.', approach: 'Fixture-driven.', ...extra });
  const submit = async (artifacts: string[], file = 'w.json') => {
    const f = path.join(t.root, file);
    fs.writeFileSync(f, JSON.stringify(wr({ artifactsProduced: artifacts })));
    return submitWorkReport(t.root, runId, f, UI);
  };
  beforeEach(async () => {
    fastForward(t.root, runId, 'execution', { G1: { status: 'approved', decisions: 1 } });
    await startPhase(t.root, runId, 'execution', ORCH);
    await addTask(t.root, runId, { id: 'T-exec-1', title: 'ui', agent: UI }, ORCH);
    await claimTask(t.root, runId, 'T-exec-1', UI);
  });
  const stored = (rel: string) => JSON.parse(fs.readFileSync(path.join(runDir(t.root, runId), rel), 'utf8')) as Record<string, unknown>;

  it('an error in a listed spec is returned and stamped; the entry may carry a note; a warning is shown and not stamped', async () => {
    spec('tests/qa/specs/login/ui.spec.ts', `${FIXTURE}${POM}${SHOT}test('t', async ({ page }) => {\n  expect(true).toBe(true);\n  await page.waitForTimeout(5);\n});\n`);
    const res = await submit(['tests/qa/specs/login/ui.spec.ts (RUN)', 'tests/qa/pages/login/*.ts', 'sandbox/notes.md']);
    expect(res.lint!.errors.map((f) => f.rule)).toEqual(['spec-trivial-assertion']);
    expect(res.lint!.warnings.map((f) => f.rule)).toEqual(['spec-wait-for-timeout']);
    expect(Object.keys(res.lint!.errors[0]!).sort()).toEqual(['file', 'line', 'message', 'rule']);
    expect(stored(res.path)['lintErrors']).toEqual(['spec-trivial-assertion tests/qa/specs/login/ui.spec.ts:5']);
    await releaseTask(t.root, runId, 'T-exec-1', 'done', UI);
  });

  it('a report that lists no spec file is not linted, and a clean spec stamps nothing', async () => {
    const none = await submit(['sandbox/notes.md']);
    expect(none.lint).toBeUndefined();
    spec('tests/qa/api/a.api.spec.ts', "import { test, expect } from '@playwright/test';\ntest('t', async ({ request }) => {\n  expect((await request.get('/x')).status()).toBe(200);\n});\n");
    const clean = await submit(['tests/qa/api/a.api.spec.ts'], 'w2.json');
    expect(clean.lint).toMatchObject({ errors: [], warnings: [], filesScanned: 1 });
    expect('lintErrors' in stored(clean.path)).toBe(false);
  });

  it('a spec path outside the tests directory is never read', async () => {
    fs.writeFileSync(path.join(target, 'outside.spec.ts'), 'expect(true).toBe(true);\n');
    const res = await submit(['outside.spec.ts', 'tests/qa/../outside.spec.ts']);
    expect(res.lint).toBeUndefined();
  });
});
