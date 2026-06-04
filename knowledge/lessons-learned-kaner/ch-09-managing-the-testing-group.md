---
book: lessons-learned-kaner
chapter: 9
title: "Managing the Testing Group"
lessonsCovered: "~30 lessons on hiring, team structure, training, and performance"
topics:
  - team-management
  - hiring
  - training
  - team-structure
  - mentorship
  - performance-evaluation
  - retention
  - qa-as-coach
  - diversity
  - soft-skills
  - organizational-structure
applies_to_agents:
  - qa-orchestrator
  - qa-curator
  - qa-test-planner
---

# Chapter 9 — Managing the Testing Group

> Where Chapter 8 focuses on a single project's execution, Chapter 9 zooms out to the group that persists across projects. The authors argue that testers are knowledge workers—executives in Drucker's sense—and must be managed, hired, trained, and evaluated accordingly. Mediocrity is a choice made by managers who reduce testing to factory work. Excellence is cultivated deliberately through good hiring, real coaching, domain investment, and protection of staff dignity.

---

## Core lessons (paraphrased)

### Mediocrity is a self-fulfilling prophecy

If a manager eliminates creativity through dehumanising processes, measures staff by meaningless numbers, alienates testers from the outcome of their work, and prevents them from advocating for the bugs they find—then the manager should not expect loyalty, brilliance, or the extra effort that difficult projects demand. Declaring "no heroes" is the surest way to ensure you never get any.

### Treat staff as executives

Peter Drucker defined an executive as anyone who manages the value of her own time and affects organisational performance. Most testers qualify. They always have more to do than they can complete, so they must choose strategically. Managing testers as factory workers—standardising every step, making roles interchangeable—destroys the judgment and initiative that testing actually requires. Hire a mix of experience levels, invest heavily in juniors, but from day one treat every tester as a thinking individual expected to grow into autonomy.

### Read your staff's bug reports

For managers of small-to-medium groups, reading every bug report is feasible and valuable. Reports reveal product health, tester skill, morale, and the quality of programmer-tester communication. Useful questions to ask while reading:

- Is the report clearly and economically written?
- Does it invite follow-up testing or close off investigation?
- Was the bug hard to find, or was it luck?
- What is the tone, and how has the programmer responded?

This habit keeps the manager grounded in reality and makes coaching conversations specific rather than vague.

### Evaluate staff as executives, not by bug count

Bug counts are at best useless and at worst perverse—they make the wrong people look good and the best people look incompetent. Richer evaluation sources include:

- Quality and creativity of bug reports
- Code and test documentation produced
- Peer and stakeholder feedback from programmers and others
- Reliability on deadlines and personal commitments
- Types of bugs consistently missed
- Assistance provided to colleagues
- Skill acquisition and skill transfer to others
- Positions taken on matters of principle and business judgment

This multi-dimensional picture does not reduce to a single score, but it can be organised into a scorecard showing patterns of strength and development need. Formal annual self-evaluations are insufficient; ongoing active observation is the baseline.

### Test with your staff

Managers who delegate everything and never touch the product lose technical credibility and the ability to judge work quality. Participating in at least one active project at a time—enough to install the software, reproduce a few bugs, and discuss the product intelligently—is worth protecting in the priority list. Staff lose respect for managers who cannot run the very software being tested.

### Avoid multi-project fragmentation

When testers are assigned to multiple projects simultaneously, one of two things happens: they silently ignore all but one project, or they spend so much time switching context (re-reading notes, catching up on email, attending multiple sets of meetings) that output on every project suffers. Context-switching overhead is real and costly; avoid structuring the team to depend on it.

---

## Hiring criteria

### Hiring decisions are the most important decisions a manager makes

A bad hire is a mistake you will likely live with for a long time. Invest the effort upfront.

### Use contractors to buy time during recruiting

Temporary contractors prevent the pressure to hire the wrong person quickly. Even companies that restrict contractor use often support this specific use case.

### Resist accepting rejects from other groups

