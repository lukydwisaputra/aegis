---
topic: defect-management
sources:
  - book: lessons-learned-kaner
    chapters: [4, 7]
    role: primary
ingestedAt: "2026-05-24"
updatedAt: "2026-05-24"
---

# Defect Management (Cross-Book Synthesis)

> Bug reports are the primary work product of most testers, and they are advocacy documents — sales tools that ask people to spend time and money in return for a quality improvement. Kaner Ch 4 is THE canonical reference; this synthesis drives `qa-defect-manager` entirely. The central frame: **every bug report should be written to sell a fix to people who control scarce time and money, and to anticipate every objection that fix decision-makers will raise.** Severity and priority are independent dimensions and must never be conflated. Variation testing on three axes (behaviour, program state, environment) extends every finding to its worst manifestation before reporting. The 65-character summary line is the single most leveraged element. Reports written for known programmers in collaborative working relationships are repaired faster than reports written for anonymous readers; Kaner Ch 7 establishes the evidence-over-authority dynamic that makes that relationship work.

---

## The advocacy frame (the premise everything follows from)

### You are what you write

Bug reports are the primary work product of most testers. Readers form their perception of a tester through these documents. Good reports of real bugs build reputation; weak or sloppily written reports waste programmers' time and breed resentment. Managers and executives also read bug reports: a blaming or petty tone, poor explanation, or inadequate research creates a negative impression with the people who control career outcomes. (lessons-learned-kaner ch-04)

### Your advocacy drives repair

Every bug report is an advocacy document. **Not every bug will be fixed — that is not the tester's responsibility.** The tester's responsibility is to report accurately and in a way that allows any reader to understand the full impact. Research quality and writing quality directly affect the probability of a fix.

### A bug report is a sales tool

Good sales practice requires two things:

1. **State the benefit so the reader wants it.** Explain how the bug interferes with normal use, what data it corrupts, how often users will encounter it. Reference competitor reviews of similar bugs. Quote technical-support statistics. Show the product passed this test in a previous release. Route the report to a stakeholder whose feature is blocked.
2. **Anticipate objections and counter them.** Common objections: too minor, not reproducible, impossible to understand, unlikely in real world, hardware-specific, too risky to fix, will not bother real users. Address pre-emptively through good reporting practice: write clearly, verify reproduction on multiple configurations, include concrete cost data ("A similar bug in Release 2 cost over $100,000 in technical support").

### Your bug report is your representative

When the report is filed, the tester is usually absent. The report must speak for itself — to the programmer, to project managers, and to the Change Control Board (also called triage team, project team, war team, bug review team). Every change the board considers costs money, takes time, and risks introducing new defects. The bug report is often the tester's only vehicle for persuading decision-makers to approve a fix.

### The work serves many stakeholders simultaneously

Bug reports serve: programmers (defect alert, troubleshooting context), spec / docs / tooling owners (errors in their material), technical writers (troubleshooting content), customer training, post-sale technical support (workarounds for deferred items), management (product quality picture), and the next-release improvement backlog. Investment in writing well pays compounding dividends.

### Any stakeholder should be able to report

A stakeholder is anyone with a vested interest in product success — employees, customers, heavy users. The testing group should *facilitate* this communication, not gatekeep it, especially when complaints come from outside Product Development. (lessons-learned-kaner ch-04)

---

## The canonical bug-report structure

Kaner does not prescribe a rigid template, but synthesises the following structure from the lessons. **This is the canonical Aegis defect-report field set.**

### Summary line (headline)

- **One line, approximately 65 characters.**
- Must convey: a specific description the reader can visualise, a hint at how narrow or broad the triggering conditions are, and the impact or consequence.
- This is the single most important line in the report. Project managers, executives, and triage teams scan lists of unresolved or deferred bugs and see only the summary. Bugs with weak headlines are dismissed.
- Because management reports typically display only ~65 characters, **choose the most compelling element** rather than trying to fit everything. The rest belongs in the detailed description.

