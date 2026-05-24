import { SignJWT } from "jose";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── JWT forging ─────────────────────────────────────────────────────────────

/**
 * Forge a Supabase-compatible JWT for a given role.
 * Uses the HS256 algorithm with the SUPABASE_JWT_SECRET.
 * The forged token has the standard Supabase claims format.
 */
export async function forgeRoleJwt(opts: {
  role: string;
  userId: string;
  email: string;
  jwtSecret: string;
  expiresInSeconds?: number;
  extraClaims?: Record<string, unknown>;
}): Promise<string> {
  const { role, userId, email, jwtSecret, expiresInSeconds = 3600, extraClaims = {} } = opts;

  const secret = new TextEncoder().encode(jwtSecret);

  const payload: Record<string, unknown> = {
    sub: userId,
    email,
    role,
    app_metadata: { role },
    user_metadata: {},
    iss: "supabase",
    ...extraClaims,
  };

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(secret);

  return token;
}

// ─── Migration runner ─────────────────────────────────────────────────────────

export interface MigrationResult {
  file: string;
  status: "applied" | "skipped" | "failed";
  error?: string;
  durationMs: number;
}

/**
 * Run Supabase SQL migrations in order (numeric prefix sort).
 * Falls back to direct psql execution if supabase CLI not available.
 */
export async function runMigrations(opts: {
  migrationsDir: string;
  databaseUrl: string;
  fromMigration?: string;
  dryRun?: boolean;
}): Promise<MigrationResult[]> {
  const { migrationsDir, databaseUrl, fromMigration, dryRun = false } = opts;

  const allFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => {
      // Sort by numeric prefix
      const numA = parseInt(a.match(/^(\d+)/)?.[1] ?? "0", 10);
      const numB = parseInt(b.match(/^(\d+)/)?.[1] ?? "0", 10);
      return numA - numB;
    });

  let skip = fromMigration !== undefined;

  const results: MigrationResult[] = [];

  for (const file of allFiles) {
    // Skip files before fromMigration
    if (skip) {
      if (file === fromMigration) {
        skip = false;
      } else {
        results.push({ file, status: "skipped", durationMs: 0 });
        continue;
      }
    }

    const filePath = path.join(migrationsDir, file);
    const cmd = `psql "${databaseUrl}" -f "${filePath}"`;

    if (dryRun) {
      console.log(`[dry-run] ${cmd}`);
      results.push({ file, status: "applied", durationMs: 0 });
      continue;
    }

    const start = Date.now();
    try {
      execSync(cmd, { stdio: "pipe" });
      results.push({ file, status: "applied", durationMs: Date.now() - start });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ file, status: "failed", error, durationMs: Date.now() - start });
    }
  }

  return results;
}

// ─── RLS test helpers ─────────────────────────────────────────────────────────

export interface RlsTestContext {
  role: string;
  jwt: string;
  databaseUrl: string;
}

/**
 * Build a Postgres connection string with the role set for RLS testing.
 * Appends role options to the connection string.
 */
export async function buildRlsTestUrl(ctx: RlsTestContext): Promise<string> {
  const { role, jwt, databaseUrl } = ctx;

  const separator = databaseUrl.includes("?") ? "&" : "?";
  const claims = JSON.stringify({ role, sub: "", iss: "supabase" });
  const encodedClaims = encodeURIComponent(claims);
  const encodedJwt = encodeURIComponent(jwt);

  return (
    `${databaseUrl}${separator}` +
    `options=-c%20request.jwt.claims%3D${encodedClaims}` +
    `&options=-c%20request.jwt%3D${encodedJwt}` +
    `&options=-c%20role%3D${encodeURIComponent(role)}`
  );
}

/**
 * Verify that a given role can/cannot access a table.
 * Executes a minimal query wrapped in a SET role + SET request.jwt.claims session.
 */
export async function verifyRlsPolicy(opts: {
  databaseUrl: string;
  role: string;
  table: string;
  operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
  expectedAllowed: boolean;
  jwt: string;
}): Promise<{ passed: boolean; reason: string }> {
  const { databaseUrl, role, table, operation, expectedAllowed, jwt } = opts;

  const claims = JSON.stringify({ role, sub: "", iss: "supabase" });

  let testQuery: string;
  switch (operation) {
    case "SELECT":
      testQuery = `SELECT 1 FROM ${table} LIMIT 1`;
      break;
    case "INSERT":
      testQuery = `INSERT INTO ${table} DEFAULT VALUES`;
      break;
    case "UPDATE":
      testQuery = `UPDATE ${table} SET id = id WHERE false`;
      break;
    case "DELETE":
      testQuery = `DELETE FROM ${table} WHERE false`;
      break;
  }

  const sessionSql = [
    `SET LOCAL role = '${role}';`,
    `SET LOCAL request.jwt.claims = '${claims.replace(/'/g, "''")}';`,
    `SET LOCAL request.jwt = '${jwt.replace(/'/g, "''")}';`,
    testQuery + ";",
  ].join(" ");

  const cmd = `psql "${databaseUrl}" -c "${sessionSql.replace(/"/g, '\\"')}"`;

  try {
    execSync(cmd, { stdio: "pipe" });
    // Command succeeded — access was allowed
    if (expectedAllowed) {
      return { passed: true, reason: `Role '${role}' can ${operation} on '${table}' as expected` };
    } else {
      return {
        passed: false,
        reason: `Role '${role}' was able to ${operation} on '${table}' but should have been denied`,
      };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isPermissionError =
      errorMsg.includes("permission denied") ||
      errorMsg.includes("insufficient privilege") ||
      errorMsg.includes("new row violates");

    if (!expectedAllowed && isPermissionError) {
      return {
        passed: true,
        reason: `Role '${role}' correctly denied ${operation} on '${table}'`,
      };
    } else if (expectedAllowed) {
      return {
        passed: false,
        reason: `Role '${role}' was denied ${operation} on '${table}' but should be allowed: ${errorMsg}`,
      };
    } else {
      return {
        passed: false,
        reason: `Unexpected error during RLS check: ${errorMsg}`,
      };
    }
  }
}

// ─── NRIC detection ───────────────────────────────────────────────────────────

/**
 * NRIC pattern for Singapore IDs (Sev1 data leak risk).
 * Pattern: [STFG]\d{7}[A-Z]
 */
export const NRIC_PATTERN = /\b[STFG]\d{7}[A-Z]\b/g;

/**
 * Detect NRIC pattern in a string (Singapore ID — Sev1 data leak risk).
 */
export function detectNric(text: string): boolean {
  NRIC_PATTERN.lastIndex = 0;
  return NRIC_PATTERN.test(text);
}
