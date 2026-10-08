import * as fs from 'fs';
import * as path from 'path';
import { SEVERITY_MAP } from '@qa/contracts';

const ROOT = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const REPORTER = '.claude/agents/tier1-phase/qa-executive-reporter.md';
const SPV = '.claude/agents/spv/qa-executive-reporter-spv.md';
const body = (md: string): string => md.slice(0, md.indexOf('## Contract (machine-checked)'));

describe('slide 1 states what was tested, what was not, and the open items', () => {
  const rep = read(REPORTER);
  const slide1 = rep.slice(rep.indexOf('**Slide 1 — KEY FINDING:**'), rep.indexOf('**Next slides'));

  it('the reporter is told the three parts and given a model sentence without a release judgement', () => {
    expect(slide1).toContain('what was tested, what could not be tested, and the open items');
    expect(slide1).toContain('Of 100 designed checks, 98 were attempted: 61 passed, 1 partly passed, 5 failed and 31 were blocked; 2 were not attempted. 4 defects remain open: 1 Critical, 2 Major, 1 Minor.');
    expect(slide1).not.toMatch(/planned (tests|checks)/);
    for (const banned of ['blocking', 'release-blocking', 'blocker', 'go-live ready', 'ready to release']) expect(slide1).toContain(`"${banned}"`);
    expect(slide1).toContain('One or two sentences carrying three parts');
    expect(slide1).toContain('"Of N designed checks, M were attempted: P passed, X partly passed, F failed and B were blocked; K were not attempted."');
    expect(slide1).toContain('the checks that were not attempted are never listed inside the colon list of the attempted ones');
    expect(slide1).toContain('designed is attempted plus not attempted, and attempted is passed plus partial plus failed plus blocked plus skipped plus unknown');
    expect(slide1).toContain('no judgement about release readiness');
  });

  it('slide 1 bans the word blocker except as the severity label of a count, so an open Sev1 can be reported', () => {
    expect(slide1).toContain('"blocker" (except as the severity label of a count, e.g. "1 Blocker defect")');
    expect(slide1).toContain('each open count with its severity name');
  });

  it('the old model headline is gone from the reporter, the SPV and everything under .claude', () => {
    expect(rep).not.toContain('Zero blocking issues found');
    expect(read(SPV)).not.toContain('Zero blocking issues found');
    expect(rep).not.toContain('Ship as planned');
    expect(rep).not.toMatch(/medium-severity/);
  });

  it('the SPV checks slide 1 for the three parts and for release-readiness words', () => {
    const spv = read(SPV);
    const check2 = spv.slice(spv.indexOf('2. **Slide 1'), spv.indexOf('4. **What/So-What/Now-What'));
    expect(check2).toContain('what was tested, what could not be tested, and the open items');
    expect(check2).toMatch(/release-blocking[^\n]*requested-changes/);
    expect(check2).toContain('one or two complete sentences');
  });

  it('the SPV applies the release-readiness ban to every slide and the sign-off narrative, in check 3 and in the verdict', () => {
    const spv = read(SPV);
    const check3 = spv.slice(spv.indexOf('3. **'), spv.indexOf('4. **What/So-What/Now-What'));
    expect(check3).toContain('on any slide or in the sign-off narrative');
    const verdict = spv.slice(spv.indexOf('## Verdict'), spv.indexOf('## Submitting Your Verdict'));
    expect(verdict).toContain('a release-readiness word on a slide or in the sign-off narrative');
    expect(verdict).not.toContain('on slide 1');
  });

  it('the reporter lists the release-readiness wording among the things its SPV rejects', () => {
    const rep2 = read(REPORTER);
    const quality = rep2.slice(rep2.indexOf('## Quality Standards'), rep2.indexOf('## Task Protocol'));
    expect(quality).toContain('any release-readiness wording, rather than what was tested, what could not be tested and the open items');
    expect(quality).toContain('lists only the highest severity');
    expect(quality).toContain('stating no base');
  });
});

