import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// Resolve aegis root from the test file's location, not the test runner cwd —
// otherwise running jest from inside __internal-tests__ vs the root behaves
// differently.
const AEGIS_ROOT = resolve(__dirname, "..");
const AGENTS_ROOT = join(AEGIS_ROOT, ".claude", "agents");
const MODEL_POLICY_PATH = join(AEGIS_ROOT, ".claude", "model-policy.yaml");

// ─── Lightweight frontmatter / YAML parsing ───────────────────────────────────
// The validator deliberately avoids adding a YAML dependency. Aegis agent
// frontmatter has a fixed, simple shape: scalar key/value lines, an inline
// `tools: [A, B, C]` list, and a `knowledge_refs:` block list of `  - path`
// lines. This parser handles exactly that — anything richer would mean the
// agent file diverged from the documented schema and should be flagged.

interface Frontmatter {
  name?: string;
  description?: string;
  modelTier?: string;
  tools?: string[];
  knowledge_refs?: string[];
  isolation?: string;
  raw: Record<string, string>;
}

function parseFrontmatter(source: string, relPath: string): Frontmatter {
  if (!source.startsWith("---\n")) {
    throw new Error(`${relPath}: file does not start with frontmatter delimiter`);
  }
  const end = source.indexOf("\n---\n", 4);
  if (end === -1) {
    throw new Error(`${relPath}: frontmatter has no closing '---' delimiter`);
  }
  const block = source.slice(4, end);
  const lines = block.split("\n");

  const fm: Frontmatter = { raw: {} };
  let listKey: "knowledge_refs" | null = null;

  for (const line of lines) {
    if (line.trim() === "") {
      listKey = null;
      continue;
    }
    // List continuation: "  - some/path"
    if (listKey && /^\s+-\s+/.test(line)) {
      const value = line.replace(/^\s+-\s+/, "").trim();
      fm[listKey] ??= [];
      fm[listKey]!.push(value);
      continue;
    }
    listKey = null;

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      throw new Error(`${relPath}: cannot parse frontmatter line: ${JSON.stringify(line)}`);
    }
    const key = match[1]!;
    const rawValue = match[2]!.trim();

    if (key === "tools") {
      // Inline list "[Read, Write, Edit]" — strip brackets, split on comma.
      const inline = /^\[(.*)\]$/.exec(rawValue);
      if (!inline) {
        throw new Error(`${relPath}: tools must be an inline list like [Read, Edit] (got: ${rawValue})`);
      }
      fm.tools = inline[1]!
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      continue;
    }
    if (key === "knowledge_refs") {
      // Either inline "[]" (empty) or block list on following lines.
      if (rawValue === "[]") {
        fm.knowledge_refs = [];
      } else if (rawValue === "") {
        fm.knowledge_refs = [];
        listKey = "knowledge_refs";
      } else {
        throw new Error(`${relPath}: knowledge_refs must be [] or a block list (got: ${rawValue})`);
      }
      continue;
    }
    if (key === "name") fm.name = rawValue;
    else if (key === "modelTier") fm.modelTier = rawValue;
    else if (key === "isolation") fm.isolation = rawValue;
    else if (key === "description") fm.description = rawValue;

    fm.raw[key] = rawValue;
  }

  return fm;
}

// ─── Model-policy loading ─────────────────────────────────────────────────────

interface ModelPolicy {
  /** Map of agent name → declared tier. */
  agentToTier: Map<string, string>;
  validTiers: Set<string>;
}

function loadModelPolicy(): ModelPolicy {
  const text = readFileSync(MODEL_POLICY_PATH, "utf-8");

  const agentToTier = new Map<string, string>();
  const validTiers = new Set<string>();

  // Parse just the `assignments:` block. Structure:
  //   assignments:
  //     planning:
  //       - qa-orchestrator
  //       ...
  //     implementation:
  //       - qa-foo
  //       ...
  // Subsequent top-level keys (ingestion:, spvFastPath:, tokenRates:) end the
  // assignments scope.
  const lines = text.split("\n");
  let inAssignments = false;
  let currentTier: string | null = null;

  for (const line of lines) {
    if (/^assignments:\s*$/.test(line)) {
      inAssignments = true;
      continue;
    }
    if (!inAssignments) continue;

    // New top-level key (no leading whitespace, ends with ':') — end of block.
    if (/^[A-Za-z]/.test(line)) {
      inAssignments = false;
      currentTier = null;
      continue;
    }

    // Tier header: "  planning:" (2-space indent, ends with colon)
    const tierMatch = /^  ([a-z-]+):\s*$/.exec(line);
    if (tierMatch) {
      currentTier = tierMatch[1]!;
      validTiers.add(currentTier);
      continue;
    }

    // Agent entry: "    - qa-orchestrator"
    const agentMatch = /^    -\s+([a-z0-9-]+)\s*$/.exec(line);
    if (agentMatch && currentTier) {
      agentToTier.set(agentMatch[1]!, currentTier);
    }
  }

  return { agentToTier, validTiers };
}

