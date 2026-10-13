import * as fs from 'fs';
import * as path from 'path';

// Gap F: the PDPA clause catalogue carries the verified section numbers and headings (mirror of the consolidated Act; owner to confirm on SSO),
// and the SPV checks a cited section against the catalogue heading, not only against the tag regex.

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const pdpa = read('.claude/agents/compliance/qa-compliance-pdpa.md');
const catalogue = pdpa.slice(pdpa.indexOf('## PDPA Clause Catalogue'), pdpa.indexOf('## Process'));

// Section -> heading, as verified; the catalogue names each as "sN Heading".
const VERIFIED: Record<string, string> = {
  s13: 'Consent required', s14: 'Provision of consent', s15: 'Deemed consent', s15A: 'Deemed consent by notification', s16: 'Withdrawal of consent',
  s17: 'Collection, use and disclosure without consent', s18: 'Limitation of purpose and extent', s19: 'Personal data collected before 2 July 2014',
  s20: 'Notification of purpose', s21: 'Access to personal data', s22: 'Correction of personal data', s23: 'Accuracy of personal data',
  s24: 'Protection of personal data', s25: 'Retention of personal data', s26: 'Transfer of personal data outside Singapore',
  s26A: 'Interpretation', s26B: 'Notifiable data breaches', s26C: 'Duty to conduct assessment of data breach',
  s26D: 'Duty to notify occurrence of notifiable data breach', s26E: 'Obligations of data intermediary of public agency',
};

describe('PDPA clause catalogue', () => {
  it.each(Object.entries(VERIFIED))('%s is catalogued as "%s"', (section, heading) => {
    expect(catalogue).toContain(`${section} ${heading}`);
  });

  it('puts access under s21 and correction under s22, never under s20', () => {
    expect(catalogue).not.toMatch(/Section 20|s20 Access|Access and Correction/);
    expect(catalogue).toMatch(/\*\*s21 Access to personal data:\*\*\n- Users can request access/);
    expect(catalogue).toMatch(/\*\*s22 Correction of personal data:\*\*\n- Users can correct/);
  });

  it('names s26C as the duty to assess and s26D as the duty to notify, and no longer calls s26C the notification', () => {
    expect(catalogue).toMatch(/s26C Duty to conduct assessment of data breach/);
    expect(catalogue).toMatch(/s26D Duty to notify occurrence of notifiable data breach/);
    expect(pdpa).not.toMatch(/Mandatory Data Breach Notification \(Section 26C\)/);
  });

  it('keeps deemed consent (s15, s15A) apart from the legitimate-interests exception (s17) and does not guess the Schedule', () => {
    expect(catalogue).toMatch(/s17 Collection, use and disclosure without consent \(including the legitimate-interests exception\)/);
    expect(catalogue).toMatch(/Schedule citation .* not verified/);
  });

  it('covers Part 9 Do Not Call ss36-48 as PDPA-PartIX and data porting s26H only when in force', () => {
    expect(catalogue).toMatch(/Part 9 Do Not Call provisions, ss36-48 \(tag `PDPA-PartIX`\)/);
    expect(catalogue).toMatch(/s26H Data porting \(Part 6B\), when in force/);
  });

  it('states its source as the mirror of the Act, with the owner to confirm on SSO', () => {
    expect(catalogue).toMatch(/mirror of the consolidated Act \(lawplayer\.com\/sg\/act\/PDPA2012\)/);
    expect(catalogue).toMatch(/owner is to confirm them there/);
  });

  it('the knowledge synthesis and HANDBOOK agree on the same sections', () => {
    const k = read('knowledge/synthesis/compliance-and-regulations.md');
    for (const [section, heading] of Object.entries(VERIFIED)) expect(k).toContain(`${section} ${heading}`);
    expect(read('HANDBOOK/13-mechanics.md')).toMatch(/PDPA-Sec26C` \(the duty to conduct an assessment of a data breach; `PDPA-Sec26D` is the duty to notify\)/);
  });

  it('the compliance SPV checks a cited section against its catalogue heading', () => {
    const spv = read('.claude/agents/spv/qa-compliance-spv.md');
    expect(spv).toMatch(/checked against the catalogue heading it names, not only against the regex/);
    expect(spv).toMatch(/an access gap is s21, a correction gap s22, a breach assessment gap s26C, a breach notification gap s26D/);
  });
});

describe('ISO 25010 catalogue', () => {
  it('lists Security-Resistance (ISO/IEC 25010:2023) in the agent, the SPV and the knowledge table', () => {
    expect(read('.claude/agents/compliance/qa-compliance-iso25010.md')).toMatch(/accountability, resistance \(ISO\/IEC 25010:2023.*`ISO25010-Security-Resistance`\)/);
    expect(read('.claude/agents/spv/qa-compliance-spv.md')).toMatch(/accountability, authenticity and resistance/);
    expect(read('knowledge/synthesis/compliance-and-regulations.md')).toMatch(/authenticity, resistance\)/);
  });
});
