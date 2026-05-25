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
    const def1 = await nextId('DEF', 'AUTH');
    const tc2 = await nextId('TC', 'AUTH');
    expect(tc1).toBe('TC-AUTH-001');
    expect(def1).toBe('DEF-AUTH-0001');
    expect(tc2).toBe('TC-AUTH-002');
  });

  it('concurrent calls do not produce duplicate IDs', async () => {
    const ids = await Promise.all(
      Array.from({ length: 5 }, () => nextId('TC', 'CONC'))
    );
    const unique = new Set(ids);
    expect(unique.size).toBe(5);
  });

  it('pads counter to correct width per kind', async () => {
    const tc = await nextId('TC', 'PAD');
    const def = await nextId('DEF', 'PAD');
    expect(tc).toMatch(/TC-PAD-\d{3}$/);
    expect(def).toMatch(/DEF-PAD-\d{4}$/);
  });

  it('WR kind returns WR-T-{taskNumber} without a counter', async () => {
    const id = await nextId('WR', '42');
    expect(id).toBe('WR-T-42');
  });
});
