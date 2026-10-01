import { z } from "zod";
import { NonBlank } from "./non-blank.js";
import { AcceptanceCriterionIdSchema, RunIdSchema } from "./ids.js";

// ─── Developer-test review (P0 spec §3.4, NEW-02) ─────────────────────────────

const S = NonBlank();
const N = z.number().int().nonnegative();
const Score = z.number().min(0).max(100);
const Reason = NonBlank(10).pipe(z.string().max(500));
/** A developer test: "<file path>#<test name>". */
export const DevTestRefSchema = z.string().regex(/^[^#\s][^#]*#\s*\S.*$/, "dev-test ref format: <path>#<test name>");

export const DevTestVerdictSchema = z.enum(["adequate", "weak", "wrong", "unmapped"]);
export type DevTestVerdict = z.infer<typeof DevTestVerdictSchema>;

export const DevTestEntrySchema = z
  .object({
    ref: DevTestRefSchema,
    kind: z.enum(["unit", "integration", "e2e", "api", "other"]),
    framework: S,
    // What the test exercises, named as in target-profile.json#sourceInventory.
    subject: z.object({ kind: z.enum(["route", "component", "api-handler", "function", "module"]), ref: S }).strict(),
    behaviour: NonBlank(10).pipe(z.string().max(300)),
    // Intake requirement text this behaviour maps to (acceptance criteria do not exist yet).
    requirementRefs: z.array(S).default([]),
    verdict: DevTestVerdictSchema,
    reason: Reason,
    negativePath: z.boolean(),
    // Stryker score of the subject file; unit tests only, null when mutation testing did not run.
    mutationScore: Score.nullable(),
    // The requirement a `wrong` test contradicts.
    contradicts: S.optional(),
    // Static evidence for a non-unit test: what it covers and how the reviewer established that (no mutation score exists for it).
    // The review runs before Requirements, so AC ids exist only when the intake carries them; otherwise the
    // intake requirement anchors (intake/prd.md#login) or REQ ids the assertions pin.
    coversAcIds: z.array(AcceptanceCriterionIdSchema).default([]),
    coversRequirementRefs: z.array(NonBlank(3)).default([]),
    evidenceNote: NonBlank(10).optional(),
  })
  .strict();
export type DevTestEntry = z.infer<typeof DevTestEntrySchema>;

export const MutationSummarySchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ran"),
      tool: z.literal("stryker"),
      // Owner floor: config may raise the threshold, never lower it below 60.
      threshold: z.number().min(60).max(100),
      score: Score,
      killed: N,
      survived: N,
      noCoverage: N,
      timeout: N,
      reportPath: S,
    })
    .strict(),
  z.object({ status: z.literal("skipped"), tool: z.literal("stryker"), reason: Reason }).strict(),
]);

export const DevTestGapSchema = z
  .object({
    subject: S,
    kind: z.enum(["missing-negative-path", "snapshot-only", "cannot-fail", "untested-subject", "low-mutation-score"]),
    detail: Reason,
  })
  .strict();

/** runs/{runId}/dev-test-review.json, written by qa-dev-test-reviewer. */
export const DevTestReviewSchema = z
  .object({
    runId: RunIdSchema,
    reviewedAt: z.string().datetime({ offset: false }),
    mutation: MutationSummarySchema,
    tests: z.array(DevTestEntrySchema),
    gaps: z.array(DevTestGapSchema).default([]),
    summary: z.object({ adequate: N, weak: N, wrong: N, unmapped: N }).strict(),
  })
  .strict()
  .superRefine((review, ctx) => {
    const issue = (path: Array<string | number>, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    for (const v of DevTestVerdictSchema.options) {
      const n = review.tests.filter((t) => t.verdict === v).length;
      if (review.summary[v] !== n) issue(["summary", v], `summary says ${review.summary[v]} ${v} tests; tests[] has ${n}`);
    }
    if (review.mutation.status === "ran") {
      // Stryker's mutation score: detected (killed + timeout) over valid mutants (detected + survived + no coverage).
      const m = review.mutation;
      const detected = m.killed + m.timeout;
      const valid = detected + m.survived + m.noCoverage;
      if (valid === 0) issue(["mutation"], "a run with no mutants is recorded as skipped, not ran");
      else if (Math.abs(m.score - (detected / valid) * 100) > 0.5) {
        issue(["mutation", "score"], `score ${m.score} disagrees with (killed + timeout) / (killed + timeout + survived + noCoverage) x 100 = ${((detected / valid) * 100).toFixed(2)}`);
      }
    }
    review.tests.forEach((t, i) => {
      if (t.verdict === "wrong" && t.contradicts === undefined) issue(["tests", i, "contradicts"], "a wrong test names the requirement it contradicts");
      if (t.kind !== "unit" && t.verdict === "adequate" && (t.evidenceNote === undefined || (t.coversAcIds.length === 0 && t.coversRequirementRefs.length === 0))) {
        issue(["tests", i, "evidenceNote"], "a non-unit test is adequate only with recorded static evidence: an evidenceNote and coversAcIds or coversRequirementRefs");
      }
      if (t.kind !== "unit" && t.mutationScore !== null) issue(["tests", i, "mutationScore"], "only unit tests carry a mutation score");
      if (t.kind !== "unit") return;
      if (review.mutation.status === "skipped" && t.mutationScore !== null) issue(["tests", i, "mutationScore"], "mutation testing was skipped, so the score is null");
      // Owner decision: a unit test is never adequate without mutation evidence; a skipped run leaves it weak at best.
      if (review.mutation.status === "skipped" && t.verdict === "adequate") issue(["tests", i, "verdict"], "mutation testing was skipped, so a unit test cannot be adequate without evidence");
      if (review.mutation.status === "ran" && t.verdict === "adequate" && (t.mutationScore === null || t.mutationScore < review.mutation.threshold)) {
        issue(["tests", i, "mutationScore"], `an adequate unit test needs a mutation score of at least ${review.mutation.threshold}`);
      }
    });
  });
export type DevTestReview = z.infer<typeof DevTestReviewSchema>;
