---
book: full-stack-testing-mohan
chapter: 4
title: "Continuous Testing"
pages: "170-207"
topics:
  - continuous-testing
  - ci-cd
  - ci-stages
  - pipeline-design
  - shift-left
  - automation-strategy
  - test-pyramid
  - smoke-tests
  - gates
  - deployment-pipeline
  - flakiness
  - full-stack-testing
  - deployment-strategy
  - monitoring
  - observability
applies_to_agents:
  - qa-cicd-planner
  - qa-cicd-implementer
  - qa-cicd-evaluator
  - qa-cicd-spv
  - qa-orchestrator
  - qa-automation-engineer
  - qa-strategist
---

# Chapter 4 — Continuous Testing

> Chapter 4 establishes continuous testing (CT) as the operational backbone of a quality-focused delivery team. It defines CI, CT, continuous delivery, and continuous deployment as a layered system; describes the principles and etiquette that make these processes effective; presents four progressively sophisticated CT pipeline strategies (single loop, two loops, three loops with CFR, and smoke-plus-nightly-regression); walks through hands-on setup of Git and Jenkins; and concludes by connecting rigorous CT practices to Google DORA's four key metrics for elite-team performance.

---

## Core Concepts

### Continuous Integration (CI)
- CI is the practice of every team member pushing small, incremental code changes to a shared version control system (VCS) frequently throughout the day.
- Each push triggers an automated pipeline on the CI server.
- A commit is only considered "integrated" after it passes at least the micro-level (unit) tests in the build and test stage.
- The goal is to surface integration conflicts early, while context is fresh, rather than allowing divergent branches to accumulate over days or weeks.

### Continuous Testing (CT)
- CT extends CI: it validates both functional and cross-functional (performance, security, accessibility) quality for every incremental commit in an automated fashion.
- CT also encompasses manual exploratory testing after each self-service deployment; a feature is not "done" until scenarios found during exploratory testing have been automated and added to the suite.
- CT is the necessary precondition for continuous delivery—the application must be production-ready at all times.

### Continuous Delivery vs. Continuous Deployment
- **Continuous delivery**: the application is always in a deployable state; deployment to any environment (QA, UAT, production) is triggered manually via a self-service mechanism (e.g., a "Deploy Vx" button). Suitable when business launch dates govern release timing.
- **Continuous deployment**: every commit that passes the CT process is pushed to production automatically, without human intervention. Suitable when continuous, real-time user feedback is the priority.
- Only commits that have passed all CT stages are offered as deployment candidates; failed commits are excluded from the self-service menu.

### Shift-Left in Continuous Testing
- Running micro-level tests (unit, integration, contract) in the earliest build-and-test stage is the primary shift-left mechanism: these tests execute without deploying the application, catch regressions fastest, and give developers feedback before they move on to the next task.
- Additional shift-left occurs by embedding cross-functional checks (static security scanning, single-endpoint performance tests) inside the build-and-test stage rather than reserving them for later environments.
- The test pyramid (discussed in Chapter 3) is the architectural enabler of effective shift-left: a broad base of micro-level tests provides extensive coverage at high speed.

### The Test Pyramid as a CT Enabler
- When the test pyramid is properly implemented, the two-loop pipeline (build-and-test + acceptance) can complete in under an hour.
- Example from Chapter 3: a team with ~200 macro-level tests required 8 hours for a full feedback cycle; after restructuring to the pyramid with ~470 mixed tests, the cycle dropped to ~35 minutes.
- Violation of the pyramid (too many slow macro-level tests) directly degrades CI lead time and encourages developers to ignore failing tests.

---

## CI Pipeline Stages — Catalog