describe('severity words are the SEVERITY_MAP names', () => {
  it.each([REPORTER, SPV])('%s names every severity and forbids softer synonyms and a bare code', (file) => {
    const text = body(read(file));
    for (const [code, name] of Object.entries(SEVERITY_MAP)) expect(text).toContain(`${code} ${name}`);
    for (const synonym of ['"moderate"', '"minor"', '"medium"']) expect(text).toContain(synonym);
    expect(text).toContain('never a code alone');
    expect(text).toContain('lists every open count by severity');
  });

  it('the Blocker name is a severity label only, attached to a count', () => {
    for (const file of [REPORTER, SPV]) expect(body(read(file))).toContain('`Blocker` is allowed only as the severity label of a count (`1 Blocker defect`)');
  });
});

describe('numbers are computed and carry their base', () => {
  it('the reporter computes from run files and states the base; two points is the limit for a word', () => {
    const text = body(read(REPORTER));
    expect(text).toContain('every percentage or fraction, in narrative is computed from `closure.json` or `reports/metrics/coverage.json`');
    expect(text).toContain('61 of 98 attempted');
    expect(text).toContain('within 2 points of the exact value');
    expect(text).toContain('Requirements coverage comes from `reports/metrics/coverage.json`');
  });

  it('the old raw-count ban yields to the stated base', () => {
    const text = body(read(REPORTER));
    expect(text).toContain('only as a part or the base of a stated whole ("61 of 98 attempted", "98 of 100 designed checks")');
    expect(text).not.toContain('Never cite raw test counts');
  });

  it('open-defect counts come from the sign-off source and a sentence states the total and every per-severity count', () => {
    const rep = read(REPORTER);
    const wording = rep.slice(rep.indexOf('## Wording Rules'), rep.indexOf('## Process'));
    const numbers = wording.slice(wording.indexOf('**Numbers.**'));
    expect(numbers).toContain('Every count of open defects, and every percentage or fraction');
    expect(numbers).toContain('the `defectMetrics` field `confirmedOpen` of `closure.json`, else the open records in `defects/*.json`');
    expect(numbers).toContain('states the total and every per-severity count');
    expect(numbers).toContain('else from the open records when they sum to the total; when neither does, state the total and say the severity breakdown is not available');
  });

  it('the SPV recomputes counts, not only percentages, from the files it is given', () => {
    const spv = read(SPV);
    const check13 = spv.slice(spv.indexOf('13. **Numbers.**'), spv.indexOf('## Verdict'));
    expect(check13).toContain('Recompute every count, percentage and fraction');
    expect(check13).toContain('the total and every per-severity count must match');
    const check12 = spv.slice(spv.indexOf('12. **Severity words.**'), spv.indexOf('13. **Numbers.**'));
    expect(check12).toContain('an open-defect total or per-severity count that does not match the files = requested-changes');
  });

  it('the SPV is given every file checks 12 and 13 read, in its Inputs and in its contract reads', () => {
    const spv = read(SPV);
    const inputs = spv.slice(spv.indexOf('## Inputs'), spv.indexOf('## Review Checklist'));
    const reads = spv.slice(spv.indexOf('reads:'), spv.indexOf('writes: []'));
    for (const f of ['reports/closure/closure.json', 'execution-summary.json', 'reports/metrics/coverage.json', 'defects/*.json']) {
      expect(inputs).toContain('`runs/{runId}/' + f + '`');
      expect(reads).toContain('"{run}/' + f + '"');
    }
  });

  it('a severity synonym is defined by capitalisation, and bare codes in the skill-printed tables are exempt', () => {
    for (const file of [REPORTER, SPV]) {
      const text = body(read(file));
      expect(text).toContain("any severity word other than the defect's severity-table name written with that name's capitalisation");
      expect(text).toContain('"minor issues" for a Major defect is a synonym');
    }
    expect(body(read(SPV))).toContain("bare severity codes inside the technical report's tables, which the skill prints, are exempt");
  });

  it('the tone-check protocol heading covers the sign-off as well as the slides', () => {
    const rep = read(REPORTER);
    expect(rep).toContain('## Tone-Check Protocol (Slides and Sign-off)');
    expect(rep).not.toContain('(Slides Only)');
  });

  it('the reporter reads the coverage file and tone-checks the sign-off in its Process', () => {
    const rep = read(REPORTER);
    const process = rep.slice(rep.indexOf('## Process'), rep.indexOf('## Quality Standards'));
    expect(process).toContain('Read `reports/metrics/coverage.json` as well.');
    expect(process).toContain('record the skill\'s `jargonRewriteCount` in the work report');
    expect(process).toContain('append `jargon.flagged` with source `signoff` only for a sentence you rewrote yourself');
    expect(process).not.toContain('record each rewrite as `jargon.flagged`');
  });

  it('the jargon.flagged event entry matches Process step 3: for the sign-off only sentences the agent rewrote itself', () => {
    const rep = read(REPORTER);
    const events = rep.slice(rep.indexOf('## Events You Emit'), rep.indexOf('## Concurrency'));
    const entry = events.slice(events.indexOf('- `jargon.flagged`'), events.indexOf('- `tone.check-failed`'));
    expect(entry).toContain('one per sentence you rewrote yourself; for the sign-off only those');
    expect(entry).toContain('`jargonRewriteCount` in the work report');
    expect(rep).not.toContain('one per sentence rewritten by tone-check');
  });

  it('the SPV checks numbers against the run files', () => {
    const spv = body(read(SPV));
    expect(spv).toContain('13. **Numbers.**');
    expect(spv).toMatch(/states no base[^\n]*requested-changes/);
    expect(spv).toMatch(/further than 2 points from the exact value = requested-changes/);
  });
});

