import { scanPii, validNric } from '@qa/run-state';

const pii: { syntheticEmailDomains: string[]; syntheticNamePrefixes: string[]; syntheticPhonePatterns: string[]; syntheticValues: string[] } = { syntheticEmailDomains: [], syntheticNamePrefixes: ['QA', 'Test', 'E2E', 'Dummy', 'Sample'], syntheticPhonePatterns: [], syntheticValues: [] };
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

// ---- fix round 1 ----
const found = (text: string, p = pii) => scanPii('closure.md', text, p);
const ctxs = (text: string) => found(text).map((f) => f.context);

describe('quoted, code and fenced values are scanned (a customer reads them)', () => {
  it.each([
    ['NRIC "S1234567D" shown', ['pii-nric']],
    ['user `S1234567D`', ['pii-nric']],
    ['{"nric": "S1234567D"}', ['pii-nric']],
    ['"phone": "+65 9123 4567"', ['pii-phone']],
    ['phone `+65 9123 4567`', ['pii-phone']],
    ['"a b"@gmail.com', ['pii-email']],
    ['write `tan@gmail.com`', ['pii-email']],
    ['```\nS1234567D\n```', ['pii-nric']],
  ])('%j', (text, expected) => expect(found(text).map((f) => f.rule)).toEqual(expected));
  it('reports the real line inside a fence', () => {
    expect(found('a\n```\nb\nS1234567D\n```').map((f) => f.line)).toEqual([4]);
  });
});

describe('the context never prints another value of the line', () => {
  it('masks every detected value in every finding', () => {
    for (const text of ['x@gmail.com called 91234567', '"S1234567D" called 91234567', '+65 9123 4567 / +65 9123 4568']) {
      const fs = found(text);
      expect(fs.length).toBe(2);
      for (const f of fs) for (const v of ['x@gmail.com', 'S1234567D', '91234567', '9123 4567', '9123 4568']) expect(f.context).not.toContain(v);
    }
  });
  it('keeps the masked NRIC form S****567D', () => {
    expect(found('"S1234567D" called 91234567')[0]!.context).toContain('S****567D');
  });
  it('shows a match far into a long line, within 120 characters', () => {
    const [f] = found(`${'word '.repeat(40)}S1234567D tail`);
    expect(f!.context).toContain('S****567D');
    expect(f!.context.length).toBeLessThanOrEqual(120);
  });
  it('a name finding prints no part of the name', () => {
    expect(found('- **Name:** Tan Ah Kow')[0]!.context).toBe('Name: ***');
  });
  it('holds when the same value appears twice', () => {
    for (const f of found('tan@gmail.com tan@gmail.com 91234567 91234567 call')) expect(f.context).not.toMatch(/tan@gmail|91234567/);
  });
});

describe('email false positives and forms', () => {
  it('a package version is not an address', () => {
    expect(rules('pnpm@9.1.0, react@18.3.1 and lodash@4.17.21')).toEqual([]);
  });
  it('a trailing dot and capitals still work', () => {
    expect(rules('mail a@b.com.')).toEqual(['pii-email']);
    expect(rules('Person@Example.COM')).toEqual([]);
    expect(rules('Person@Gmail.COM')).toEqual(['pii-email']);
  });
});

describe('synthetic name prefix needs a word boundary', () => {
  it.each(['QA Test Volunteer', 'QA-Volunteer 014', 'Test_User 3', 'E2E 5', 'qa: Tan Ah'])('%s passes', (v) => expect(rules(`Name: ${v}`)).toEqual([]));
  it.each(['Qasim Abdullah', 'Testa Rossi', 'Sampler Tan', 'Dummyson Lee'])('%s is flagged', (v) => expect(rules(`Name: ${v}`)).toEqual(['pii-name']));
  it('ignores a blank prefix entry', () => {
    expect(rules('Name: Tan Ah Kow', { ...pii, syntheticNamePrefixes: ['', '  '] })).toEqual(['pii-name']);
  });
});

describe('name line numbers', () => {
  it('reports the real line', () => {
    expect(found('a\n\n\nName: Tan Ah Kow').map((f) => f.line)).toEqual([4]);
    expect(found('Name: Tan Ah Kow\nx\nName: Siti Binte Rahman').map((f) => f.line)).toEqual([1, 3]);
  });
});

describe('name heuristic', () => {
  it.each([
    'Name: Tan Ah Kow', 'Full name: Siti Binte Rahman', 'First name: Siti Aminah', 'Last name: Tan Ah', 'Surname: Tan Ah', '- **fullName:** Tan Ah Kow', '**Name**: Tan Ah Kow', 'Name : Tan Ah Kow',
    '| Name | Tan Ah Kow |', '| **Name** | Tan Ah Kow | x |', 'Name: "Tan Ah Kow"', 'Name: TAN AH KOW', "Name: Conan O'Brien", 'Name: Anne-Marie Tan', 'Name: José Garcia',
    'Name: Muhammad bin Abdullah', 'Name: Siti binte Rahman', 'Name: Raj s/o Kumar', 'Name: Tan Ah Kow Lee Mei',
  ])('%s is a person', (t) => expect(rules(t)).toEqual(['pii-name']));
  it.each([
    'Name: Volunteer Registration', 'Name: Dashboard Overview', 'Name: Settings page header', 'Name: Admin User', 'Name: Tan', 'Name: Tan Ah Kow Lee Mei Ling', 'Name: tan ah kow', 'Name: Tan 3',
    '| Name | Phone |', 'Username: Tan Ah Kow', 'Name: ', 'Name: Event Management', 'Name: Attendance Report',
  ])('%s is not', (t) => expect(rules(t)).toEqual([]));
});

