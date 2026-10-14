import { scanPii, validNric } from '@qa/run-state';

const pii: { syntheticEmailDomains: string[]; syntheticNamePrefixes: string[]; syntheticPhonePatterns: string[] } = { syntheticEmailDomains: [], syntheticNamePrefixes: ['QA', 'Test', 'E2E', 'Dummy', 'Sample'], syntheticPhonePatterns: [] };
const rules = (text: string, p = pii) => scanPii('closure.md', text, p).map((f) => f.rule);

describe('validNric (checksum)', () => {
  it.each(['S1234567D', 'T0123456G', 'F1234567N', 'G1234567X', 'M1234567K', 'M1234521J'])('%s is valid', (n) => expect(validNric(n)).toBe(true));
  it.each(['S1234567A', 'T0123456A', 'M1234521M', 'S123456D', 'X1234567D'])('%s is not', (n) => expect(validNric(n)).toBe(false));
});

describe('NRIC', () => {
  it('a valid one is an error, a masked or partial one and a wrong check letter pass', () => {
    expect(rules('Volunteer S1234567D logged in')).toEqual(['pii-nric']);
    expect(rules('Volunteer S****567D logged in')).toEqual([]);
    expect(rules('last digits 567D')).toEqual([]);
    expect(rules('seeded S1234567A (cannot exist)')).toEqual([]);
  });
  it('never prints the value back', () => {
    const [f] = scanPii('closure.md', 'Volunteer S1234567D logged in', pii);
    expect(f!.context).toContain('S****567D');
    expect(f!.context).not.toContain('S1234567D');
  });
  it('masks every occurrence of the value in the line', () => {
    const fs = scanPii('closure.md', 'S1234567D then again S1234567D', pii);
    expect(fs.length).toBe(2);
    for (const f of fs) {
      expect(f.context).not.toContain('S1234567D');
      expect(f.context).toContain('S****567D');
    }
  });
});

describe('email', () => {
  it('passes reserved domains and declared ones, fails every other', () => {
    expect(rules('qa+1@example.com and x@mail.example.org and y@host.test and z@a.invalid')).toEqual([]);
    expect(rules('tan.ah.kow@gmail.com')).toEqual(['pii-email']);
    expect(rules('someone@werkdone.com')).toEqual(['pii-email']);
    expect(rules('qa1@qa.werkdone.example', { ...pii, syntheticEmailDomains: ['qa.werkdone.example'] })).toEqual([]);
  });
  it('never prints the address back, however often it occurs', () => {
    const fs = scanPii('closure.md', 'tan.ah.kow@gmail.com and again tan.ah.kow@gmail.com', pii);
    expect(fs.length).toBe(2);
    for (const f of fs) expect(f.context).not.toContain('tan.ah.kow@gmail.com');
  });
});

describe('phone', () => {
  it('fails a phone-shaped value unless masked or matching a declared synthetic pattern', () => {
    expect(rules('call +65 9123 4567')).toEqual(['pii-phone']);
    expect(rules('call 91234567')).toEqual(['pii-phone']);
    expect(rules('call 9123****')).toEqual([]);
    expect(rules('call +65 9100 ****')).toEqual([]);
    expect(rules('call 9100 ****')).toEqual([]);
    expect(rules('call +65 0000 0000')).toEqual(['pii-phone']); // not guaranteed fake by form: the owner declares a pattern or masks it
    expect(rules('call +65 0123 4567', { ...pii, syntheticPhonePatterns: ['^\\+65 ?0\\d{3} ?\\d{4}$'] })).toEqual([]);
  });
  it('does not mistake counts, dates, ids or versions for a phone', () => {
    expect(rules('144 cases, 2026-10-12, TC-ATT-002, build 12345678abc')).toEqual([]);
  });
  it('never prints the number back', () => {
    const [f] = scanPii('closure.md', 'call +65 9123 4567 now', pii);
    expect(f!.context).not.toContain('9123 4567');
  });
});

describe('person name', () => {
  it('flags a full name in a name field unless it carries a synthetic marker', () => {
    expect(rules('- **Name:** Tan Ah Kow')).toEqual(['pii-name']);
    expect(rules('Full name: Siti Binte Rahman')).toEqual(['pii-name']);
    expect(rules('- **Name:** QA Test Volunteer 014')).toEqual([]);
    expect(rules('- **Name:** Settings page header')).toEqual([]); // not a person: a label of the application
    expect(rules('Name: ')).toEqual([]);
  });
});