describe('the sign-off banner is the owner\'s recorded decision', () => {
  it('the reporter and the SPV name the label and the three texts, and no GO / NO-GO / CONDITIONAL mapping remains', () => {
    for (const file of [REPORTER, SPV]) {
      const text = body(read(file));
      expect(text).toContain('GATE 3 DECISION (owner)');
      for (const shown of ['APPROVED', 'APPROVED WITH CONDITIONS', 'REJECTED']) expect(text).toContain(shown);
      expect(text).not.toMatch(/GO \/ NO-GO|`GO`|`NO-GO`|`CONDITIONAL`/);
    }
    expect(body(read(REPORTER))).not.toContain('Go/No-Go field');
    expect(body(read(REPORTER))).not.toContain('Quality verdict');
  });

  it('check 8 requires the banner to equal the recorded decision text and refuses a verdict label', () => {
    const spv = read(SPV);
    const check8 = spv.slice(spv.indexOf('8. **'), spv.indexOf('### All 3 Documents'));
    expect(check8).toContain('`approved` → `APPROVED`, `approved-with-conditions` → `APPROVED WITH CONDITIONS`, `rejected` → `REJECTED`');
    expect(check8).toMatch(/banner that differs from the recorded decision[^\n]*requested-changes/);
    expect(check8).toMatch(/RELEASE VERDICT, GO, NO-GO or CONDITIONAL[^\n]*requested-changes/);
    expect(spv).toContain('- `runs/{runId}/gates/gate-3-decision.json`');
    expect(spv).toContain('  - "{run}/gates/gate-3-decision.json"');
    const verdict = spv.slice(spv.indexOf('## Verdict'), spv.indexOf('## Submitting Your Verdict'));
    expect(verdict).toContain('a sign-off banner that differs from the recorded Gate 3 decision, a release-readiness word on a slide or in the sign-off narrative, a wrong severity word or a number that does not match the run files');
    expect(verdict).not.toContain('mapped Gate 3 decision');
  });
});