### Severity

- The **impact or consequence** of the bug on the product, its users, or the business.
- **Stable** — does not change unless follow-up investigation reveals consequences not apparent in the initial report.
- Drawn from the company's classification scheme. If the scheme seems wrong, use the most defensible rating and explain why in the description.

### Priority

- **When** the company wants it fixed.
- Set by the project team based on business context — schedule, budget, release timing, risk tolerance, competitive pressure.
- **Shifts as those factors shift.** Independent of severity.

### Reproduction steps

- Numbered, sequential, complete.
- No steps omitted.
- The shortest path to the failure.
- Short, simple sentences.
- State what happened **and what was expected to happen**.
- Written for a sleep-deprived, time-pressured reader (many bugs are fixed in the final weeks of a project by sleep-deprived programmers working heavy overtime).
- Use whitespace for scannability.
- For complicated problems, open with a three-line executive summary then give detailed steps.
- Avoid jokes — they will be misunderstood.

### Environment / configuration

- Hardware, OS, software version, relevant settings.
- Configuration snapshots when environment interactions are suspected.

### Reproducibility status

- Explicitly flagged: **reproducible, nonreproducible, intermittent, or unknown**.
- If nonreproducible: document the troubleshooting steps taken. The impression to leave is "thorough investigation exhausted available tools," not "gave up after one try."
- Use a dedicated tracking field or an explicit `NR` marker in the summary so triage can manage expectations.

### Follow-up testing results

- Findings from variation testing on the three axes (behaviour, program state, environment — see below).
- **Report the worst observed consequence, not just the first observed symptom.**

### Impact and context

- Why the consequence is serious if there is any chance the reader will not grasp it.
- Market data, support cost estimates, competitor comparisons, stakeholder impact when relevant.

### Attribution of additions

Any content added to the report after initial filing — especially by a different person — should be initialled and dated (e.g., `[CK 12/27/01]` at the start of a new line). This practice makes follow-up questions easy to direct to the right person and avoids putting words into someone else's name.

---

## Severity vs. priority — the canonical distinction

**Severity** is the intrinsic impact of a bug on the product, its users, or the business. It describes what happens when the bug is triggered: data corruption, crash, security exposure, incorrect output, poor usability. **Determined by the nature of the failure.** Does not change unless follow-up investigation reveals consequences not apparent in the initial report.

**Priority** is a scheduling decision. It reflects when — or whether — the project team wants the bug fixed given the current state of the project. Function of business context: schedule, budget, release timing, risk tolerance, competitive pressures. **Changes frequently as those factors shift.**

These two dimensions interact but are not the same:

| Scenario | Severity | Priority |
|---|---|---|
| Data-corruption bug triggered only by a date that has already passed | High | Low (trigger no longer applies) |
| Misspelled company name on launch splash screen | Low (cosmetic) | High (embarrassing before any user sees the product) |
| Crash on obscure edge case with a known workaround | Medium-High | Medium (workaround exists; fix scheduled next release) |
| Security buffer-overrun on field accepting large input | Critical | High (regardless of how unlikely normal users would trigger it) |

**Kaner's position is unambiguous: severity describes reality; priority describes resource allocation.** Conflating them — rating severity based on when the team plans to fix it, or setting priority based solely on perceived severity — produces misinformation in both directions. Both dimensions belong in every bug report; neither substitutes for the other. (lessons-learned-kaner ch-04)

---

## Variation testing protocol — three axes

When the first failure appears, the program is in a state the programmer neither intended nor anticipated. Data may now hold impossible values. Three types of follow-up testing extend understanding of the bug's scope and severity. **Aegis defect investigation must cover all three axes before filing.**

### Axis 1 — Vary behaviour (change what you do)

- Repeat the failure path: cumulative effect?
- Try tasks related to the failing task.
- Try tasks related to the failure symptom.
- Change sequencing: trigger the failure symptom first, then the related task.
- Change activity speed.
- Continue using the program in the degraded state without resetting; run unrelated tests in the degraded state.

