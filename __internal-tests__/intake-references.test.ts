import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { copyIntakeReferences, createRun, readRunConfig, runDir } from '@qa/run-state';
import { makeAegisRoot, type TmpAegis } from './helpers/aegis-root';

// Pinned reference repositories in intake (intake.references).

let t: TmpAegis;
let ref: string;
let sha: string;
const git = (...args: string[]) => execFileSync('git', ['-C', ref, ...args], { encoding: 'utf-8' }).trim();
beforeEach(() => {
  t = makeAegisRoot();
  ref = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-ref-'));
  for (const f of ['baseline/booking/rules.md', 'clients/slec/notes.md', 'clients/other/notes.md', '_sources/big.sql']) {
    fs.mkdirSync(path.dirname(path.join(ref, f)), { recursive: true });
    fs.writeFileSync(path.join(ref, f), f);
  }
  git('init', '-q');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init');
  sha = git('rev-parse', 'HEAD');
});
afterEach(() => {
  t.cleanup();
  fs.rmSync(ref, { recursive: true, force: true });
});
const setConfig = (extra: object) => {
  const cfg = path.join(t.root, 'aegis.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), ...extra }));
};

describe('intake.references copies pinned repositories into intake/references/{name}/', () => {
  it('copies the globbed files, writes provenance and is part of run create', async () => {
    setConfig({ intake: { sources: [], references: [{ name: 'vms-wiki', root: ref, sha, sources: ['baseline/**', 'clients/slec/**'] }] } });
    const intake = path.join(runDir(t.root, (await createRun(t.root, { environment: 'development', modules: ['AUTH'], cycleType: 'full' }, 'owner')).runId), 'intake');
    const base = path.join(intake, 'references', 'vms-wiki');
    expect(fs.readFileSync(path.join(base, 'baseline/booking/rules.md'), 'utf8')).toBe('baseline/booking/rules.md');
    expect(fs.existsSync(path.join(base, 'clients/other/notes.md'))).toBe(false);
    expect(fs.existsSync(path.join(base, '_sources/big.sql'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(intake, 'references', 'vms-wiki.provenance.json'), 'utf8'))).toMatchObject({
      name: 'vms-wiki', sha, pinned: sha, files: ['baseline/booking/rules.md', 'clients/slec/notes.md'],
    });
  });

  it('refuses a checkout that is not at the pinned sha, before copying anything', () => {
    const dir = path.join(t.root, 'intake-x');
    const wrong = 'f'.repeat(40);
    expect(() => copyIntakeReferences(t.root, [{ name: 'a', root: ref, sources: ['**'] }, { name: 'b', root: ref, sha: wrong, sources: ['**'] }], dir))
      .toThrow(`intake reference b: ${ref} is at ${sha}, pinned ${wrong}`);
    expect(fs.existsSync(path.join(dir, 'references'))).toBe(false);
  });

  it('validates the config entries', () => {
    const bad = (references: unknown, msg: string) => {
      setConfig({ intake: { references } });
      expect(() => readRunConfig(t.root)).toThrow(msg);
    };
    bad({}, 'intake.references must be a list');
    bad([{ name: 'Bad Name', root: ref, sources: ['**'] }], 'name must be lowercase letters, digits and hyphens');
    bad([{ name: 'a', root: ref, sources: ['**'] }, { name: 'a', root: ref, sources: ['**'] }], 'is listed twice');
    bad([{ name: 'a', root: ref, sha: 'abc', sources: ['**'] }], 'must be a full 40-character commit sha');
    bad([{ name: 'a', root: ref, sources: [] }], 'must list at least one glob');
    expect(() => copyIntakeReferences(t.root, [{ name: 'a', root: ref, sources: ['../x'] }], path.join(t.root, 'i'))).toThrow('without ".."');
  });
});
