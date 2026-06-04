---
book: lessons-learned-kaner
chapter: 4
title: "Bug Advocacy"
lessonsCovered: "47 lessons"
topics:
  - defect-management
  - bug-reports
  - severity
  - priority
  - reproduction-steps
  - root-cause-analysis
  - bug-isolation
  - bug-variation
  - bug-advocacy
  - deferred-defects
  - regression-defects
  - sev-vs-prio
  - qa-pm-relationship
  - defect-taxonomy
  - bug-write-up
applies_to_agents:
  - qa-defect-manager
  - qa-test-executor
  - qa-orchestrator
  - qa-closure-reporter
  - qa-executive-reporter
  - qa-curator
---

# Chapter 4 — Bug Advocacy

> Summary: this is THE canonical bug-reporting reference. Aegis's defect-report template is built on these lessons. The chapter reframes bug reporting as an act of professional advocacy — you are selling the case for a fix to people who control scarce time and money. Every lesson flows from that premise.

---

## Core Lessons (paraphrased)

### Lesson 1 — You are what you write

Bug reports are the primary work product of most testers. Readers form their perception of a tester through these documents. Good reports of real bugs build reputation; weak or sloppily written reports waste programmers' time and breed resentment. Managers and executives also read bug reports: a blaming or petty tone, poor explanation, or inadequate research will create a negative impression with the people who control career outcomes. Take the time to research and write every report well.

### Lesson 2 — Your advocacy drives the repair of the bugs you report

Every bug report is an advocacy document. Not every bug will be fixed — that is not the tester's responsibility. The tester's responsibility is to report accurately and in a way that allows any reader to understand the full impact of the problem. Research quality and writing quality directly affect the probability of a fix.

### Lesson 3 — Make your bug report an effective sales tool

A bug report is a sales document: it asks people to spend time and money in return for a quality improvement. Good sales practice requires two things:

**State the benefit so the reader will want it.** Explain how the bug interferes with normal use, what data it corrupts, how often users will encounter it. Reference competitor reviews that savaged a similar bug. Quote technical support statistics. Show that the product passed this test in a previous release. Or route the report to someone whose feature is blocked by this bug.

**Anticipate objections and counter them.** Common objections include: too minor, not reproducible, impossible to understand, unlikely in the real world, hardware-specific, too risky to fix, will not bother real users. Address these pre-emptively through good reporting practice: write clearly, verify reproduction on multiple configurations, include concrete cost data such as "A similar bug in Release 2 cost over $100,000 in technical support."

### Lesson 4 — Your bug report is your representative

When the report is filed, the tester is usually absent. The report must speak for itself to a programmer the tester does not manage, to project managers, and often to the Change Control Board (also called the triage team, project team, war team, or bug review team). Every change the board considers costs money, takes time, and risks introducing new defects. The bug report is often the tester's only vehicle for persuading decision-makers to approve a fix.

### Lesson 5 — Take the time to make your bug reports valuable

Bug reports serve many stakeholders simultaneously. They alert people to defects and help programmers troubleshoot. They flag errors in specifications, test documentation, user documentation, and development tools. They provide background for technical writers building troubleshooting content. They surface issues for customer training. They support post-sale technical support for unfixed problems. They give management a picture of product quality. They feed the next-release improvement backlog. Because so many people rely on this one document, the investment in writing it well pays compounding dividends.

### Lesson 6 — Any stakeholder should be able to report a bug

A stakeholder is anyone with a vested interest in product success — employees, customers, or heavy users. Anyone in the company convinced that quality or the feature set is wrong should be able to record that concern in a way that reaches the development team. The testing group should facilitate this communication rather than gatekeep it, especially when complaints come from outside Product Development. Bug-tracking data may be treated as confidential (like source code), but a wide range of people should have write access to the records.

### Lesson 7 — Be careful about rewording other people's bug reports

Add comments; do not edit another person's material without permission. Rewording risks losing important information and puts words into someone else's name. Every addition to a bug report — especially to someone else's report — should be initialled and dated (e.g., "[CK 12/27/01]" at the start of a new line). This practice also makes it easy to direct follow-up questions to the right person.

### Lesson 8 — Report perceived quality gaps as bugs

Quality is value to some person (Weinberg). If a legitimate stakeholder is disappointed by the product and considers it less valuable because of something the product does or fails to do, that disappointment should be written up as a bug report. The tester's task is to help that stakeholder articulate the concern clearly and effectively.

