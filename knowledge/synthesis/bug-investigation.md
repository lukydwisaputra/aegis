---
topic: bug-investigation
sources:
  - book: lessons-learned-kaner
    chapters: [4, 2]
    role: primary
ingestedAt: "2026-05-24"
---

# Bug Investigation (Cross-Book Synthesis)

> A bug report is only as strong as the investigation behind it. This document captures Aegis's canonical investigation discipline: how to move from a single observed symptom to a defensible, reproducible, well-bounded defect with its worst manifestation surfaced. The technique is three-axis variation testing (behavior, state, environment) from Kaner ch-04, applied through the abductive inference engine from Kaner ch-02, evaluated against the oracle problem so that pass/fail decisions are explicit about what was observed and what was not. Together these form the bug-investigation pipeline for qa-defect-manager and qa-test-executor.

---

## The investigation thesis

(lessons-learned-kaner ch-04 Lessons 20, 21, 22, 23; ch-02 lessons on abductive inference and oracles)

A failure is a symptom of an error, not the error itself (ch-04 Lesson 20). What the tester observes is a *misbehaviour* of the program, not the underlying code error. A minor-looking symptom (mouse droppings) may reflect a severe underlying fault (wild pointer). Under slightly different conditions, the same fault may produce catastrophic failures. Therefore:

- When a symptom looks minor, do follow-up testing to find more severe manifestations and to demonstrate a wider range of circumstances.
- When a problem is hard to reproduce, do follow-up testing to isolate the critical conditions that make it consistent, then drive the now-reproducible bug toward its worst expression.

The investigation pipeline has three stages, executed in order:

1. **Isolation** — find the minimal, reliable conditions that produce the failure.
2. **Variation** — systematically extend understanding across three axes (behaviour, state, environment).
3. **Severity escalation** — drive the bug toward its worst expression so the report represents the true cost of leaving it unfixed.

All three stages run on abductive inference: generate multiple candidate explanations, seek data that differentiates among them.

---

## Stage 1 — Isolation

(lessons-learned-kaner ch-04 Lesson 23: "Nonreproducible bugs are reproducible")

Every failure occurs under specific conditions. Inability to reproduce means the critical conditions are not yet identified. Treat nonreproducibility as an information gap, not a dead end.

The conditions to check systematically:

- **Delayed-fuse causes.** Memory leaks, wild pointers, corrupted stacks, state accumulated across sessions. Monitor memory usage over time. Look for failures that appear only after extended use.
- **First-installation-only behavior.** Use disk imaging to restore a clean installation state and re-test.
- **Specific data values or corrupted databases.** Check whether the failure depends on the exact data in use.
- **Time- or date-dependent behavior.** End-of-day, weekend, quarter-end, year-end transitions are common triggers.
- **Order-dependent task sequences.** What was done immediately *before* the failing task?
- **State left by a previous failure.** Was the machine restarted after the last error? A failure may have left the system in an unstable state that conditions subsequent failures.
- **Background or competing applications.** Other software running concurrently, contention for shared devices, network interference.

For Aegis: when qa-test-executor reports a nonreproducible failure, qa-defect-manager's isolation pass must enumerate the candidate conditions explicitly. Reports that say "nonreproducible" without showing what was tried are weak; reports that document the conditions investigated build credibility even when reproduction was not achieved (ch-04 Lesson 22: nonreproducible bugs are still worth filing if the investigation is documented).

---

## Stage 2 — Three-axis variation testing

(lessons-learned-kaner ch-04 Lesson 21: "Do follow-up testing on seemingly minor coding errors")

Once the bug is isolated (or determined to be irreproducible despite investigation), variation testing extends understanding across three axes. The premise: when the first failure appears, the program is in a state the programmer did not intend or anticipate. Data may now hold impossible values. The same fault under slightly different conditions may produce dramatically different failures.

### Axis 1 — Vary behavior (change what you do)

- **Repeat the failure path.** Is there a cumulative effect?
- **Try tasks related to the failing task.** Do related operations also fail or behave oddly?
- **Try tasks related to the failure type.** If the symptom is a scrolling artefact, try other operations that produce scrolling.
- **Change sequencing.** Trigger the failure symptom first, then the related task.
- **Change activity speed.** Type slower, click faster, pause between steps.
- **Continue using the program in the degraded state without resetting.** What else breaks?

### Axis 2 — Vary program state (change options and settings)

