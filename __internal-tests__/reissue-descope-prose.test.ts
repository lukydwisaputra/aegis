import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { extractContract } from '@qa/alignment';

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

  it('says noData also covers a run whose every designed case is descoped, and that outOfScope and descoped survive it', () => {
    expect(coverage).toContain('or every designed case is descoped.');
    expect(coverage).toContain('all zero when `noData` is true except `outOfScope`');
    expect(coverage).toContain('also when `noData` is true, see Out of scope');
  });
});

describe('the reporters state out-of-scope checks apart, with their reason', () => {
  it('the executive reporter, in its source-of-truth rule', () => {
    const rep = read('.claude/agents/tier1-phase/qa-executive-reporter.md');
    const source = rep.slice(rep.indexOf('**Source of truth for counts.**'), rep.indexOf('## Process'));
    expect(source).toContain('Checks the owner descoped are out of scope: `coverage.json#counts.outOfScope` counts them and `coverage.json#descoped` names each with its recorded reason.');
    expect(source).toContain('never as a gap, never among the uncovered checks, and never in the designed or attempted count');
  });

  it('the executive reporter runs the quoted out-of-scope reason through the tone check and the brand check', () => {
    const rep = read('.claude/agents/tier1-phase/qa-executive-reporter.md');
    const source = rep.slice(rep.indexOf('**Source of truth for counts.**'), rep.indexOf('## Process'));
    expect(source).toContain('The recorded reason you quote goes through the tone check and the brand check like every other sentence; reword it when it fails either.');
  });

  it('the executive SPV, in check 13', () => {
    const spv = read('.claude/agents/spv/qa-executive-reporter-spv.md');
    const check13 = spv.slice(spv.indexOf('13. **Numbers.**'), spv.indexOf('## Verdict'));
    expect(check13).toContain('Out-of-scope checks (`coverage.json#counts.outOfScope`, each named in `coverage.json#descoped`) are stated separately with their recorded reason');
    expect(check13).toContain('Omitting a nonzero `coverage.json#counts.outOfScope` from the narrative, or stating it without its recorded reason, is requested-changes too.');
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

const contractOf = (md: string): Record<string, unknown> => {
  const c = extractContract(md);
  if (typeof c === 'string') throw new Error(c);
  return parse(c.yaml) as Record<string, unknown>;
};

describe('the orchestrator runs a reissue of any phase after Gate 1', () => {
  const orch = read('.claude/agents/orchestrator/qa-orchestrator.md');

  it('names reset gates, the case list and the re-decision, and keeps the second run.completed', () => {
    expect(orch).toContain('a completed full run the owner reissued from a phase after Gate 1');
    expect(orch).toContain('every gate after it is `reset` (decided before, it needs a new owner decision');
    expect(orch).toContain('When the `reissue` record of `aegis run status` lists `cases`');
    expect(orch).toContain('never treat the earlier decision as standing');
    expect(orch).toContain('After a gate rejection or a reissue the tasks of the reopened phases already exist as `pending`');
    expect(orch).toContain('a second `run.completed`');
  });

  it('a reset gate is neither open nor approved, and the case list lapses at a gate rejection', () => {
    expect(orch).toContain('a reset gate is neither open nor approved');
    expect(orch).toContain('`next` is `open-gate` for the gate the reissue reset');
    expect(orch).toContain('The case list applies only until a gate rejection or a completed run: when the event log holds a `gate.decided` with decision rejected or a `run.completed` after the latest `run.reissued`, ignore the `cases` of the `reissue` record');
    // Step 5, the gate-rejection path, points to step 9 for the lapsed case list.
    const step5 = orch.slice(orch.indexOf('5. **Open the gates; never decide them.**'), orch.indexOf('6. **Leave the specialist cap to the CLI.**'));
    expect(step5).toContain("Inside a reissued cycle a rejection also lapses the reissue's case list: step 9 says what the `qa-test-executor` brief then states.");
  });

  it('a lapsed case list is announced in the executor brief with the sentence the executor matches', () => {
    const exec = read('.claude/agents/tier1-phase/qa-test-executor.md');
    const sentence = 'the owner rejected a gate after the reissue, so run what the rejection note names; nothing is carried forward by scope';
    expect(orch).toContain(`say so in the brief of \`qa-test-executor\`: after a rejection "${sentence}"`);
    expect(exec).toContain(`your brief says "${sentence}"`);
    // A run.completed after the latest run.reissued lapses the list too, with one sentence the orchestrator and the executor share.
    const completed = 'the reissued run completed since, so nothing is carried forward by scope';
    expect(orch).toContain(`after a completed run \"${completed}\"`);
    expect(exec).toContain(`or \"${completed}\"`);
  });

  it('its SPV accepts a restart after run.reissued', () => {
    const spv = read('.claude/agents/spv/qa-orchestrator-spv.md');
    const check2 = spv.slice(spv.indexOf('2. **Phase order.**'), spv.indexOf('3. **SPV coverage.**'));
    expect(check2).toContain('After a `run.reissued` the phases restart from its `phase`');
  });
});

describe('the executor runs a scoped re-execution', () => {
  const exec = read('.claude/agents/tier1-phase/qa-test-executor.md');

  it('reads the case list from aegis run status, carries the rest forward and names the scope', () => {
    expect(exec).toContain('Then run `aegis run status`: when its `reissue` record lists `cases`');
    expect(exec).toContain('gets a carry-forward attempt');
    expect(exec).toContain('In a scoped re-execution the summary names the scope');
    expect((contractOf(exec) as { cli: string[] }).cli).toContain('run.status');
  });

  it('the case list lapses at a gate rejection', () => {
    expect(exec).toContain('The case list applies only until a gate rejection or a completed run');
    expect(exec).toContain('the event log holds a `gate.decided` with decision rejected or a `run.completed` after the latest `run.reissued`');
    expect(exec).toContain('ignore the `cases` of the `reissue` record');
  });

  it('its SPV reads run.json and checks the scope', () => {
    const spv = read('.claude/agents/spv/qa-test-executor-spv.md');
    expect(spv).toContain('- `runs/{runId}/run.json` — its `reissue` record');
    expect(spv).toContain('11. **Scoped re-execution.**');
    expect(spv).toContain('The check lapses once the event log holds a `gate.decided` with decision rejected or a `run.completed` after the latest `run.reissued`');
    expect((contractOf(spv) as { reads: unknown[] }).reads).toContain('{run}/run.json');
  });
});

describe('/qa-descope and /qa-reissue', () => {
  it('/qa-descope is an execution skill that runs the owner commands and dispatches nobody', () => {
    const skill = read('.claude/skills/qa-descope/SKILL.md');
    expect(skill).toMatch(/^---\nname: qa-descope\n/);
    expect(contractOf(skill)).toMatchObject({
      kind: 'execution', dispatchedBy: [], cli: ['run.status', 'run.descope'], dispatches: [],
      emits: [{ event: 'run.descoped', via: 'cli:run.descope' }],
    });
    expect(skill).toContain('`AEGIS_AGENT=owner pnpm aegis run descope --case <TC-ID> --reason "<reason>"`');
    expect(skill).toContain('must not name the framework or an agent');
  });

  it('/qa-descope shows repeated --case with all-or-nothing validation and asks for plain business wording', () => {
    const skill = read('.claude/skills/qa-descope/SKILL.md');
    expect(skill).toContain('--case <TC-ID> --case <TC-ID>');
    expect(skill).toContain('all or nothing');
    expect(skill).toContain('plain business wording');
  });

  it('/qa-descope records one event per case, tolerates a repeat and works on a completed run', () => {
    const skill = read('.claude/skills/qa-descope/SKILL.md');
    expect(skill).toContain('one `run.descoped` event per case recorded');
    expect(skill).toContain('`recorded: false`');
    expect(skill).toContain('a completed run included');
  });

  it('/qa-reissue sends Planning-or-earlier and open-gate reopenings to /qa-gate-decide', () => {
    expect(read('.claude/skills/qa-reissue/SKILL.md')).toContain('Reopening Planning or earlier, or phases of an open gate, is a gate rejection (`/qa-gate-decide`)');
  });

  it('/qa-reissue names the phases after Gate 1, --cases, the gate reset and the archived decision files', () => {
    const skill = read('.claude/skills/qa-reissue/SKILL.md');
    expect(skill).toContain('from a phase after Gate 1 (Design through Curator)');
    expect(skill).toContain('| `--cases` |');
    expect(skill).toContain('every gate after the reissued phase must be decided again with `/qa-gate-decide`');
    expect(skill).toContain('`gates/gate-<N>-decision.<sequence>.json`');
  });

  it('/qa-reissue tells the owner Gate 2 and Gate 3 need a fresh decision and the old ones stay as history', () => {
    const skill = read('.claude/skills/qa-reissue/SKILL.md');
    expect(skill).toContain('Gate 2 and Gate 3 when they fall in the reopened range');
    expect(skill).toContain('the previous decisions stay as history');
  });

  it('the docs name both commands', () => {
    const mech = read('HANDBOOK/13-mechanics.md');
    expect(mech).toContain('## 13.10 Reissuing a phase of a completed run (`/qa-reissue`)');
    expect(mech).toContain('**Descoping a case (`/qa-descope`).**');
    expect(read('HANDBOOK/05-commands.md')).toContain('#### `/qa-descope`');
    expect(read('CLAUDE.md')).toContain('/qa-descope --case=TC-... --reason="..."');
    expect(read('docs/D05-cheat-sheet.md')).toContain('| `/qa-descope --case=TC-... --reason="..."` | Record a test case as out of scope for a run |');
    expect(read('docs/D05-commands-reference.md')).toContain('### /qa-descope');
  });
});

describe('branch review fixes', () => {
  const dir = path.join(ROOT, '.claude/agents/spv');
  const specialistSpvs = fs.readdirSync(dir).filter((f) => /^qa-.*-specialist-spv\.md$/.test(f) && f !== 'qa-web-explorer-spv.md');

  it('every specialist SPV (the twelve that review Execution work) knows a carry-forward attempt and reads what it needs', () => {
    expect(specialistSpvs).toHaveLength(12);
    for (const f of specialistSpvs) {
      const spv = read(`.claude/agents/spv/${f}`);
      expect(spv).toContain('**Carry-forward attempt (scoped re-execution).**');
      expect(spv).toContain('the work report\'s summary begins "Carry-forward attempt", check only that each result file the report names exists and is unchanged and that no new file was written; skip every checklist item above');
      expect(spv).toContain('no `gate.decided` with decision rejected and no `run.completed` after the latest `run.reissued`');
      expect(spv).toContain('A carry-forward attempt that re-ran or changed anything = requested-changes.');
      const reads = (contractOf(spv) as { reads: string[] }).reads;
      expect(reads).toEqual(expect.arrayContaining(['{run}/run.json', '{run}/events.jsonl']));
    }
  });

  it('the executor tells the specialist how to declare a carry-forward, in the words its SPV matches', () => {
    const exec = read('.claude/agents/tier1-phase/qa-test-executor.md');
    expect(exec).toContain('a work report whose summary begins "Carry-forward attempt" and whose approach names the carried-forward result files');
  });

  it('the closure reporter leaves descoped cases out of uncoveredTestCases, and its SPV rejects one listed there', () => {
    expect(read('.claude/agents/tier1-phase/qa-closure-reporter.md')).toContain('the cases listed in `coverage.json#descoped` are not among them, they are stated apart as out of scope');
    expect(read('.claude/agents/spv/qa-closure-reporter-spv.md')).toContain('or listed in `uncoveredTestCases` = requested-changes');
  });

  it('the executor skips descoped cases and keeps them out of the totals; its SPV checks both', () => {
    const exec = read('.claude/agents/tier1-phase/qa-test-executor.md');
    expect(exec).toContain('Skip every case in the `descoped` list of `aegis run status`');
    expect(exec).toContain('the cases in the `descoped` list of `aegis run status` are in none of the totals');
    expect(read('.claude/agents/spv/qa-test-executor-spv.md')).toContain('a descoped case that was run or counted = requested-changes');
  });

  it('the orchestrator and its SPV count gate-report decisions from the later of the previous gate decision and the latest reissue', () => {
    const w = "one entry per dispatch since the previous gate decision (the run's start for G1) or the latest `run.reissued`, whichever is later";
    expect(read('.claude/agents/orchestrator/qa-orchestrator.md')).toContain(w);
    expect(read('.claude/agents/spv/qa-orchestrator-spv.md')).toContain(w);
  });
});
