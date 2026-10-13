import * as fs from 'fs';
import * as path from 'path';
import { DefectSchema } from '@qa/contracts';

// Framework gaps 5 to 7 are additive: what earlier runs wrote still parses. Each fixture is the shape an earlier run left on disk.
const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

describe('old defect record (before retestVerdict and g2Triage were in the schema)', () => {
  const { retestVerdict: _rv, g2Triage: _g2, ...oldest } = fixture('old-defect-record.json');

  it('a record with neither field still parses, and both stay unset', () => {
    const r = DefectSchema.safeParse(oldest);
    expect(r.success).toBe(true);
    expect(r.success && [r.data.retestVerdict, r.data.g2Triage]).toEqual([undefined, undefined]);
  });

  it('a record carrying them parses and keeps their keys, known and unknown', () => {
    const r = DefectSchema.safeParse(fixture('old-defect-record.json'));
    expect(r.success).toBe(true);
    expect(r.success && r.data.retestVerdict).toMatchObject({ verdict: 'REFRAMED', previousVerdict: 'NOT FIXED', triageVerification: expect.any(String) });
    expect(r.success && r.data.g2Triage).toMatchObject({ retestVerdict: 'REFRAMED', whoMustAct: 'product owner' });
  });

  it('a retestVerdict outside the vocabulary does not make the record unreadable', () => {
    const r = DefectSchema.safeParse({ ...oldest, retestVerdict: { verdict: 'FIXED WITH CONDITIONS' }, g2Triage: 'free text' });
    expect(r.success).toBe(true);
    expect(r.success && [r.data.retestVerdict, r.data.g2Triage]).toEqual([undefined, undefined]);
  });
});