### Lesson 9 — Some stakeholders cannot report bugs — you are their proxy

Customers of commercial off-the-shelf software cannot report bugs during development because they do not have the product yet. Other stakeholders may be unavailable. The tester stands in for absent stakeholders. To do this credibly, testers must study the ways users will actually use the product and what they will value or resent about a product of this type.

### Lesson 10 — Draw the affected stakeholder's attention to controversial bugs

When a bug is hard to get fixed through normal channels, identify who else in the company is harmed if it stays unfixed. User-interface inconsistencies, for example, may seem trivial to programmers but drive up documentation, training, and support costs; they can cost sales in demos; they may violate accessibility requirements; they damage product reviews. None of these costs appear in programmers' budgets. Route the bug report — or a memo attached to a copy — to the people whose budgets will suffer. They become the tester's advocates. If they are indifferent to the impact, that is a signal to move on and advocate for a more impactful bug instead.

### Lesson 11 — Never use the bug-tracking system to monitor programmers' performance

Using bug-tracking data to embarrass or evaluate individual programmers produces predictable and counterproductive pushback: programmers contest whether design issues are bugs at all, argue that similar bugs are duplicates, insist nonreproducible bugs should not be reported, and question the tester's competence. Once the system is perceived as a political or HR tool rather than a technical one, it will be treated that way by everyone.

### Lesson 12 — Never use the bug-tracking system to monitor testers' performance

Rewarding testers by bug count distorts behavior: testers gravitate toward easy, superficial bugs and are more willing to report multiple instances of the same defect. They invest less in coaching peers or maintaining the testing infrastructure. Programmers are more likely to dismiss design bugs as fabricated artifacts of an inflated count. Bug count is a proxy metric that corrupts the system it is meant to measure.

### Lesson 13 — Report defects promptly

Do not wait until tomorrow or next week. Delays cause forgotten details. Late reporting also produces a false quality signal: managers watching a testing area with no incoming bug reports conclude (incorrectly) that the area is stable.

### Lesson 14 — Never assume an obvious bug has already been filed

The shared assumption that "someone else reported it" allows serious bugs to reach release unfixed. Before assuming a report exists, check the tracking system. If a weak report exists, add information to strengthen it or file a new, better report. The danger of the assumption has been observed for severe, widely known bugs that were never formally filed until beta complaints surfaced.

### Lesson 15 — Report design errors

A program is part of a system that includes equipment, other software, and people. Bugs include design errors — things that make the program hard to use, confusing, uncooperative with surrounding software, or hardware-restricted. Testers are often the only development staff who exercise the full system before it ships. The objection that "design should have been settled earlier" fails in practice because people do not fully understand the implications of a system until it is built. The objection that "testers lack design expertise" is real but addressable: testers should consult published UI guidelines and domain experts before criticizing design, but if the error is clear, it belongs in the tracking system. Test groups increase design-evaluation capability by hiring people with diverse backgrounds — domain expertise, database design, network security, user interface, and so on.

### Lesson 16 — Extreme-looking bugs are potential security flaws

Buffer-overrun bugs — which occur when more data is entered than the allocated memory can hold, with excess data spilling into adjacent memory — are the source of the majority of internet break-ins. Testers trained to dismiss "unrealistic" extreme-value inputs miss the most exploitable defects. Any bug that can interfere with program operation or corrupt data is an exploit-in-waiting. A skilled attacker can weaponize a flaw and distribute the exploit broadly. Severe-consequence bugs must be fixed regardless of how unlikely the triggering condition appears.

### Lesson 17 — Uncorner your corner cases

Extreme values are efficient test inputs precisely because they stress the program with a small number of cases. Programmers sometimes dismiss results at extreme values as "corner cases" — a rhetorical move to avoid fixing bugs. The counter-technique is to keep testing inward from the extreme until the actual failure boundary is established. Reporting that the program fails across the entire range 100–999 — not just at 999 — is far more persuasive. If the failure is truly narrow, report the narrow boundary explicitly rather than dropping the bug.

### Lesson 18 — Minor bugs are worth reporting and fixing

