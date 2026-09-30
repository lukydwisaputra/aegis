import { z } from "zod";
export const PackageManagerSchema = z.enum(["pnpm", "npm", "yarn", "bun"]);
const S = z.string().min(1);
const N = z.number().int().nonnegative();
const Named = z.object({ name: S, file: S });
export const SourceInventorySchema = z.object({
  routes: z.array(z.object({ path: S, file: S })).default([]),
  components: z.array(Named).default([]),
  apiHandlers: z.array(z.object({ path: S, methods: z.array(S), file: S })).default([]),
  exportedFunctions: z.array(Named).default([]),
  existingTestFiles: z.array(z.object({ path: S, type: S })).default([]),
});
export const ExistingTestsSchema = z.object({
  files: z.array(z.string()), frameworks: z.array(z.string()), locations: z.array(z.string()), count: N,
  unitTestStyle: z.enum(["colocated", "tests-dir", "mixed", "none"]),
});
/** The fields the preflight and requirements phase rely on (P0 spec §6.2). Non-strict: reads a full profile. */
export const TargetProfileCoreSchema = z.object({
  targetIsSingleProject: z.boolean(), sourceInventory: SourceInventorySchema, existingTests: ExistingTestsSchema,
});
/** runs/{runId}/target-profile.json as written by qa-context-scanner. Top level is strict (an unlisted field is drift); nested objects strip unknown keys. */
export const TargetProfileSchema = TargetProfileCoreSchema.extend({
  scannedAt: z.string().datetime({ offset: false }),
  packageManager: PackageManagerSchema,
  framework: z.object({ name: S, version: z.string().nullable(), appRouter: z.boolean().nullable().optional() }),
  language: z.object({ typescript: z.boolean(), tsxFiles: N, jsxFiles: N, hasMixedJsxTsx: z.boolean() }),
  monorepo: z.object({ tool: S, workspaces: z.array(z.string()) }),
  apps: z.array(z.object({ name: S, path: S, framework: S, language: z.enum(["ts", "tsx", "jsx"]) })),
  platform: z.enum(["supabase", "generic"]),
  supabase: z.object({ projectRef: z.string().nullable(), migrationDir: z.string().nullable(), migrationCount: N }).optional(),
  roles: z.array(z.string()),
  ci: z.object({ provider: z.enum(["github-actions", "gitlab-ci", "circleci", "none"]), workflowFiles: z.array(z.string()) }),
  apiSurface: z.array(z.string()),
  envVarNames: z.array(z.string()),
  hasAuth: z.boolean(), authProvider: z.string().nullable(), nodeVersion: z.string().nullable(),
  hasRealtimeFeatures: z.boolean(), hasFeatureFlags: z.boolean(), featureFlagProvider: z.string().nullable().optional(),
}).strict();
export type TargetProfile = z.infer<typeof TargetProfileSchema>;
export type TargetProfileCore = z.infer<typeof TargetProfileCoreSchema>;