### Axis 2 — Vary program state (change options and settings)

- Switch databases or data files.
- Change persistent variable values.
- Alter memory configuration, window size, display precision, background-process settings.
- Change any preference or option the program exposes.
- In the scrolling-after-addition example: change window size, digit precision, or background spell-checker activity.

### Axis 3 — Vary the environment (change software and hardware context)

- Change processor speed or load if timing is suspected.
- Change memory size or virtual memory if memory pressure is suspected.
- Change communication connection speed or type if network interaction is suspected.
- Add or remove background applications.

**This is not standard configuration testing.** The goal is to ask what environmental changes would make the failure *more dramatic*.

### Time investment

At minimum, a few minutes for every failure believed to reflect a coding error. For some failures, up to a full day. Trust judgment; stop when the marginal return on additional testing is low.

### Why variation testing is mandatory

- **A failure is a symptom of an error, not the error itself.** A minor-looking symptom (mouse droppings) may reflect a severe underlying fault (wild pointer). Under slightly different conditions the same fault may produce catastrophic failures. When a symptom looks minor, do follow-up testing to find more severe manifestations.
- **Uncornering corner cases.** Extreme values are efficient test inputs that stress the program with a small number of cases. Programmers sometimes dismiss extreme-value results as "corner cases" — a rhetorical move to avoid fixing. The counter-technique: **keep testing inward from the extreme until the actual failure boundary is established.** Reporting that the program fails across the entire range 100–999 — not just at 999 — is far more persuasive than a single data point at the edge.
- **Extreme-looking bugs are potential security flaws.** Buffer-overrun bugs occur when more data is entered than allocated memory can hold; they are the source of the majority of internet break-ins. Any bug that can interfere with program operation or corrupt data is an exploit-in-waiting. Severe-consequence bugs must be fixed regardless of how unlikely the triggering condition appears. (lessons-learned-kaner ch-04)

---

## Bug isolation — making nonreproducible bugs reproducible

**"Every failure occurs under specific conditions. Inability to reproduce means the critical conditions are not yet identified."** Conditions frequently overlooked:

- **Delayed-fuse causes:** memory leaks, wild pointers, corrupted stacks. Monitor memory usage over time; use tools like Bounds Checker or Purify.
- **First-installation-only behaviour:** use disk imaging (Drive Image, Ghost) to restore a clean system and re-test.
- **Specific data values or corrupted databases.**
- **Time- or date-dependent behaviour:** end-of-day, weekend, quarter-end, year-end.
- **Order-dependent task sequences:** what was done immediately before the failing task?
- **State left by a previous failure:** was the machine restarted after the last GPF?
- **Interactions with background or competing applications**, or with a shared device.

### Reporting nonreproducible bugs

**Always report them — they may be time bombs.** Customers encounter nonreproducible failures; confidence erodes; support costs spike. Programmers have code-analysis tools the tester lacks; a well-described nonreproducible symptom can often be traced to its source — credible estimates suggest programmers can fix around 20% of competently reported nonreproducible bugs. Even in organisations that policy-ignore them, reporting is still worthwhile because patterns across multiple reports for the same underlying fault emerge if reports are consistently filed.

**Flag clearly** (NR in the summary line, or a dedicated tracking field) to manage expectations. Screen-capture tools (PrintScreen, screen recorders, video) help document the existence of failures that would otherwise be dismissed. (lessons-learned-kaner ch-04)

---

## Politics of bug reporting — selling the bug

Bug advocacy requires understanding the organisational context in which fix decisions are made.

### The Change Control Board / Triage Team

In many organisations, fix decisions near the end of a project are made by a board — not by individual programmers. The tester may not attend these meetings. The bug report is the tester's only representative in the room. The test lead or manager advocates on the tester's behalf based on the quality of the report.

### The fix-risk calculus