### Stage 1: Build and Test Stage
- Combines application compilation with all micro-level tests (unit, integration, contract).
- Runs against static application code; no deployment is required.
- Must complete within a few minutes ("the time to make a cup of tea" — Humble & Farley, *Continuous Delivery*).
- If it takes longer, the team should parallelize the stage per component.
- Broken build must be repaired within 10 minutes (Martin Fowler's Continuous Integration Certification Test); if not fixable in time, the broken commit should be reverted.
- All micro-level tests always belong here; macro-level or cross-functional tests should not be moved to smoke or nightly regression unless resource constraints demand it.
- Static code security scanning can also run here as a shift-left security measure.

### Stage 2: Deploy Stage
- Triggered immediately after the build and test stage passes.
- Pushes application artifacts to the CI/dev environment.
- Prepares the deployed environment for macro-level test execution.

### Stage 3: Acceptance Testing Stage (also called Functional Testing Stage)
- Runs macro-level tests (API, UI, end-to-end) against the live application in the CI environment.
- Takes longer than the build-and-test stage due to deployment overhead and test execution time.
- When the test pyramid is respected, this stage completes within a reasonable window (targeting sub-hour overall pipeline time).
- Passing this stage makes the commit eligible for self-service deployment to higher environments (QA, UAT, production).

### Stage 4: Cross-Functional Requirements (CFR) Stage
- Optional additional stage configured after the acceptance testing stage.
- Runs automated performance, security, and accessibility tests.
- Can be integrated into the existing two loops or configured as independent subsequent stages.
- Enables continuous holistic quality feedback beyond functional correctness.

### Smoke Test Stage (variant of Acceptance Testing Stage)
- Used when the full acceptance test suite has grown too large to run on every commit.
- A curated subset of tests covering the end-to-end flow of every feature is selected as the "smoke pack."
- Provides a high-level signal on every commit quickly; the commit is eligible for self-service deployment after smoke tests pass.
- Only macro-level and cross-functional tests should be categorized as smoke tests; all micro-level tests must remain in the build-and-test stage.

### Nightly Regression Stage
- Complements smoke testing; runs the entire test suite once per day against the latest code base (with all of that day's commits).
- Typically scheduled during off-hours (e.g., 7 p.m. daily) via the CI server's scheduling mechanism.
- Team must review results first thing the next morning, prioritize defect fixes, and address environment failures the same day to prevent false feedback on subsequent commits.

---

## CT Pipeline Strategies — Catalog

### Strategy 1: Single Loop (All Tests, Every Commit)
- A single build-and-test stage runs all tests (micro and macro) against every commit.
- Suitable for young applications with small test suites.
- Simplest to maintain; no test selection or scheduling needed.

### Strategy 2: Two Independent Feedback Loops
- Loop 1: Build-and-test stage (micro-level tests, fast, against static code).
- Loop 2: Deploy + Acceptance testing stage (macro-level tests, against deployed application).
- Standard recommended approach; separates fast feedback from slower integration feedback.
- Both loops together should complete in under an hour when the test pyramid is followed.
- Parallelizing per-component builds and using test parallelization techniques help keep total time short.

### Strategy 3: Three Feedback Loops (with Cross-Functional)
- Extends Strategy 2 by adding a CFR stage (performance, security, accessibility tests) after the acceptance testing stage.
- Cross-functional tests can be integrated into existing loops or run as independent subsequent stages.
- Achieves continuous holistic quality feedback across all application quality dimensions.

### Strategy 4: Four Loops (Smoke + Nightly Regression)
- Extends Strategy 3 by splitting macro-level and CFR tests into smoke (per-commit) and nightly regression (scheduled) subsets.
- Build-and-test stage remains unchanged; all micro-level tests still run on every commit.
- Smoke stage runs a curated end-to-end subset; nightly stage runs the full suite.
- Addresses pipeline resource and time constraints as applications and test suites grow.
- Trade-off: feedback on non-smoke tests is delayed by up to one day.

---

## Shift-Left Practices — Catalog

- **Self-testing code**: every code commit is accompanied by automated tests in the same commit, ensuring no commit is unvalidated.
- **Local pre-push validation**: teams mandate that all micro- and macro-level tests pass on local machines before pushing to the VCS.
- **Code coverage gating**: the build-and-test stage fails if a commit does not meet the configured code coverage threshold.
- **Static security scanning in the build stage**: running static analysis security tools (SAST) in the earliest CI stage rather than waiting for dedicated security environments.
- **Single-endpoint performance testing in CI**: running a focused performance load test for one critical endpoint per commit rather than deferring all performance tests to nightly or dedicated environments.
- **Micro-level tests as integration validation**: relying on a well-structured unit and integration test layer to catch the vast majority of regressions before the application is ever deployed.

---

## Principles and Etiquette for CI/CT

These are the minimum practices a team must follow for CI/CT to deliver its intended value:

1. **Frequent code commits**: push small, logically complete increments to the VCS frequently (not large batches of days-long work).
2. **Self-tested code**: every commit includes the automated tests that validate it; do not commit code without accompanying tests.
3. **Adhere to the CI Certification Test**: fix a broken build-and-test stage within 10 minutes; if that is not feasible, revert the offending commit immediately to restore a green pipeline.
4. **Do not comment out or ignore failing tests**: suppressing tests to force a green pipeline masks real defects and degrades the trustworthiness of the CT process.
5. **Do not push to a broken build**: committing on top of a red pipeline compounds the problem and makes root-cause analysis harder.
6. **Take ownership of all failures**: if your changes caused a test to fail in code you did not write, it is still your responsibility to fix it (pairing with domain experts is acceptable, but the obligation to resolve it before moving on is yours).

Additional stricter practices some teams adopt:
- Publishing commit status (pass/fail) with the committer's name to a shared communication channel (e.g., Slack).
- Playing a distinct audio alert in the team area when a build breaks, driven by a dedicated CI monitor screen.
- Having testers actively monitor CT pipeline health and enforce timely fixes.

---

## Techniques and Templates

### Parallelization for Pipeline Speed
- Parallelize the build-and-test stage per component (microservice or module) rather than running a single monolithic stage for the entire code base.
- Parallelize test execution within a stage using test framework concurrency settings.

### Test Selection for Smoke Packs
- Identify one end-to-end flow test per feature as the smoke test representative.
- Criteria: the test must exercise the happy path of the feature from the user's perspective, covering the most critical integration points.
- Keep the smoke pack small enough to complete within the pipeline's time budget.

### Nightly Regression Configuration in Jenkins
- Use the "Build Periodically" trigger in Jenkins with a cron expression (e.g., `0 19 * * *`) to schedule the full suite at a fixed nightly time.
- The nightly run targets the latest code base (all of the day's merged commits).

### Chaining Stages in Jenkins
- Use the "Post-build Actions" tab in a Jenkins Freestyle project to trigger downstream pipelines after an upstream stage passes.
- Enables building the full CD pipeline: build-and-test → deploy → acceptance → CFR → self-service deployment options.

### Pipeline Triggers in Jenkins
- **Poll SCM**: Jenkins polls the VCS repository at a configured interval (e.g., every 2 minutes) and triggers a build when new commits are detected.
- **GitHub hook trigger**: a GitHub plugin sends a webhook to Jenkins on every push, avoiding polling latency.
- **Build Periodically**: triggers a pipeline on a cron schedule regardless of new commits; used for nightly regression.

---

## Examples and Tool References

### Git (Version Control)
- The most widely used distributed VCS (90% adoption per 2021 Stack Overflow survey); originally created by Linus Torvalds in 2005.
- Four-stage local workflow: working directory → staging area (`git add`) → local repository (`git commit`) → remote repository (`git push`).
- Relevant commands: `git init`, `git add`, `git commit -m`, `git remote add origin`, `git push -u origin master`, `git pull`, `git clone`, `git merge`, `git fetch`, `git reset`.
- GitHub and Bitbucket are the primary cloud hosting options; GitHub requires a personal access token (mandatory since August 2021) or SSH authentication for push operations.
- CI pipelines are triggered only on push to the remote repository, not on local commits.

### Jenkins (CI Server)
- Open source CI server; installable via Homebrew on macOS (`brew install jenkins-lts`).
- Web UI accessible at `http://localhost:8080/`; requires initial unlock with a generated admin password, plugin installation, and admin account creation.
- Pipeline configuration elements: General (description, GitHub project URL), Source Code Management (Git repository URL for clone), Build Triggers (Poll SCM, Build Periodically, GitHub hook), Build (Maven lifecycle phase — `test`), Post-build Actions (downstream pipeline chaining).
- In production usage, the Jenkins server is hosted in the cloud or on a shared VM accessible to all team members, not on individual developer machines.
- DevOps engineers often own CI/CD infrastructure setup and maintenance; however, testers are responsible for devising the CT strategy, ensuring correct stage chaining, and monitoring pipeline health.

### DORA Four Key Metrics (4KM)
- Developed by Google's DevOps Research and Assessment team; documented in *Accelerate* (Humble, Kim, Forsgren).
- Quantify a software team's performance as elite, high, medium, or low.

| Metric | Measures | Elite Target |
|---|---|---|
| Deployment frequency | How often software reaches production | On-demand (multiple deploys per day) |
| Lead time | Commit-to-production-ready duration | Less than one day |
| Mean time to restore (MTTR) | Time to recover from a production incident | Less than one hour |
| Change fail percentage | Proportion of releases requiring remediation (rollback, hotfix) | 0–15% |

- The first two metrics (deployment frequency, lead time) measure delivery tempo; the last two (MTTR, change fail percentage) measure release stability.
- Rigorous CT directly improves lead time (fast feedback loops) and change fail percentage (comprehensive automated coverage).
- DORA research shows elite teams correlate with organizational performance improvements in profit, share price, and customer retention.

---

## Pitfalls / Anti-Patterns

### Slow Build-and-Test Stage
- Description: the build-and-test stage takes many minutes or longer, exceeding the threshold where developers will wait for results before picking up a new task.
- Cause: too many macro-level or slow integration tests placed in the first stage; monolithic single-stage builds for large codebases.
- Consequence: developers stop treating the pipeline as a fast feedback mechanism; broken builds are deprioritized.
- Fix: enforce the test pyramid, parallelize the build per component, remove duplicate tests, refactor tests to eliminate unnecessary waits.

### Commenting Out or Ignoring Failing Tests
- Description: suppressing test failures with comments or skip annotations to force a green pipeline.
- Consequence: CT process gives incomplete or false feedback; defects accumulate silently; subsequent commits are validated against a broken baseline.
- This is explicitly called out as a common anti-pattern despite its obvious harm.

### Pushing to a Broken Build
- Description: committing new code when the pipeline is already red.
- Consequence: compounds the failure, makes it harder to identify the original breaking commit, and forces the entire team to work on an unstable baseline.

### Not Taking Ownership of Failures
- Description: tossing responsibility for a failing test between team members because the broken code is not "their area."
- Consequence: broken tests remain in the pipeline for days; the CT process provides incomplete feedback during the open window; sometimes tests are removed from the CI run entirely to eliminate noise.

### Failing Tests Tracked as Defects and Fixed Later
- Description: when the feedback loop is long (hours), developers pick up new tasks and defer failing tests to a backlog.
- Consequence: new code is integrated on top of unresolved defects; the new code itself is inadequately tested because the failing tests are ignored; the CT process loses its ability to provide reliable continuous feedback.

### Nightly Regression Results Not Reviewed Promptly
- Description: teams run nightly regression but do not prioritize reviewing results first thing in the morning.
- Consequence: environment failures and test failures accumulate; subsequent commits receive inaccurate CT feedback because the suite is partially broken.

### Misclassifying Micro-Level Tests as Smoke Tests
- Description: moving unit or integration tests from the build-and-test stage to the smoke or nightly regression stage to reduce pipeline runtime.
- Consequence: the first feedback loop loses its breadth of coverage; defects that micro-level tests would have caught immediately are delayed by hours or a full day.

### Single Monolithic CI Stage for a Large Codebase
- Description: one build-and-test stage covering the entire application rather than per-component parallel stages.
- Consequence: stage runtime grows linearly with the codebase; violates the guideline that the build-and-test stage should finish within minutes.

---

## Benefits of Continuous Testing (Summary)

- **Common quality goals**: all team members continuously measure their work against the same functional and cross-functional quality bar.
- **Early defect detection**: issues are surfaced while the developer still has relevant context, reducing rework cost.
- **Always ready to deliver**: the application is in a deployable state at all times, enabling on-demand releases.
- **Enhanced collaboration**: distributed teams can track which commit introduced which failure; blame is replaced by data.
- **Combined delivery ownership**: responsibility for release quality is shared across all team members, not concentrated in a testing team or senior developers.

---

## Cross-Refs

- `[[foreword]]` — organizational context for quality-first delivery culture
- `[[ch-01-introduction-to-full-stack-testing]]` — foundational definition of full-stack testing; quality dimensions referenced throughout CT strategy
- `[[ch-02-manual-exploratory-testing]]` — exploratory testing is part of the CT process; scenarios found during exploration must be automated before a commit is declared done
- `[[ch-03-automated-functional-testing]]` — micro-level and macro-level tests that feed into CI stages; test pyramid architecture that determines pipeline speed; the 470-test example
- `[[ch-05-data-testing]]` — data tests can be included in CT stages
- `[[ch-06-visual-testing]]` — visual regression tests can be added to acceptance or CFR stages
- `[[ch-07-security-testing]]` — static security scanning belongs in build-and-test stage; functional security scanning belongs in nightly regression; shift-left strategies for security covered there
- `[[ch-08-performance-testing]]` — single-endpoint load test can run per-commit; full performance suite runs as nightly regression; discussed in detail in that chapter
- `[[ch-09-accessibility-testing]]` — accessibility tests can be incorporated into CFR stages
- `[[ch-10-cross-functional-requirements-testing]]` — CFR tests are the subject of the optional third and fourth CI feedback loops
- `[[ch-11-mobile-testing]]` — mobile-specific CT pipeline considerations
- `[[ch-12-moving-beyond-first-principles]]` — scaling CT practices in complex organizational contexts
- `[[ch-13-introduction-to-testing-in-emerging-technologies]]` — CT pipelines for emerging tech stacks