Minor errors — spelling mistakes, mouse droppings, minor calculation errors, incorrect error messages, shortcut keys that do not work, mishandled timeouts — erode customer confidence cumulatively. Research by Kaner and Pels on a strong-selling mass-market product showed that "cheap fixes" (costing fewer than four hours each) could have prevented over half of all technical support calls. After fixing those minor issues, technical support cost per new customer fell by roughly half and market share increased substantially. Progressive toleration of minor defects normalizes acceptance of larger ones — a dynamic documented in the Challenger disaster.

### Lesson 19 — Keep clear the difference between severity and priority

Severity describes the impact or consequence of a bug. Priority indicates when the company wants it fixed. These are independent dimensions and must not be conflated. Severity is stable — it does not change unless follow-up investigation reveals hidden consequences. Priority shifts as the project timeline and business context change. A bug that corrupted data before December 1999 was once high priority; after that date passed, the severity remained, but the priority justifiably dropped. Conversely, a cosmetic bug — a misspelled company name on the splash screen — has low severity but may be treated as highest priority before a product launch. Both dimensions belong in every bug report; neither substitutes for the other.

### Lesson 20 — A failure is a symptom of an error, not the error itself

What the tester observes is a misbehavior of the program, not the underlying code error. A minor-looking symptom (mouse droppings) may reflect a severe underlying fault (wild pointer). Under slightly different conditions, the same fault may produce catastrophic failures. Therefore: when a symptom looks minor, do follow-up testing to find more severe manifestations and to demonstrate a wider range of circumstances. When a problem is hard to reproduce, do follow-up testing to isolate the critical conditions that make it consistent, then drive the now-reproducible bug toward its worst expression.

### Lesson 21 — Do follow-up testing on seemingly minor coding errors

When the first failure appears, the program is in a state the programmer neither intended nor anticipated. Data may now hold impossible values. Three types of follow-up testing are recommended:

**Vary your behavior (change what you do).** Repeat the failure path to check for cumulative effects. Try tasks related to the failing task. Try tasks related to the failure symptom. Change the speed of activity. Continue using the program without restarting, running unrelated tests in the degraded state.

**Vary the options and settings of the program (change program state).** Switch databases, change persistent variable values, change memory use, alter any preference or option the program exposes. In the scrolling-after-addition example, change window size, digit precision, or background spell-checker activity.

**Vary the software and hardware environment (change the environment).** This is not standard configuration testing. The goal is to ask what environmental changes would make the failure more dramatic. If timing seems relevant, use a different processor speed or communications connection. If memory seems relevant, test with reduced memory or altered virtual memory settings.

Time investment in follow-up testing: at minimum, a few minutes for every failure believed to reflect a coding error. For some failures, up to a full day. Trust judgment; stop when the marginal return on additional testing is low.

### Lesson 22 — Always report nonreproducible errors; they may be time bombs

Nonreproducible failures can be the most expensive bugs in a release. Customers encounter them, confidence erodes, support costs spike. Programmers have code-analysis tools the tester lacks; a well-described nonreproducible symptom can often be traced by a programmer to its source — credible estimates suggest programmers can fix around 20% of competently reported nonreproducible bugs. Even in organizations that policy-ignore them, reporting is still worthwhile: patterns across multiple nonreproducible reports for the same underlying fault will emerge if reports are consistently filed. Flagging a bug as nonreproducible (NR in the summary line, or via a dedicated tracking field) manages expectations. Screen-capture tools — PrintScreen, screen recorders, even video — help document the existence of failures that would otherwise be dismissed.

### Lesson 23 — Nonreproducible bugs are reproducible

Every failure occurs under specific conditions. Inability to reproduce means the critical conditions are not yet identified. Conditions that are frequently overlooked:

- Delayed-fuse causes: memory leaks, wild pointers, corrupted stacks. Monitor memory usage over time; use tools like Bounds Checker or Purify.
- First-installation-only behavior: use disk imaging tools (Drive Image, Ghost) to restore a clean system and re-test.
- Specific data values or corrupted databases.
- Time- or date-dependent behavior: end-of-day, weekend, quarter-end, year-end.
- Order-dependent task sequences: what was done immediately before the failing task?
- State left by a previous failure: was the machine restarted after the last GPF?
- Interactions with background or competing applications, or with a shared device.

### Lesson 24 — Be conscious of the processing cost of your bug reports

Every bug report costs time to write, read, evaluate, and sometimes escalate to the Change Control Board. Late in a project, flooding the system with minor or irreproducible reports can paralyze the programming and project management teams. The appropriate responses: write minor-bug reports with exceptional clarity; discuss group policy with the test manager before releasing a batch of minor bugs late in the schedule (a secondary database may be better); for irreproducible bugs filed late, explicitly state they are nonreproducible and document all troubleshooting steps taken.

