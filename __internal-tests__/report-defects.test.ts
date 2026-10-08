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

describe('resolveDefectFigures: closed comes from the records, Flagged-for-owner is neither open nor closed', () => {
  it('the real run shape: 21 open + 7 closed + 2 flagged = 30 records gives open 21 and closed 7, not 9', () => {
    const closure = { defectMetrics: { totalLogged: 30, confirmedOpen: 21 } };
    const records = [
      ...Array.from({ length: 21 }, () => rec('Triaged', 'Sev3')),
      ...Array.from({ length: 7 }, () => rec('Closed', 'Sev3')),
      ...Array.from({ length: 2 }, () => rec('Flagged-for-owner', 'Sev3')),
    ];
    expect(resolveDefectFigures(closure, records)).toMatchObject({ open: 21, closed: 7 });
  });

  it('without closure figures, a flagged record is neither open nor closed and its severity is not an open severity', () => {
    const records = [rec('Triaged', 'Sev2'), rec('Flagged-for-owner', 'Sev1'), rec('Closed', 'Sev3'), rec('Verified', 'Sev4')];
    expect(resolveDefectFigures({}, records)).toMatchObject({ open: 1, closed: 2, highestOpenSeverity: 'Sev2', openBySeverity: { Sev2: 1 } });
  });

  it('the open figure still honours confirmedOpen over the records', () => {
    expect(resolveDefectFigures({ defectMetrics: { confirmedOpen: 5, totalLogged: 9 } }, [rec('Triaged', 'Sev3'), rec('Closed', 'Sev3')])).toMatchObject({ open: 5, closed: 1 });
  });

  it('with no records, closed is totalLogged minus confirmedOpen; with neither, null', () => {
    expect(resolveDefectFigures({ defectMetrics: { confirmedOpen: 5, totalLogged: 9 } }, null)).toMatchObject({ open: 5, closed: 4 });
    expect(resolveDefectFigures({ defectMetrics: { confirmedOpen: 5, totalLogged: 9 } }, [])).toMatchObject({ open: 5, closed: 4 });
    expect(resolveDefectFigures({ defectMetrics: { confirmedOpen: 5 } }, null)).toMatchObject({ open: 5, closed: null });
    expect(resolveDefectFigures({}, null)).toMatchObject({ open: null, closed: null });
  });

  it('a record with no status is not counted closed', () => {
    expect(resolveDefectFigures({ defectMetrics: { confirmedOpen: 2 } }, [rec('Closed', 'Sev3'), {}, rec('Triaged', 'Sev3')])).toMatchObject({ open: 2, closed: 1 });
  });
});

describe('resolveDefectFigures: a run with an empty defects directory', () => {
  it('has no open and no closed defects, whether or not the closure says totalLogged is 0', () => {
    expect(resolveDefectFigures({}, [])).toMatchObject({ open: 0, closed: 0 });
    expect(resolveDefectFigures({ defectMetrics: { totalLogged: 0 } }, [])).toMatchObject({ open: 0, closed: 0 });
    expect(summary({}, [])).toBe('No open defects at sign-off.');
    expect(summary({ defectMetrics: { totalLogged: 0 } }, [])).toBe('No open defects at sign-off.');
  });

  it('a run with no defects directory at all stays not available', () => {
    expect(resolveDefectFigures({ defectMetrics: { totalLogged: 0 } }, null)).toMatchObject({ open: null, closed: null });
  });
});
