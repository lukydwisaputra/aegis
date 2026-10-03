import * as fs from 'fs';
import * as path from 'path';

const REPO = path.join(__dirname, '..');
const agent = fs.readFileSync(path.join(REPO, '.claude', 'agents', 'tier1-phase', 'qa-dev-test-reviewer.md'), 'utf-8');
const spv = fs.readFileSync(path.join(REPO, '.claude', 'agents', 'spv', 'qa-dev-test-reviewer-spv.md'), 'utf-8');

const SECRET_EXCLUDES = [
  '.npmrc', '.yarnrc.yml', '.netrc', '.pgpass', "'*.pem'", "'*.key'", "'*.p12'", "'*.pfx'", "'*.jks'", "'*.keystore'",
  "'id_rsa*'", "'id_ecdsa*'", "'id_ed25519*'", "'*service-account*.json'", "'*credentials*.json'", "'*.tfstate'", "'*.tfstate.*'",
];

const rsync = /`(rsync -a [^`]+)`/.exec(agent)?.[1] ?? '';

it('the sandbox copy excludes registry tokens, key material and cloud credentials', () => {
  for (const x of SECRET_EXCLUDES) expect(rsync).toContain(`--exclude ${x}`);
});

it('dependencies are included before the secret excludes, so bundled certificates survive', () => {
  const include = rsync.indexOf("--include 'node_modules/**'");
  expect(include).toBeGreaterThan(rsync.indexOf('--exclude node_modules/.vite'));
  expect(include).toBeLessThan(rsync.indexOf("--exclude '*.pem'"));
});

it('the copy gets a token-stripped .npmrc, and the SPV checks both', () => {
  expect(agent).toMatch(/grep -vE '\(_authToken\|_auth\|_password\|username\|email\|certfile\|keyfile\)\[\[:space:\]\]\*=' <target>\/\.npmrc/);
  expect(spv).toMatch(/--exclude '\*\.pem'/);
  expect(spv).toMatch(/no `_authToken`/);
});

// Behavioural fixtures: run the documented commands on a temp tree (argv only, no shell).
import { execFileSync } from 'child_process';
import * as os from 'os';

const FAKE_TOKEN = 'FAKE-TOKEN-do-not-use-0000';

function rsyncArgs(src: string, dst: string): string[] {
  const parts = rsync.split(' ').slice(2); // drop "rsync -a"
  const args: string[] = ['-a'];
  const joined = parts.join(' ');
  const re = /--(include|exclude) ('[^']*'|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(joined))) {
    const v = (m[2] ?? '').replace(/^'|'$/g, '');
    if (v.startsWith('/<')) continue; // repo / tests dir placeholders
    args.push(`--${m[1]}`, v);
  }
  return [...args, src + '/', dst + '/'];
}

describe('rsync fixture', () => {
  let tmp: string;
  let dst: string;
  const put = (rel: string, body = 'x') => {
    const p = path.join(tmp, 'src', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dtsp-'));
    dst = path.join(tmp, 'dst');
    fs.mkdirSync(dst);
    for (const f of ['.npmrc', '.yarnrc.yml', '.netrc', '.pgpass', 'deploy.pem', 'a/server.key', 'c.p12', 'c.pfx', 'k.jks', 'k.keystore',
      'id_rsa', 'id_rsa.pub', 'id_ecdsa', 'id_ed25519', 'my-service-account-1.json', 'aws-credentials.json', 'main.tfstate', 'main.tfstate.backup',
      '.env', '.env.local', 'sub/.env.production', '.envrc', '.dev.vars']) put(f);
    for (const f of ['.env.example', 'src/app.ts', 'package.json', 'node_modules/pkg/index.js', 'node_modules/pkg/ca-bundle.pem', 'node_modules/pkg/.npmrc']) put(f);
    put('node_modules/.cache/junk');
    execFileSync('rsync', rsyncArgs(path.join(tmp, 'src'), dst));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('drops every secret-pattern file', () => {
    for (const f of ['.npmrc', '.yarnrc.yml', '.netrc', '.pgpass', 'deploy.pem', 'a/server.key', 'c.p12', 'c.pfx', 'k.jks', 'k.keystore',
      'id_rsa', 'id_rsa.pub', 'id_ecdsa', 'id_ed25519', 'my-service-account-1.json', 'aws-credentials.json', 'main.tfstate', 'main.tfstate.backup',
      '.env', '.env.local', 'sub/.env.production', '.envrc', '.dev.vars']) {
      expect(fs.existsSync(path.join(dst, f))).toBe(false);
    }
  });

  it('keeps source, .env.example and dependencies (bundled certificates included), not caches', () => {
    for (const f of ['.env.example', 'src/app.ts', 'package.json', 'node_modules/pkg/index.js', 'node_modules/pkg/ca-bundle.pem']) {
      expect(fs.existsSync(path.join(dst, f))).toBe(true);
    }
    expect(fs.existsSync(path.join(dst, 'node_modules/.cache'))).toBe(false);
  });
});

describe('token-stripped .npmrc', () => {
  it('keeps registry and scope lines, never an auth, password, email or cert line', () => {
    const cmd = /`(grep -vE '[^`]+)`/.exec(agent)?.[1] ?? '';
    const pattern = /grep -vE '([^']+)'/.exec(cmd)?.[1] ?? '';
    expect(pattern).not.toBe('');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dtsp-npmrc-'));
    try {
      const src = path.join(tmp, '.npmrc');
      fs.writeFileSync(src, [
        'registry=https://registry.example.test/',
        '@acme:registry=https://npm.acme.example.test/',
        `//registry.example.test/:_authToken=${FAKE_TOKEN}`,
        `//npm.acme.example.test/:_auth=${FAKE_TOKEN}`,
        `//registry.example.test/:_password=${FAKE_TOKEN}`,
        '//registry.example.test/:username=someone',
        'email=someone@example.test',
        `_authToken = ${FAKE_TOKEN}`,
        'certfile=/etc/x.pem',
        'keyfile=/etc/x.key',
        '',
      ].join('\n'));
      let out = '';
      try {
        out = execFileSync('grep', ['-vE', pattern, src], { encoding: 'utf-8' });
      } catch (e: any) {
        out = e.stdout?.toString() ?? '';
      }
      expect(out).toContain('registry=https://registry.example.test/');
      expect(out).toContain('@acme:registry=https://npm.acme.example.test/');
      expect(out).not.toContain(FAKE_TOKEN);
      expect(out).not.toMatch(/_authToken|_auth\b|_password|email|username|certfile|keyfile/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
