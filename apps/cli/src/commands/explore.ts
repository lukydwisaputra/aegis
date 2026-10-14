import { Command } from "commander";
import { exploreProbe, type FetcherFactory } from "@qa/run-state";
import { makePlaywrightFetcher } from "../explore-fetcher.js";
import { action, context, runIdFor } from "./_io.js";

/** Resolves once everything written to `stream` so far has been handed to the OS (a pipe on macOS is asynchronous). */
const flushed = (stream: NodeJS.WriteStream): Promise<void> => new Promise((res) => stream.write("", () => res()));

/** The Explore baseline and the probe that verifies carried-over discovery against the running app. */
export function exploreCommand(): Command {
  const explore = new Command("explore").description("Compare the running app with the pages the explorer visited");

  explore
    .command("probe")
    .description("Verify carried-over discovery (writes reports/explore/probe.json and decides reuse, partial or full), or take the baseline with --baseline")
    .option("--baseline", "take the baseline of the explored pages (while Explore is in progress, after the explorer's review passed)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(async (...args: [{ baseline?: boolean; run?: string }, Command]) => {
      let started = false;
      await action(async (o: { baseline?: boolean; run?: string }, _cmd: Command) => {
        const ctx = context();
        const runId = runIdFor(ctx, o.run);
        // Called by the probe only after the caller and carried checks: a refusal never starts a browser.
        const factory: FetcherFactory = () => {
          started = true;
          return makePlaywrightFetcher(ctx.root, runId);
        };
        return exploreProbe(ctx.root, runId, ctx.caller, factory, { baseline: o.baseline === true });
      })(...args);
      // A browser that did not close (or a Playwright handle left open) must not keep the CLI alive until the caller's timeout:
      // once the result is printed and flushed, the process ends with the exit code the action set.
      if (started) {
        await flushed(process.stdout);
        await flushed(process.stderr);
        process.exit();
      }
    });

  return explore;
}