describe('phone cue', () => {
  it.each(['id 86000000', '98765432 bytes', 'RM 91234567.50', 'SGD 91234567', 'ref #91234567', 'case 61234567', 'took 3000 4000 ms', 'on +2026-10-12'])('%s is not a phone', (t) => expect(rules(t)).toEqual([]));
  it.each(['Phone: 9123 4567', 'call 91234567', '+65 9123 4567', 'tel:+6591234567', '65 91234567', 'Mobile 91234567', 'x@gmail.com called 91234567', '{"contact": "91234567"}'])('%s is a phone', (t) => expect(rules(t)).toContain('pii-phone'));
  it('masked forms pass', () => {
    expect(rules('phone +65 9100 ****, 9100 ****, 9100****')).toEqual([]);
  });
  it('a table cell under a phone heading is a phone', () => {
    expect(rules('| Name | Phone |\n| --- | --- |\n| QA One | 91234567 |')).toEqual(['pii-phone']);
    expect(rules('| Name | Count |\n| --- | --- |\n| QA One | 91234567 |')).toEqual([]);
  });
});

describe('NRIC forms', () => {
  it.each(['s1234567d', 'file_S1234567D.png', 'S 1234567 D', 'S-1234567-D'])('%s is flagged', (t) => expect(rules(t)).toEqual(['pii-nric']));
  it.each(['ABCS1234567D', 'S1234567DX', 'S12345678D'])('%s is not', (t) => expect(rules(t)).toEqual([]));
  it('masks the separated form', () => {
    const [f] = found('id S 1234567 D here');
    expect(f!.context).toBe('id S****567D here');
  });
});

describe('order', () => {
  it('is by line, then rule id', () => {
    expect(rules('Name: Tan Ah Kow\nS1234567D tan@gmail.com call 91234567')).toEqual(['pii-name', 'pii-email', 'pii-nric', 'pii-phone']);
  });
});

// ---- fix round 2 ----
describe('parenthesised country code', () => {
  it.each(['(65) 9123 4567', '(+65) 9123 4567', '(65) 91234567', 'call (65) 9123 4567'])('%s is a phone with no cue needed', (t) => expect(rules(t)).toEqual(['pii-phone']));
  it('masks the number in the context', () => {
    expect(found('(+65) 9123 4567')[0]!.context).not.toContain('9123 4567');
  });
  it.each(['(65)', '65 apples', '(650) 123', '(65) 9123 456'])('%s is not', (t) => expect(rules(t)).toEqual([]));
});

describe('large tables', () => {
  it('a 5,000-row table with a Phone column is scanned in under 500 ms', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `| QA ${i} | ${String(91230000 + i)} |`);
    const text = ['| Name | Phone |', '| --- | --- |', ...rows].join('\n');
    const started = Date.now();
    const fs = found(text);
    expect(Date.now() - started).toBeLessThan(500);
    expect(fs.length).toBe(5000);
  });
});

describe('calibration C2: a package file name is not an email', () => {
  it('a version-like domain is not an address', () => {
    expect(rules('vendor-chunks/zod@3.25.76.js')).toEqual([]);
    expect(rules('lodash@4.17.21.tgz')).toEqual([]);
    expect(rules('pnpm@9.1.0')).toEqual([]);
  });
  it('a real-looking address is still flagged', () => {
    expect(rules('a@b.com')).toEqual(['pii-email']);
    expect(rules('lim@123.com')).toEqual(['pii-email']);
    expect(rules('x@gmail.com')).toEqual(['pii-email']);
  });
});

describe('calibration C4: the project declares the fake values it uses', () => {
  const declared = { ...pii, syntheticValues: ['+6500000000', 'S1234567D', 'fake.person@gmail.com', 'Tan Ah Kow'] };
  it('a declared value is never reported, whatever its spacing or case', () => {
    expect(rules('call +65 0000 0000', declared)).toEqual([]);
    expect(rules('call +6500000000', declared)).toEqual([]);
    expect(rules('Volunteer S1234567D logged in', declared)).toEqual([]);
    expect(rules('Volunteer s-1234567-d logged in', declared)).toEqual([]);
    expect(rules('mail Fake.Person@Gmail.com', declared)).toEqual([]);
    expect(rules('Name: Tan Ah Kow', declared)).toEqual([]);
  });
  it('another value of the same kind is still reported', () => {
    expect(rules('call +6591234567', declared)).toEqual(['pii-phone']);
    expect(rules('Volunteer S2345678H logged in', declared)).toEqual(['pii-nric']);
    expect(rules('mail other@gmail.com', declared)).toEqual(['pii-email']);
    expect(rules('Name: Lim Mei Ling', declared)).toEqual(['pii-name']);
  });
});