describe('the jargon list', () => {
  it('the SPV adds blocker, release-blocking and Sev1 to the list it scans for', () => {
    const spv = read(SPV);
    const check5 = spv.slice(spv.indexOf('5. **Jargon elimination.**'), spv.indexOf('6. **Jargon rewrite correctness.**'));
    for (const term of ['blocker', 'release-blocking', 'Sev1']) expect(check5).toContain(term);
  });

  it('the sign-off is tone-checked too and the reporter records it as jargon.flagged', () => {
    const rep = body(read(REPORTER));
    expect(rep).toContain('the same tone-check on the sign-off');
    expect(read(SPV)).toContain('the tone-check ran on the sign-off as well');
  });
});

describe('the per-severity open-defect source is named for every agent that needs it', () => {
  const CLOSURE_REPORTER = '.claude/agents/tier1-phase/qa-closure-reporter.md';
  const CLOSURE_SPV = '.claude/agents/spv/qa-closure-reporter-spv.md';
  const SIGNOFF_SKILL = '.claude/skills/_qa-report-signoff-pdf/SKILL.md';

  it('the closure reporter writes the object in its key block, with Sev1 to Sev5 summing to confirmedOpen', () => {
    const text = read(CLOSURE_REPORTER);
    const block = text.slice(text.indexOf('### closure.json keys the collector index reads'), text.indexOf('Two rules that matter'));
    expect(block).toMatch(/"confirmedDefectsBySeverity": \{ "Sev1": \d+, "Sev2": \d+, "Sev3": \d+, "Sev4": \d+, "Sev5": \d+ \}/);
    expect(block).toContain('the five counts sum to `confirmedOpen`');
    expect(block).toContain('sign-off and the executive deck take their per-severity open counts from it');
  });

  it('the closure reporter is rejected for omitting the field or for counts that do not sum to confirmedOpen', () => {
    const text = read(CLOSURE_REPORTER);
    const quality = text.slice(text.indexOf('## Quality Standards'), text.indexOf('## Task Protocol'));
    expect(quality).toContain('`confirmedDefectsBySeverity` missing from `defectMetrics`, or its five counts do not sum to `confirmedOpen`');
  });

  it('the closure SPV checks the sum in its arithmetic check', () => {
    const spv = read(CLOSURE_SPV);
    const check3 = spv.slice(spv.indexOf('3. **Metrics arithmetic verification.**'), spv.indexOf('4. **Open questions section.**'));
    expect(check3).toContain('the five counts of `confirmedDefectsBySeverity` in `defectMetrics` sum to `confirmedOpen`');
    expect(check3).toMatch(/missing or does not sum[^\n]*requested-changes/);
  });

  it('the sign-off skill names the field as the per-severity source beside confirmedOpen', () => {
    const skill = read(SIGNOFF_SKILL);
    const behaviour = skill.slice(skill.indexOf('## Behaviour'), skill.indexOf('5. Read residual risk'));
    expect(behaviour).toContain('the `confirmedDefectsBySeverity` field of the `defectMetrics` object in closure.json');
    expect(behaviour).toContain('the per-severity source beside `confirmedOpen`');
  });

  it('the executive reporter names the field in its Numbers rule', () => {
    const rep = read(REPORTER);
    const numbers = rep.slice(rep.indexOf('**Numbers.**'), rep.indexOf('## Process'));
    expect(numbers).toContain('the per-severity counts come from the `defectMetrics` field `confirmedDefectsBySeverity` of `closure.json`, beside `confirmedOpen`');
  });

  it('the executive SPV exempts the skill-printed "severity breakdown: not available" line as a closure-data note', () => {
    const spv = read(SPV);
    const check12 = spv.slice(spv.indexOf('12. **Severity words.**'), spv.indexOf('13. **Numbers.**'));
    expect(check12).toContain('"N open defects; severity breakdown: not available"');
    expect(check12).toMatch(/exempt[^\n]*closure-data note[^\n]*not a rejection of the reporter/);
    const check13 = spv.slice(spv.indexOf('13. **Numbers.**'), spv.indexOf('## Verdict'));
    expect(check13).toContain('`confirmedDefectsBySeverity`');
  });
});

