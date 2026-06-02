import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { nextId } from '@qa/ids';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-ids-test-'));
  process.env['AEGIS_COUNTERS_PATH'] = path.join(tmpDir, '.counters.json');
});

afterEach(() => {
  delete process.env['AEGIS_COUNTERS_PATH'];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('@qa/ids', () => {
  it('returns TC-AUTH-001 format for first call', async () => {
    const id = await nextId('TC', 'AUTH');
    expect(id).toMatch(/^TC-AUTH-\d{3}$/);
    expect(id).toBe('TC-AUTH-001');
  });

  it('sequential calls return incrementing IDs', async () => {
    const id1 = await nextId('TC', 'AUTH');
    const id2 = await nextId('TC', 'AUTH');
    const id3 = await nextId('TC', 'AUTH');
    expect(id1).toBe('TC-AUTH-001');
    expect(id2).toBe('TC-AUTH-002');
    expect(id3).toBe('TC-AUTH-003');
  });

  it('different kind+module combinations use independent counters', async () => {
    const tc1 = await nextId('TC', 'AUTH');
    const def1 = await nextId('DEF', 'AUTH', 'UI');
    const tc2 = await nextId('TC', 'AUTH');
    expect(tc1).toBe('TC-AUTH-001');
    expect(def1).toBe('DEF-001-AUTH-UI');
    expect(tc2).toBe('TC-AUTH-002');
  });

  it('DEF counter is global per MODULE — NNN leads and increments across types', async () => {
    const ui1 = await nextId('DEF', 'AUTH', 'UI');
    const sec2 = await nextId('DEF', 'AUTH', 'SEC');
    const ui3 = await nextId('DEF', 'AUTH', 'UI');
    const a11y1 = await nextId('DEF', 'FORM', 'A11Y');
    expect(ui1).toBe('DEF-001-AUTH-UI');
    expect(sec2).toBe('DEF-002-AUTH-SEC');
    expect(ui3).toBe('DEF-003-AUTH-UI');
    expect(a11y1).toBe('DEF-001-FORM-A11Y');
  });

  it('concurrent calls do not produce duplicate IDs', async () => {
    const ids = await Promise.all(
      Array.from({ length: 5 }, () => nextId('TC', 'CONC'))
    );
    const unique = new Set(ids);
    expect(unique.size).toBe(5);
  });

  it('pads DEF counter to 3 digits and places it first', async () => {
    const tc = await nextId('TC', 'PAD');
    const def = await nextId('DEF', 'PAD', 'UI');
    expect(tc).toMatch(/^TC-PAD-\d{3}$/);
    expect(def).toMatch(/^DEF-\d{3}-PAD-UI$/);
  });

  it('WR kind returns WR-T-{taskNumber} without a counter', async () => {
    const id = await nextId('WR', '42');
    expect(id).toBe('WR-T-42');
  });
});
