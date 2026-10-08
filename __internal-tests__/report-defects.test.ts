import { openDefectsSummary, resolveDefectFigures } from '@qa/contracts';

const rec = (status: string, severity: string | null) => ({ status: { code: status }, ...(severity === null ? {} : { severity: { code: severity } }) });
const summary = (closure: unknown, records: unknown[] | null) => openDefectsSummary(resolveDefectFigures(closure, records));

describe('openDefectsSummary prints severity names', () => {
  it('counts open records by severity name, in severity order, never a code', () => {
    const records = [rec('Triaged', 'Sev2'), rec('Reopened', 'Sev3'), rec('Closed', 'Sev1'), rec("Won't Fix", 'Sev4')];
    expect(summary({}, records)).toBe('2 open defects: 1 Critical, 1 Major');
    expect(summary({}, records)).not.toMatch(/Sev\d/);
  });

  it('names Sev1 Blocker and orders by severity, not by count', () => {
    expect(summary({}, [rec('New', 'Sev1')])).toBe('1 open defect: 1 Blocker');
    expect(summary({}, [rec('New', 'Sev4'), rec('New', 'Sev4'), rec('New', 'Sev4'), rec('New', 'Sev2')])).toBe('4 open defects: 1 Critical, 3 Minor');
  });

  it('uses closure defectMetrics.confirmedDefectsBySeverity when it accounts for confirmedOpen (records may hold more than the confirmed defects)', () => {
    const closure = { defectMetrics: { totalLogged: 30, confirmedOpen: 21, confirmedDefectsBySeverity: { Sev1: 0, Sev2: 2, Sev3: 10, Sev4: 6, Sev5: 3 } } };
    const records = Array.from({ length: 30 }, (_, i) => rec(i < 7 ? 'Closed' : 'Triaged', 'Sev3'));
    expect(summary(closure, records)).toBe('21 open defects: 2 Critical, 10 Major, 6 Minor, 3 Trivial');
  });

  it('says the breakdown is not available when the severities do not account for the open count', () => {
    expect(summary({ defectMetrics: { confirmedOpen: 3 } }, [rec('Triaged', 'Sev2')])).toBe('3 open defects; severity breakdown: not available');
    expect(summary({}, [rec('Triaged', 'Sev2'), rec('Triaged', null)])).toBe('2 open defects; severity breakdown: not available');
    expect(summary({ defectMetrics: { confirmedOpen: 2, confirmedDefectsBySeverity: { Sev2: 1 } } }, null)).toBe('2 open defects; severity breakdown: not available');
  });

  it('keeps the unknown and zero lines', () => {
    expect(summary({}, null)).toBe('Open defects: not available');
    expect(summary({ defectMetrics: { confirmedOpen: 0, totalLogged: 2 } }, [])).toBe('No open defects at sign-off.');
  });
});