describe('the executive reporter\'s Inputs and Process match what its skills print and read', () => {
  const rep = read(REPORTER);

  it('keyFinding is one or two sentences, as Slide 1 says', () => {
    const step4 = rep.slice(rep.indexOf('4. **Draft slide content.**'), rep.indexOf('5. **SPV pre-check.**'));
    expect(step4).toContain('`keyFinding` (slide 1, one or two sentences)');
    expect(step4).not.toContain('one sentence');
  });

  it('Inputs lists the execution summary the numbers rule and the contract read', () => {
    const inputs = rep.slice(rep.indexOf('## Inputs'), rep.indexOf('## Outputs'));
    expect(inputs).toContain('- `runs/{runId}/execution-summary.json`');
  });
});

describe('the executive SPV description lists the wording and number checks', () => {
  it('the frontmatter description names checks 12 and 13 beside the no-verdict rule', () => {
    const description = read(SPV).split('\n').find((l) => l.startsWith('description:')) ?? '';
    expect(description).toContain('no ship/no-ship verdict');
    expect(description).toContain('severity-word and number checks (12 and 13)');
  });
});

describe('/qa-reissue is discoverable and its follow-ups are named', () => {
  it('the cheat sheet, the command reference and qa-help list it', () => {
    expect(read('docs/D05-cheat-sheet.md')).toContain('| `/qa-reissue --phase=executive --reason="..."` | Reopen the executive or curator phase of a completed run |');
    expect(read('docs/D05-commands-reference.md')).toContain('### /qa-reissue');
    expect(read('.claude/skills/qa-help/SKILL.md')).toContain('always list `/qa-reissue` (reopen the executive or curator phase of a completed run)');
  });

  it('the reissue skill and the handbook name the collector republish, and regenerate-report points at /qa-reissue', () => {
    const push = '`/qa-push-reports --project=<name> --force`';
    expect(read('.claude/skills/qa-reissue/SKILL.md')).toContain(push);
    expect(read('HANDBOOK/13-mechanics.md')).toContain(push);
    for (const doc of ['.claude/skills/qa-reissue/SKILL.md', 'HANDBOOK/13-mechanics.md']) {
      expect(read(doc)).toContain('`--force` re-exports every run of that project (one export each)');
      expect(read(doc)).toContain('`scripts/export-run.sh --project <name> --run <runId> --source <QA folder>/<name>/aegis/runs`');
    }
    expect(read('.claude/skills/qa-regenerate-report/SKILL.md')).toContain('To regenerate the executive reports of a completed run, use `/qa-reissue --phase=executive` instead');
  });
});

