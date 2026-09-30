import { findAegisRoot, resolveCaller, resolveRunId, RunStateError } from "@qa/run-state";

export interface Ctx {
  root: string;
  caller: string;
}

export function context(): Ctx {
  return { root: findAegisRoot(), caller: resolveCaller() };
}

export function runIdFor(ctx: Ctx, explicit: string | undefined): string {
  return resolveRunId(ctx.root, explicit);
}

/** Wrap a commander action: print the result as JSON; map refusals to exit 2, crashes to exit 1. */
export function action<A extends unknown[]>(fn: (...args: A) => unknown) {
  return async (...args: A): Promise<void> => {
    try {
      const out = await fn(...args);
      if (out !== undefined) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    } catch (e) {
      if (e instanceof RunStateError) {
        process.stderr.write(JSON.stringify({ error: e.code, message: e.message }) + "\n");
        process.exitCode = 2;
        return;
      }
      process.stderr.write(JSON.stringify({ error: "internal", message: (e as Error).message }) + "\n");
      process.exitCode = 1;
    }
  };
}