Every change carries the risk of introducing a new bug. Late in the schedule, when testing time is limited, experienced project managers resist changes to code that appears stable. A persuasive bug report must acknowledge this: demonstrating a wide range of consequences and a broad set of triggering conditions makes the risk of *not* fixing appear worse than the risk of fixing.

### Routing to the right stakeholder

A bug that cannot be sold to the programming team may be fixable by routing it to someone whose budget is affected. Technical Support, Documentation, Sales, Marketing, Legal, and Accessibility teams each have different cost sensitivities. **Identify whose pain is greatest and route accordingly.**

- User-interface inconsistencies that seem trivial to programmers drive up documentation, training, and support costs; they can cost sales in demos; they may violate accessibility requirements; they damage product reviews. None of these costs appear in programmers' budgets — they appear in other people's.

### The appeal process

Every organisation has some appeal path — triage meetings, scrub meetings, private executive conversations. Understand the path, use it promptly, and prepare a substantially stronger case than the original report. **Appeals that rely on the original, already-rejected report fail predictably.**

### Framing cost and risk explicitly

The most effective bug reports include concrete cost language: estimated technical support cost, lost sales in demo scenarios, published competitor failures, legal or compliance exposure. Abstract statements of severity are less persuasive than specific financial framing.

### Scenario-based advocacy

Develop short narratives — plausible stories about how a real user would encounter the bug in ordinary use. Scenarios make abstract failures concrete and emotionally legible to non-technical decision-makers. (lessons-learned-kaner ch-04)

---

## Deferred-defect handling

### "Deferred" means real but not fixed in this release

Deferred bugs are open issues at the start of the next release. **Bug-tracking systems should automatically reopen deferred bugs** (or transfer them as open items) when work begins on the next version. "Works as designed" rejections that relate to decisions under review in the next release should also be reopened.

### Periodic cleanup of stale defects

Products with long histories accumulate bugs that will never result in changes. A periodic review with project managers — **best done at the start of a new project, under minimal schedule pressure** — can permanently close stale reports through an explicit "INWTSTA" (I Never Want To See This Again) decision.

### Testing inertia is never a valid reason for deferral

A fatally flawed process is one in which the test manager asks programmers not to fix a bug because the change would require updating too many checklists, test scripts, or other testing artefacts. **Test infrastructure must not become a barrier to product improvement.** (lessons-learned-kaner ch-04)

### Legitimate reasons not to fix

- The fix itself may introduce a more serious bug and there is insufficient testing time before release.
- The customer is not willing to pay for the fix.
- Fixing is more expensive than the cost of leaving it.
- A separate critical update is already planned and adding a cosmetic fix would delay it.

If a compelling case cannot be built — and no stakeholder can be found who will actively support an appeal — move on and advocate for a more impactful defect. **Do not insist that every bug be fixed; pick your battles.**

### Appeal protocol

When a bug is deferred or rejected as "works as designed," decide promptly whether to appeal. Delay erodes the case: an appeal made months after a decision rarely receives a sympathetic hearing.

**When you decide to fight, decide to win.** An appeal based solely on the original bug report (the document that already failed to persuade) is a waste of time and damages credibility. Build the case from scratch before appealing:

- Consult stakeholders in Technical Support, Documentation, and Sales. Identify whose budget will be hit hardest and by how much.
- Do additional follow-up testing to find more severe consequences or a broader range of triggering conditions.
- Develop user scenarios — realistic stories illustrating how a normal user encounters the bug in ordinary use.
- Search the press for competitor products that shipped a similar bug; published negative coverage is strong evidence.

Every appeal should be built to win. **Even losing appeals on well-built cases protect and build the tester's reputation as a credible advocate.** (lessons-learned-kaner ch-04)

---

## Closure protocol — closing the loop

### Bugs are closed by testers

When a bug is marked as resolved, a tester reviews the disposition:

