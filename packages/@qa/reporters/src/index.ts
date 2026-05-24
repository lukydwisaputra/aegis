import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { CLASS_B_KINDS, checkBrandExposure } from "@qa/contracts";
import { assertWritable, assertAegisOwnership, PathGuardError } from "@qa/path-guard";
import { append } from "@qa/event-bus";

// ─── Re-export PathGuardError for convenience ─────────────────────────────────
export { PathGuardError } from "@qa/path-guard";

// ─── BrandExposureError ───────────────────────────────────────────────────────

export class BrandExposureError extends Error {
  constructor(
    public readonly path: string,
    public readonly pattern: string
  ) {
    super(
      `Brand exposure detected in artefact at "${path}": pattern "${pattern}" matched. ` +
      `Remove all internal Aegis framework references before writing Class B artefacts.`
    );
    this.name = "BrandExposureError";
  }
}

// ─── ArtifactDataSchema ───────────────────────────────────────────────────────

/**
 * Minimal structural schema: any non-null object with an `id` field.
 * Caller's template is responsible for deeper validation.
 */
const ArtifactDataSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => typeof v["id"] === "string" && v["id"].length > 0, {
    message: "Artefact data must contain a non-empty string `id` field",
  });

// ─── writeArtifact ────────────────────────────────────────────────────────────

export interface WriteArtifactParams {
  /** Artefact kind, e.g. "defect", "test-case" */
  kind: string;
  /** Raw data (structurally validated inside: must be object with `id`) */
  data: unknown;
  /** Absolute path for the .json output file */
  jsonPath: string;
  /** Absolute path for the .md output file */
  mdPath: string;
  /** Absolute path to the aegis root directory */
  aegisRoot: string;
  /** Absolute path to the events.jsonl bus file */
  busPath: string;
  /** Agent name — used for territory check when provided */
  agentName?: string | undefined;
  /** Caller-supplied Markdown renderer */
  renderMd: (data: unknown) => string;
}

/**
 * Full writeArtifact pipeline:
 * 1. Structural Zod validation (object with `id`)
 * 2. Brand-exposure check for Class B kinds
 * 3. Path-guard assertions for both output files
 * 4. Optional territory ownership check
 * 5. Atomic dual-write (.json + .md)
 * 6. Emit `artifact.created` event to event bus
 */
export async function writeArtifact(params: WriteArtifactParams): Promise<void> {
  const {
    kind,
    data,
    jsonPath,
    mdPath,
    aegisRoot,
    busPath,
    agentName,
    renderMd,
  } = params;

  // ── Step 1: Structural validation ──────────────────────────────────────────
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      `writeArtifact: 'data' must be a non-null object, got ${data === null ? "null" : Array.isArray(data) ? "array" : typeof data}`
    );
  }

  const parseResult = ArtifactDataSchema.safeParse(data);
  if (!parseResult.success) {
    throw new Error(
      `writeArtifact: schema validation failed for kind "${kind}": ${parseResult.error.message}`
    );
  }

  // ── Step 2: Brand-exposure check (Class B artefacts only) ──────────────────
  // Cast via unknown to avoid TypeScript's strict literal union check on Set.has()
  if ((CLASS_B_KINDS as Set<string>).has(kind)) {
    const rendered = renderMd(data);
    const match = checkBrandExposure(rendered);
    if (match !== null) {
      throw new BrandExposureError(jsonPath, String(match));
    }
  }

  // ── Step 3: Path-guard for jsonPath ───────────────────────────────────────
  try {
    assertWritable(jsonPath, aegisRoot);
  } catch (err) {
    if (err instanceof PathGuardError) throw err;
    throw new PathGuardError(
      `writeArtifact: path guard failed for json path "${jsonPath}": ${String(err)}`,
      jsonPath,
      "not-writable"
    );
  }

  // ── Step 4: Path-guard for mdPath ─────────────────────────────────────────
  try {
    assertWritable(mdPath, aegisRoot);
  } catch (err) {
    if (err instanceof PathGuardError) throw err;
    throw new PathGuardError(
      `writeArtifact: path guard failed for md path "${mdPath}": ${String(err)}`,
      mdPath,
      "not-writable"
    );
  }

  // ── Step 5: Territory ownership check ─────────────────────────────────────
  if (agentName !== undefined) {
    assertAegisOwnership(agentName, jsonPath, aegisRoot);
  }

  // ── Step 6: Atomic dual-write ──────────────────────────────────────────────
  const jsonDir = dirname(jsonPath);
  const mdDir = dirname(mdPath);
  mkdirSync(jsonDir, { recursive: true });
  if (mdDir !== jsonDir) {
    mkdirSync(mdDir, { recursive: true });
  }

  writeFileSync(jsonPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  writeFileSync(mdPath, renderMd(data), "utf-8");

  // ── Step 7: Emit artifact.created event ───────────────────────────────────
  await append(
    {
      type: "artifact.created",
      kind,
      path: jsonPath,
      ts: new Date().toISOString(),
    },
    busPath
  );
}