Occasionally a person who struggled elsewhere will thrive in testing, but it is rare. Accepting cast-offs degrades the group's reputation, and the extra headcount will be counted against future hiring requests even if the transfer adds no real capacity.

### Hire for tasks and skills, not credentials

The true qualifications of a tester are not a specific degree or a specific number of years of experience. Hire people who can prove they can do the work.

### Staff the team with diverse backgrounds

A group of identical computer-science graduates will find fewer bugs than a group with diverse professional histories. Successful hires drawn from non-traditional backgrounds—lawyers, accountants, technical support representatives, hardware technicians, librarians, translators, sales directors, retired executives—bring analytical angles and domain knowledge that programmers alone miss. Programmers are also needed, but they require training in non-programming knowledge; non-programmers provide complementary coverage.

Diversity along cultural, gender, age, and experiential lines is not merely a legal obligation—it is a testing asset. The broader the range of backgrounds, the more ways the team will analyse the software and the more defects they will find. Hiring practices that produce teams more homogeneous than necessary are counter-productive to the testing mission.

### Hire from non-traditional talent pools

During tight labour markets, look beyond the usual pipeline. People with strong analytical skills who want to pivot into software—lawyers, accountants, recently single parents seeking flexibility, retired executives—can become exceptional testers. A part-time or flexible offer can secure talent that full-time-only roles would never attract.

### Hire by consensus

Let every full-time group member and close collaborator interview candidates. Allow any interviewer to veto a candidate, unless the veto is plainly based on protected characteristics irrelevant to the role. Poorly articulated but strongly felt objections have saved teams from bad hires, including cases of subsequent harassment. Override a veto only when there is clear evidence of bias, not merely because you cannot immediately articulate a counter-argument.

### Hire for love of the work and integrity

Enthusiasm for testing itself is a signal. Persistent conflict with past managers, bitterness about previous roles, or a pattern of blaming environments rather than engaging with them are warning signs. Integrity matters most: the testing function provides controversial information, and the trust of the entire organisation depends on the character of the people delivering it.

### Have candidates demonstrate job-relevant skills during the interview

Ask an experienced tester to write a bug report against an open-source product. Ask an automation architect to sketch an automation strategy for an open-source application. Judge the questions they ask, the research they do, and the coherence of the approach. Logic puzzles and numeric aptitude tests are less informative than many interviewers believe—performance on them is heavily influenced by prior practice and selects for speed rather than thorough thinking.

### Ask for work samples

Code, bug reports, and written documentation from previous roles are far more predictive than interview performance alone. People who left a company on good terms can often obtain permission to share specific artefacts. Contributors to open-source projects have public samples available. Never solicit confidential material.

### Move fast once you decide

Good candidates disappear during slow hiring processes. Expediting paperwork after you have made a decision is itself a management task that deserves priority attention.

### Put hiring promises in writing and keep them

Disputes over what was promised are corrosive to the individual and alarming to the rest of the team. Commit nothing you cannot control—career path trajectories and future promotions are outside your authority to guarantee. Clarity at offer time prevents bitter disputes later.

---

## Team structure & roles

### Match experience level to project maturity

Do not assign novice testers to projects that are nearly complete. A seasoned tester can absorb documentation, understand test matrices, and become productive quickly. A novice needs hands-on instruction and preparation time that the project cannot afford at the end. Invest in novices when you have the time to develop them, not when the schedule is already under pressure.

### Use mentors for new hires

Assign every new hire a mentor—ideally someone accessible and technically capable, though cross-department mentors also foster inter-team communication. The mentor's role is informal: show the newcomer around, answer questions, review early work, provide social anchoring. The mentor has no supervisory authority and does not report to the manager unless a serious problem arises. This non-evaluative relationship allows the new tester to ask questions they might fear to raise with their direct manager.

---

## Training / coaching patterns

### Build domain expertise intentionally

Testers become more effective as they understand the world the software inhabits: how customers use similar products, what problems matter to them, how competitors solve the same problems. Practical paths include:

