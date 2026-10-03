import { createHmac } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { checkBrandExposure } from '@qa/contracts';
import { forgeRoleJwt } from '@qa/supabase';

// P2c — the QA helpers copied into the target (docs/superpowers/specs/2026-10-02-p2-roster-design.md §4.11.3, T6, T7).
const REPO = path.join(__dirname, '..');
const HELPERS = ['test-helpers', 'supabase'] as const;
const source = (name: string) => fs.readFileSync(path.join(REPO, 'packages', '@qa', name, 'src', 'index.ts'), 'utf-8');
const version = (name: string) => (JSON.parse(fs.readFileSync(path.join(REPO, 'packages', '@qa', name, 'package.json'), 'utf-8')) as { version: string }).version;
/** Every module specifier a TypeScript source imports, re-exports or requires. */
const specifiers = (text: string): string[] =>
  [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);

describe('the helper sources run in any target (T7)', () => {
  it('import only node: built-ins and carry no framework name', () => {
    for (const n of HELPERS) {
      expect(specifiers(source(n)).filter((s) => !s.startsWith('node:'))).toEqual([]);
      expect(checkBrandExposure(source(n))).toBeNull();
      expect(version(n)).toMatch(/^\d+\.\d+\.\d+$/);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'packages', '@qa', 'supabase', 'package.json'), 'utf-8')) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).not.toHaveProperty('jose');
  });

  it('forgeRoleJwt signs HS256 so an independent HMAC-SHA256 check verifies it', async () => {
    const secret = 'super-secret-jwt-token-with-at-least-32-characters';
    const before = Math.floor(Date.now() / 1000);
    const token = await forgeRoleJwt({ role: 'authenticated', userId: 'u-1', email: 'qa+1@example.com', jwtSecret: secret, expiresInSeconds: 600, extraClaims: { iat: 1, aal: 'aal1' } });
    const [header, payload, signature] = token.split('.') as [string, string, string];
    expect(createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')).toBe(signature);
    expect(createHmac('sha256', 'another-secret').update(`${header}.${payload}`).digest('base64url')).not.toBe(signature);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf-8'))).toEqual({ alg: 'HS256' });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<string, unknown>;
    expect(claims).toMatchObject({ sub: 'u-1', email: 'qa+1@example.com', role: 'authenticated', app_metadata: { role: 'authenticated' }, user_metadata: {}, iss: 'supabase', aal: 'aal1' });
    expect(claims['iat']).toBeGreaterThanOrEqual(before);
    expect(claims['exp']).toBe((claims['iat'] as number) + 600);
  });
});
