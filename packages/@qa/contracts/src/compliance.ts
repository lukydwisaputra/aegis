/** The regulations aegis.config.json#compliance may list; each has one qa-compliance-<id> agent. */
export const COMPLIANCE_REGULATIONS = ["iso25010", "iso5055", "istqb", "cmmi", "gdpr", "pdpa"] as const;
export type ComplianceRegulation = (typeof COMPLIANCE_REGULATIONS)[number];

/** Regulations that apply only when the target profile shows personal data (AUD-055, spec §4.9). */
export const PERSONAL_DATA_REGULATIONS: readonly ComplianceRegulation[] = ["gdpr", "pdpa"];