- Reading industry magazines and books written for end users
- Attending customer training sessions (preferably taught externally, not by the company's own staff)
- Studying the underlying subject matter (a tester of real-estate software might study for a broker's licence)
- Working briefly at customer sites on a loaner or part-time basis
- Staffing the technical support hotline for a few hours per week
- Selling the company's software—or a competitor's—in retail settings

None of these are passive; all require commitment and intentional reflection to yield skill growth.

### Build technology expertise alongside domain expertise

As software environments grow more complex, many defects arise from interactions between the application under test and external systems—remote servers, third-party libraries, operating environments. Testers who understand the technology stack—component libraries, APIs, networking—are better positioned to find these interaction failures. Invest in technical breadth as deliberately as in domain depth.

### Actively develop skills, not just use them

Skill development is not a one-time event. Techniques for bug hunting, bug reporting, and risk analysis must be practised repeatedly, not declared mastered. The changing technology landscape, competitive market, and evolving development tools all require ongoing investment. This is the basis for sustained contribution.

### Review technical support logs as a training input

Customer complaint records—phone logs, support emails—reveal the classes of failure that make it into production. Reviewing them prompts testers to ask: what tests would have prevented this? what patterns are generic enough to generalise to the current product? This is a feedback loop between field quality and test design.

### Onboard new testers with structured early tasks

A structured onboarding sequence that builds product knowledge systematically:

1. **Documentation verification:** Have the new tester check every factual claim in the user manual and online help against actual software behaviour. This forces exposure to the entire product surface and has intrinsic value—documentation mismatches constitute implied warranty problems. The tester should check both explicit statements of fact and reasonable inferences a user would draw.

2. **Positive testing:** After understanding the intended behaviour, have the tester install the product from scratch and attempt real-life use cases. The goal is developing an informed perspective on what is good about the product—a necessary foundation for credible, proportionate criticism.

3. **Rewriting old bug reports:** Before writing new reports, have novice testers reword existing reports for greater clarity, specificity, and follow-up testing value. The manager reviews these rewrites and provides feedback on tone, precision, and creative follow-up before permitting the tester to file new bugs.

4. **Retesting existing bugs:** Three categories of useful retesting work for newcomers: (a) confirming that currently open bugs are still reproducible in the current build; (b) checking that previously fixed bugs have not regressed; (c) investigating bugs that were resolved but not yet closed—with structured debriefs against the tester who originally filed them, building judgment about how much effort to invest in retesting edge cases.

### Create sustained training structures

- A voluntary reading group meeting weekly or bi-weekly to discuss a paper or book chapter. Reward regular participation with resources (e.g., provide the books). The manager attends but does not dominate.
- Regular lunchtime presentations: talks by the manager, guest speakers from other organisations, peer presentations by staff on techniques or domain challenges, skill exercises.
- Individual career conversations: meet one-on-one to help each tester plan continuing education. Identify relevant university courses, online programmes, and conferences. Point out well-taught options without prescribing exactly what to take.
- Send staff to conferences and seminars in pairs or threes—social reinforcement accelerates learning. Require a presentation back to the group on what was learned.

### Work actively on your own skills

The same discipline expected of staff applies to the manager. Technical credibility requires sustained personal investment, not just delegation.

---

## Performance evaluation pitfalls

### Bug counts are a harmful metric

Bug counts systematically reward the wrong behaviours and punish the right ones. Testers who find the most visible, easy-to-reproduce bugs in high-churn areas of the codebase will score well; testers who find hard, subtle defects in stable areas will appear to underperform. Beyond the distortive effect, bug-count pressure is demotivating and encourages gaming. The solution is richer, qualitative evaluation—not a better formula applied to counts.

### Formal annual evaluations are insufficient

Annual or semi-annual reviews provide too little signal too infrequently. Ongoing observation of actual work—reading reports, attending to interpersonal dynamics, tracking commitments met—gives the manager enough knowledge to coach meaningfully. This is not micromanagement; observing and coaching is distinct from controlling how work is done.

### Morale is a multiplier

Napoleon's observation that morale has a three-to-one advantage over material conditions applies to testing teams. Staff who believe their work matters, that they can succeed, and that accomplishments will be recognised give remarkable effort when projects need it. The manager is the primary guardian of team morale. Practical obligations include:

- Courteous, respectful treatment as a baseline
- Noticing and acknowledging good work and honest effort
- Sharing the load during late nights and weekend pushes—not every time, but enough to demonstrate solidarity
- Assigning people to work that interests them where possible
- Intervening when a tester is struggling rather than waiting for failure
- Providing training and showing publicly that professional development is valued
- Never misleading staff or making promises outside your control
- Never bullying, publicly criticising, or retaliating

### Protect staff from abuse

Testers routinely receive pushback from developers, stakeholders, and project managers under pressure. When bullying occurs—shouting, personal attacks, bad-faith hostility—the manager must intervene: provide private emotional support, confront the aggressor, and draw clear professional lines. Paired testing provides testers with mutual support in high-pressure environments.

### Defend against abusive overtime

Chronic overtime produces burnout, turnover, cynicism, and degraded work quality. Short bursts of extra effort at critical moments are normal; sustained overtime is not. Practical defences:

- Schedule realistically: six hours of focused work per day is a more honest estimate than eight.
- Refuse to agree to schedules you know are impossible. Negotiate: which tasks are highest priority? which can be done less thoroughly? what resources can be added?
- Do not write schedules that assume staff have no meetings, status reports, HR obligations, or any task except the primary deliverable.
- Reward results, not presence. The manager who values hours logged over output completed destroys efficiency and fairness simultaneously.

### Protect your own boundaries

Managers are subject to the same unreasonable demands they must protect their teams from. You cannot promise the impossible without eroding credibility. You cannot compromise your integrity and retain the authority to speak honestly—which is the core of the testing function's value. Be a volunteer in extra effort, not a victim of chronic pressure. If the organisation is fundamentally unreasonable and unresponsive to evidence, begin planning your exit.

---

## Cross-refs

### Within this book

- `[[ch-01-the-role-of-the-tester]]` — foundational framing of what testers actually do, which sets the context for what "executive" management of testers means
- `[[ch-02-thinking-like-a-tester]]` — the cognitive and investigative skills that hiring and training should develop
- `[[ch-03-testing-techniques]]` — the technique repertoire that domain and technology expertise enables; relevant to training content decisions
- `[[ch-04-bug-advocacy]]` — the advocacy and integrity skills that hiring for "integrity" and evaluating "what fights he gets into and why" depend on
- `[[ch-05-automating-testing]]` — automation architects need specific skills assessment during hiring (the "automation strategy sketch" interview approach)
- `[[ch-06-documenting-testing]]` — documentation quality is a primary evaluation lens (reading bug reports, test documentation)
- `[[ch-07-interacting-with-programmers]]` — programmer-tester relationship quality is visible in bug report comments; relevant to evaluating staff and to abuse-protection responsibilities
- `[[ch-08-managing-the-testing-project]]` — Ch. 8 is the per-project complement to Ch. 9's across-project group view; overtime, scheduling, and stakeholder management issues overlap
- `[[ch-10-your-career-in-software-testing]]` — individual career development advice that complements the manager-side training and coaching lessons here
- `[[ch-11-planning-the-testing-strategy]]` — the skills needed to contribute to strategy are what the training programme should build toward
- `[[appendix-the-context-driven-approach]]` — the philosophy that underpins why diversity, judgment, and context-sensitivity matter more than standardised process

### Cross-book

- `[[full-stack-testing-mohan/ch-12-moving-beyond-first-principles]]` — Dreyfus skill-model framing of novice-to-expert progression maps directly onto Ch. 9's structured onboarding sequence and the coaching arc from documentation verification through to independent judgment; QA-as-coach role is treated in depth there