### Lesson 25 — Give special handling to bugs related to the tools or environment

When a failure is caused entirely by a known weakness in the operating system or a third-party system and is completely outside the programmers' control, declining to report may be reasonable. However, if the application can avoid the triggering system call or add appropriate error handling, the failure is also an application bug and should be reported as such. A note in the report — acknowledging the OS-level involvement while requesting an application-level workaround — is the correct approach. Configuration snapshot tools help document the environment at the time of failure. Bugs caused by third-party code integrated into the application should always be reported; they are failures the company is shipping to customers.

### Lesson 26 — Ask before reporting bugs against prototypes or early private versions

When a programmer shares a private build for informal feedback, respect the implicit rules: defects are communicated in conversation, notes, or email, not entered into the public tracking system. Entering these bugs publicly breaks the programmer's trust and ends early access. Once the build becomes the public test target, any pre-release findings that remain unfixed belong in the tracking system. Watch for abuse of this arrangement — teams that keep every release labeled "prototype" to hide bugs from management. If this occurs, escalate to the test manager or to key stakeholders; never participate in a cover-up.

### Lesson 27 — Duplicate bug reports are a self-correcting problem

Adding data to an existing open report is usually preferable to filing a separate report on what appears to be the same bug. Cross-reference similar reports. That said: do not let the search for duplicates consume disproportionate time. Every well-written report of a similar bug carries new information that can aid diagnosis. Whether two failures share a single fault or reflect multiple faults is often not clear until after the fix. The best solution to inflated bug counts from duplicates is to fix the bugs.

### Lesson 28 — Every bug deserves its own report

Do not merge distinct bugs onto a single report to appease those who complain about duplicate counts. Merged reports predictably result in some bugs never being fixed. The criterion for filing separately: if different tests would be needed to verify the fix for each issue, file them as different bugs. When similar minor bugs are batched for efficiency, reopen individual reports for any items that remain unfixed after the batch is marked resolved.

### Lesson 29 — The summary line is the most important line in the bug report

The summary (headline, title) is read by project managers, executives, and other managers when scanning lists of unresolved or deferred bugs — often in triage or bug-scrub meetings. Bugs with weak headlines are dismissed. The summary line is a tester's best single tool for selling the bug to non-technical decision-makers. A good summary includes:

- A specific description the reader can visualize.
- A brief indication of how narrow or broad the triggering circumstances are.
- A brief indication of the impact or consequences.

Because management reports typically display only one line of summary (approximately 65 characters), choose the most compelling element rather than trying to fit everything. The rest belongs in the detailed description.

### Lesson 30 — Never exaggerate your bugs

Credibility is the foundation of influence. Overstating severity or artificially inflating the severity rating will erode trust and reduce overall influence over the long term. Work within the company's established severity classification scheme. If the scheme seems to misclassify a particular bug, use the most defensible rating and explain the reasoning explicitly in the description: "I know this would normally be classed minor, but I believe this particular bug warrants serious because..."

### Lesson 31 — Report the problem clearly, but do not try to solve it

The tester's job is to report failures accurately, not to diagnose root causes or prescribe solutions. Root-cause analysis without access to the code is speculative at best. Reports focused on the tester's theory of the cause often omit the actual observed data the programmer needs to understand what happened. Solution-focused reports invite rejection: programmers who find the proposed solution invalid may dismiss the entire report without examining the underlying problem. Deciding the correct fix is the product designer's role. "An error message appeared but I was unable to read it because it disappeared when I moved the mouse" is a better report than "the error message should appear in a modal dialog." A tentative suggestion may be appropriate in the context of an established working relationship, framed as a question rather than a prescription.

### Lesson 32 — Be careful of your tone; every person you criticize will see the report

A blaming, sarcastic, or patronizing tone never pays. It costs credibility, invites micromanagement, and reduces the probability of fixes. ALL-CAPS text reads as screaming. Before filing, read the report aloud using a threatening or sarcastic voice — if it sounds bad aloud, it will read badly too. When tone has been a persistent issue, have a trusted colleague review the draft before filing.

### Lesson 33 — Make your reports readable, even to people who are exhausted and cranky