- **For "fixed" resolutions:** attempt to demonstrate the fix is incomplete (variations of data, adjacent features, slightly different conditions). Under time pressure, programmers often fix the narrowest version of the symptom; retest with variations.
- **For "nonreproducible" or "not understood":** improve the report.
- **For "deferred" or "not a bug":** evaluate whether additional data justifies a challenge.
- **For "duplicate":** judge whether the duplicate classification is accurate — some project teams bury bugs by marking them as duplicates.

**No bug should be marked closed without tester review.**

### Verify fixes promptly

Test a fix as soon as it is available. Promptness signals respect for the programmer's work and improves the tester's reputation for responsiveness, which encourages prompt programmer attention to future bug reports. Finding a problem with the fix quickly — while the programmer still remembers what changed — makes rework faster and less error-prone.

### When fixes fail, talk directly

A repeatedly failing or late-breaking fix should not merely be entered in the tracking system and filed. Deliver the feedback directly and promptly — in person when possible, by phone when not. The tone should be helpful, not accusatory.

### Improving reporting skill

Study the bug-tracking system. Compare closed bugs that were fixed against those that were not — look for reporting differences. Read programmer responses to bug reports: what makes them confused, angry, unreceptive, or appreciative? Apply observations to future reports. **Peer review of bug reports before submission** improves report quality and trains staff; the reviewer checks that critical information is present and legible, attempts reproduction, and asks whether the report can be simplified, generalised, or strengthened. (lessons-learned-kaner ch-04)

---

## The tester-programmer relationship (evidence over authority)

Bug advocacy lands inside a working relationship. Kaner Ch 7 establishes the dynamics that make that relationship productive.

### Evidence over assertion

Disputes about whether a bug is real or reproducible are resolved by **logs and reproduction steps, not by insisting more loudly**. The tester's expertise is external product behaviour; speculation about root causes in areas outside that expertise undermines credibility. **Stick to what was observed.** (lessons-learned-kaner ch-07)

### State once, document, move on

If you believe a design decision will cause problems, record your concern once in a trackable form (comment, email, bug note). Repeated objections convert a professional concern into a personal conflict. Nagging signals poor professional judgment and erodes relationships without changing outcomes. (lessons-learned-kaner ch-07)

### Programmers operate from models

When a programmer says "that bug can't happen," they are not claiming infallibility — they are saying the failure contradicts their mental model. The tester's role is to surface evidence that tests that model. Maintain careful logs, report what was actually observed, and let the programmer reconcile the discrepancy. (lessons-learned-kaner ch-07)

### Service over auditing

Reframe the tester role as a service role rather than an auditing role. Test third-party components and share results so programmers can make integration decisions with real data. Test private builds before formal review cycles. Set up shared test environments. Review requirements for testability and ambiguity. **Every testing activity is ultimately service**; making the service visible and immediate accelerates trust. (lessons-learned-kaner ch-07)

### Never use bug-tracking as a performance metric

Bug count is a proxy metric that corrupts the system it is meant to measure:

- **Using bug data to evaluate programmers** produces predictable pushback: programmers contest whether design issues are bugs, argue that similar bugs are duplicates, insist nonreproducible bugs should not be reported, and question tester competence. Once the system is perceived as a political tool, it will be treated that way by everyone.
- **Rewarding testers by bug count** distorts behaviour: testers gravitate toward easy, superficial bugs; report multiple instances of the same defect; invest less in coaching peers or maintaining infrastructure. Programmers dismiss design bugs as fabricated artefacts of an inflated count.

The bug-tracking system is a technical communication tool, not an HR instrument. (lessons-learned-kaner ch-04, ch-07)

### Focus on the work, not the person

Report bugs, not character assessments. The moment a tester positions themselves as the evaluator of programmer quality, programmers stop sharing information. This cuts the tester off from the early access that makes testing effective. Testers who appoint themselves as disciplinarians become politically expendable — kept around as "bad cops" until a sufficiently large failure demands a scapegoat. If a pattern of systemic problems appears unaddressed, bring evidence to the appropriate manager discreetly and let management handle it. (lessons-learned-kaner ch-07)

