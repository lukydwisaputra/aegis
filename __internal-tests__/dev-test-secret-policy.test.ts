import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.join(__dirname, '..');
const agent = fs.readFileSync(path.join(REPO, '.claude', 'agents', 'tier1-phase', 'qa-dev-test-reviewer.md'), 'utf-8');
const spv = fs.readFileSync(path.join(REPO, '.claude', 'agents', 'spv', 'qa-dev-test-reviewer-spv.md'), 'utf-8');

const SECRET_EXCLUDES = [
  '.npmrc', '.yarnrc.yml', '.netrc', '.pgpass', "'*.pem'", "'*.key'", "'*.p12'", "'*.pfx'", "'*.jks'", "'*.keystore'",
  "'id_rsa*'", "'id_ecdsa*'", "'id_ed25519*'", "'*service-account*.json'", "'*[Cc]redentials*.[jJ][sS][oO][nN]'", "'*.tfstate'", "'*.tfstate.*'",
  "'.dev.vars.*'", "'*firebase-adminsdk*.json'", 'serviceAccountKey.json', '.pypirc', '.git-credentials', '.docker/config.json', '.htpasswd',
  "'*.p8'", "'*.tfvars'",
];

const DEP_EXCLUDES = [
  "'node_modules/**/.npmrc'", "'node_modules/**/.env'", "'node_modules/**/.env.*'", 'node_modules/.npmrc',
  // A18: a dotenv file directly in a node_modules root
  'node_modules/.env', "'node_modules/.env.*'",
  "'**/node_modules/**/.npmrc'", "'**/node_modules/**/.env'", "'**/node_modules/**/.env.*'", "'**/node_modules/.npmrc'",
  "'**/node_modules/.env'", "'**/node_modules/.env.*'",
];

const rsync = /`(rsync -a [^`]+)`/.exec(agent)?.[1] ?? '';

it('the sandbox copy excludes registry tokens, key material and cloud credentials', () => {
  for (const x of SECRET_EXCLUDES) expect(rsync).toContain(`--exclude ${x}`);
});

it('dependencies are included before the secret excludes, so bundled certificates survive', () => {
  const include = rsync.indexOf("--include 'node_modules/**'");
  expect(include).toBeGreaterThan(rsync.indexOf('--exclude node_modules/.vite'));
  expect(include).toBeLessThan(rsync.indexOf("--exclude '*.pem'"));
  expect(rsync.indexOf("--include '**/node_modules/**'")).toBeGreaterThan(include);
  expect(rsync.indexOf("--include '**/node_modules/**'")).toBeLessThan(rsync.indexOf("--exclude '*.pem'"));
});

it('dependency dotenv and .npmrc files are excluded before the dependencies are included', () => {
  const include = rsync.indexOf("--include 'node_modules/**'");
  for (const x of DEP_EXCLUDES) {
    const at = rsync.indexOf(`--exclude ${x}`);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(include);
  }
});

const NPMRC_CMD = /`(grep -E '[^']+' <target>\/\.npmrc \| grep -vE '[^']+' > [^`]+)`/.exec(agent)?.[1] ?? '';
const NPMRC_PATTERNS = /grep -E '([^']+)' <target>\/\.npmrc \| grep -vE '([^']+)'/.exec(NPMRC_CMD) ?? [];
const KEEP = NPMRC_PATTERNS[1] ?? '';
const DROP = NPMRC_PATTERNS[2] ?? '';

it('the copy gets an allowlisted .npmrc, and the SPV checks the copy and the excludes', () => {
  expect(NPMRC_CMD).toContain("grep -E '^[[:space:]]*(@[^:=[:space:]]+:)?registry[[:space:]]*=' <target>/.npmrc | grep -vE '://[^/[:space:]]*@' > sandbox/{date}-dev-test-review/target/.npmrc");
  expect(agent).toMatch(/an empty result is fine; a grep exit status of 1 is not a failure/);
  expect(agent).toMatch(/root `node_modules`/);
  expect(spv).toMatch(/--exclude '\*\.pem'/);
  expect(spv).toMatch(/--exclude 'node_modules\/\*\*\/\.npmrc'/);
  expect(spv).toMatch(/only `registry=` and `@scope:registry=` lines/);
  // A18: the check is about userinfo in a URL, not any `@` (a scope name or a path may hold one).
  expect(spv).toMatch(/no URL in it carries `user@` or `user:pass@` userinfo/);
  expect(spv).not.toMatch(/no URL in it contains `@`/);
  // Check 6 lists the same dependency excludes as the agent's command (lockstep).
  for (const x of DEP_EXCLUDES) expect(spv).toContain(`--exclude ${x}`);
});

// Behavioural fixtures: run the documented commands on a temp tree (argv only, no shell).
const FAKE_TOKEN = 'FAKE-TOKEN-do-not-use-0000';

function rsyncArgs(src: string, dst: string): string[] {
  const joined = rsync.split(' ').slice(2).join(' ');
  const args: string[] = ['-a'];
  const re = /--(include|exclude) ('[^']*'|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(joined))) {
    const v = (m[2] ?? '').replace(/^'|'$/g, '');
    if (v.startsWith('/<')) continue; // repo / tests dir placeholders
    args.push(`--${m[1]}`, v);
  }
  return [...args, src + '/', dst + '/'];
}

const DROPPED = [
  '.npmrc', '.yarnrc.yml', '.netrc', '.pgpass', 'deploy.pem', 'a/server.key', 'c.p12', 'c.pfx', 'k.jks', 'k.keystore',
  'id_rsa', 'id_rsa.pub', 'id_ecdsa', 'id_ed25519', 'my-service-account-1.json', 'aws-credentials.json', 'Credentials.JSON', 'gcp-Credentials.json',
  'main.tfstate', 'main.tfstate.backup', '.env', '.env.local', 'sub/.env.production', '.envrc', '.dev.vars', '.dev.vars.production',
  'proj-firebase-adminsdk-abc12.json', 'sub/serviceAccountKey.json', '.pypirc', '.git-credentials', 'home/.docker/config.json', '.htpasswd',
  'AuthKey_ABC123.p8', 'prod.tfvars', 'infra/dev.tfvars',
  'node_modules/.npmrc', 'node_modules/dep/.npmrc', 'node_modules/dep/.env', 'node_modules/dep/.env.local', 'node_modules/@s/dep/.npmrc',
  'pkgs/a/node_modules/.npmrc', 'pkgs/a/node_modules/dep/.npmrc', 'pkgs/a/node_modules/dep/.env', 'pkgs/a/node_modules/dep/.env.local',
  // A18: dotenv files directly in the root and a nested node_modules
  'node_modules/.env', 'node_modules/.env.local', 'pkgs/a/node_modules/.env', 'pkgs/a/node_modules/.env.production',
];
const KEPT = [
  '.env.example', 'src/app.ts', 'package.json', 'config.json', '.docker/other.json', 'node_modules/pkg/index.js', 'node_modules/pkg/ca-bundle.pem',
  'node_modules/pkg/test.key', 'pkgs/a/node_modules/dep/ca.pem', 'pkgs/a/node_modules/dep/index.js',
];

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
    for (const f of [...DROPPED, ...KEPT, 'node_modules/.cache/junk']) put(f);
    execFileSync('rsync', rsyncArgs(path.join(tmp, 'src'), dst));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('drops every secret-pattern file, including nested node_modules dotenv and .npmrc', () => {
    for (const f of DROPPED) expect([f, fs.existsSync(path.join(dst, f))]).toEqual([f, false]);
  });

  it('keeps source, .env.example and dependencies (bundled certificates and keys included), not caches', () => {
    for (const f of KEPT) expect([f, fs.existsSync(path.join(dst, f))]).toEqual([f, true]);
    expect(fs.existsSync(path.join(dst, 'node_modules/.cache'))).toBe(false);
  });
});