Many bugs are fixed in the final weeks of a project by sleep-deprived programmers working heavy overtime. Write for those readers. Reproduction-step best practices:

- Walk through the bug one step at a time.
- Number each step.
- Include every step needed to reproduce; skip none.
- Use the shortest step sequence that reaches the failure.
- Use whitespace to make scanning easy.
- Use short, simple sentences.
- State what happened and what was expected to happen.
- Explain why consequences are serious if there is any chance the programmer may not see it.
- Include comments that will help the programmer recognize the problem or help the tester retest after the fix.
- For complicated problems, open with a three-line executive summary, then give the detailed steps.
- Keep tone neutral.
- Avoid jokes — they will be misunderstood.

### Lesson 34 — Improve your reporting skills

Study the bug-tracking system for lessons. Compare closed bugs that were fixed against those that were not — look for reporting differences. Read programmer responses to bug reports: what makes them confused, angry, unreceptive, or appreciative? Apply those observations to future reports.

### Lesson 35 — Use market or support data when appropriate

When possible, compare the product's behavior to leading competitors to help characterize user expectations. Gather stories from salespeople and sales engineers about customer questions and demo requirements. Connect bug reports to technical support records for similar or related issues. Estimate the support cost of deferring the bug, or quantify the customer and support-staff pain if the bug ships unfixed.

### Lesson 36 — Review each other's bug reports

A peer-review practice, where a second tester reviews defect reports before submission, improves report quality and trains staff. The reviewing tester checks that critical information is present and legible, attempts to reproduce the bug, and asks whether the report can be simplified, generalized, or strengthened. If problems are found, the report goes back to the original reporter with coaching notes. Beware of overburdening the reviewing tester; balance thoroughness against the cost of the review process itself.

### Lesson 37 — Meet the programmers who will read your reports

Reports written for known individuals tend to be more courteous and more carefully researched than reports written for anonymous readers. Knowing the programmer personally reduces the tendency to see the other party as incompetent rather than as a fallible professional doing a difficult job.

### Lesson 38 — The best approach may be to demonstrate your bugs to the programmers

Walking to the programmer's desk and showing a bug in action — or emailing an invitation before filing the formal report — can be the most efficient path to a fix, particularly for complex products where the programmer needs data the tester may not know to provide. Conditions for this approach to work well: the tester should have already made the bug reproducible and done some follow-up testing before approaching; the less established the working relationship, the better-prepared the tester should be. If the programmer appears focused, send an email rather than interrupting. If the programmer is chronically unavailable, file bugs without the demonstration step.

### Lesson 39 — When the programmer says it is fixed, make sure it is not still broken

Under time pressure, programmers often fix the narrowest version of the symptom described in the report. Retesting should include variations: different data, adjacent features, the same operation under slightly different conditions. Look for whether the fix introduced a new problem elsewhere.

### Lesson 40 — Verify bug fixes promptly

Test a fix as soon as it is available. Promptness signals respect for the programmer's work and improves the tester's reputation for responsiveness, which in turn encourages prompt programmer attention to future bug reports. Finding a problem with the fix quickly — while the programmer still remembers what was changed — makes the rework faster and less error-prone.

### Lesson 41 — When fixes fail, talk with the programmer directly

A repeatedly failing or late-breaking fix should not merely be entered in the tracking system and filed. Deliver the feedback directly and promptly — in person when possible, by phone when not. The tone should be helpful, not accusatory: the goal is to give the programmer the information right away and offer to clarify the report or demonstrate the failure. If the programmer works for another company, check with the project manager before calling.

### Lesson 42 — Bug reports should be closed by testers

When a bug is marked as resolved, a tester should review the disposition. For "fixed" resolutions, the tester should attempt to demonstrate the fix is incomplete. For "nonreproducible" or "not understood" dispositions, the tester should improve the report. For "deferred" or "not a bug" dispositions, the tester should evaluate whether additional data justifies a challenge. For "duplicate" dispositions, the tester should judge whether the duplicate classification is accurate — some project teams bury bugs by marking them as duplicates. No bug should be marked closed without tester review.

### Lesson 43 — Do not insist that every bug be fixed; pick your battles

Legitimate reasons not to fix a bug include: the fix itself may introduce a more serious bug and there is insufficient testing time before release; the customer is not willing to pay for the fix; fixing is less expensive than the cost of repair; a separate critical update is already planned and adding a cosmetic fix would delay it. If a compelling case cannot be built — and no stakeholder can be found who will actively support an appeal — move on and advocate for a more impactful defect.

