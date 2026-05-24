# REQ-AUTH-04 — SSO Login must accept plus-aliased email addresses

| Field              | Value                                      |
|--------------------|--------------------------------------------|
| **Requirement ID** | REQ-AUTH-04                                |
| **Module**         | AUTH                                       |
| **Source Story**   | STORY-AUTH-204                             |
| **Status**         | Approved                                   |
| **Version**        | 1.2                                        |
| **Owner**          | Platform-Auth squad                        |
| **Last revised**   | 2026-05-20                                 |

---

## Title

SSO Login must accept plus-aliased email addresses

---

## Description

The application's SSO entry point must treat `user+alias@domain.com` as a valid,
deliverable email address in accordance with RFC 5321 Section 4.1.2, which allows
the local part to contain a `+` character. When a user authenticates through the
Identity Provider (IdP) using a plus-aliased address, the OAuth 2.0 / OIDC callback
must forward the email claim unmodified to the application's session layer. Stripping,
URL-encoding errors, or case-folding of the `+` character at any layer — reverse
proxy, OAuth handler, or session store — constitutes a defect against this requirement.

---

## Acceptance Criteria (Gherkin)

```gherkin
Feature: SSO Login with plus-aliased email addresses

  Scenario: AC-1 — Successful SSO login using a plus-aliased email
    Given a registered user whose IdP account email is "qa.engineer+test@werkdone.com"
    And the OAuth 2.0 PKCE flow is configured on the staging environment
    When the user completes the IdP login form and grants consent
    Then the application receives an ID token where email claim equals "qa.engineer+test@werkdone.com"
    And the application session is created with email "qa.engineer+test@werkdone.com" unchanged

  Scenario: AC-2 — Session record stores plus-aliased email verbatim
    Given a user authenticates via SSO with email "noreply+automation@werkdone.com"
    When the session is persisted to the user-session datastore
    Then the stored email field equals "noreply+automation@werkdone.com"
    And no URL-encoding substitution (e.g. "%2B") appears in the stored value

  Scenario: AC-3 — Multiple distinct plus aliases are treated as distinct identities
    Given IdP accounts exist for "dev+alpha@werkdone.com" and "dev+beta@werkdone.com"
    When each account authenticates via SSO in separate browser sessions
    Then each session is linked to its respective account record
    And neither session inherits data from the other account

  Scenario: AC-4 — Invalid email format is rejected at the pre-auth validation layer
    Given a login request is submitted with local part containing consecutive plus signs "user++bad@werkdone.com"
    When the pre-auth email validation runs
    Then the request is rejected before reaching the IdP with HTTP 422 and error code EMAIL_FORMAT_INVALID
    And no OAuth redirect is initiated
```

---

## Testability Notes

*Applying Kaner ch-01 testability heuristics.*

| Heuristic              | Assessment |
|------------------------|------------|
| **Observable**         | The email claim in the ID token and the stored session record are both observable via API and database query. Observable. |
| **Controllable**       | Test accounts can be pre-seeded in the staging IdP. The OAuth callback URL can be pointed at a local stub to isolate the application layer. Controllable. |
| **Decomposable**       | The flow decomposes into: (1) IdP authentication, (2) OAuth callback, (3) session persistence, (4) downstream reads. Each layer can be tested in isolation. |
| **Understandable**     | Partially. RFC 5321 email syntax is well-specified but the IdP vendor's internal email normalisation behaviour is not publicly documented — this is a testability risk. |
| **What makes it hard** | The `+` character is a reserved delimiter in `application/x-www-form-urlencoded` (RFC 1866), meaning HTTP layers may silently encode it as a space or `%2B`. This encoding/decoding round-trip is invisible unless explicitly logged. |

---

## Ambiguity Flags

*Items a qa-requirements-analyst would flag for clarification before test design begins.*

| Flag ID | Ambiguity | Impact if unresolved | Recommended action |
|---------|-----------|----------------------|--------------------|
| AMB-01 | The requirement says "unmodified" but does not specify whether case-folding of the domain part (e.g. `WERKDONE.COM` → `werkdone.com`) is permitted. RFC 5321 mandates case-insensitive domain matching but case-sensitive local-part matching. | Test for case-folding of domain may pass or fail depending on interpretation. | Clarify with Auth squad whether domain normalisation to lowercase is intentional. |
| AMB-02 | AC-4 rejects `user++bad@werkdone.com` but does not define the full set of invalid local-part patterns. Is `user+@werkdone.com` (trailing plus) valid or invalid? | Test coverage gap for boundary of valid vs invalid plus usage. | Request a complete email-format validation rule table from Auth squad. |
| AMB-03 | "No URL-encoding substitution" (AC-2) does not specify at which layer — storage, display, or API response — this guarantee applies. | A display layer that re-encodes `+` as `%2B` may satisfy storage AC but violate display expectations. | Add explicit acceptance criteria for the API response and UI display layers. |
| AMB-04 | The requirement is silent on behaviour when the IdP itself normalises or strips the `+` alias before issuing the ID token (a known Google Workspace behaviour for some domain configs). | If the IdP strips the alias, the application cannot be held to AC-1; but users will lose their account association. | Confirm whether tested IdP (Okta staging tenant) preserves `+` aliases in the email claim. |