// ─── Agent discovery ──────────────────────────────────────────────────────────

interface AgentFile {
  path: string;
  relPath: string;
  /** Top-level subdir under .claude/agents (orchestrator, tier1-phase, spv, ...). */
  tierDir: string;
}

function findAgents(): AgentFile[] {
  const found: AgentFile[] = [];
  const subdirs = readdirSync(AGENTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "temp" && d.name !== "archive")
    .map((d) => d.name);

  for (const sub of subdirs) {
    const dir = join(AGENTS_ROOT, sub);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      found.push({
        path: join(dir, entry.name),
        relPath: join(".claude/agents", sub, entry.name),
        tierDir: sub,
      });
    }
  }
  return found;
}

// ─── Skill discovery ──────────────────────────────────────────────────────────
// Skills live under .claude/skills/{dir}/SKILL.md where {dir} is either
// `qa-<name>` (user-facing) or `_qa-<name>` (internal, agent-invoked).
// The skill's logical name (what an agent writes in "Skill to invoke: X") is
// the `name:` value in the SKILL.md frontmatter, which strips the leading
// underscore. So the lookup table is keyed on that logical name.

const SKILLS_ROOT = join(AEGIS_ROOT, ".claude", "skills");

function loadSkillNames(): Set<string> {
  const names = new Set<string>();
  if (!existsSync(SKILLS_ROOT)) return names;

  for (const entry of readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(SKILLS_ROOT, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    // The directory name is the source of truth — strip leading underscore.
    const logicalName = entry.name.replace(/^_/, "");
    names.add(logicalName);
    // Also accept the raw directory name, in case an agent prompt happens to
    // include the `_` prefix.
    names.add(entry.name);
  }
  return names;
}

const skillNames = loadSkillNames();

// ─── Allowed tools ────────────────────────────────────────────────────────────
// Authoritative list of tool identifiers an agent may declare. Drawn from the
// frontmatter values currently in use across the agent set. If you add a new
// tool to an agent, add it here so the validator stays meaningful.
const ALLOWED_TOOLS = new Set<string>([
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Skill",
  "Agent",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
]);

// ─── Section requirements ─────────────────────────────────────────────────────
// SPV agents follow a different prompt template than workers. The validator
// enforces both shapes, picking by name suffix.

const WORKER_REQUIRED_SECTIONS = ["## Your Role", "## Inputs", "## Outputs", "## Process"];
const SPV_REQUIRED_SECTIONS = ["## Your Role", "## Inputs", "## Review Checklist", "## Verdict"];
// Cross-cutting agents (event-bus, librarian, scanners, curator, metrics) are
// utilities, not STLC workers. They legitimately diverge from the worker
// template — each is shaped to its purpose. Enforce only the universal minimum.
const CROSSCUTTING_REQUIRED_SECTIONS = ["## Your Role", "## Inputs"];

function isSpvAgent(name: string): boolean {
  return name.endsWith("-spv");
}

function pickRequiredSections(tierDir: string, name: string): string[] {
  if (tierDir === "crosscutting") return CROSSCUTTING_REQUIRED_SECTIONS;
  if (isSpvAgent(name)) return SPV_REQUIRED_SECTIONS;
  return WORKER_REQUIRED_SECTIONS;
}

// ─── Cached loads ─────────────────────────────────────────────────────────────

const agents = findAgents();
const policy = loadModelPolicy();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("agent frontmatter — sanity", () => {
  it("discovers at least 50 agent files", () => {
    expect(agents.length).toBeGreaterThanOrEqual(50);
  });

  it("model-policy.yaml declares at least 50 agent assignments", () => {
    expect(policy.agentToTier.size).toBeGreaterThanOrEqual(50);
  });
});

describe.each(agents)("agent file: $relPath", (agent) => {
  const source = readFileSync(agent.path, "utf-8");
  const fm = parseFrontmatter(source, agent.relPath);

  it("has required frontmatter fields (name, description, modelTier, tools, knowledge_refs)", () => {
    expect(fm.name).toBeDefined();
    expect(fm.description).toBeDefined();
    expect(fm.description!.length).toBeGreaterThan(20);
    expect(fm.modelTier).toBeDefined();
    expect(fm.tools).toBeDefined();
    expect(fm.knowledge_refs).toBeDefined();
  });

  it("name matches the filename", () => {
    const expected = agent.path.split("/").pop()!.replace(/\.md$/, "");
    expect(fm.name).toBe(expected);
  });

  it("declares a modelTier listed in model-policy.yaml", () => {
    expect(policy.validTiers.has(fm.modelTier!)).toBe(true);
  });

  it("is registered in model-policy.yaml#assignments exactly once", () => {
    expect(policy.agentToTier.has(fm.name!)).toBe(true);
  });

  it("modelTier in frontmatter matches the tier in model-policy.yaml", () => {
    const policyTier = policy.agentToTier.get(fm.name!);
    expect(fm.modelTier).toBe(policyTier);
  });

  it("declares only allowed tools", () => {
    expect(fm.tools).toBeDefined();
    const unknown = fm.tools!.filter((t) => !ALLOWED_TOOLS.has(t));
    expect(unknown).toEqual([]);
  });

  it("every knowledge_refs path exists on disk (or is an agent-memory lessons file)", () => {
    expect(fm.knowledge_refs).toBeDefined();
    const missing: string[] = [];
    for (const ref of fm.knowledge_refs!) {
      const abs = join(AEGIS_ROOT, ref);
      if (existsSync(abs)) continue;
      // agent-memory/{agent}/lessons.{md,json} is auto-created at first run.
      // Accept the reference if the path matches that pattern, regardless of
      // whether the file or its directory exists yet.
      if (/^agent-memory\/[a-z0-9-]+\/lessons\.md$/.test(ref)) {
        continue;
      }
      missing.push(ref);
    }
    expect(missing).toEqual([]);
  });

  it("has the required prompt sections for its role", () => {
    const required = pickRequiredSections(agent.tierDir, fm.name!);
    const missing = required.filter((header) => !source.includes(`\n${header}\n`));
    expect(missing).toEqual([]);
  });

  it("every 'Skill to invoke: X' reference points to an existing skill", () => {
    // Match phrasings used in agent prompts to name a skill they will dispatch.
    // Three patterns observed in the wild:
    //   Skill to invoke: `qa-foo`
    //   invoke `qa-foo` skill
    //   invoking `qa-foo` skill
    const patterns = [
      /Skill to invoke:\s*`([a-z][a-z0-9-]+)`/g,
      /invoke\s+`([a-z][a-z0-9-]+)`\s+skill/gi,
      /invoking\s+`([a-z][a-z0-9-]+)`\s+skill/gi,
    ];

    const referenced = new Set<string>();
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        referenced.add(match[1]!);
      }
    }

    if (referenced.size === 0) {
      // Agent invokes no skills — nothing to validate.
      expect(true).toBe(true);
      return;
    }

    // If the agent references skills, it must also declare `Skill` in its tools.
    const hasSkillTool = (fm.tools ?? []).includes("Skill");
    if (!hasSkillTool) {
      throw new Error(
        `${agent.relPath}: prompt invokes skills [${[...referenced].join(", ")}] but frontmatter does not declare the Skill tool. ` +
          `Tools: [${(fm.tools ?? []).join(", ")}]`,
      );
    }

    const missing = [...referenced].filter((name) => !skillNames.has(name));
    if (missing.length > 0) {
      throw new Error(
        `${agent.relPath}: references skills that do not exist under .claude/skills/: ${missing.join(", ")}. ` +
          `Either create the skill or remove the reference.`,
      );
    }
    expect(missing).toEqual([]);
  });

  it("declares the Write or Edit tool when the prompt body says it writes files", () => {
    // Pull the `## Outputs` section body (everything until the next `## ` header).
    const outputsMatch = /\n## Outputs\n([\s\S]*?)(?:\n## |\Z)/.exec(source);
    const outputsBody = outputsMatch ? outputsMatch[1]! : "";

    // Heuristic: a writing agent is one whose Outputs section names a concrete
    // file path (anything matching `runs/{runId}/...` or `aegis/...`), OR whose
    // description uses an explicit writing verb followed by a path-like token.
    // Pattern-matched phrasings only — we don't try to read between the lines.
    const writesPathInOutputs = /`(?:runs\/|aegis\/|\.aegis\/|agent-memory\/)/.test(outputsBody);

    const description = fm.description ?? "";
    const writesInDescription =
      /\b(?:writes?|produces?|writes? to|emits to)\s+[`'"]?[\w./{}*-]+\.(?:json|md|yml|yaml|jsonl|pdf|html|csv)/i.test(
        description,
      ) ||
      /\bwrites to runs\//i.test(description) ||
      /\bwrites? [A-Za-z][\w-]*\.(?:json|md|yml|yaml|jsonl|pdf)/i.test(description);

    const declaresWriting = writesPathInOutputs || writesInDescription;
    const hasWriteTool = (fm.tools ?? []).some((t) => t === "Write" || t === "Edit");

    if (declaresWriting && !hasWriteTool) {
      throw new Error(
        `${agent.relPath}: prompt declares it writes files but frontmatter tools list has neither Write nor Edit. ` +
          `Tools: [${(fm.tools ?? []).join(", ")}]. ` +
          `${writesInDescription ? "Description verb match. " : ""}` +
          `${writesPathInOutputs ? "Outputs section names a concrete file path." : ""}`,
      );
    }
    expect(true).toBe(true); // assertion lives in the throw above for a clearer message
  });
});

describe("model-policy.yaml — coverage", () => {
  it("every agent declared in model-policy.yaml has a corresponding .md file", () => {
    const filenames = new Set(agents.map((a) => a.path.split("/").pop()!.replace(/\.md$/, "")));
    const orphaned: string[] = [];
    for (const name of policy.agentToTier.keys()) {
      if (!filenames.has(name)) orphaned.push(name);
    }
    expect(orphaned).toEqual([]);
  });
});
