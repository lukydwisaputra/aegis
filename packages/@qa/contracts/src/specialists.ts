/** Canonical short names for Tier-2 specialists. `mutates`: changes target state whatever the test case. */
export const SPECIALISTS = {
  ui: { agent: "qa-ui-specialist", mutates: false }, api: { agent: "qa-api-specialist", mutates: false },
  security: { agent: "qa-security-specialist", mutates: true }, database: { agent: "qa-database-specialist", mutates: true },
  performance: { agent: "qa-performance-specialist", mutates: true }, responsive: { agent: "qa-responsive-specialist", mutates: false },
  exploratory: { agent: "qa-exploratory-specialist", mutates: false }, accessibility: { agent: "qa-accessibility-specialist", mutates: false },
  email: { agent: "qa-email-specialist", mutates: true }, realtime: { agent: "qa-realtime-specialist", mutates: false },
  "feature-flag": { agent: "qa-feature-flag-specialist", mutates: true }, unit: { agent: "qa-unit-specialist", mutates: false },
} as const satisfies Record<string, { agent: string; mutates: boolean }>;
export type SpecialistShortName = keyof typeof SPECIALISTS;
const SHORT_NAMES = Object.keys(SPECIALISTS) as SpecialistShortName[];
/** The short name for a short name or an agent name; null when neither. */
export function specialistShortName(name: string): SpecialistShortName | null {
  if (Object.prototype.hasOwnProperty.call(SPECIALISTS, name)) return name as SpecialistShortName;
  return SHORT_NAMES.find((k) => SPECIALISTS[k].agent === name) ?? null;
}
export interface EnvironmentSpecialistConfig {
  readOnly?: boolean; mutating?: boolean; allowedSpecialists?: readonly string[]; forbiddenSpecialists?: readonly string[];
}
/** An environment is read-only when `readOnly` is true or `mutating` is false. */
export function isReadOnlyEnvironment(env: EnvironmentSpecialistConfig): boolean {
  return env.readOnly === true || env.mutating === false;
}
/** The single source for aegis.config.json and the `aegis init` template. */
export const DEFAULT_ENVIRONMENT_SPECIALISTS = {
  development: { allowedSpecialists: ["*"] }, testing: { allowedSpecialists: ["*"] }, staging: { allowedSpecialists: ["*"] },
  production: { allowedSpecialists: ["ui", "api"], forbiddenSpecialists: ["database", "performance", "security", "email", "feature-flag"] },
} as const satisfies Record<string, EnvironmentSpecialistConfig>;
/** Problems in environment specialist lists, as `environments.<env>.<field>: <problem>` lines. */
export function checkEnvironmentSpecialists(envs: Record<string, EnvironmentSpecialistConfig>): string[] {
  const out: string[] = [];
  for (const [name, env] of Object.entries(envs)) {
    const readOnly = isReadOnlyEnvironment(env);
    for (const field of ["allowedSpecialists", "forbiddenSpecialists"] as const) {
      const at = `environments.${name}.${field}`;
      for (const s of env[field] ?? []) {
        if (s === "*") {
          if (field === "forbiddenSpecialists") out.push(`${at}: "*" is only valid in allowedSpecialists`);
          else if (readOnly) out.push(`${at}: "*" on a read-only environment`);
        } else {
          const short = specialistShortName(s);
          if (short === null) out.push(`${at}: unknown specialist "${s}"`);
          else if (field === "allowedSpecialists" && readOnly && SPECIALISTS[short].mutates) out.push(`${at}: mutating specialist "${s}" on a read-only environment`);
        }
      }
    }
  }
  return out;
}
