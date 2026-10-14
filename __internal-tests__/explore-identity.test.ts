import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compareSignatures, decideProbe, identityDiffers, observe, redactError, selectPages, signatureOf, sourceIdentity, type PageSignature, type RawPage } from '@qa/run-state';

const raw = (over: Partial<RawPage> = {}): RawPage => ({
  role: 'volunteer', url: '/home', finalPath: '/home', status: 200, title: 'Home', h1: 'Welcome', testids: ['nav', 'row-1', 'row-2'], consoleErrors: [], ...over,
});
const sig = (over: Partial<RawPage> = {}): PageSignature => signatureOf(raw(over));

describe('signatureOf', () => {
  it('turns digits and spacing in text into #, and test ids into a hash of the distinct digit-free values', () => {
    const a = signatureOf(raw({ title: 'Home (3 new)', h1: ' Welcome  12 ', testids: ['nav', 'row-1', 'row-2', 'row-3'] }));
    expect(a).toMatchObject({ title: 'Home (# new)', h1: 'Welcome #', hasErrors: false });
    expect(a.testidHash).toBe(signatureOf(raw({ testids: ['row-9', 'nav'] })).testidHash); // same distinct values: nav, row-#
    expect(a.testidHash).not.toBe(signatureOf(raw({ testids: ['nav'] })).testidHash);
  });
  it('console errors count except resource-load noise (favicon, "Failed to load resource")', () => {
    expect(signatureOf(raw({ consoleErrors: ['Failed to load resource: 404 /favicon.ico'] })).hasErrors).toBe(false);
    expect(signatureOf(raw({ consoleErrors: ['TypeError: x is undefined'] })).hasErrors).toBe(true);
  });
  it('UUID and hash test ids are data: card-<uuid> rows are the same structure', () => {
    const a = signatureOf(raw({ testids: ['card-3f9a1c2e-0b1d-4e5f-8a9b-1c2d3e4f5a6b'] }));
    expect(a.testidHash).toBe(signatureOf(raw({ testids: ['card-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'card-11111111-2222-3333-4444-555555555555'] })).testidHash);
  });
});

describe('compareSignatures and decideProbe', () => {
  const four = [raw(), raw({ url: '/events', title: 'Events' }), raw({ role: 'admin', url: '/admin' }), raw({ url: '/profile', status: 500, consoleErrors: ['boom'], testids: [] })].map(signatureOf);

  it('same structure with different data (other row ids) is same: reuse', () => {
    const now = [raw({ testids: ['nav', 'row-7'] }), raw({ url: '/events', title: 'Events' }), raw({ role: 'admin', url: '/admin' }), raw({ url: '/profile', status: 500, consoleErrors: ['boom'], testids: [] })].map(observe);
    const diff = compareSignatures(four, now);
    expect(diff).toMatchObject({ same: 4, changed: [], failed: [], total: 4 });
    expect(decideProbe(diff)).toBe('reuse');
  });

  it('a page that errored before and renders now is changed (the Vault case): partial with 1 of 4', () => {
    const now = [raw(), raw({ url: '/events', title: 'Events' }), raw({ role: 'admin', url: '/admin' }), raw({ url: '/profile', status: 200, consoleErrors: [], testids: ['profile-form'] })].map(observe);
    const diff = compareSignatures(four, now);
    expect(diff.changed).toEqual([{ role: 'volunteer', url: '/profile', fields: ['status', 'testidHash', 'hasErrors'] }]);
    expect(decideProbe(diff)).toBe('partial');
  });

  it('a redirect to login and an unreachable page are never same; a missing observation is failed', () => {
    const now = [observe(raw({ finalPath: '/login' })), observe({ role: 'volunteer', url: '/events', error: 'timeout at https://x.test/events?token=abc' })];
    const diff = compareSignatures(four, now);
    expect(diff.changed).toEqual([{ role: 'volunteer', url: '/home', fields: ['finalPath'] }]);
    expect(diff.failed.map((f) => f.url)).toEqual(['/events', '/admin', '/profile']);
    expect(JSON.stringify(diff)).not.toContain('token=abc');
    expect(decideProbe(diff)).toBe('full');
  });

  it('partial up to 30% of the pages, full beyond, full for no pages and for every page failed', () => {
    const ten = Array.from({ length: 10 }, (_, i) => raw({ url: `/p${i}` }));
    const base = ten.map(signatureOf);
    const changed = (n: number) => compareSignatures(base, ten.map((p, i) => observe(i < n ? { ...p, title: 'Other' } : p)));
    expect(decideProbe(changed(3))).toBe('partial');
    expect(decideProbe(changed(4))).toBe('full');
    expect(decideProbe(compareSignatures([], []))).toBe('full');
    expect(decideProbe(compareSignatures(base, []))).toBe('full');
  });
});

describe('selectPages', () => {
  const entries = [
    { role: 'volunteer', url: 'https://app.test/home', route: '/home' },
    { role: 'admin', route: '/volunteers?status=new#top' },
    { role: 'admin', url: 'https://other.example/x', route: '/x' },
    { role: 'admin', route: '/volunteers/[id]' },
    { role: 'admin', route: '/groups/:id' },
    { role: 'admin', route: '/logout' },
    { role: 'admin', route: '/switch-profile' },
    { role: 'volunteer', route: '/home' },
    { role: 'volunteer' },
    null,
  ];
  it('keeps concrete same-origin pages once, strips origin and hash, and names what it skipped and why', () => {
    const r = selectPages(entries, 'https://app.test');
    expect(r.pages).toEqual([{ role: 'volunteer', url: '/home' }, { role: 'admin', url: '/volunteers?status=new' }]);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(['dynamic route pattern', 'dynamic route pattern', 'logout-like route', 'logout-like route', 'other origin']);
  });
  it('is empty for anything that is not an array; never throws on a stray % or a bad base; honours extra skip patterns', () => {
    expect(selectPages(undefined, 'https://app.test')).toEqual({ pages: [], skipped: [] });
    expect(selectPages([{ role: 'a', route: '/discount/100%' }], 'https://app.test').pages).toEqual([{ role: 'a', url: '/discount/100%' }]);
    expect(selectPages([{ role: 'a', route: '/x' }], '${PREVIEW_URL}').skipped).toEqual([{ role: 'a', route: '/x', reason: 'invalid page address' }]);
    expect(selectPages([{ role: 'a', route: '/unsubscribe?t=1' }], 'https://app.test', [/unsubscribe/]).skipped[0]?.reason).toBe('skip pattern');
  });
});

describe('redactError', () => {
  it('replaces URLs and cuts to 120 characters', () => {
    expect(redactError('failed https://a.test/x?token=1 now')).toBe('failed <url> now');
    expect(redactError('x'.repeat(300))).toHaveLength(120);
  });
});

describe('sourceIdentity', () => {
  let dir: string;
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@e.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { encoding: 'utf8' });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-id-'));
    git('init', '-q');
    fs.writeFileSync(path.join(dir, 'app.ts'), 'one');
    git('add', '.');
    git('commit', '-qm', 'init');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('is stable; changes with an edit, a new untracked file, a deletion and a rename; ignores gitignored files and never reads .env', () => {
    const base = sourceIdentity(dir, []);
    expect(sourceIdentity(dir, [])).toEqual(base);
    expect(base.head).toMatch(/^[0-9a-f]{40}$/);
    fs.writeFileSync(path.join(dir, 'app.ts'), 'two');
    const edited = sourceIdentity(dir, []);
    expect(identityDiffers(base, edited)).toEqual(['dirtyHash']);
    fs.writeFileSync(path.join(dir, 'new.ts'), 'x');
    const added = sourceIdentity(dir, []);
    expect(added.dirtyHash).not.toBe(edited.dirtyHash);
    git('mv', 'app.ts', 'renamed.ts');
    expect(sourceIdentity(dir, []).dirtyHash).not.toBe(added.dirtyHash);
    fs.writeFileSync(path.join(dir, '.gitignore'), '.env.local\n');
    git('add', '.gitignore');
    const beforeEnv = sourceIdentity(dir, []);
    fs.writeFileSync(path.join(dir, '.env.local'), 'SECRET=zq-not-hex-secret');
    expect(sourceIdentity(dir, [])).toEqual(beforeEnv);
    expect(JSON.stringify(sourceIdentity(dir, []))).not.toContain('zq-not-hex-secret');
  });

  it('leaves out the excluded directories; a non-git directory gives null parts', () => {
    fs.mkdirSync(path.join(dir, 'aegis'));
    fs.mkdirSync(path.join(dir, 'tests', 'qa'), { recursive: true });
    const base = sourceIdentity(dir, ['aegis', 'tests/qa']);
    fs.writeFileSync(path.join(dir, 'aegis', 'run.json'), '{}');
    fs.writeFileSync(path.join(dir, 'tests', 'qa', 'pom.ts'), 'x');
    expect(sourceIdentity(dir, ['aegis', 'tests/qa'])).toEqual(base);
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-plain-'));
    expect(sourceIdentity(plain, [])).toEqual({ head: null, dirtyHash: null });
    fs.rmSync(plain, { recursive: true, force: true });
  });

  it('identityDiffers names every part when there is no earlier identity', () => {
    expect(identityDiffers(undefined, { head: 'a', dirtyHash: 'b' })).toEqual(['head', 'dirtyHash']);
  });
});