describe('check counts have one source of truth: the counts of coverage.json', () => {
  const rep = read(REPORTER);
  const wording = rep.slice(rep.indexOf('## Wording Rules'), rep.indexOf('## Process'));
  const source = wording.slice(Math.max(0, wording.indexOf('**Source of truth for counts.**')));

  it('the reporter takes every count of checks from the counts object, which wins over the executor roll-up and closure.json', () => {
    expect(wording).toContain('**Source of truth for counts.**');
    expect(source).toContain('Counts of checks (designed, attempted, passed, failed, partial, blocked, skipped, not attempted) come from the `counts` object of `reports/metrics/coverage.json`');
    expect(source).toContain('computes from the case files');
    expect(source).toContain('when the totals of `execution-summary.json` or the metrics of `closure.json` differ, `coverage.json` wins');
  });

  it('the narrative names designed and attempted separately, states partial apart, and never calls the attempted count the planned one', () => {
    expect(source).toContain('"of N designed checks, M were attempted: …"');
    expect(source).toContain('partial is stated separately from passed');
    expect(source).toContain('never "of 98 planned"');
    expect(source).toContain('add up to the base it states');
  });

  it('the split of the uncovered checks uses the closure report\'s exact figures, with no hedge word on any count', () => {
    expect(source).toContain('categories sum exactly to the number of uncovered checks (blocked plus skipped plus undetermined plus not attempted)');
    expect(source).toContain('no "around", "about" or "roughly" goes before any count');
    expect(body(rep)).not.toContain('round it to context');
    expect(body(rep)).not.toContain('"about 150 tests"');
  });

  it('the sign-off is generated with the tested build version the script derives, an explicit version flag winning', () => {
    const process = rep.slice(rep.indexOf('## Process'), rep.indexOf('## Quality Standards'));
    const step3 = process.slice(process.indexOf('3. **Produce Deliverable 2**'), process.indexOf('4. **Draft slide content.**'));
    expect(step3).toContain('prints the tested build version');
    expect(step3).toContain('derived from the run');
    expect(step3).toContain('an explicit `--version` flag wins');
    expect(step3).toContain('never "unversioned" when the run records the build');
  });

  it('SPV check 13 recomputes counts from the counts of coverage.json and rejects a count that does not sum to its stated base', () => {
    const spv = read(SPV);
    const check13 = spv.slice(spv.indexOf('13. **Numbers.**'), spv.indexOf('## Verdict'));
    expect(check13).toContain('Recompute every count of checks (designed, attempted, passed, failed, partial, blocked, skipped, not attempted) from the `counts` object of `reports/metrics/coverage.json`');
    expect(check13).toContain('cross-check them against the `cases/*-result.json` files');
    expect(check13).toContain('where `execution-summary.json` or `closure.json` differ, `coverage.json` wins');
    expect(check13).toMatch(/requested-changes\. So are counts that add up to a different total than the base the sentence states/);
    expect(check13).toContain('"of N planned" for the attempted count');
    expect(check13).toMatch(/"around" or "about" on a count\. The work report/);
  });

  it('the closure reporter and its SPV take the results counts from the same object', () => {
    const closure = read('.claude/agents/tier1-phase/qa-closure-reporter.md');
    const step2 = closure.slice(closure.indexOf('2. **Read computed metrics.**'), closure.indexOf('3. **Write ISTQB closure sections.**'));
    expect(step2).toContain('counts of checks (designed, attempted, passed, failed, partial, blocked, skipped, not attempted) come from the `counts` object of `coverage.json`');
    expect(step2).toContain('not from `execution-summary.json`, which counts a partial case as a pass');
    const spv = read('.claude/agents/spv/qa-closure-reporter-spv.md');
    const check3 = spv.slice(spv.indexOf('3. **Metrics arithmetic verification.**'), spv.indexOf('4. **Open questions section.**'));
    expect(check3).toContain('`passed`, `failed` and `blocked` of `closure.json#metrics` and the Results summary counts must equal the same-named counts of `coverage.json`');
  });
});