- **Switch databases or data files.**
- **Change persistent variable values.**
- **Alter memory configuration, window size, display precision, background-process settings.**
- **Change any preference or option the program exposes.**

In the scrolling-after-addition example from ch-04: change window size, digit precision, or background spell-checker activity.

### Axis 3 — Vary the environment (change software and hardware context)

This is not standard configuration testing. The goal is to ask what environmental changes would make the failure *more dramatic*.

- **If timing seems relevant**, use a different processor speed or communications connection.
- **If memory seems relevant**, test with reduced memory or altered virtual memory settings.
- **If network interaction is suspected**, change communication connection speed or type.
- **Add or remove background applications.**

### Time investment

Kaner's guidance: at minimum, a few minutes for every failure believed to reflect a coding error. For some failures, up to a full day. Trust judgment; stop when the marginal return on additional testing is low.

---

## Stage 3 — Severity escalation (uncornering corner cases)

(lessons-learned-kaner ch-04 Lessons 16, 17: "Extreme-looking bugs are potential security flaws" / "Uncorner your corner cases")

When a failure occurs at an extreme value, do not stop there. Test inward until the actual failure boundary is found. Report the full failing range rather than the single data point.

The boundary-extension technique:

1. Failure observed at the extreme (e.g., 999).
2. Test inward: 990, 950, 900, 500, 100.
3. Establish the actual boundary (e.g., fails at 100 and above).
4. Report the full range, not the single extreme case.

The political consequence (per ch-04): programmers may dismiss extreme-value failures as "corner cases." A report that fails across the entire range 100–999 is far harder to dismiss than a single data point at 999.

The security consequence: extreme-value bugs are often the most exploitable defects. Buffer-overrun bugs source most internet break-ins (ch-04 Lesson 16). Testers trained to dismiss "unrealistic" inputs miss the most exploitable defects. Any bug that can interfere with program operation or corrupt data is an exploit-in-waiting.

---

## Abductive inference as the investigation engine

(lessons-learned-kaner ch-02, lesson "Use abductive inference to discover conjectures")

All three stages run on abductive inference: reasoning to the best explanation.

The four-step loop:

1. **Gather data and attempt to make sense of it.** What was observed, in what sequence, under what conditions?
2. **Construct multiple explanations that could account for the data.** Memory leak? Race condition? Bad data? Order dependency? Environment interaction?
3. **Seek more data that corroborates or refutes each explanation.** Each candidate should suggest a specific test that would distinguish it.
4. **Select the most coherent explanation, or continue gathering.** Do not commit prematurely.

The discipline is to *generate multiple candidates before committing*. A single hypothesis investigated in isolation produces confirmation bias (ch-02 cognitive biases list). Three or four candidates, each with a differentiating test, produces real investigation.

For Aegis: qa-defect-manager reports should include the candidate explanations considered and the data that ruled out the alternatives. This transforms a bug report from "here is what I saw" into "here is what I observed, here are the explanations I considered, here is the data that points to the surviving explanation."

---

## The oracle problem in investigation

(lessons-learned-kaner ch-02; appendix illustration "All oracles can be wrong")

An oracle is the mechanism that tells you whether observed behaviour is acceptable. Every oracle is partial. The investigation discipline must be explicit about which oracle is in use and what it cannot detect.

When investigating an ambiguous symptom, the questions are:

- **What part of the product was exercised?** Investigation focused on UI may miss a backend state corruption that is the true cause.
- **What was specifically observed?** A field display may be correct while the underlying database value is wrong.
- **Which requirements were checked?** A test against the spec may miss user-impact failures the spec does not name.
- **To what degree was the requirement fulfilled?** Partial success is not success.
- **Under what range of conditions did it work?** A pass in one configuration is not a pass globally.

The translation discipline (ch-02): when anyone says "it worked," translate mentally to "it appears to meet some requirement to some degree." The investigation report should explicitly state the oracle used and the oracle's known gaps.

For ambiguous pass/fail (where the oracle is uncertain), the report includes the observation, the candidate oracles that would interpret it differently, and the data needed to discriminate. This is more honest than asserting a binary pass/fail when the underlying judgment is genuinely uncertain.

---

## From symptom to root cause — the path

The full investigation pipeline:

