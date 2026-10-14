import { Command } from "commander";
import { exploreProbe, RunStateError, type FetcherFactory } from "@qa/run-state";
import { action, context, runIdFor } from "./_io.js";

/**
 * Until the Playwright page fetcher lands, no page can be visited: a baseline is recorded as unavailable and a probe answers full,
 * which is what a run without a baseline does today. The factory is only called after the caller and carried checks.
 */
const noFetcher: FetcherFactory = async () => {
  throw new RunStateError("invalid-input", "no page fetcher is available in this build");
};

/** The Explore baseline and the probe that verifies carried-over discovery against the running app. */
export function exploreCommand(): Command {
  const explore = new Command("explore").description("Compare the running app with the pages the explorer visited");

  explore
    .command("probe")
    .description("Verify carried-over discovery (writes reports/explore/probe.json and decides reuse, partial or full), or take the baseline with --baseline")
    .option("--baseline", "take the baseline of the explored pages (while Explore is in progress, after the explorer's review passed)")
    .option("--run <id>", "run id (defaults to the active run)")
    .action(
      action(async (o: { baseline?: boolean; run?: string }) => {
        const ctx = context();
        return exploreProbe(ctx.root, runIdFor(ctx, o.run), ctx.caller, noFetcher, { baseline: o.baseline === true });
      })
    );

  return explore;
}
