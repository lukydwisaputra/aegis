import { z } from "zod";
import { AcceptanceCriterionIdSchema, RequirementIdSchema, StoryIdSchema } from "./ids.js";

// ─── User stories and acceptance criteria (P0 spec §3.3, NEW-01) ──────────────

export const AcceptanceCategorySchema = z.enum(["happy", "rejection", "edge"]);
export type AcceptanceCategory = z.infer<typeof AcceptanceCategorySchema>;

/** The letter an AC id carries for its category: AC-AUTH-003-H1 / -R1 / -E1. */
export const ACCEPTANCE_LETTER: Readonly<Record<AcceptanceCategory, "H" | "R" | "E">> = { happy: "H", rejection: "R", edge: "E" };

const Clause = z.string().min(3);
const Reason = z.string().min(10);

export const AcceptanceCriterionSchema = z
  .object({
    id: AcceptanceCriterionIdSchema,
    category: AcceptanceCategorySchema,
    given: Clause,
    when: Clause,
    then: Clause,
  })
  .strict();
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

/** runs/{runId}/stories/{STORY-ID}.json, written by qa-requirements-analyst. */
export const UserStorySchema = z
  .object({
    id: StoryIdSchema,
    asA: Clause,
    iWant: Clause,
    soThat: Clause,
    source: z.object({ kind: z.enum(["intake", "derived"]), ref: z.string().min(1) }).strict(),
    // true → Gate 1 asks the owner to confirm the story.
    derived: z.boolean(),
    requirementIds: z.array(RequirementIdSchema).default([]),
    acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
    // Why a story has no rejection or no edge criterion; silent omission is refused.
    notApplicable: z.object({ rejection: Reason.optional(), edge: Reason.optional() }).strict().optional(),
  })
  .strict()
  .superRefine((story, ctx) => {
    const issue = (path: Array<string | number>, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (story.derived !== (story.source.kind === "derived")) issue(["derived"], "derived must be true exactly when source.kind is derived");
    const prefix = `AC-${story.id.slice("STORY-".length)}-`;
    const seen = new Set<string>();
    story.acceptanceCriteria.forEach((ac, i) => {
      if (!ac.id.startsWith(prefix)) issue(["acceptanceCriteria", i, "id"], `${ac.id} does not belong to ${story.id} (expected ${prefix}…)`);
      else if (ac.id.charAt(prefix.length) !== ACCEPTANCE_LETTER[ac.category]) issue(["acceptanceCriteria", i, "id"], `a ${ac.category} criterion id carries ${ACCEPTANCE_LETTER[ac.category]}`);
      if (seen.has(ac.id)) issue(["acceptanceCriteria", i, "id"], `duplicate criterion id ${ac.id}`);
      seen.add(ac.id);
    });
    const count = (c: AcceptanceCategory) => story.acceptanceCriteria.filter((ac) => ac.category === c).length;
    if (count("happy") === 0) issue(["acceptanceCriteria"], "a story needs at least one happy criterion");
    for (const c of ["rejection", "edge"] as const) {
      const reason = story.notApplicable?.[c];
      if (count(c) === 0 && reason === undefined) issue(["notApplicable", c], `no ${c} criterion: give the reason in notApplicable`);
      if (count(c) > 0 && reason !== undefined) issue(["notApplicable", c], `${c} criteria exist, so notApplicable must not name ${c}`);
    }
  });
export type UserStory = z.infer<typeof UserStorySchema>;
