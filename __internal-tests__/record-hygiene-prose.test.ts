import * as fs from 'fs';
import * as path from 'path';

// Gaps D and E: record hygiene rules are in the agent text and its SPV checklist.
const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '.claude', 'agents', rel), 'utf8');

describe('defect manager: the triage summary is re-read against the latest results', () => {
  it('the agent re-reads the summary and checks each section statement before the work report', () => {
    const t = read('tier1-phase/qa-defect-manager.md');
    expect(t).toMatch(/Re-read the triage summary before the work report/);
    expect(t).toMatch(/was not scanned/);
    expect(t).toMatch(/check each section statement against the current `cases\/\*-result\*\.json` and `defects\/\*\.json` before you submit/);
    expect(t).toMatch(/A section of `defects\/triage-summary\.md`.*left uncorrected/);
  });
  it('the SPV requests changes for a stale statement', () => {
    expect(read('spv/qa-defect-manager-spv.md')).toMatch(/\*\*Triage summary current\.\*\*.*= requested-changes/);
  });
});

describe('closure reporter: no drafting history in the customer-facing closure', () => {
  it('the agent and its SPV forbid it', () => {
    expect(read('tier1-phase/qa-closure-reporter.md')).toMatch(/never narrates its own drafting history.*no review statistics, no attempt or rejection counts/);
    expect(read('tier1-phase/qa-closure-reporter.md')).toMatch(/narrates its own drafting history \(Lessons Learned bullets/);
    expect(read('spv/qa-closure-reporter-spv.md')).toMatch(/how the closure report itself was drafted or revised, review statistics or attempt counts.*= requested-changes/);
  });
});
