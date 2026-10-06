import * as fs from 'fs';
import * as path from 'path';
import { AegisEventUnionSchema } from '@qa/contracts';

/**
 * Guards against event-type drift.
 *
 * Agent and skill definitions document the events they emit. Every one of those
 * names reaches `appendChained()` in `@qa/event-bus` at runtime, which validates against
 * AegisEventSchema and THROWS on an unknown type. A name documented but not
 * declared is therefore a latent runtime failure, not a no-op.
 *
 * This test extracts every documented event name and asserts it is declared.
 */

const REPO_ROOT = path.join(__dirname, '..');
const SCAN_ROOTS = ['.claude', 'HANDBOOK', 'docs'];

// Historical planning documents record names as they were designed, not as they
// are declared today. They are intentionally frozen and excluded.
const EXCLUDED_DIRS = ['node_modules', 'superpowers', 'dist'];

// Prose tokens that match the extraction patterns but are not event types.
const NOT_EVENT_NAMES = new Set([
  'BLOCK',
  'FLAG',
  'PASS',
  'CorrectiveInstruction', // a work-report schema object, not an event
]);

// File and artefact names look like dotted event types but are not.
const FILE_SUFFIXES = [
  '.md', '.json', '.jsonl', '.ts', '.tsx', '.js', '.mjs', '.yaml', '.yml',
  '.sh', '.pdf', '.png', '.har', '.csv', '.txt', '.html', '.xml', '.zip',
  '.env', '.lock', '.lockb', '.log', '.spec', '.config',
];

// Dotted tokens that are config keys, JSON field paths, library APIs or
// standards identifiers — not events. Matched as prefixes so that e.g.
// `discovery.` covers every config key under it, while a genuine event such
// as `discovery.step-complete` stays declared and is checked normally.
const NON_EVENT_PREFIXES = [
  // config keys, addressed bare or fully qualified
  'aegis.config.json.', 'target-profile.json.',
  'dashboard.', 'discovery.', 'github.', 'target.', 'env.forbiddenSpecialists',
  'env.readOnly', 'ports.', 'engines.', 'url.', 'secretsRef.', 'reports.',
  'metrics.costSavings', 'scenario.sharedSeed',
  // NEW-07: the messaging config keys, named one by one so the messaging.* events stay checked
  'messaging.stubPort', 'messaging.dispatchTimeoutSeconds', 'messaging.fakeRecipients',
  // JSON field paths inside artefacts
  'defectMetrics.', 'resultsSummary.', 'rootCause.', 'work-report.',
  'SignoffSpec.', 'response.usage.',
  'env.baseUrl', 'env.token', // runs/{runId}/messaging/plan.json
  // target-profile.json field paths named by the scanner checklist
  'monorepo.', 'ci.provider', 'framework.', 'existingTests.', 'language.', 'supabase.',
  'messaging.provider', 'messaging.baseUrlEnv', 'messaging.tokenEnv',
  // library and framework APIs
  'Promise.', 'console.', 'page.', 'test.afterEach', 'test.beforeEach',
  'socket.io', 'use.', 'path-guard.',
  // standards identifiers and placeholders
  'WCAG-', 'RUN-',
];

function isNonEvent(name: string): boolean {
  if (FILE_SUFFIXES.some((sfx) => name.endsWith(sfx))) return true;
  return NON_EVENT_PREFIXES.some((p) => name === p || name.startsWith(p));
}

function declaredTypes(): Set<string> {
  const options = (AegisEventUnionSchema as unknown as { options: Array<{ shape: { type: { value: string } } }> }).options;
  return new Set(options.map((o) => o.shape.type.value));
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.some((d) => entry.name === d)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

interface Mention {
  name: string;
  location: string;
}

function extractMentions(file: string): Mention[] {
  const rel = path.relative(REPO_ROOT, file);
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const found: Mention[] = [];
  let inEventsSection = false;

  lines.forEach((line, idx) => {
    // Section headings: "## Events You Emit", "## Events emitted",
    // "### Events Published", "## Events You Subscribe To".
    // Subscribed events matter too: an agent waiting on a name nothing can
    // write waits forever.
    if (/^#+\s*Events?\b.*(Emit|emitted|Publish|Subscribe)/.test(line)) {
      inEventsSection = true;
      return;
    }
    if (inEventsSection && /^#+\s/.test(line)) inEventsSection = false;

    const names: string[] = [];

    // Bullet entries inside an events section: "- `foo.bar` — description".
    if (inEventsSection && line.trim().startsWith('-')) {
      const beforeDash = line.split('—')[0] ?? '';
      names.push(...matchAll(beforeDash, /`([A-Za-z][A-Za-z0-9._-]+)`/g));
    }

    // Every backticked dotted token elsewhere. Earlier versions of this test
    // matched only "emit `x`", which missed the passive and indirect
    // phrasings the documentation actually uses — "a `task.escalated` event
    // is emitted", "logs a `worktree.orphan.removed` event", "→ emit
    // `sandbox.ttl-prune`" inside a diagram. Scanning every dotted token and
    // filtering known non-events via isNonEvent() catches those.
    names.push(...matchAll(line, /`([A-Za-z][A-Za-z0-9._-]*\.[A-Za-z0-9._-]+)`/g));

    for (const name of names) {
      if (NOT_EVENT_NAMES.has(name)) continue;
      if (isNonEvent(name)) continue;
      found.push({ name, location: `${rel}:${idx + 1}` });
    }
  });

  return found;
}

function matchAll(text: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = rx.exec(text)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

describe('@qa/contracts — event type drift', () => {
  const declared = declaredTypes();
  const files = SCAN_ROOTS.flatMap((r) => {
    const abs = path.join(REPO_ROOT, r);
    return fs.existsSync(abs) ? walk(abs) : [];
  });

  it('finds documentation to scan', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('declares every event name documented as emitted or subscribed to', () => {
    const undeclared: Mention[] = [];
    for (const file of files) {
      for (const mention of extractMentions(file)) {
        if (!declared.has(mention.name)) undeclared.push(mention);
      }
    }

    if (undeclared.length > 0) {
      const grouped = new Map<string, string[]>();
      for (const { name, location } of undeclared) {
        if (!grouped.has(name)) grouped.set(name, []);
        grouped.get(name)!.push(location);
      }
      const report = [...grouped.entries()]
        .sort()
        .map(([name, locs]) => `  ${name}\n${locs.map((l) => `    ${l}`).join('\n')}`)
        .join('\n');
      throw new Error(
        `${grouped.size} event name(s) are documented as emitted/subscribed but not declared in ` +
          `AegisEventSchema. append() throws on an unknown type, so each is a latent ` +
          `runtime failure:\n${report}`
      );
    }

    expect(undeclared).toHaveLength(0);
  });

  it('uses lowercase dotted naming for every declared type', () => {
    const offenders = [...declared].filter((t) => !/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(t));
    expect(offenders).toEqual([]);
  });

  it('declares no duplicate type literals', () => {
    const options = (AegisEventUnionSchema as unknown as { options: Array<{ shape: { type: { value: string } } }> }).options;
    expect(options.length).toBe(declared.size);
  });
});
