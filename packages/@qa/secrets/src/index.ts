export type SecretProvider =
  | "env"
  | "github-actions-secrets"
  | "vault"
  | "aws-ssm"
  | "1password";

export interface SecretsConfig {
  type: SecretProvider;
  prefix?: string;    // env var prefix, e.g. "STAGING_"
  vaultPath?: string; // for vault: the KV path
  awsRegion?: string; // for aws-ssm
}

// A proxy ref — the actual secret value is NOT stored here
export interface SecretRef {
  readonly name: string;
  readonly provider: SecretProvider;
}

export class SecretsError extends Error {
  constructor(
    message: string,
    public readonly secretName: string,
  ) {
    super(message);
    this.name = "SecretsError";
  }
}

export class SecretsClient {
  private readonly config: SecretsConfig;

  constructor(config: SecretsConfig) {
    this.config = config;
  }

  // Returns a SecretRef (not the value)
  ref(name: string): SecretRef {
    return {
      name,
      provider: this.config.type,
    };
  }

  // Resolves the secret value — call this ONLY at the last moment (e.g. filling a form)
  // Reads from env var `${config.prefix ?? ""}${name}` for "env" and "github-actions-secrets" providers
  // Throws SecretsError if the env var is not set
  async resolve(ref: SecretRef): Promise<string> {
    const { type, prefix } = this.config;

    if (type === "env" || type === "github-actions-secrets") {
      const envKey = `${prefix ?? ""}${ref.name}`;
      const value = process.env[envKey];
      if (value === undefined) {
        throw new SecretsError(
          `Secret "${ref.name}" not found: env var "${envKey}" is not set`,
          ref.name,
        );
      }
      return value;
    }

    throw new SecretsError(
      `Provider ${type} requires runtime SDK — configure secretsRef accordingly.`,
      ref.name,
    );
  }

  // Validate that all required secrets are present in the environment
  // Does NOT return values — returns { missing: string[], present: string[] }
  async validate(names: string[]): Promise<{ missing: string[]; present: string[] }> {
    const missing: string[] = [];
    const present: string[] = [];

    for (const name of names) {
      const secretRef = this.ref(name);
      try {
        await this.resolve(secretRef);
        present.push(name);
      } catch {
        missing.push(name);
      }
    }

    return { missing, present };
  }
}

// Factory from aegis.config.json.environments[env].secretsRef
export function createSecretsClient(secretsRef: SecretsConfig): SecretsClient {
  return new SecretsClient(secretsRef);
}

// Guard: never log secrets — call this before any logging
// Returns "***REDACTED***" if the value matches a secret pattern
const SECRET_PATTERNS = [
  /^[A-Za-z0-9+/]{20,}={0,2}$/, // base64-ish (JWT, API keys)
  /^(sk|pk|rk|ghp|ghs|gho|glpat|xox)[-_]/i, // known key prefixes
  /^[0-9a-f]{32,}$/i, // hex tokens
];

export function redactIfSecret(value: string): string {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(value)) {
      return "***REDACTED***";
    }
  }
  return value;
}
