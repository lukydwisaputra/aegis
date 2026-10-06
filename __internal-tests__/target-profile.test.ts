import * as fs from 'fs'; import * as path from 'path';
import { MESSAGING_PROVIDERS, ScanWarningEventSchema, TargetProfileCoreSchema, TargetProfileSchema } from '@qa/contracts';
import { PROFILE, TS } from './helpers/pipeline';
const md = fs.readFileSync(path.join(__dirname, '..', '.claude', 'agents', 'crosscutting', 'qa-context-scanner.md'), 'utf-8');
const example = JSON.parse(/```jsonc\n([\s\S]*?)\n```/.exec(md)![1]!);
const CHECKLIST = /## Scanning Checklist\n([\s\S]*?)\n## Outputs/.exec(md)![1]!;
describe('TargetProfileSchema (AUD-031)', () => {
  it('parses the scanner prose example (the file agents write)', () =>
    expect(TargetProfileSchema.safeParse(example).error?.issues ?? []).toEqual([]));
  it('accepts bun; rejects undeclared fields and a missing targetIsSingleProject', () => {
    const { targetIsSingleProject: _t, ...rest } = example;
    expect(TargetProfileSchema.safeParse({ ...example, packageManager: 'bun' }).success).toBe(true);
    expect(TargetProfileSchema.safeParse({ ...example, tsxFileCount: 3 }).success).toBe(false);
    expect(TargetProfileSchema.safeParse(rest).success).toBe(false);
  });
  it('the pipeline-test PROFILE fixture is a valid full profile', () =>
    expect(TargetProfileSchema.safeParse(PROFILE).error?.issues ?? []).toEqual([]));
  it('the checklist prose names only schema paths and enum values (AUD-052)', () => {
    const shape = TargetProfileSchema.shape;
    // flat names the schema has no field for must not appear
    for (const flat of ['monorepoTool', 'ciProvider']) expect(md).not.toContain(`\`${flat}\``);
    expect(md).toContain('`monorepo.tool`');
    expect(md).toContain('`ci.provider`');
    // every ci.provider enum value is spelled out in the prose
    for (const v of shape.ci.shape.provider.options) expect(md).toContain(`\`${v}\``);
    expect(md).toMatch(/`platform` is `"generic"`/);
    expect(md).toMatch(/`true` \(App Router[^)]*\), `false` \(Pages Router[^)]*\) or `null`/);
    expect(md).toMatch(/ISO-8601 UTC timestamp ending in `Z`/);
    expect(md).not.toMatch(/Count test files by type/);
    // every dotted `a.b` path the checklist records resolves in the schema
    const roots = Object.keys(shape);
    for (const m of md.matchAll(/`((?:monorepo|ci|framework|language|existingTests|supabase)\.[a-zA-Z]+)(?:\[\])?`/g)) {
      const [root, key] = m[1]!.split('.');
      expect(roots).toContain(root);
      const obj = (shape as any)[root!];
      expect(Object.keys((obj.unwrap?.() ?? obj).shape)).toContain(key);
    }
  });
  it('the checklist names every field by its schema path (final wave, parked T6 + final-review Minor 2)', () => {
    const shape = TargetProfileSchema.shape;
    const checklist = /## Scanning Checklist\n([\s\S]*?)\n## Outputs/.exec(md)![1]!;
    // nested fields carry their object's prefix; a bare nested name is a field the strict schema refuses
    const nested = { supabase: shape.supabase.unwrap().shape, language: shape.language.shape };
    for (const [root, fields] of Object.entries(nested)) {
      for (const key of Object.keys(fields)) {
        expect(checklist).toContain(`\`${root}.${key}\``);
        expect(md).not.toMatch(new RegExp('`' + key + '`'));
      }
    }
    expect(checklist).toMatch(/`framework\.version` \(null when not found\)/);
    expect(checklist).toMatch(/Record `roles\[\]` \(empty when no roles are found or the target is not Supabase\)/);
    // every top-level field except the scan timestamp (Outputs) is named in the checklist
    for (const key of Object.keys(shape).filter((k) => k !== 'scannedAt')) expect(checklist).toMatch(new RegExp('`' + key + '[`.:\\[]'));
    for (const key of ['authProvider', 'nodeVersion']) expect(checklist).toMatch(new RegExp('`' + key + '` \\(null when absent\\)'));
    expect(checklist).toMatch(/`monorepo\.tool` is `"none"`/);
    expect(checklist).toMatch(/no lockfile[^\n]*`"npm"`[^\n]*`scan\.warning`/);
    const appsLine = checklist.split('\n').find((l) => l.includes('**Apps list.**'))!;
    for (const v of shape.apps.element.shape.language.options) expect(appsLine).toContain(`\`${v}\``);
    expect(md).toMatch(/every field is required except `supabase` \(omitted when `platform` is `"generic"`\), `featureFlagProvider` and `framework\.appRouter`/);
  });
  it('a generic target with nothing optional detected is a valid profile', () => {
    const { supabase: _s, ...rest } = example;
    const generic = {
      ...rest, platform: 'generic', roles: [], authProvider: null, nodeVersion: null,
      framework: { name: 'vite-react', version: null }, monorepo: { tool: 'none', workspaces: [] },
    };
    expect(TargetProfileSchema.safeParse(generic).error?.issues ?? []).toEqual([]);
  });
  it('every required field is in the pipeline PROFILE fixture and the prose example (a new field updates both)', () => {
    const required = Object.entries(TargetProfileSchema.shape).filter(([, s]) => !s.isOptional()).map(([k]) => k);
    expect(required).toEqual(expect.arrayContaining(['hasPersonalData', 'personalDataSignals', 'hasMessagingIntegration']));
    for (const key of required) {
      expect(PROFILE).toHaveProperty(key);
      expect(example).toHaveProperty(key);
    }
  });
  it('the checklist records the P2b fields by their schema paths, with their detection rules (AUD-051, AUD-055)', () => {
    expect(CHECKLIST).toMatch(/Record `hasPersonalData` \(`true` or `false`\) and `personalDataSignals\[\]`/);
    expect(CHECKLIST).toMatch(/`hasAuth` is `true`, because accounts hold at least an email or a username \(signal `"hasAuth"`\)/);
    for (const f of ['email', 'phone', 'nric', 'date_of_birth', 'ip_address']) expect(CHECKLIST).toContain('`' + f + '`');
    expect(CHECKLIST).toMatch(/When in doubt, record `true`/);
    expect(CHECKLIST).toMatch(/`hasPersonalData` is `false` only when you found no signal, and then `personalDataSignals` is empty/);
  });
  it('step 19 records the messaging integration from the adapters\' hints, never from names in the prose (NEW-07)', () => {
    const step = CHECKLIST.split('\n').find((l) => l.startsWith('19. **Messaging integration.**'))!;
    expect(step).toBeDefined();
    expect(step).toContain('the messaging adapters line of the CLI cheat-sheet');
    expect(step).toContain('set `messaging.provider` to its id, `hasMessagingIntegration` to true, and `messaging.baseUrlEnv` / `messaging.tokenEnv` to the env names the client reads');
    expect(step).toMatch(/set `messaging\.provider` to `direct-mail` and `hasMessagingIntegration` to false\. Otherwise `none` and false, with both env names null\./);
    expect(step).toContain('When `hasMessagingIntegration` is false, the messaging specialist reports a no-op.');
    // The adapter ids come first, then the two non-adapters the step names in schema order.
    expect(MESSAGING_PROVIDERS).toEqual(['commshub', 'direct-mail', 'none']);
    expect(step.indexOf('`direct-mail`')).toBeGreaterThan(0);
    expect(step.indexOf('`none`')).toBeGreaterThan(step.indexOf('`direct-mail`'));
    // Provider names and env patterns belong to the adapter (H4 cheat-sheet), not to the scanner prose (D10).
    expect(step).not.toMatch(/commshub|COMMS?HUB_|commhub/i);
    // Supabase auth mail is not a messaging integration any more.
    expect(CHECKLIST).not.toMatch(/hasEmailFlows|Supabase auth sends confirmation mail/);
  });
  it('the strict schema refuses a profile missing a P2b field or carrying a wrong value', () => {
    for (const key of ['hasPersonalData', 'personalDataSignals', 'hasMessagingIntegration']) {
      const { [key]: _gone, ...rest } = example;
      expect(TargetProfileSchema.safeParse(rest).success).toBe(false);
    }
    expect(TargetProfileSchema.safeParse({ ...example, hasPersonalData: 'yes' }).success).toBe(false);
    expect(TargetProfileSchema.safeParse({ ...example, personalDataSignals: [''] }).success).toBe(false);
    expect(TargetProfileSchema.safeParse({ ...example, hasMessagingIntegration: 'yes' }).success).toBe(false);
  });
  it('the full detection term lists stay in the checklist (deleting any term fails)', () => {
    const personalTerms = ['email', 'phone', 'telephone', 'tel', 'mobile', 'name', 'username', 'surname', 'first_name', 'last_name', 'full_name', 'given_name', 'family_name', 'address', 'street', 'city', 'zip', 'postcode', 'postal', 'dob', 'date_of_birth', 'birth', 'nric', 'fin', 'passport', 'national_id', 'tax_id', 'ssn', 'gender', 'password', 'ip_address'];
    const analytics = ['posthog-js', 'mixpanel-browser', '@segment/analytics-next', '@amplitude/analytics-browser', '@hubspot/api-client', '@vercel/analytics', 'react-ga4', 'hotjar', 'intercom', '@sentry/*'];
    const authPackages = ['next-auth', '@auth/*', '@supabase/auth-js', '@auth0/*', '@clerk/*', 'firebase/auth', 'passport', 'lucia', 'better-auth', '@supabase/supabase-js', '@supabase/ssr'];
    const mailEnv = ['*SMTP*', '*MAIL*', 'RESEND_*', 'SENDGRID_*', 'POSTMARK_*', 'MAILGUN_*'];
    const mailDeps = ['nodemailer', 'resend', '@sendgrid/mail', '@sendgrid/*', 'postmark', 'mailgun.js', 'mailgun-js', '@react-email/*', '@aws-sdk/client-ses'];
    // Each list is checked against its own sentence: a term deleted from its list fails even if it appears elsewhere.
    const segment = (from: string, to: string): string[] => {
      const start = CHECKLIST.indexOf(from);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = CHECKLIST.indexOf(to, start + from.length);
      expect(end).toBeGreaterThan(start);
      return [...CHECKLIST.slice(start + from.length, end).matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    };
    expect(segment('Terms: ', ' Match by token')).toEqual(expect.arrayContaining(personalTerms));
    expect(segment('monitoring dependency is present, by presence alone: ', '\n')).toEqual(expect.arrayContaining(analytics));
    expect(segment('Check for these auth packages: ', 'Custom auth routes')).toEqual(expect.arrayContaining(authPackages));
    expect(segment('an env name matching ', ' is found')).toEqual(expect.arrayContaining(mailEnv));
    expect(segment('but a mail library (', ') or an env name')).toEqual(expect.arrayContaining(mailDeps));
    expect(CHECKLIST).toMatch(/Match by token/);
    expect(CHECKLIST).toContain('Plurals count: a token equal to a term followed by `s` or `es` also matches (`emails`, `phones`, `addresses`).');
    expect(CHECKLIST).toMatch(/`final`, `find` and `hotel` do not match/);
    for (const scope of ['supabase/migrations/**', 'prisma/schema.prisma', 'models/**', 'zod schemas', 'never row or seed values']) expect(CHECKLIST).toContain(scope);
    expect(CHECKLIST).toMatch(/`\.auth\.` call/);
  });
  it('generic targets: framework fallback, a root app entry, scan.warning fields (P2a final-review carries)', () => {
    expect(CHECKLIST).toMatch(/`framework\.name` \(`"unknown"` when the target is neither nextjs nor vite-react\)/);
    const appsLine = CHECKLIST.split('\n').find((l) => l.includes('**Apps list.**'))!;
    expect(appsLine).toMatch(/single-app target \(no monorepo\), record one entry for the root[^\n]*`path` `"\."`/);
    expect(CHECKLIST).toMatch(/`scan\.warning` event with `path` \(`package\.json`\) and `reason`/);
    expect(md).toMatch(/append `scan\.warning` with that `path` and the `reason`/);
    const events = /## Events You Emit\n([\s\S]*?)\n## /.exec(md)![1]!;
    expect(events).toMatch(/^- `scan\.warning` — `\{ path, reason \}`, both required/m);
    expect(ScanWarningEventSchema.safeParse({ type: 'scan.warning', ts: TS, path: 'package.json' }).success).toBe(false);
    expect(ScanWarningEventSchema.safeParse({ type: 'scan.warning', ts: TS, path: 'package.json', reason: 'no lockfile' }).success).toBe(true);
  });
  it('the core schema reads the three preflight fields from a full profile', () => {
    const core = TargetProfileCoreSchema.parse(example);
    expect([core.targetIsSingleProject, core.sourceInventory.routes[0]!.path, core.existingTests.files]).toEqual([true, '/auth/login', []]);
    const { files: _f, ...noFiles } = example.existingTests;
    expect(TargetProfileCoreSchema.safeParse({ ...example, existingTests: noFiles }).success).toBe(false);
  });
});
