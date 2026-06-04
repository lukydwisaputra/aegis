---
book: lessons-learned-kaner
chapter: 7
title: "Interacting with Programmers"
lessonsCovered: "7 lessons (Lessons 148–154 approx.)"
topics:
  - soft-skills
  - communication
  - tester-developer-relationship
  - collaboration
  - conflict-resolution
  - qa-as-coach
  - professionalism
applies_to_agents:
  - qa-orchestrator
  - qa-defect-manager
  - qa-curator
  - qa-test-planner
  - qa-executive-reporter
---

# Chapter 7 — Interacting with Programmers

> Testers and programmers are interdependent professionals who must build trust through mutual respect, honest communication, and service orientation. An adversarial stance erodes access to the early information that makes testing most effective; a collaborative stance earns it.

---

## Core lessons (paraphrased)

### 1. Understand how programmers think

Programmers and testers operate under fundamentally different conditions and develop different mental habits as a result.

- **Specialists vs. generalists.** A programmer typically owns a narrow subsystem and relies on incomplete knowledge of adjacent components. A tester must understand how the entire system fits together — and can therefore act as a cross-cutting information source for the team.
- **Model-driven vs. observation-driven.** When a programmer says "that bug can't happen," they are not claiming infallibility — they are saying the failure contradicts their mental model. The tester's role is to surface evidence that tests that model. Maintain careful logs, report what you actually observed, and let the programmer reconcile the discrepancy.
- **Deep focus and low interrupt tolerance.** Programming demands sustained concentration. This makes programmers genuinely impatient with interruptions, not dismissive. Time your interactions accordingly.
- **Preference for automation.** Many programmers see any repetitive activity as a candidate for scripting and may pressure testers to automate everything. Resist the urge to automate solely to win programmer respect. Integrity and demonstrated competence are more durable currency.
- **The best school is programming itself.** No set of guidelines substitutes for having written production code that was then criticized by testers, managers, and users. Where possible, testers benefit from hands-on coding experience.

### 2. Develop programmers' trust

Early engagement is far more valuable than late engagement. To get it, be useful before being critical.

- When reviewing early-draft code, ask what the programmer considers a serious problem and focus there. They already know about the gaps they have not yet filled (error handling, edge cases). Surfacing those wastes trust.
- State disagreements once and clearly, then step back. If you believe a decision will cause problems, say so, document it, and avoid nagging. The evidence will emerge on its own schedule.
- Share information proactively. Testers often hold system-wide visibility that individual programmers lack. Offering that context builds goodwill and opens reciprocal information flows.

### 3. Provide service

Reframe the tester role as a service role rather than an auditing role. Concrete examples:

- Test third-party or vendor components and share results so programmers can make integration decisions with real data.
- Test private builds and prototypes before formal review cycles.
- Set up shared test environments that programmers can use for their own exploratory debugging.
- Review requirements for testability and ambiguity. Programmers struggle with vague requirements just as testers do; this is a natural collaboration point.

Every testing activity is ultimately service. These examples simply make the service visible and immediate, accelerating trust.

### 4. Your integrity and competence will demand respect

A tester who is known as a straight shooter earns access and credibility that no political maneuver can manufacture.

- **Crisp, step-by-step bug reports.** Every unnecessary step in a reproduction sequence is wasted programmer time. Eliminating that waste signals respect.
- **Report observable behavior, not internal guesses.** Testers are experts in external product behavior. Speculating about root causes in areas outside your knowledge undermines credibility. Stick to what you saw.
- **Irreproducible bugs require documented effort.** When a failure cannot be reproduced, show the investigation you performed. The impression to leave is "thorough investigation exhausted available tools" — not "gave up after one try."
- **Deliver bad news directly.** Warn before escalating. Give people the opportunity to act on information before going over their heads.
- **Never fake certainty.** If you do not know how severe a bug is, say so. Gather evidence from support or marketing staff, or be explicit that you are offering a hypothesis.
- **Neither exaggerate nor minimize.** Resist pressure to soft-pedal real issues. A reputation for accuracy is a durable professional asset; a reputation for inflation or suppression is not recoverable.

Integrity is the precondition for competence to matter. Without it, technical skill is invisible.

### 5. Focus on the work, not the person

Report bugs, not character assessments.

- Experienced testers learn to use patterns in the code to predict where bugs will cluster. This is a legitimate skill. The mistake is translating those organizational observations into personal accusations in reports or meetings.
- The moment a tester positions themselves as the evaluator of programmer quality, programmers stop sharing information. This cuts the tester off from the early access that makes testing effective.
- Testers who appoint themselves as disciplinarians become politically expendable. They are kept around as "bad cops" until a sufficiently large failure demands a scapegoat.
- If a pattern of systemic problems appears unaddressed, bring evidence to the appropriate manager discreetly and let management handle it. That is their role, not the tester's.

### 6. Programmers like to talk about their work — ask them questions

Many testers assume programmers are unwilling to share. The authors' experience is the opposite: most programmers are eager to discuss the systems they are building.

