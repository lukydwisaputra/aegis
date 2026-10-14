import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Reports what a dispatched qa-* agent actually loaded, from Claude Code's per-subagent
// transcripts. Prints names, flags and counts only, never transcript text. Read-only.

export type TranscriptMeta = { agentType: string; spawnDepth?: number | undefined };

export type TranscriptSummary = {
  agentType: string;
  spawnDepth: number | undefined;
  claudeMdLoaded: boolean;
  memoryLoaded: boolean;
  rulesCore: boolean;
  firstTurnTokens: number;
  turns: number;
};

const RULES_HEADING = 'Rules core (SubagentStart hook)';

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function summariseTranscript(lines: string[], meta: TranscriptMeta): TranscriptSummary {
  let claudeMdLoaded = false;
  let memoryLoaded = false;
  let rulesCore = false;
  const turnIds = new Set<string>();
  let firstTurnTokens = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: unknown;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!isObject(rec)) continue;

    const att = rec.attachment;
    if (isObject(att)) {
      if (Array.isArray(att.files)) {
        for (const f of att.files) {
          if (!isObject(f)) continue;
          const path = typeof f.path === 'string' ? f.path : '';
          // The path is only a fallback for a file that carries no type; a typed file is judged by its type alone.
          const untyped = f.type === undefined || f.type === null;
          if (f.type === 'Project' || (untyped && (path.endsWith('/CLAUDE.md') || path === 'CLAUDE.md'))) claudeMdLoaded = true;
          if (f.type === 'AutoMem' || (untyped && (path.endsWith('/MEMORY.md') || path === 'MEMORY.md'))) memoryLoaded = true;
        }
      }
      if (att.hookEvent === 'SubagentStart') {
        const items: unknown[] = Array.isArray(att.content) ? att.content : [att.content];
        if (items.some((c) => typeof c === 'string' && c.includes(RULES_HEADING))) rulesCore = true;
      }
    }

    if (rec.type === 'assistant' && isObject(rec.message) && typeof rec.message.id === 'string') {
      const id = rec.message.id;
      if (!turnIds.has(id)) {
        if (turnIds.size === 0) {
          const u = isObject(rec.message.usage) ? rec.message.usage : {};
          firstTurnTokens = num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens);
        }
        turnIds.add(id);
      }
    }
  }

  return { agentType: meta.agentType, spawnDepth: meta.spawnDepth, claudeMdLoaded, memoryLoaded, rulesCore, firstTurnTokens, turns: turnIds.size };
}

function defaultProjectsDir(): string {
  return join(homedir(), '.claude', 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'));
}

export function parseArgs(argv: string[]): { projectsDir: string; last: number } {
  let projectsDir = defaultProjectsDir();
  let last = 5;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    const eq = a.indexOf('=');
    const key = eq === -1 ? a : a.slice(0, eq);
    const val = eq === -1 ? argv[i + 1] : a.slice(eq + 1);
    if (key === '--projects-dir' && val) {
      projectsDir = val;
      if (eq === -1) i++;
    } else if (key === '--last' && val !== undefined) {
      const n = Number.parseInt(val, 10);
      if (Number.isInteger(n) && n > 0) last = n;
      if (eq === -1) i++;
    }
  }
  return { projectsDir, last };
}

type Found = { jsonl: string; metaPath: string; mtime: number };

// Claude Code lays transcripts out as <project dir>/<session id>/subagents/agent-<id>.jsonl
// with a sibling agent-<id>.meta.json: --projects-dir is the project dir.
function listTranscripts(projectsDir: string): Found[] {
  const found: Found[] = [];
  let sessions: string[];
  try { sessions = readdirSync(projectsDir); } catch { return found; }
  for (const session of sessions) {
    const dir = join(projectsDir, session, 'subagents');
    let names: string[];
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!/^agent-.*\.jsonl$/.test(name)) continue;
      const jsonl = join(dir, name);
      try {
        found.push({ jsonl, metaPath: jsonl.replace(/\.jsonl$/, '.meta.json'), mtime: statSync(jsonl).mtimeMs });
      } catch { /* unreadable: skip */ }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

function readMeta(path: string): TranscriptMeta | undefined {
  try {
    const m = JSON.parse(readFileSync(path, 'utf8'));
    if (!isObject(m) || typeof m.agentType !== 'string' || !/^qa-/.test(m.agentType)) return undefined;
    return { agentType: m.agentType, spawnDepth: typeof m.spawnDepth === 'number' ? m.spawnDepth : undefined };
  } catch { return undefined; }
}

export function collectTranscripts(projectsDir: string, last: number): TranscriptSummary[] {
  const out: TranscriptSummary[] = [];
  for (const f of listTranscripts(projectsDir)) {
    if (out.length >= last) break;
    const meta = readMeta(f.metaPath);
    if (!meta) continue;
    try { out.push(summariseTranscript(readFileSync(f.jsonl, 'utf8').split('\n'), meta)); } catch { /* unreadable: skip */ }
  }
  return out;
}

const yn = (b: boolean): string => (b ? 'yes' : 'no');

export function renderSummary(s: TranscriptSummary): string {
  return [
    /^qa-[a-z0-9-]+$/.test(s.agentType) ? s.agentType : '(non-qa)',
    `spawnDepth: ${s.spawnDepth ?? 'unknown'}`,
    `claudeMdLoaded: ${yn(s.claudeMdLoaded)}`,
    `memoryLoaded: ${yn(s.memoryLoaded)}`,
    `rulesCore: ${yn(s.rulesCore)}`,
    `firstTurnTokens: ${s.firstTurnTokens}`,
    `turns: ${s.turns}`,
  ].join('  ');
}

function main(): void {
  const { projectsDir, last } = parseArgs(process.argv.slice(2));
  const rows = collectTranscripts(projectsDir, last);
  if (rows.length === 0) {
    console.log(`no qa-* subagent transcripts under ${projectsDir}`);
    return;
  }
  for (const r of rows) console.log(renderSummary(r));
}

if (require.main === module) main();