### Escalation with warning

Before going to management, give the programmer the opportunity to address the issue. Announce the escalation before it happens. Bad news should be delivered directly. (lessons-learned-kaner ch-07)

---

## Tone and writing discipline

### Never exaggerate

Credibility is the foundation of influence. Overstating severity or artificially inflating ratings erodes trust and reduces overall influence over the long term. Work within the company's established classification scheme. If the scheme seems to misclassify a particular bug, use the most defensible rating and explain the reasoning explicitly: "I know this would normally be classed minor, but I believe this particular bug warrants serious because…"

### Report the problem clearly, but do not try to solve it

The tester's job is to report failures accurately, not to diagnose root causes or prescribe solutions. Root-cause analysis without access to the code is speculative. Reports focused on the tester's theory of the cause often omit the actual observed data the programmer needs. Solution-focused reports invite rejection: programmers who find the proposed solution invalid may dismiss the entire report. Deciding the correct fix is the product designer's role.

> "An error message appeared but I was unable to read it because it disappeared when I moved the mouse" is a better report than "the error message should appear in a modal dialog."

### Tone: every person you criticise will see the report

A blaming, sarcastic, or patronising tone never pays. It costs credibility, invites micromanagement, and reduces fix probability. ALL-CAPS text reads as screaming. **Before filing, read the report aloud using a threatening or sarcastic voice — if it sounds bad aloud, it will read badly too.** When tone has been a persistent issue, have a trusted colleague review the draft before filing.

### Demonstrating bugs directly when appropriate

Walking to the programmer's desk and showing a bug in action — or emailing an invitation before filing the formal report — can be the most efficient path to a fix, particularly for complex products where the programmer needs data the tester may not know to provide. Conditions for this to work: the tester should have already made the bug reproducible and done some follow-up testing before approaching; the less established the working relationship, the better-prepared the tester should be. If the programmer appears focused, send an email rather than interrupting. (lessons-learned-kaner ch-04)

### Reporting on prototypes

When a programmer shares a private build for informal feedback, respect the implicit rules: defects are communicated in conversation, notes, or email — not entered into the public tracking system. Entering these bugs publicly breaks trust and ends early access. Once the build becomes the public test target, any pre-release findings that remain unfixed belong in the tracking system. Watch for abuse of this arrangement — teams that keep every release labelled "prototype" to hide bugs from management. If this occurs, escalate to the test manager or to key stakeholders; never participate in a cover-up. (lessons-learned-kaner ch-04)

---

## Cardinal anti-patterns (avoid)

- **The "obviously already filed" assumption.** Assuming that a visible, serious bug has been reported by someone else. Multiple people make this assumption simultaneously, and the bug ships unfixed. **Always check first; if a weak report exists, strengthen it.**
- **Solution-focused reporting.** Specifying what the fix should be rather than what the failure is. Misdirects programmer attention, omits key observed data, invites rejection based on disagreement with the proposed solution rather than examination of the underlying problem.
- **Exaggerated severity.** Inflating severity to draw attention erodes credibility with every reader. Influence loss is durable and cross-report.
- **Blaming or sarcastic tone.** Reads as an attack to the programmer and to every manager in the review chain. Cost is credibility and professional standing.
- **Merged bug reports.** Combining multiple distinct bugs into one report to reduce bug count. Predictable outcome: some merged bugs are never fixed. **Criterion for separation:** if different tests would be needed to verify the fix for each issue, file them separately.
- **Testing-inertia deferrals.** Asking programmers not to fix a real bug because the fix would require updating test scripts or checklists. Test infrastructure serves the product, not the reverse.
- **Corner-case dismissal by the tester.** Pre-emptively deciding not to report extreme-value failures because programmers might call them corner cases. Extreme-value bugs are frequently security vulnerabilities; the tester is the last line of defence before the bug ships.
- **Filing and forgetting deferred bugs.** Treating "deferred" as a final close. Deferred bugs are open items for the next release and must be tracked.
- **Bug-tracking used for performance evaluation** (of programmers or testers). Corrupts reporting behaviour on both sides.
- **Rewording others' reports without permission.** Risks losing information and attributes words to someone who did not write them. Additions should be appended, dated, and initialled.
- **Appealing with the original rejected report.** Wastes time and damages credibility as an advocate. A meaningful appeal requires substantially new evidence or framing.
- **Late reporting.** Waiting until details are forgotten and the project team has drawn conclusions from the absence of bugs. Both the quality signal and the advocacy opportunity are degraded by delay. (lessons-learned-kaner ch-04, ch-07)

