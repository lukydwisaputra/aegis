# STORY-AUTH-204 — SSO Login with Plus-Aliased Emails

| Field            | Value                                                                      |
|------------------|----------------------------------------------------------------------------|
| **Story ID**     | STORY-AUTH-204                                                             |
| **Module**       | AUTH                                                                       |
| **Epic**         | EPIC-AUTH-07 — Identity & Access Modernisation                             |
| **Sprint**       | S24 (2026-05-18 → 2026-05-31)                                              |
| **Story Points** | 5                                                                          |
| **Assignee**     | Platform-Auth squad                                                        |
| **Status**       | In Development                                                             |
| **Linked Req**   | REQ-AUTH-04                                                                |
| **Linked TCs**   | TC-AUTH-031, TC-AUTH-032, TC-AUTH-033, TC-AUTH-034, TC-AUTH-035, TC-AUTH-036, TC-AUTH-037, TC-AUTH-038 |

---

## User Story (Connextra Format)

> **As** a Werkdone enterprise user whose corporate email address uses a plus alias
> (e.g., `firstname.lastname+dept@werkdone.com`) for inbox filtering,
>
> **I want** to be able to log in to the Werkdone platform via SSO using that plus-aliased
> address without any authentication error,
>
> **So that** I am not forced to maintain a separate non-aliased email address solely for
> platform access, and my inbox-filtering strategy remains intact.

---

## Acceptance Criteria (Gherkin)

```gherkin
Feature: SSO Login with Plus-Aliased Emails — STORY-AUTH-204

  Scenario: AC-1 — User with plus alias completes SSO login
    Given the user has a valid Okta account with email "firstname.lastname+dept@werkdone.com"
    And the Werkdone SSO login page is accessible
    When the user clicks "Sign in with SSO" and authenticates at the Okta IdP
    Then they are redirected back to the Werkdone dashboard
    And their displayed profile email matches "firstname.lastname+dept@werkdone.com" exactly

  Scenario: AC-2 — Plus alias is preserved in all downstream systems
    Given the user "firstname.lastname+dept@werkdone.com" has completed SSO login
    When the audit log and notification service are queried for that user
    Then both systems reference the email as "firstname.lastname+dept@werkdone.com"
    And no system has stored or sent to the stripped form "firstname.lastname@werkdone.com"

  Scenario: AC-3 — Users with no plus alias are unaffected
    Given a user with plain email "plain.user@werkdone.com" authenticates via SSO
    When the SSO callback processes the ID token
    Then login succeeds and the session email is "plain.user@werkdone.com"
    And no regression is introduced in the standard login path
```

---

## Definition of Ready

Before this story enters a sprint the following must be true:

- [ ] **DoR-1** — REQ-AUTH-04 is in Approved status and all ambiguity flags (AMB-01 through AMB-04) have a disposition (resolved or deferred with owner).
- [ ] **DoR-2** — A staging Okta tenant is provisioned with at least two test accounts using plus-aliased emails, and credentials are available in the team's secrets vault.
- [ ] **DoR-3** — The OAuth 2.0 callback handler source is accessible for code review, and the email-claim extraction path has been identified by a developer.
- [ ] **DoR-4** — Acceptance criteria are agreed upon by the product owner, the Auth squad lead, and the QA lead. No open AC disputes remain.
- [ ] **DoR-5** — The data classification for plus-aliased email storage has been reviewed by the Data Privacy officer and aligns with GDPR Art. 32 requirements (logged under RISK-AUTH-007).

---

## Definition of Done

The story is done when all of the following are satisfied:

- [ ] **DoD-1** — All 8 test cases TC-AUTH-031 through TC-AUTH-038 have been executed on the staging environment and results recorded in the test run RUN-20260524-001 (or a subsequent run).
- [ ] **DoD-2** — Any Sev1 or Sev2 defects raised against this story are resolved or formally risk-accepted with a documented mitigation plan (see DEF-001-AUTH-UI and RISK-AUTH-007).
- [ ] **DoD-3** — Code changes have been peer-reviewed and approved by two Auth squad members; no outstanding review comments.
- [ ] **DoD-4** — The OAuth callback email-claim extraction path is covered by an automated integration test in CI with assertion on the verbatim email value.
- [ ] **DoD-5** — GDPR Data Processing record has been updated to reflect that plus-aliased email addresses are stored and processed as first-class identifiers.

---

## INVEST Assessment

| Criterion      | Status | Notes |
|----------------|--------|-------|
| **I**ndependent | PASS | The plus-alias handling is isolated to the OAuth callback handler; it does not depend on any other in-progress story. |
| **N**egotiable  | PASS | The scope can be reduced to Okta-only if other IdP integrations are deferred. Confirmed negotiable with PO. |
| **V**aluable    | PASS | Affects all enterprise users who use plus-aliased addresses for inbox filtering — estimated 18% of the active user base per analytics. |
| **E**stimable   | PASS | The team estimated 5 points based on a comparable OAuth email-normalisation fix (STORY-AUTH-178) completed in S21. |
| **S**mall       | PASS | Fits within a single sprint. If the root cause involves the reverse proxy config as well as the OAuth handler, scope must be renegotiated. |
| **T**estable    | PASS | Acceptance criteria are in Gherkin; eight test cases (TC-AUTH-031–038) exist; staging IdP accounts are available. |
