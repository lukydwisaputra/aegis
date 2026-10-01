import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface TmpAegis {
  root: string;
  cleanup(): void;
}

/** A throwaway aegis root with a minimal config and isolated ID counters. */
export function makeAegisRoot(opts: { maxSpecialists?: number; environments?: Record<string, unknown> } = {}): TmpAegis {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-rs-'));
  fs.writeFileSync(
    path.join(root, 'aegis.config.json'),
    JSON.stringify({
      profile: 'full',
      parallelism: { maxSpecialists: opts.maxSpecialists ?? 2 },
      environments: opts.environments ?? {
        development: { url: 'http://localhost:5173', mutating: true },
        production: { url: 'https://example.com', mutating: false },
      },
    }),
  );
  process.env['AEGIS_COUNTERS_PATH'] = path.join(root, '.aegis', '.counters.json');
  return {
    root,
    cleanup() {
      delete process.env['AEGIS_COUNTERS_PATH'];
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Last element of a non-empty array (avoids Array.prototype.at, which needs lib ES2022). */
export function last<T>(xs: T[]): T {
  return xs[xs.length - 1]!;
}

/** The `code` of whatever `fn` throws, or undefined if it does not throw. */
export function thrownCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

/** A created run with Intake in progress, so tasks can be added and claimed (CO-08). */
export async function startedRun(root: string, cycleType: 'full' | 'smoke' = 'full', environment = 'development'): Promise<string> {
  const { createRun, startPhase } = await import('@qa/run-state');
  const { runId } = await createRun(root, { environment, modules: ['AUTH'], cycleType }, 'owner');
  await startPhase(root, runId, 'intake', 'qa-orchestrator');
  return runId;
}
