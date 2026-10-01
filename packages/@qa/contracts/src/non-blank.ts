import { z } from "zod";

/** A string with at least `min` characters once surrounding whitespace is ignored (whitespace-only text never passes). */
export const NonBlank = (min = 1) => z.string().refine((s) => s.trim().length >= min, { message: `must have at least ${min} non-blank character(s)` });
