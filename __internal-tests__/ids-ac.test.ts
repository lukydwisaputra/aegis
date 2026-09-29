import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { nextId } from '@qa/ids';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-ids-ac-'));
  process.env['AEGIS_COUNTERS_PATH'] = path.join(tmpDir, '.counters.json');
});

afterEach(() => {
  delete process.env['AEGIS_COUNTERS_PATH'];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('@qa/ids — AC kind', () => {
  it('mints AC ids per story and category', async () => {
    expect(await nextId('AC', 'STORY-AUTH-003', 'happy')).toBe('AC-AUTH-003-H1');
    expect(await nextId('AC', 'STORY-AUTH-003', 'happy')).toBe('AC-AUTH-003-H2');
    expect(await nextId('AC', 'STORY-AUTH-003', 'rejection')).toBe('AC-AUTH-003-R1');
    expect(await nextId('AC', 'STORY-AUTH-003', 'edge')).toBe('AC-AUTH-003-E1');
  });

  it('keeps counters independent between stories', async () => {
    await nextId('AC', 'STORY-AUTH-003', 'happy');
    expect(await nextId('AC', 'STORY-AUTH-004', 'happy')).toBe('AC-AUTH-004-H1');
  });

  it('rejects an unknown category', async () => {
    await expect(nextId('AC', 'STORY-AUTH-003', 'sad' as never)).rejects.toThrow(/category/);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('rejects inherited key %s as a category', async (key) => {
    await expect(nextId('AC', 'STORY-AUTH-003', key as never)).rejects.toThrow(/category must be happy\|rejection\|edge/);
  });

  it('rejects a malformed story id', async () => {
    await expect(nextId('AC', 'US-AUTH-003', 'happy')).rejects.toThrow();
  });
});

describe('@qa/ids — RUN kind', () => {
  it('mints RUN-YYYYMMDD-NNN', async () => {
    expect(await nextId('RUN', '20260929')).toBe('RUN-20260929-001');
    expect(await nextId('RUN', '20260929')).toBe('RUN-20260929-002');
  });
});
