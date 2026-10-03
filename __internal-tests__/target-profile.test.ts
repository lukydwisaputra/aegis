import * as fs from 'fs'; import * as path from 'path';
import { ScanWarningEventSchema, TargetProfileCoreSchema, TargetProfileSchema } from '@qa/contracts';
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
    expect(required).toEqual(expect.arrayContaining(['hasPersonalData', 'personalDataSignals', 'hasEmailFlows']));
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
    expect(CHECKLIST).toMatch(/Record `hasEmailFlows` \(`true` or `false`\)/);
    for (const lib of ['nodemailer', 'resend', '@sendgrid/mail', 'postmark', 'mailgun.js', '@aws-sdk/client-ses']) expect(CHECKLIST).toContain('`' + lib + '`');
    expect(CHECKLIST).toMatch(/`platform` is `"supabase"` and `hasAuth` is `true`/);
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
