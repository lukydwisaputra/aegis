import { maskPath, maskPersonalData } from "./mask.js";
import type { Finding } from "./text.js";

/** How much of a record value is masked before the cut: enough that a cut never splits a value the masker would have caught. */
const MASK_PREFIX = 1000;
/** A piece of record text in a finding: personal data masked over a bounded prefix FIRST, then cut at 60 characters. */
export const snippet = (s: string): string => maskPersonalData(s.slice(0, MASK_PREFIX)).text.slice(0, 60);

/** A data finding: file run-relative (masked), line 1, kind "data". */
export const finding = (rule: string, severity: Finding["severity"], file: string, message: string, context: string): Finding =>
  ({ rule, severity, file: maskPath(file), line: 1, message, context, kind: "data" });

export const isPlain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