### Lesson 44 — Do not let deferred bugs disappear

"Deferred" means real but not fixed in this release. Deferred bugs are open issues at the start of the next release. Bug-tracking systems should be configured to automatically reopen deferred bugs (or transfer them as open items) when work begins on the next version. "Works as designed" rejections that relate to decisions under review in the next release should also be reopened. Products with long histories accumulate bugs that will never result in changes; a periodic review with project managers — best done at the start of a new project, under minimal schedule pressure — can permanently close stale reports through an explicit "INWTSTA" (I Never Want To See This Again) decision.

### Lesson 45 — Testing inertia should never be the cause of bug deferral

A fatally flawed process is one in which the test manager asks programmers not to fix a bug — coding error or design error — because the change would require updating too many checklists, test scripts, or other testing artifacts and would therefore take too long to manage. Test infrastructure must not become a barrier to product improvement.

### Lesson 46 — Appeal bug deferrals immediately

When a bug is deferred or rejected as "works as designed," decide promptly whether to appeal. Appeals may be made through formal channels (bug-scrub or triage meetings) or through direct conversations with executives, depending on company culture. Delay erodes the case: an appeal made months after a decision rarely receives a sympathetic hearing.

### Lesson 47 — When you decide to fight, decide to win

An appeal based solely on the original bug report — the document that already failed to persuade — is a waste of time and damages credibility. Build the case from scratch before appealing:

- Consult stakeholders in Technical Support, Documentation, and Sales. Identify whose budget will be hit hardest and by how much.
- Do additional follow-up testing to find more severe consequences or a broader range of triggering conditions.
- Develop user scenarios — realistic stories illustrating how a normal user encounters the bug in ordinary use.
- Search the press for competitor products that shipped a similar bug; published negative coverage is strong evidence.

Every appeal should be built to win. Even losing appeals on well-built cases protect and build the tester's reputation as a credible advocate.

---

## The Canonical Bug-Report Structure

The book does not prescribe a rigid field-by-field template, but synthesizes the following structure from its lessons:

**Summary line (headline)**
One line, approximately 65 characters. Must convey: a specific description of the failure, a hint at the breadth of triggering conditions, and the impact. This is the primary selling tool for decision-makers who scan lists.

**Severity**
The impact or consequence of the bug. Stable — does not change unless new consequences are discovered. Drawn from the company's classification scheme. If the classification seems wrong, state the preferred rating and explain why.

**Priority**
When the company wants it fixed. Set by the project team. Separate from severity; must not be used as a synonym.

**Reproduction steps**
Numbered, sequential, complete. No steps omitted. The shortest path to the failure. Short, simple sentences. State what happened and what was expected to happen. Written for a sleep-deprived, time-pressured reader.

**Environment / configuration**
Hardware, OS, software version, relevant settings. Include configuration snapshots when environment interactions are suspected.

**Reproducibility status**
Explicitly flagged: reproducible, nonreproducible, intermittent, or unknown. If nonreproducible, document the troubleshooting steps taken.

**Follow-up testing results**
Findings from behavior variation, options/settings variation, and environment variation. Report the worst observed consequence, not just the first observed symptom.

**Impact and context**
Explain why the consequence is serious if there is any possibility the reader will not grasp it. Include market data, support cost estimates, competitor comparisons, or stakeholder impact when relevant.

**Attribution of additions**
Any content added to the report after initial filing, especially by a different person, should be initialed and dated.

---

## Heuristics for Bug Investigation

### Bug Isolation

The goal of isolation is to determine the minimal, reliable set of conditions that produce the failure.

- Start from the observed symptom and work backward: what state was the program in, what actions preceded the failure?
- Treat nonreproducibility as an information gap, not a dead end. List all conditions that could vary and test each.
- Check for delayed-fuse mechanisms: memory leaks, wild pointers, corrupted stacks, state accumulated across sessions.
- Use disk imaging to restore a clean installation state when first-time-only behavior is suspected.
- Check for time and date dependencies — end-of-day, week, quarter, year.
- Check for task-order dependencies: what was done immediately before the failing operation?
- Check for lingering effects of prior failures: was the machine restarted cleanly?
- Check for environmental interactions: other applications running, shared device contention.

### Variation (Follow-Up Testing)

