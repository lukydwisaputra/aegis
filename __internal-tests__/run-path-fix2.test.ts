import * as fs from 'fs';
import * as path from 'path';

// Run-path fix round 2 (whole-branch review of a86849a): prose pins for the defect manager, the
// executive-reporter SPV, the closure reporter and the metrics collector.
const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const AGENTS = '.claude/agents';
const DM = `${AGENTS}/tier1-phase/qa-defect-manager.md`;
const DM_SPV = `${AGENTS}/spv/qa-defect-manager-spv.md`;

describe('I1: a defect that traces to no requirement', () => {
  it('the defect manager gives it no RTM row and no defect.linked event, and lists it as untraced in the work report', () => {
    const text = read(DM);
    const step7 = text.slice(text.indexOf('7. **Link each defect'), text.indexOf('8. **Write the work report'));
    expect(step7).toContain('**Untraced defects.**');
    expect(step7).toMatch(/traces to no requirement[^\n]*no `rtm\.json` row[^\n]*no `defect\.linked` event/);
    expect(step7).toContain('`uncertainties[]` entry whose `topic` starts with `untraced:`');
    expect(step7).toContain('leaves `requirementId` and `userStory` unset');
    const events = text.slice(text.indexOf('## Events You Emit'), text.indexOf('## Concurrency'));
    expect(events).toMatch(/`defect\.linked`[^\n]*never for an untraced defect/);
  });

  it('the SPV exempts a defect with no requirementId/userStory from the RTM-link check and requires its untraced entry', () => {
    const text = read(DM_SPV);
    const check6 = text.slice(text.indexOf('6. **RTM link.**'), text.indexOf('7. **IEEE 1044'));
    expect(check6).toMatch(/no `requirementId` and no `userStory`[^\n]*exempt/);
    expect(check6).toContain('`untraced:`');
    expect(check6).toMatch(/untraced defect missing from the work report[^\n]*requested-changes/);
    const verdict = text.slice(text.indexOf('## Verdict'), text.indexOf('## Submitting Your Verdict'));
    expect(verdict).toMatch(/a traced defect missing from its RTM row/);
    expect(verdict).toMatch(/an untraced defect with no `untraced:` entry/);
  });
});