describe('allowlisted .npmrc', () => {
  const run = (pattern: string, flag: string, input: string): string => {
    try {
      return execFileSync('grep', [flag, pattern], { encoding: 'utf-8', input });
    } catch (e: any) {
      if (e.status === 1) return ''; // no match is not a failure
      throw e;
    }
  };
  const pipeline = (input: string) => run(DROP, '-vE', run(KEEP, '-E', input));

  it('keeps plain registry and scope-registry lines', () => {
    const out = pipeline([
      'registry=https://registry.example.test/',
      '@acme:registry=https://npm.acme.example.test/',
      '  registry = https://spaced.example.test/',
      'registry=https://host.example.test/@scoped/path/',
      '',
    ].join('\n'));
    expect(out).toContain('registry=https://registry.example.test/');
    expect(out).toContain('@acme:registry=https://npm.acme.example.test/');
    expect(out).toContain('registry = https://spaced.example.test/');
    expect(out).toContain('https://host.example.test/@scoped/path/');
  });

  it('drops every credential-bearing or unrelated line', () => {
    const out = pipeline([
      'registry=https://registry.example.test/',
      `registry=https://u:${FAKE_TOKEN}@host.example.test/`,
      `@acme:registry=https://u:p-${FAKE_TOKEN}@host.example.test/`,
      `//registry.example.test/:_authToken=${FAKE_TOKEN}`,
      `//registry.example.test/:_AUTHTOKEN=${FAKE_TOKEN}`,
      `_authToken = ${FAKE_TOKEN}`,
      `//npm.acme.example.test/:_auth=${FAKE_TOKEN}`,
      `//registry.example.test/:_password=${FAKE_TOKEN}`,
      '//registry.example.test/:username=someone',
      'email=someone@example.test',
      `proxy=http://u:${FAKE_TOKEN}@proxy.example.test`,
      `https-proxy=http://u:${FAKE_TOKEN}@proxy.example.test`,
      `key="-----BEGIN PRIVATE KEY-----${FAKE_TOKEN}-----END PRIVATE KEY-----"`,
      `cert="-----BEGIN CERTIFICATE-----${FAKE_TOKEN}-----END CERTIFICATE-----"`,
      'certfile=/etc/x.pem',
      'keyfile=/etc/x.key',
      '',
    ].join('\n'));
    expect(out).toBe('registry=https://registry.example.test/\n');
    expect(out).not.toContain(FAKE_TOKEN);
  });

  it('an .npmrc with no registry line yields an empty result without failing', () => {
    expect(pipeline(`_authToken=${FAKE_TOKEN}\n`)).toBe('');
  });
});
