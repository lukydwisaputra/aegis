/** The regulations aegis.config.json#compliance may list; each has one qa-compliance-<id> agent. */
export const COMPLIANCE_REGULATIONS = ["iso25010", "iso5055", "istqb", "cmmi", "gdpr", "pdpa"] as const;
export type ComplianceRegulation = (typeof COMPLIANCE_REGULATIONS)[number];

/** Regulations that apply only when the target profile shows personal data (AUD-055, spec §4.9). */
export const PERSONAL_DATA_REGULATIONS: readonly ComplianceRegulation[] = ["gdpr", "pdpa"];

/** The agent that runs one regulation (one template for the role table and the Compliance barrier). */
export const complianceAgent = (id: string): string => `qa-compliance-${id}`;
