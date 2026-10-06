import { z } from "zod";

/** NEW-07: providers a target can send messages through. An adapter id in @qa/messaging exists for each, except the two non-adapters. */
export const MESSAGING_PROVIDERS = ["commshub", "direct-mail", "none"] as const;
export type MessagingProvider = (typeof MESSAGING_PROVIDERS)[number];

/** The scanner's messaging finding: which provider, and the env names the target's client reads for base URL and key. */
export const MessagingProfileSchema = z
  .object({
    provider: z.enum(MESSAGING_PROVIDERS),
    baseUrlEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).nullable(),
    tokenEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).nullable(),
  })
  .strict();
export type MessagingProfile = z.infer<typeof MessagingProfileSchema>;
