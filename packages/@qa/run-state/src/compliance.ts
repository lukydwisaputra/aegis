import { PERSONAL_DATA_REGULATIONS, type TargetProfile } from "@qa/contracts";

/**
 * The personal-data signal Scan snapshots (spec §4.9, T3): false only when hasPersonalData and hasAuth are false and
 * personalDataSignals is empty. Conservative on purpose: any app with accounts keeps GDPR and PDPA.
 */
export function showsPersonalData(profile: Pick<TargetProfile, "hasPersonalData" | "hasAuth" | "personalDataSignals">): boolean {
  return profile.hasPersonalData || profile.hasAuth || profile.personalDataSignals.length > 0;
}

/** The configured regulations that apply to a run. An absent snapshot (a run scanned before P2b) counts as personal data. */
export function relevantRegulations(configured: readonly string[], personalData: boolean | undefined): string[] {
  const needsPersonalData = new Set<string>(PERSONAL_DATA_REGULATIONS);
  return personalData === false ? configured.filter((id) => !needsPersonalData.has(id)) : [...configured];
}

/** The agent that runs one regulation. */
export const complianceAgent = (id: string): string => `qa-compliance-${id}`;
