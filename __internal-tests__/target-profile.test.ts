import * as fs from 'fs'; import * as path from 'path';
import { TargetProfileCoreSchema, TargetProfileSchema } from '@qa/contracts';
import { PROFILE } from './helpers/pipeline';
const md = fs.readFileSync(path.join(__dirname, '..', '.claude', 'agents', 'crosscutting', 'qa-context-scanner.md'), 'utf-8');
const example = JSON.parse(/```jsonc\n([\s\S]*?)\n```/.exec(md)![1]!);
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
    for (const m of md.matchAll(/`((?:monorepo|ci|framework|language|existingTests)\.[a-zA-Z]+)(?:\[\])?`/g)) {
      const [root, key] = m[1]!.split('.');
      expect(roots).toContain(root);
      expect(Object.keys((shape as any)[root!].shape)).toContain(key);
    }
  });
  it('the core schema reads the three preflight fields from a full profile', () => {
    const core = TargetProfileCoreSchema.parse(example);
    expect([core.targetIsSingleProject, core.sourceInventory.routes[0]!.path, core.existingTests.files]).toEqual([true, '/auth/login', []]);
    const { files: _f, ...noFiles } = example.existingTests;
    expect(TargetProfileCoreSchema.safeParse({ ...example, existingTests: noFiles }).success).toBe(false);
  });
});