Once the bug is isolated, variation testing extends understanding of its scope and severity:

**Vary behavior (change what you do)**
- Repeat the failure path: is there a cumulative effect?
- Try tasks related to the failing task.
- Try tasks related to the failure type.
- Change sequencing: trigger the failure symptom first, then the related task.
- Change activity speed.
- Continue using the program in the degraded state without resetting.

**Vary program state (change options and settings)**
- Switch databases or data files.
- Change persistent variable values.
- Alter memory configuration, window size, display precision, background-process settings.
- Change any preference or option the program exposes.

**Vary the environment (change software and hardware context)**
- Change processor speed or load if timing is suspected.
- Change memory size or virtual memory settings if memory pressure is suspected.
- Change communication connection speed or type if network interaction is suspected.
- Add or remove background applications.

### The Boundary-Extension Technique (Uncornering Corner Cases)

When a failure occurs at an extreme value, do not stop there. Test inward until the actual failure boundary is found. Report the full failing range (e.g., "fails for all values 100–999") rather than the single extreme case. A broad failure range is far more compelling to decision-makers than a single data point at the edge.

### Follow-Up Investigation After a Fix

After a fix is applied, do not merely retest the exact reproduction steps from the original report. The fix may address the narrow symptom while leaving the underlying fault active under slightly different conditions. Test adjacent operations, different data, and related features. Look for regressions introduced by the fix itself.

---

## Severity vs. Priority — The Canonical Distinction

**Severity** is the intrinsic impact of a bug on the product, its users, or the business. It describes what happens when the bug is triggered: data corruption, crash, security exposure, incorrect output, poor usability. Severity is determined by the nature of the failure. It does not change unless follow-up investigation reveals consequences that were not apparent in the initial report.

**Priority** is a scheduling decision. It reflects when — or whether — the project team wants the bug fixed given the current state of the project. Priority is a function of business context: schedule, budget, release timing, risk tolerance, competitive pressures. Priority changes frequently as these factors shift.

These two dimensions interact but are not the same:

| Scenario | Severity | Priority |
|---|---|---|
| Data-corruption bug triggered only by a date that has already passed | High | Low (the trigger no longer applies) |
| Misspelled company name on launch splash screen | Low (cosmetic) | High (embarrassing before any user sees the product) |
| Crash on obscure edge case with a known workaround | Medium-High | Medium (workaround exists; fix scheduled for next release) |
| Security buffer-overrun on field accepting large input | Critical | High (regardless of how unlikely normal users would trigger it) |

The book's position is unambiguous: severity describes reality; priority describes resource allocation. Conflating them — rating a bug's severity based on when the team plans to fix it, or setting priority based solely on perceived severity — produces misinformation in both directions.

---

## Politics of Bug Reporting — "Selling" the Bug

Bug advocacy requires understanding the organizational context in which fix decisions are made. Key political realities:

**The Change Control Board (CCB) / Triage Team**
In many organizations, fix decisions near the end of a project are made by a board — not by individual programmers. The tester may not attend these meetings. The bug report is the tester's only representative in the room. The test lead or manager advocates on the tester's behalf based on the quality of the report.

**The fix-risk calculus**
Every change carries the risk of introducing a new bug. Late in the schedule, when testing time is limited, experienced project managers resist changes to code that appears stable. A persuasive bug report must acknowledge this: demonstrating a wide range of consequences and a broad set of triggering conditions makes the risk of not fixing appear worse than the risk of fixing.

**Routing to the right stakeholder**
A bug that cannot be sold to the programming team may be fixable by routing it to someone whose budget is affected. Technical Support, Documentation, Sales, Marketing, Legal, and Accessibility teams each have different cost sensitivities. Identify whose pain is greatest and route accordingly.

**The appeal process**
Every organization has some appeal path — triage meetings, scrub meetings, private executive conversations. Understand the path, use it promptly, and prepare a substantially stronger case than the original report. Appeals that rely on the original, already-rejected report fail predictably.

**Framing cost and risk explicitly**
The most effective bug reports include concrete cost language: estimated technical support cost, lost sales in demo scenarios, published competitor failures, legal or compliance exposure. Abstract statements of severity are less persuasive than specific financial framing.

**Scenario-based advocacy**
Develop short narratives — plausible stories about how a real user would encounter the bug in ordinary use. Scenarios make abstract failures concrete and emotionally legible to non-technical decision-makers.

---

## Anti-Patterns

