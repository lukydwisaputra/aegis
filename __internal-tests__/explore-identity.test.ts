import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compareSignatures, decideProbe, identityDiffers, observe, redactError, selectPages, signatureOf, sourceIdentity, type RawPage } from '@qa/run-state';

const raw = (over: Partial<RawPage> = {}): RawPage => ({
  role: 'volunteer', url: '/home', finalPath: '/home', status: 200, title: 'Home', h1: 'Welcome', testids: ['nav', 'row-1', 'row-2'], consoleErrors: [], ...over,
});

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
  it('cuid and ULID-like ids are data, but slugs keep their words', () => {
    const hash = (id: string) => signatureOf(raw({ testids: [id] })).testidHash;
    expect(hash('row-clx9k3j2h0000')).toBe(hash('row-cm1a2b3c4d5e6'));
    expect(hash('item-01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(hash('item-01BX5ZZKBKACTAV9WEVGEMMVRZ'));
    expect(hash('user-profile-edit-2')).not.toBe(hash('user-settings-edit-2'));
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
  it('url wins over route; encoded route patterns are skipped; brackets in a query string are data', () => {
    expect(selectPages([{ role: 'a', url: 'https://app.test/real', route: '/other' }], 'https://app.test').pages).toEqual([{ role: 'a', url: '/real' }]);
    const r = selectPages([{ role: 'a', route: '/v/%5Bid%5D' }, { role: 'a', route: '/g/%7Bid%7D' }, { role: 'a', route: '/items?filter[status]=new' }], 'https://app.test');
    expect(r.skipped.map((s) => s.reason)).toEqual(['dynamic route pattern', 'dynamic route pattern']);
    expect(r.pages).toEqual([{ role: 'a', url: '/items?filter[status]=new' }]);
  });
  it('a global skip pattern is stateless across entries', () => {
    const r = selectPages([{ role: 'a', route: '/x/1' }, { role: 'b', route: '/x/2' }], 'https://app.test', [/x/g]);
    expect(r.pages).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['skip pattern', 'skip pattern']);
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
  it('covers other schemes, bearer credentials and localhost addresses', () => {
    expect(redactError('connect ws://h.test/s?k=1 failed')).toBe('connect <url> failed');
    expect(redactError('401 with Bearer abc.def-ghi')).not.toContain('abc.def-ghi');
    expect(redactError('Basic dXNlcjpwYXNz rejected')).not.toContain('dXNlcjpwYXNz');
    expect(redactError('refused localhost:3000/a?token=abc')).toBe('refused <url>');
  });
});

describe('sourceIdentity', () => {
  let dir: string;
  const cleanEnv = (): NodeJS.ProcessEnv => {
    const env = { ...process.env };
    delete env['GIT_DIR'];
    delete env['GIT_WORK_TREE'];
    delete env['GIT_INDEX_FILE'];
    return env;
  };
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@e.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { encoding: 'utf8', env: cleanEnv() });
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
    fs.writeFileSync(path.join(dir, '.env.example'), 'SECRET=placeholder'); // not ignored: part of the source
    expect(sourceIdentity(dir, [])).not.toEqual(beforeEnv);
  });

  it('a deleted tracked file and a removed untracked file change the hash', () => {
    const base = sourceIdentity(dir, []);
    fs.writeFileSync(path.join(dir, 'new.ts'), 'x');
    const added = sourceIdentity(dir, []);
    expect(added.dirtyHash).not.toBe(base.dirtyHash);
    fs.rmSync(path.join(dir, 'new.ts'));
    expect(sourceIdentity(dir, [])).toEqual(base);
    fs.rmSync(path.join(dir, 'app.ts'));
    const deleted = sourceIdentity(dir, []);
    expect(deleted.dirtyHash).not.toBe(base.dirtyHash);
    expect(deleted.dirtyHash).not.toBeNull();
  });

  it('a rename enters the hash with its old path: two renames to the same new file differ', () => {
    fs.writeFileSync(path.join(dir, 'b.ts'), 'one');
    git('add', '.');
    git('commit', '-qm', 'b');
    git('mv', 'app.ts', 'renamed.ts');
    const fromApp = sourceIdentity(dir, []);
    git('mv', 'renamed.ts', 'app.ts');
    git('mv', 'b.ts', 'renamed.ts');
    const fromB = sourceIdentity(dir, []);
    expect(fromB.dirtyHash).not.toBe(fromApp.dirtyHash); // both list renamed.ts with the same content: only the removed old path tells them apart
  });

  it('leaves out the excluded directories; a non-git directory gives null parts', () => {
    fs.mkdirSync(path.join(dir, 'aegis'));
    fs.mkdirSync(path.join(dir, 'tests', 'qa'), { recursive: true });
    const base = sourceIdentity(dir, ['aegis', 'tests/qa']);
    fs.writeFileSync(path.join(dir, 'aegis', 'run.json'), '{}');
    fs.writeFileSync(path.join(dir, 'tests', 'qa', 'pom.ts'), 'x');
    expect(sourceIdentity(dir, ['aegis', 'tests/qa'])).toEqual(base);
    expect(sourceIdentity(dir, ['./aegis/', 'tests/qa/'])).toEqual(base); // trailing slash and ./ are normalised
    expect(sourceIdentity(dir, [])).not.toEqual(base); // positive control: the writes are visible without the exclusion
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-plain-'));
    expect(sourceIdentity(plain, [])).toEqual({ head: null, dirtyHash: null });
    fs.rmSync(plain, { recursive: true, force: true });
  });

  it('an excluded directory is a whole path segment: excluding aegis keeps aegis2 in', () => {
    fs.mkdirSync(path.join(dir, 'aegis2'));
    const base = sourceIdentity(dir, ['aegis']);
    fs.writeFileSync(path.join(dir, 'aegis2', 'x'), 'x');
    expect(sourceIdentity(dir, ['aegis']).dirtyHash).not.toBe(base.dirtyHash);
  });

  it('entries with an empty or .. segment exclude nothing and do not throw', () => {
    const base = sourceIdentity(dir, []);
    expect(sourceIdentity(dir, ['', '..', '../x', '.'])).toEqual(base);
  });

  it('head ignores commits that touch only excluded directories, and moves with a commit of source', () => {
    fs.mkdirSync(path.join(dir, 'aegis'));
    const base = sourceIdentity(dir, ['aegis']);
    fs.writeFileSync(path.join(dir, 'aegis', 'run.json'), '{}');
    git('add', '.');
    git('commit', '-qm', 'qa only');
    expect(sourceIdentity(dir, ['aegis'])).toEqual(base);
    expect(sourceIdentity(dir, []).head).not.toBe(base.head); // positive control
    fs.writeFileSync(path.join(dir, 'other.ts'), 'y');
    git('add', '.');
    git('commit', '-qm', 'source');
    const after = sourceIdentity(dir, ['aegis']);
    expect(after.head).not.toBe(base.head);
    expect(after.head).toBe(git('rev-parse', 'HEAD').trim());
  });

  it('identityDiffers names every part when there is no earlier identity', () => {
    expect(identityDiffers(undefined, { head: 'a', dirtyHash: 'b' })).toEqual(['head', 'dirtyHash']);
  });
});
