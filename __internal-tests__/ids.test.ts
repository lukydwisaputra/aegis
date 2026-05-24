import { nextId, resetCounters } from '@qa/ids';

describe('@qa/ids', () => {
  beforeEach(() => {
    // Reset counters between tests for isolation
    resetCounters?.();
  });

  it('returns TC-AUTH-001 format for first call', () => {
    const id = nextId('TC', 'AUTH');
    expect(id).toMatch(/^TC-AUTH-\d{3}$/);
    expect(id).toBe('TC-AUTH-001');
  });

  it('sequential calls return incrementing IDs', () => {
    const id1 = nextId('TC', 'AUTH');
    const id2 = nextId('TC', 'AUTH');
    const id3 = nextId('TC', 'AUTH');
    expect(id1).toBe('TC-AUTH-001');
    expect(id2).toBe('TC-AUTH-002');
    expect(id3).toBe('TC-AUTH-003');
  });

  it('different kind+scope combinations use independent counters', () => {
    const tc1 = nextId('TC', 'AUTH');
    const bg1 = nextId('BG', 'AUTH');
    const tc2 = nextId('TC', 'AUTH');
    expect(tc1).toBe('TC-AUTH-001');
    expect(bg1).toBe('BG-AUTH-001');
    expect(tc2).toBe('TC-AUTH-002');
  });

  it('concurrent calls do not produce duplicates', async () => {
    const calls = Array.from({ length: 5 }, () =>
      Promise.resolve(nextId('TC', 'CONC'))
    );
    const ids = await Promise.all(calls);
    const unique = new Set(ids);
    expect(unique.size).toBe(5);
  });

  it('throws on invalid kind', () => {
    expect(() => nextId('', 'AUTH')).toThrow();
    expect(() => nextId('TOOLONGKIND', 'AUTH')).toThrow();
  });

  it('throws on invalid scope', () => {
    expect(() => nextId('TC', '')).toThrow();
  });

  it('pads counter to 3 digits', () => {
    const id = nextId('TC', 'PAD');
    expect(id).toMatch(/\d{3}$/);
  });
});