**Anti-pattern: The "obviously already filed" assumption**
Assuming that a visible, serious bug has been reported by someone else. Multiple people make this assumption simultaneously, and the bug ships unfixed.

**Anti-pattern: Solution-focused reporting**
Writing a report that specifies what the fix should be rather than what the failure is. This misdirects the programmer's attention, omits key observed data, invites rejection based on disagreement with the proposed solution rather than examination of the underlying problem, and positions the tester as overstepping their role.

**Anti-pattern: Exaggerated severity**
Inflating the severity rating to draw attention to a report. Erodes credibility with every reader; reduces influence over time and across all future reports.

**Anti-pattern: Blaming or sarcastic tone**
Any report that uses accusatory language, names a programmer's failures, or writes in ALL CAPS reads as an attack. The programmer and every manager in the review chain will see it. The cost is credibility and professional standing.

**Anti-pattern: Merged bug reports**
Combining multiple distinct bugs into one report to reduce the bug count. The predictable outcome is that some of the merged bugs are never fixed. Each bug that requires different tests for verification deserves its own report.

**Anti-pattern: Testing-inertia deferrals**
Asking programmers not to fix a real bug because the fix would require updating test scripts or checklists. The testing infrastructure is supposed to serve the product, not the reverse.

**Anti-pattern: Corner-case dismissal by the tester**
Pre-emptively deciding not to report extreme-value failures because programmers might call them corner cases. Extreme-value bugs are frequently security vulnerabilities. The tester who self-censors at this boundary is the last line of defense before the bug ships.

**Anti-pattern: Filing and forgetting deferred bugs**
Treating a "deferred" disposition as a final close. Deferred bugs are open items for the next release and must be tracked accordingly. Systems that do not automatically carry deferred bugs forward produce backlogs of known unfixed defects with no accountability.

**Anti-pattern: Bug-tracking used for performance evaluation**
Using bug counts — for programmers or for testers — as a performance metric. Corrupts reporting behavior on both sides, destroys the informational integrity of the tracking system, and produces defensive rather than collaborative relationships between testers and programmers.

**Anti-pattern: Rewording others' reports without permission**
Editing another person's bug report without consent risks losing information and attributes words to someone who did not write them. Additions should be appended, dated, and initialed — never substituted.

**Anti-pattern: Appealing with the original rejected report**
Filing an appeal that restates the original unsuccessful case. This wastes everyone's time and damages the tester's credibility as an advocate. A meaningful appeal requires substantially new evidence or framing.

**Anti-pattern: Late reporting**
Waiting to file reports until details are forgotten and the project team has drawn conclusions from the absence of bugs. Both the quality signal and the advocacy opportunity are degraded by delay.

---

## Cross-refs

- `[[lessons-learned-kaner/ch-01-the-role-of-the-tester]]` — the professional role that makes bug advocacy the tester's core responsibility
- `[[lessons-learned-kaner/ch-02-thinking-like-a-tester]]` — the cognitive framing and heuristic thinking that underlies bug investigation
- `[[lessons-learned-kaner/ch-03-testing-techniques]]` — the test design techniques that discover the bugs this chapter teaches how to report
- `[[lessons-learned-kaner/ch-05-automating-testing]]` — automation considerations that affect how bugs from automated runs are reported and tracked
- `[[lessons-learned-kaner/ch-06-documenting-testing]]` — broader documentation practices that contextualize the bug report within the test record
- `[[lessons-learned-kaner/ch-07-interacting-with-programmers]]` — relationship management with the people who receive and act on bug reports
- `[[lessons-learned-kaner/ch-08-managing-the-testing-project]]` — project-level context for triage, Change Control Boards, and deferral politics
- `[[lessons-learned-kaner/ch-09-managing-the-testing-group]]` — group-level policies on bug-report review, training, and metrics
- `[[lessons-learned-kaner/ch-10-your-career-in-software-testing]]` — how bug advocacy quality shapes professional reputation
- `[[lessons-learned-kaner/ch-11-planning-the-testing-strategy]]` — how the overall test strategy affects what categories of bugs surface and when
- `[[lessons-learned-kaner/appendix-the-context-driven-approach]]` — the philosophical foundation for judgment-based reporting decisions
- `[[full-stack-testing-mohan/ch-02-manual-exploratory-testing]]` — cross-book: bug discovery methods that feed the advocacy pipeline described here