describe('counts and pass rate: review fixes', () => {
  const rep = read(REPORTER);
  const wording = rep.slice(rep.indexOf('## Wording Rules'), rep.indexOf('## Process'));
  const numbersAndSource = wording.slice(wording.indexOf('**Numbers.**'));
  const spv = read(SPV);
  const check13 = spv.slice(spv.indexOf('13. **Numbers.**'), spv.indexOf('## Verdict'));
  const EXECUTED = 'executed (`testExecutionCoverage`) means the check ran to a verdict: passed, failed or partial; attempted also includes blocked, skipped and undeterminable results';

  it('the pass rate is passed over attempted from the counts, in the closure reporter and in its SPV check 2', () => {
    const closure = read('.claude/agents/tier1-phase/qa-closure-reporter.md');
    const step2 = closure.slice(closure.indexOf('2. **Read computed metrics.**'), closure.indexOf('3. **Write ISTQB closure sections.**'));
    expect(step2).toContain('The headline `passRate` is the `passed` count divided by the `attempted` count of `coverage.json`, 100 ×, one decimal');
    expect(step2).not.toContain('(e.g. a headline pass rate) from `execution-summary.json`');
    const cspv = read('.claude/agents/spv/qa-closure-reporter-spv.md');
    const check2 = cspv.slice(cspv.indexOf('2. **10 computed metrics present.**'), cspv.indexOf('3. **Metrics arithmetic'));
    expect(check2).toContain('`coverage.json` → requirementsCoverage, testExecutionCoverage and passRate (the `passed` count over the `attempted` count)');
    expect(check2).not.toContain('`execution-summary.json` → passRate');
  });

  it('the executive reporter and its SPV no longer list the executor roll-up beside coverage.json as a source of counts', () => {
    expect(numbersAndSource).not.toMatch(/computed from `closure\.json`, `execution-summary\.json`/);
    expect(check13).not.toContain('from `closure.json`, `execution-summary.json` and `reports/metrics/coverage.json`');
    const inputs = spv.slice(spv.indexOf('## Inputs'), spv.indexOf('## Review Checklist'));
    expect(inputs).toContain("the executor's roll-up, read only to explain a difference from `coverage.json`, whose counts win");
    expect(inputs).not.toContain('the execution counts check 13 recomputes from');
  });

  it('the split of the uncovered checks comes only from the by-cause counts of coverage.json, never classified by hand', () => {
    const source = wording.slice(wording.indexOf('**Source of truth for counts.**'));
    for (const text of [source, check13]) {
      expect(text).toContain('`byCause` counts of the `uncovered` object of `reports/metrics/coverage.json`');
      expect(text).toContain('environment limits');
      expect(text).toContain('testing-side gaps');
      expect(text).toContain('requirement gap');
      expect(text).toContain('not attempted');
      expect(text).toContain('sum exactly to the number of uncovered checks (blocked plus skipped plus undetermined plus not attempted)');
      expect(text).not.toContain('qaSide');
      expect(text).not.toContain("closure's explicit `cause`");
    }
    expect(source).toContain("Never classify a row of the closure's table of uncovered test cases yourself");
    expect(source).toContain('Of the 33 checks that gave no verdict, 15 were limited by the test environment, 15 by testing-side gaps and 1 by a requirement gap; 2 were not attempted.');
    expect(source).not.toContain('is built from every row');
    expect(check13).toContain('Any classification made by hand');
    expect(check13).toContain('a split read from the closure');
    expect(check13).toContain('(environment, testingSide, requirementGap, notAttempted, and other named "other" when above zero)');
  });

  it('executed and attempted are related in the reporter and in the collector', () => {
    const source = wording.slice(wording.indexOf('**Source of truth for counts.**'));
    expect(source).toContain(EXECUTED);
    const collector = read('.claude/agents/crosscutting/qa-metrics-collector.md');
    const counts = collector.slice(collector.indexOf('- **Counts**'), collector.indexOf('Rollup: percentage per type.'));
    expect(counts).toContain(EXECUTED);
  });

  it('the collector says no-op counts as a pass', () => {
    const collector = read('.claude/agents/crosscutting/qa-metrics-collector.md');
    const exec = collector.slice(collector.indexOf('- **Test execution coverage**'), collector.indexOf('- **Code coverage**'));
    expect(exec).toContain('A TC is passed only when every one of its outcomes is a pass or a `no-op` (`no-op` counts as a pass, as in the `passed` count)');
  });

  it('the sign-off skill says closed counts come from the records on disk', () => {
    expect(read('.claude/skills/_qa-report-signoff-pdf/SKILL.md')).toContain('Closed counts come from the defect records on disk, not from `totalLogged`');
  });

  it('closure SPV check 2 excuses passRate exactly when coverage.json is excused, and automationCoverage never', () => {
    const cspv = read('.claude/agents/spv/qa-closure-reporter-spv.md');
    const check2 = cspv.slice(cspv.indexOf('2. **10 computed metrics present.**'), cspv.indexOf('3. **Metrics arithmetic'));
    expect(check2).toContain('passRate is excused exactly when `coverage.json` is (listed in `closure.json#unavailableMetrics`, holding `"noData": true`, or an `attempted` count of 0)');
    expect(check2).toContain('automationCoverage comes from run files, not a metric file, and is never excused that way');
    expect(check2).not.toContain('passRate and automationCoverage come from run files');
  });

  it("the reporter's Inputs line sends counts to coverage.json and keeps execution-summary.json for the roll-up and timings", () => {
    const inputs = rep.slice(rep.indexOf('## Inputs'), rep.indexOf('## ', rep.indexOf('## Inputs') + 3));
    expect(inputs).toContain('the executor roll-up and timings only; counts of checks come from the `counts` object of `reports/metrics/coverage.json`');
    expect(inputs).not.toContain('executed, passed, failed and blocked counts of the cycle');
  });
});

