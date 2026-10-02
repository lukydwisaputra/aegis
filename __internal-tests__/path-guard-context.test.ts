import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appendLedger, ledgerPath, loadGuardContext, readEnvPolicy, readLedger } from '@qa/path-guard';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-ctx-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const RUN = 'RUN-20261002-001';
const config = (c: object) => fs.writeFileSync(path.join(root, 'aegis.config.json'), JSON.stringify(c));
function run(state: object) {
  fs.mkdirSync(path.join(root, 'runs', RUN), { recursive: true });
  fs.writeFileSync(path.join(root, 'runs', RUN, 'run.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(root, 'runs', '.active'), `${RUN}\n`);
}

it('resolves target, tests dir, active run, environment and phase', () => {
  config({ targetProjectRoot: '..', testsDir: '../tests/qa', environments: { staging: { mutating: true } } });
  run({ runId: RUN, environment: 'staging', currentPhase: 'execution' });
  expect(loadGuardContext(root)).toMatchObject({
    aegisRoot: root, targetRoot: path.dirname(root), testsDir: path.join(path.dirname(root), 'tests', 'qa'),
    activeRunId: RUN, runDir: path.join(root, 'runs', RUN), environment: 'staging', currentPhase: 'execution', envPolicy: { mutating: true },
  });
  expect(readEnvPolicy(root, 'staging')).toEqual({ mutating: true });
});

it('tolerates a missing config, a missing pointer and an unreadable run.json', () => {
  expect(loadGuardContext(root)).toMatchObject({ targetRoot: path.dirname(root), activeRunId: null, runDir: null, environment: null, currentPhase: null, envPolicy: undefined });
  run({});
  fs.writeFileSync(path.join(root, 'runs', RUN, 'run.json'), '{not json');
  expect(loadGuardContext(root)).toMatchObject({ activeRunId: RUN, environment: null, currentPhase: null });
  fs.writeFileSync(path.join(root, 'runs', '.active'), 'garbage');
  expect(loadGuardContext(root).activeRunId).toBeNull();
  expect(readEnvPolicy(root, 'staging')).toBeUndefined();
});

describe('carry (c): a testsDir that would widen the {testsDir} globs is rejected', () => {
  it.each([
    ['the target root', '..'],
    ['the target root, spelled with ..', '../tests/..'],
    ['the aegis root', '.'],
    ['inside the aegis root', 'tests/qa'],
    ['outside the target', '../../elsewhere/tests'],
    ['an absolute path outside the target', '/etc/qa'],
  ])('%s', (_label, testsDir) => {
    config({ targetProjectRoot: '..', testsDir });
    expect(() => loadGuardContext(root)).toThrow(/testsDir/);
  });

  it('accepts a testsDir strictly inside the target and outside the aegis root', () => {
    config({ targetProjectRoot: '..', testsDir: '../e2e/qa' });
    expect(loadGuardContext(root).testsDir).toBe(path.join(path.dirname(root), 'e2e', 'qa'));
  });
});

describe('carry (d): the config fails closed', () => {
  it('readEnvPolicy is undefined only when the file is missing, and throws on a corrupt or unreadable one', () => {
    expect(readEnvPolicy(root, 'production')).toBeUndefined();
    fs.writeFileSync(path.join(root, 'aegis.config.json'), '{ not json');
    expect(() => readEnvPolicy(root, 'production')).toThrow(/aegis\.config\.json/);
    fs.rmSync(path.join(root, 'aegis.config.json'));
    fs.mkdirSync(path.join(root, 'aegis.config.json'));
    expect(() => readEnvPolicy(root, 'production')).toThrow(/aegis\.config\.json/);
  });

  it('loadGuardContext throws on a corrupt config instead of dropping the environment policy', () => {
    fs.writeFileSync(path.join(root, 'aegis.config.json'), '[1, 2');
    expect(() => loadGuardContext(root)).toThrow(/aegis\.config\.json/);
  });
});

it('appends and reads ledger entries per agent instance', () => {
  appendLedger(root, RUN, { ts: '2026-10-02T00:00:00.000Z', agentId: 'a1', agentType: 'qa-ui-specialist', kind: 'claim', taskId: 'T-1' });
  appendLedger(root, RUN, { ts: '2026-10-02T00:00:01.000Z', agentId: 'a2', agentType: 'qa-ui-specialist', kind: 'start' });
  fs.appendFileSync(ledgerPath(root, RUN), 'torn{\n');
  expect(readLedger(root, RUN, 'a1')).toEqual([{ ts: '2026-10-02T00:00:00.000Z', agentId: 'a1', agentType: 'qa-ui-specialist', kind: 'claim', taskId: 'T-1' }]);
  expect(readLedger(root, RUN, 'nobody')).toEqual([]);
  expect(ledgerPath(root, RUN)).toBe(path.join(root, 'runs', RUN, 'hooks', 'agents.jsonl'));
});

it('refuses a ledger path for a run id that is not one', () => {
  expect(() => ledgerPath(root, '../escape')).toThrow(/run id/);
});
