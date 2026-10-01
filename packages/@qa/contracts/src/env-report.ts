import { z } from "zod";
import { NonBlank } from "./non-blank.js";

// ─── Env-auth report (P0 spec §3.1 environment split) ─────────────────────────

export const ENV_BROWSERS = ["chromium", "firefox", "webkit"] as const;
export const ENV_HEALTH = ["READY", "PARTIAL", "FAILED"] as const;

/**
 * runs/{runId}/env-auth-report.json: what qa-environment-engineer's scope=auth dispatch set up in Env-auth —
 * the browser matrix, the Playwright projects, each role logged in with its storage-state path, the installed
 * `@playwright/cli` version, the smoke-ping result, what was skipped and the health status.
 */
export const EnvAuthReportSchema = z
  .object({
    browsers: z.array(z.enum(ENV_BROWSERS)).min(1),
    playwrightProjects: z.array(NonBlank()).min(1),
    // Roles logged in; global-setup saves each one's state under tests/qa/state/ (gitignored).
    roles: z.array(
      z.object({ role: NonBlank(), storageState: z.string().regex(/^tests\/qa\/state\/[^/\s]+\.json$/) }).strict(),
    ),
    // null when the install failed (health is then not READY).
    playwrightCliVersion: NonBlank().nullable(),
    // status is null when the ping timed out.
    smokePing: z.object({ url: z.string().url(), status: z.number().int().min(100).max(599).nullable(), ok: z.boolean() }).strict(),
    // For example a role with no credentials file.
    skipped: z.array(z.object({ item: NonBlank(), reason: NonBlank() }).strict()),
    health: z.enum(ENV_HEALTH),
  })
  .strict()
  .superRefine((r, ctx) => {
    const unique = (values: string[], field: string) => {
      const seen = new Set<string>();
      values.forEach((v, i) => {
        if (seen.has(v)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field, i], message: `${v} is listed twice` });
        seen.add(v);
      });
    };
    unique(r.browsers, "browsers");
    unique(r.playwrightProjects, "playwrightProjects");
    unique(r.roles.map((x) => x.role), "roles");
    // ok holds exactly when the target answered 2xx.
    const { status, ok } = r.smokePing;
    if (ok !== (status !== null && status >= 200 && status < 300)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["smokePing", "ok"], message: "ok must be true exactly when status is 2xx" });
    }
    if (r.health !== "READY") return;
    if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["health"], message: "READY needs a passing smoke ping" });
    if (r.playwrightCliVersion === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["health"], message: "READY needs the installed @playwright/cli version" });
    if (r.roles.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["health"], message: "READY needs at least one logged-in role" });
    if (r.skipped.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["health"], message: "READY cannot skip anything; use PARTIAL" });
  });
export type EnvAuthReport = z.infer<typeof EnvAuthReportSchema>;