describe('closure side of the by-cause split', () => {
  it('the closure reporter states no split by cause and no cause on a row', () => {
    const t = read('.claude/agents/tier1-phase/qa-closure-reporter.md');
    expect(t).toContain('The closure states no split of them by cause: no `cause` on a row and no total by cause.');
    expect(t).toContain('stated only by the executive reports, from that file');
    expect(t).not.toContain('uncoveredByCause');
    expect(t).not.toContain('MAY also carry `cause`');
  });
  it('its SPV rejects a closure that carries a cause or a split', () => {
    const t = read('.claude/agents/spv/qa-closure-reporter-spv.md');
    expect(t).toContain('3b. **No split by cause.**');
    expect(t).toContain('no `cause` on a row of `uncoveredTestCases` and no `uncoveredByCause`');
    expect(t).toContain('A closure that carries either = requested-changes.');
  });
});

describe('residual-risk ratings and plain wording', () => {
  const rep = read(REPORTER);
  const spv = read(SPV);
  const wording = rep.slice(rep.indexOf('## Wording Rules'), rep.indexOf('## Process'));
  const check12 = spv.slice(spv.indexOf('12. **Severity words.**'), spv.indexOf('13. **Numbers.**'));

  it('a residual-risk rating is exempt from the severity-word rule, in the reporter and in SPV check 12', () => {
    for (const text of [wording, check12]) {
      expect(text).toContain('A residual-risk rating (Critical, High, Medium or Low');
      expect(text).toContain('is not a defect severity');
    }
  });

  it('the reporter writes residual-risks.json with a plain sentence for every closure residual risk, before the sign-off skill', () => {
    const step3 = rep.slice(rep.indexOf('3. **Produce Deliverable 2**'), rep.indexOf('4. **Draft slide content.**'));
    expect(step3).toContain('by first writing `reports/executive/residual-risks.json`');
    expect(step3).toContain('`{ "riskId": "...", "plain": "..." }` for EVERY risk of `residualRiskSummary` in `closure.json`');
    expect(step3).toContain('no framework, tool or product-internals names, no internal paths, and no ticket, defect or requirement ids');
    expect(step3.indexOf('residual-risks.json')).toBeLessThan(step3.indexOf('invoke the `_qa-report-signoff-pdf` skill'));
    expect(rep).toContain('  - "{run}/reports/executive/residual-risks.json"');
  });

  it('SPV check 14 requires every closure residual risk id to be covered by plain wording', () => {
    const check14 = spv.slice(spv.indexOf('14. **Residual risk wording.**'), spv.indexOf('## Verdict'));
    expect(check14).toContain('Every `riskId` of `residualRiskSummary` in `closure.json` has an entry in `reports/executive/residual-risks.json`');
    expect(check14).toContain('framework, tool or product-internals name');
    expect(check14).toContain('= requested-changes');
    expect(spv).toContain('  - "{run}/reports/executive/residual-risks.json"');
  });

  it('SPV inputs say coverage.json carries the counts and the by-cause split', () => {
    const inputs = spv.slice(spv.indexOf('## Inputs'), spv.indexOf('## Review Checklist'));
    expect(inputs).toContain('the `counts` of checks and the by-cause split of the uncovered checks');
  });
});
