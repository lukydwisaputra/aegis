import { Command } from "commander";
import { assertCallerAllowed, parseHelperList, vendorHelpers } from "@qa/run-state";
import { action, context } from "./_io.js";

export function helpersCommand(): Command {
  const helpers = new Command("helpers").description("Copy the shared QA helpers into the target's QA tests");

  helpers
    .command("vendor")
    .description("Copy packages/@qa/<name>/src/index.ts to <testsDir>/support/<name>.ts; idempotent, reports drift")
    .requiredOption("--helpers <list>", "comma-separated helper names: test-helpers, supabase")
    .action(
      action(async (o: { helpers: string }) => {
        const ctx = context();
        assertCallerAllowed(ctx.caller, "helpers.vendor");
        return vendorHelpers(ctx.root, parseHelperList(o.helpers));
      })
    );

  return helpers;
}
