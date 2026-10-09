import * as fs from 'fs';
import * as path from 'path';
import { CLI_RECORDS } from '@qa/alignment';

// Exact mirror of @qa/run-state: the event types each command's entry function appends, following
// calls into other run-state functions (blockRun, escalateOnce, resumeLocked, …).
const SRC = path.join(__dirname, '..', '..', 'packages', '@qa', 'run-state', 'src');
const source = fs.readdirSync(SRC).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(path.join(SRC, f), 'utf-8')).join('\n');
const DEFINED = new Set([...source.matchAll(/\bfunction ([A-Za-z0-9_]+)\(/g)].map((m) => m[1]!));

/** Body of a top-level function: from `function NAME(` to the first line that is exactly `}`. */
function body(name: string): string {
  const start = source.search(new RegExp(`\\bfunction ${name}\\(`));
  if (start === -1) throw new Error(`run-state has no function ${name}`);
  const end = source.indexOf('\n}\n', start);
  return source.slice(start, end === -1 ? undefined : end);
}

function recorded(name: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(name)) return out;
  seen.add(name);
  const b = body(name);
  for (const m of b.matchAll(/\btype: "([a-z][a-z0-9.-]*)"/g)) out.add(m[1]!);
  for (const m of b.matchAll(/\b([A-Za-z0-9_]+)\(/g)) if (m[1] !== name && DEFINED.has(m[1]!)) for (const t of recorded(m[1]!, seen)) out.add(t);
  return out;
}

const ENTRY: Record<string, string> = {
  'run.create': 'createRun',
  'run.stop': 'requestStop',
  'run.resume': 'resumeRun',
  'task.claim': 'claimTask',
  'task.release': 'releaseTask',
  'task.cancel': 'cancelTask',
  'work-report.submit': 'submitWorkReport',
  'review.submit': 'submitReview',
  'integrity.verify': 'verifyRunIntegrity',
  'integrity.repair-tail': 'repairTail',
  'phase.start': 'startPhase',
  'phase.complete': 'completePhase',
  'run.complete': 'completeRun',
  'run.reissue': 'reissueRun',
  'run.descope': 'descopeRun',
  'gate.open': 'openGate',
  'gate.decide': 'decideGate',
  'gate.auto-decide': 'autoDecideGate',
  'escalation.decide': 'decideEscalation',
  'messaging.fetch-contract': 'fetchContract',
  'messaging.exec': 'execWithMessaging',
};

describe('CLI_RECORDS mirrors @qa/run-state exactly (AH-14)', () => {
  it('lists exactly the commands that record events', () => {
    expect(Object.keys(CLI_RECORDS).sort()).toEqual(Object.keys(ENTRY).sort());
  });
  for (const [cmd, fn] of Object.entries(ENTRY)) {
    it(`${cmd} (${fn}) records exactly CLI_RECORDS["${cmd}"]`, () => {
      expect([...recorded(fn)].sort()).toEqual([...(CLI_RECORDS[cmd] ?? [])].sort());
    });
  }
});