- Do your homework first. Read available design documents and, if possible, review the code before initiating a conversation.
- Where documentation is sparse, ask for a whiteboard diagram. Ask "what happens if this component fails?" — pointing to individual boxes and arrows. This surfaces missing error handling and hidden assumptions, and often reveals disagreements between programmers on the same team.
- Use active listening: restate what was said in your own words, ask follow-up questions, and draw inferences aloud. The goal is to help the programmer articulate what they know, not to demonstrate what you know.
- Write up notes after conversations and share them with both the programmer and your fellow testers. Programmers resent answering the same question repeatedly to different people.
- Learn the relevant vocabulary. If the codebase is in C++ or Java, understand what a class is. If the system is multithreaded, understand what a thread is. Technical fluency lowers friction and signals investment.
- Do not demand documents as a precondition for testing. Ask for what you need, explain why it helps, and accept what is offered. Programmers cannot read minds, and rigid documentation requirements create friction without adding information.

### 7. Programmers like to help with testability

Most programmers want their code tested well and are receptive to reasonable testability requests — when those requests are specific, timely, and explained in terms of code-level interfaces.

- **Define testability as visibility and control.** This framing gives programmers a concrete design target. Rather than asking for "better testability," ask for a specific hook, interface, or diagnostic flag.
- **Speak their language.** Requests framed in terms of a specific interface in a specific module get a fair hearing. Vague requests get deferred or ignored.
- **Ask early.** Testability features added at design time cost a fraction of what they cost when retrofitted. Reference the automation-planning timeline when applicable.
- **Be realistic about scheduling.** Small testability additions can ride alongside feature work. Large ones need to be championed through the same prioritization process as any other feature.
- **Counter evasion with evidence.** Objections like "it will hurt performance" or "it will compromise security" are occasionally valid. More often they signal reluctance to think through an unfamiliar request. Prepare a brief case for why the feature benefits the team, not just the tester.

Perseverance matters. Testability features that seemed hard to justify have repeatedly proved to be among the highest-value testing investments a team makes.

---

## Communication heuristics

| Situation | Recommended approach |
|---|---|
| Early-draft code review | Ask what the programmer considers serious; focus there first |
| Bug report submission | Step-by-step reproduction, observed symptoms only, no speculation on root cause |
| Irreproducible failure | Document investigation effort before submitting; show what was tried |
| Disagreement on severity | State position once, clearly; do not repeat; let evidence emerge |
| Need for technical information | Prepare questions in advance; prefer face-to-face for follow-ups |
| Testability request | Specify the exact interface; ask early; frame benefit to the programmer |
| Escalation | Always warn the person first; give them a chance to act |

---

## Conflict resolution patterns

- **Evidence over assertion.** Disputes about whether a bug is real or reproducible are resolved by logs and reproduction steps, not by insisting more loudly.
- **State once, document, move on.** If you believe a design decision will cause problems, record your concern once in a trackable form (comment, email, bug note). Repeated objections convert a professional concern into a personal conflict.
- **Escalate with warning.** Before going to management, give the programmer the opportunity to address the issue. Announce the escalation before it happens.
- **Systemic issues go to the right manager, discretely.** If a pattern of organizational problems appears, present the evidence to the appropriate person and step back. Taking on a managerial enforcement role destroys tester credibility with the whole team.
- **Separate the person from the work in all written and spoken communication.** Bug reports describe product behavior, not programmer behavior.

---

## Anti-patterns

- **Automating tests only to impress programmers.** Automation is a tool, not a status signal. Automating things that should not be automated in order to earn respect is both a waste and a false premise.
- **Faking certainty about severity or root cause.** A single instance of overstating confidence can permanently damage the reputation that took months to build.
- **Demanding documents as a gate.** This positions the tester as a bureaucrat and closes off informal information channels that are often more valuable than formal artifacts.
- **Reporting on programmer quality rather than product quality.** This converts the tester into a surveillance function, causing programmers to stop sharing information.
- **Nagging about unresolved disagreements.** Persistence past a single, clear statement signals poor professional judgment and erodes relationships without changing outcomes.
- **Appointing yourself as disciplinarian.** Testers who punish programmers for mistakes become scapegoats when something large goes wrong.
- **Tossing irreproducible bugs without investigation.** This signals disrespect for the programmer's time and creates doubt about the reliability of all your reports.

---

## Cross-refs

- `[[ch-04-bug-advocacy]]` — foundational chapter on bug reporting, directly referenced throughout Ch. 7 as the primary vehicle for tester-programmer interaction
- `[[ch-01-the-role-of-the-tester]]` — context for the tester's position relative to the broader team
- `[[ch-02-thinking-like-a-tester]]` — the observation-vs-model distinction elaborated here connects to the core tester mindset
- `[[ch-06-documenting-testing]]` — note-taking and sharing practices reinforced in the "ask questions" lesson
- `[[ch-08-managing-the-testing-project]]` — escalation and project dynamics referenced implicitly throughout
- `[[ch-10-your-career-in-software-testing]]` — integrity and reputation as long-term career assets
- `[[full-stack-testing-mohan/ch-12-moving-beyond-first-principles]]` (cross-book — relay-team analogy; complementary framing of tester-developer handoff)