1. **First symptom observed.** Record the exact conditions: build, environment, sequence of operations, data in use, timing.
2. **Initial reproduction attempt.** Can the failure be triggered again immediately? If yes, isolation may be straightforward; if no, enter the nonreproducible-bug investigation (Stage 1 above).
3. **Isolation.** Identify the minimal conditions that reliably produce the failure. Enumerate candidates from the delayed-fuse / first-install / data-value / time-dependent / order-dependent / state-residue / environmental-interaction list.
4. **Hypothesis generation.** Construct multiple candidate explanations for the failure (abductive inference).
5. **Variation testing — behaviour axis.** Vary what is done. Does the failure scope expand?
6. **Variation testing — state axis.** Vary program options and settings. Does the failure scope expand?
7. **Variation testing — environment axis.** Vary the surrounding software/hardware. Does the failure become more dramatic?
8. **Severity escalation.** Uncorner corner cases. Drive the failure toward its worst expression.
9. **Oracle reflection.** What was observed? What was not observed? What other failures might have occurred but escaped the oracle?
10. **Report.** The bug report describes the symptom, the isolation, the variation findings (including the failure range), the worst observed consequence, and the candidate explanations considered. See [[synthesis/defect-management.md]] for report structure.

---

## Heuristics for the investigation cycle

(consolidated from lessons-learned-kaner ch-04 and ch-02)

| Heuristic | Use |
|---|---|
| **A failure is a symptom of an error** | Never stop at the first symptom; the underlying fault may produce worse manifestations |
| **Nonreproducible bugs are reproducible** | Inability to reproduce = critical conditions unknown; enumerate and test candidates |
| **Uncorner corner cases** | Test inward from extreme values until the true failure boundary is found |
| **Generate multiple candidate explanations** | Single-hypothesis investigation produces confirmation bias |
| **Each candidate suggests a differentiating test** | Investigation moves forward by eliminating candidates, not confirming favourites |
| **Oracle gaps are part of the report** | What was *not* observed matters as much as what was |
| **Variation across three axes** | Behaviour, state, environment — all three must be probed |
| **Time investment scales with severity** | Minutes for trivial; up to a day for high-impact |

---

## Anti-patterns in investigation

(consolidated from lessons-learned-kaner ch-04)

- **Tossing nonreproducible bugs without investigation.** Signals disrespect for the programmer's time and creates doubt about the reliability of all reports.
- **Dismissing extreme-value failures as corner cases.** The tester who self-censors at this boundary is the last line of defence before the bug ships; buffer-overrun bugs source most internet break-ins.
- **Stopping at the first symptom.** A minor-looking symptom may reflect a severe underlying fault. Without variation testing, the report understates the cost of leaving the bug unfixed.
- **Single-hypothesis investigation.** Confirmation bias takes over; differentiating tests are not run.
- **Solution-focused investigation.** Speculating about the code-level cause when only behaviour can be observed; the report ends up advocating a fix rather than describing the failure.
- **Asserting pass/fail when the oracle is uncertain.** Forced binary judgments hide real ambiguity.

---

## Operational consequences for Aegis

- **qa-test-executor** records COTE (Configure, Operate, observe, Evaluate) for every test, with the oracle applied and known oracle gaps. When a failure is observed, the executor's job continues into the isolation pass — single-observation reports are insufficient.
- **qa-defect-manager** runs the full three-stage pipeline. Reports include: minimal reproduction conditions, candidate explanations considered, variation testing across all three axes, the worst observed consequence, and the oracle/observation gaps.
- **qa-orchestrator** coordinates the variation testing axes when they require different specialist agents (e.g., environment variation may dispatch qa-performance-specialist or qa-security-specialist).
- **qa-curator** reviews investigation quality. Reports that show single-hypothesis reasoning, missing variation axes, or unaddressed oracle gaps go back for completion.

---

## Cross-book agreements

This document is anchored in lessons-learned-kaner. Mohan does not provide a comparable investigation protocol, but his defect-prevention and fast-feedback principles (full-stack-testing-mohan ch-12) reinforce the discipline: a well-investigated bug surfaces the worst consequence early, when fixing is cheapest. Mohan's empathetic-testing principle reinforces the severity-escalation step — drive the bug toward its worst real-user expression, not its narrowest technical manifestation.

---

## Pointers

- Used by agents: qa-defect-manager (primary), qa-test-executor (primary), qa-orchestrator, qa-curator, qa-exploratory-specialist.
- Cross-ref: [[synthesis/tester-mindset.md]], [[synthesis/defect-management.md]], [[synthesis/exploratory-testing.md]], [[synthesis/stlc-process.md]].
