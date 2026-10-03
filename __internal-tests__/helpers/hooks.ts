import { spawnSync } from 'child_process';
import * as path from 'path';
import { staleBuild } from '@qa/alignment';

export const REPO = path.join(__dirname, '..', '..');

/** Packages whose dist/ the hook scripts load. */
export const HOOK_BUILD = ['packages/@qa/contracts', 'packages/@qa/path-guard', 'packages/@qa/event-bus', 'packages/@qa/taskmaster-client', 'packages/@qa/run-state'];

/** Locally the hook tests need a fresh build; skip with a reason rather than fail. CI always runs them. */
export const hookStale = (): string | null => (process.env['CI'] ? null : staleBuild(REPO, HOOK_BUILD));

export interface HookRun {
  status: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

/** Run scripts/hooks/<name>.mjs with `input` as stdin JSON (or a raw string) against the aegis root `root`. */
export function runHook(name: string, input: unknown, root: string, opts: { script?: string; env?: Record<string, string | undefined> } = {}): HookRun {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [opts.script ?? path.join(REPO, 'scripts', 'hooks', `${name}.mjs`)], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf-8',
    env: { ...process.env, AEGIS_ROOT: root, ...opts.env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - t0 };
}
