import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'yaml';

jest.setTimeout(60_000);

const ROOT = path.join(__dirname, '..', '..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const SCRIPT = path.join(ROOT, 'scripts', 'check-baseline-growth.ts');
const BASELINE = '__internal-tests__/alignment/baseline.yaml';
const AGENT = '.claude/agents/tier1-phase/qa-a.md';
const K_DRIFT = 'DRIFT:qa-a:{run}/x.json:path-not-in-contract';
const K_KEEP = 'CONFIG:qa-a:aegis.config.json#x:missing';
const K_NEW = 'EVENT:qa-a:x.y:undeclared';

const baseline = (keys: string[]) =>
  keys.length === 0 ? 'baseline: 1\nentries: []\n' : `baseline: 1\nentries:\n${keys.map((k) => `  - key: "${k}"\n    ids: [AUD-001]\n`).join('')}`;

const agent = (prose: string, reads: string[]) =>
  [
    '---', 'name: qa-a', 'description: test agent', 'tools: [Read]', '---', '# qa-a', '', '## Process', '', prose, '',
    '## Contract (machine-checked)', '', '```yaml', 'contract: 1', 'phase: design', `reads: [${reads.map((r) => JSON.stringify(r)).join(', ')}]`, '```', '',
  ].join('\n');

const CLEAN_ENV: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'ALLOW_BASELINE_GROWTH' && k !== 'ALLOW_CONTRACT_ONLY_FIX'),
);

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-guard-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env: CLEAN_ENV, encoding: 'utf-8' });
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'guard@test.invalid');
  git('config', 'user.name', 'guard test');
  git('config', 'commit.gpgsign', 'false');
  const commit = (msg: string) => {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', msg);
  };
  const run = (env: Record<string, string> = {}, base = 'main') => {
    const r = spawnSync(TSX, [SCRIPT, '--base', base], { cwd: dir, env: { ...CLEAN_ENV, ...env }, encoding: 'utf-8' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { dir, git, write, commit, run, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** main: qa-a prose names {run}/x.json, the contract does not; the baseline owns that DRIFT key. */
function scenario() {
  const r = tmpRepo();
  r.write(AGENT, agent('1. Write `{run}/x.json`.', []));
  r.write(BASELINE, baseline([K_KEEP, K_DRIFT]));
  r.commit('base');
  r.git('checkout', '-q', '-b', 'feature');
  return r;
}

describe('baseline guard script (spawned in a temp git repo)', () => {
  it('a removed key whose subject changed only inside its contract block exits 1', () => {
    const r = scenario();
    r.write(AGENT, agent('1. Write `{run}/x.json`.', ['{run}/x.json']));
    r.write(BASELINE, baseline([K_KEEP]));
    r.commit('contract-only fix');
    const { status, out } = r.run();
    expect(status).toBe(1);
    expect(out).toContain('::error title=Baseline shrank without a prose change::');
    expect(out).toContain(`- ${K_DRIFT}  (subject qa-a: ${AGENT})`);
    r.cleanup();
  });

  it('the same removal passes with the contract-only-fix label', () => {
    const r = scenario();
    r.write(AGENT, agent('1. Write `{run}/x.json`.', ['{run}/x.json']));
    r.write(BASELINE, baseline([K_KEEP]));
    r.commit('contract-only fix');
    const { status, out } = r.run({ ALLOW_CONTRACT_ONLY_FIX: 'true' });
    expect(status).toBe(0);
    expect(out).toContain('::warning title=Baseline shrank without a prose change::');
    r.cleanup();
  });

  it('a removal alongside a prose change passes', () => {
    const r = scenario();
    r.write(AGENT, agent('1. Write `{run}/y.json`.', []));
    r.write(BASELINE, baseline([K_KEEP]));
    r.commit('prose fix');
    const { status, out } = r.run();
    expect(status).toBe(0);
    expect(out).toContain('every removed key is justified');
    r.cleanup();
  });

  it('a removal whose unit file was deleted passes', () => {
    const r = scenario();
    fs.rmSync(path.join(r.dir, AGENT));
    r.write(BASELINE, baseline([K_KEEP]));
    r.commit('roster change');
    expect(r.run().status).toBe(0);
    r.cleanup();
  });

  it('growth without the baseline-growth label exits 1; with it 0', () => {
    const r = scenario();
    r.write(BASELINE, baseline([K_KEEP, K_DRIFT, K_NEW]));
    r.commit('grow');
    const denied = r.run();
    expect(denied.status).toBe(1);
    expect(denied.out).toContain('::error title=Alignment baseline grew::');
    expect(r.run({ ALLOW_BASELINE_GROWTH: 'true' }).status).toBe(0);
    r.cleanup();
  });

  it('a PR that grows and shrinks needs both labels (Review Focus 4)', () => {
    const r = scenario();
    r.write(BASELINE, baseline([K_KEEP, K_NEW]));
    r.commit('swap a key');
    expect(r.run({ ALLOW_BASELINE_GROWTH: 'true' }).status).toBe(1);
    expect(r.run({ ALLOW_CONTRACT_ONLY_FIX: 'true' }).status).toBe(1);
    expect(r.run({ ALLOW_BASELINE_GROWTH: 'true', ALLOW_CONTRACT_ONLY_FIX: 'true' }).status).toBe(0);
    r.cleanup();
  });

  it('a missing or empty base ref exits 2 — a push event has no base (Review Focus 5)', () => {
    const r = scenario();
    for (const base of ['nope', 'origin/']) {
      const { status, out } = r.run({}, base);
      expect(status).toBe(2);
      expect(out).toContain('COULD NOT RUN');
    }
    r.cleanup();
  });
});

it('CI runs the guard only on pull_request events and passes both label flags (Review Focus 5)', () => {
  const wf = parse(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf-8'));
  const step = wf.jobs.build.steps.find((s: { run?: string }) => s.run?.includes('scripts/check-baseline-growth.ts'));
  expect(step.if).toBe("github.event_name == 'pull_request'");
  expect(step.env.ALLOW_BASELINE_GROWTH).toBe("${{ contains(github.event.pull_request.labels.*.name, 'baseline-growth') }}");
  expect(step.env.ALLOW_CONTRACT_ONLY_FIX).toBe("${{ contains(github.event.pull_request.labels.*.name, 'contract-only-fix') }}");
  expect(step.run).toContain('--base "origin/$BASE_REF"');
});
