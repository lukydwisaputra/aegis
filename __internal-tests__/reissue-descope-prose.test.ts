import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');

describe('the metrics collector names the out-of-scope rule and keys of coverage.json', () => {
  const collector = read('.claude/agents/crosscutting/qa-metrics-collector.md');
  const coverage = collector.slice(collector.indexOf('### Coverage'), collector.indexOf('### Defect Metrics'));

  it('says a descoped case is in none of the counts and never uncovered, and names outOfScope and descoped', () => {
    expect(coverage).toContain('- **Out of scope**: a case the owner descoped (recorded in `run.json` with its reason) is out of scope');
    expect(coverage).toContain('it is in none of the counts');
    expect(coverage).toContain('`counts` then carries `outOfScope`');
    expect(coverage).toContain('`coverage.json` carries `descoped`: one `{ caseId, reason }` per such case, sorted by id');
    expect(coverage).toContain('A requirement row whose linked cases are all descoped leaves the requirements denominator');
    expect(coverage).toContain('the cases the owner descoped (`run.json`)');
  });
});
