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

describe('the reporters state out-of-scope checks apart, with their reason', () => {
  it('the executive reporter, in its source-of-truth rule', () => {
    const rep = read('.claude/agents/tier1-phase/qa-executive-reporter.md');
    const source = rep.slice(rep.indexOf('**Source of truth for counts.**'), rep.indexOf('## Process'));
    expect(source).toContain('Checks the owner descoped are out of scope: `coverage.json#counts.outOfScope` counts them and `coverage.json#descoped` names each with its recorded reason.');
    expect(source).toContain('never as a gap, never among the uncovered checks, and never in the designed or attempted count');
  });

  it('the executive SPV, in check 13', () => {
    const spv = read('.claude/agents/spv/qa-executive-reporter-spv.md');
    const check13 = spv.slice(spv.indexOf('13. **Numbers.**'), spv.indexOf('## Verdict'));
    expect(check13).toContain('Out-of-scope checks (`coverage.json#counts.outOfScope`, each named in `coverage.json#descoped`) are stated separately with their recorded reason');
  });

  it('the closure reporter in step 2 and its SPV in check 3', () => {
    const closure = read('.claude/agents/tier1-phase/qa-closure-reporter.md');
    const step2 = closure.slice(closure.indexOf('2. **Read computed metrics.**'), closure.indexOf('3. **Write ISTQB closure sections.**'));
    expect(step2).toContain('Checks the owner descoped are in none of these counts');
    const spv = read('.claude/agents/spv/qa-closure-reporter-spv.md');
    const check3 = spv.slice(spv.indexOf('3. **Metrics arithmetic verification.**'), spv.indexOf('4. **Open questions section.**'));
    expect(check3).toContain('Out-of-scope checks (`coverage.json#counts.outOfScope`) are stated apart with their recorded reason');
  });

  it('the technical report skill names the Out of scope row', () => {
    expect(read('.claude/skills/_qa-report-technical-pdf/SKILL.md')).toContain('an "Out of scope" row prints that count after Undetermined; it is not part of Total Tests');
  });
});