---

## Heuristics for evaluating whether a finding warrants a bug report

These are Kaner's seven **consistency oracles** (covered in detail in `synthesis/test-design-techniques.md` under the Evaluation dimension). When in doubt about whether observed behaviour is a bug:

1. Consistent with **history** — does current behaviour match prior behaviour of the same function?
2. Consistent with **organisational image** — does behaviour match what the organisation wants to project?
3. Consistent with **comparable products** — does it match similar functions in competing products?
4. Consistent with **claims** — does it match what has been stated about it?
5. Consistent with **user expectations** — does it match what users are likely to expect?
6. Consistent **within product** — is it consistent with analogous functions elsewhere in the same product?
7. Consistent with **purpose** — is it consistent with the apparent intent of the feature?

**Inconsistency is a reason to investigate, not automatically a reason to file.** It may reflect intentional design variation. When the inconsistency is meaningful, the bug report must explain *which* consistency is being violated and *why* that matters — that explanation is the heart of the advocacy. (lessons-learned-kaner ch-03 — referenced here because it is the canonical evaluation oracle for the defect process)

---

## Operational summary (defect lifecycle for `qa-defect-manager`)

1. **Discovery** — exploratory session, automated test failure, or stakeholder report.
2. **Isolation** — work backward from symptom to a minimal, reliable reproduction. Address delayed-fuse causes, time/date dependencies, task-order dependencies, environmental interactions.
3. **Variation testing on three axes** — vary behaviour, vary program state, vary environment. Report the worst observed consequence.
4. **Boundary extension** — for failures at an extreme value, test inward to find the actual failure boundary. Report the full failing range.
5. **Consistency oracle evaluation** — apply the seven heuristic-consistency types to evaluate whether the observation warrants a report.
6. **Draft report** — summary line (≤65 chars), severity, priority, reproduction steps, environment, reproducibility status, follow-up results, impact and context.
7. **Peer review before submission** — second tester verifies presence and clarity of critical information, attempts to reproduce, asks whether report can be simplified or strengthened.
8. **Submission and routing** — file in the tracking system; route to the right stakeholder if needed.
9. **Follow-up** — verify fix promptly when available; test variations and adjacent features; check for regressions introduced by the fix.
10. **Closure** — tester reviews every disposition. No bug is closed without tester review.
11. **Deferred handling** — deferred bugs are tracked as open items for the next release; periodic cleanup with project managers under low schedule pressure.
12. **Appeal protocol when warranted** — build the case from scratch; consult stakeholders; do additional testing; develop user scenarios; cite competitor coverage. Every appeal built to win.

---

## Pointers

- Used by agent: `qa-defect-manager` (primary — this synthesis drives the agent's prompts entirely)
- Used by agents: `qa-test-executor`, `qa-orchestrator`, `qa-closure-reporter`, `qa-executive-reporter`, `qa-curator`
- Cross-ref: [[synthesis/test-design-techniques.md]] (the seven heuristic-consistency oracles; bug isolation as a coverage technique)
- Cross-ref: [[synthesis/exploratory-testing.md]] (the activity that surfaces most bugs the advocacy process then sells)
- Cross-ref: [[synthesis/metrics-and-reporting.md]] (defect metrics that *can* and *cannot* be measured without corrupting the tracking system)
