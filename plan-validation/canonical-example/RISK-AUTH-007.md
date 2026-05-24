# RISK-AUTH-007 — Risk Register Entry

| Field            | Value |
|------------------|-------|
| **Risk ID**      | RISK-AUTH-007 |
| **Module**       | AUTH |
| **Category**     | Functional / Security |
| **Status**       | Active — risk materialised (see DEF-AUTH-0017) |
| **Owner**        | Auth squad lead |
| **Reviewer**     | QA lead + Data Privacy Officer |
| **Created**      | 2026-05-19 |
| **Last updated** | 2026-05-24 (updated: risk materialised) |
| **Standard**     | ISO 31000:2018 — Risk Management |

---

## Risk Description

> **SSO email validation may silently reject or corrupt valid RFC 5321 email formats
> containing a `+` character, causing authentication failures or incorrect identity
> resolution for enterprise users who use plus-aliased email addresses.**

The OAuth 2.0 callback handler, HTTP middleware layers, and session persistence
components all handle the email string independently. Each layer has the potential
to apply URL-decoding, case-folding, or format-validation logic that treats the `+`
character as a special character rather than a valid local-part character per RFC 5321
Section 4.1.2. Failures may be silent (no error returned; alias silently stripped)
or hard (500 error; login blocked entirely).

---

## Risk Matrix (ISO 31000 5×5)

```
        IMPACT
        1-Negligible  2-Minor  3-Moderate  4-Major  5-Catastrophic
L  5    5             10       15          20       25
I  4    4             8        12          16       20
K  3    3             6       [12]         12       15   ← RISK-AUTH-007
E  2    2             4         6           8       10
L  1    1             2         3           4        5
```

| Dimension     | Rating | Rationale |
|---------------|--------|-----------|
| **Likelihood** | 3 — Possible | The `+` character has known encoding ambiguity in HTTP form submissions; the OAuth library version in use (`oauth2-client v3.1.4`) has an open issue (#412) noting email claim handling inconsistency. It is possible but not certain that this manifests on the current callback implementation. |
| **Impact**     | 4 — Major | Affects all users with plus-aliased emails (estimated 18% of enterprise users). SSO is the primary authentication method for enterprise accounts. A silent failure (alias stripped) could lead to incorrect identity resolution and potential data leakage between accounts. |
| **Risk Score** | **12 — HIGH** | (Likelihood 3 × Impact 4) |
| **Ordinal tag** | **H (High)** | |

### Heuristic Disclaimer (Kaner ch-11)

The likelihood rating of 3 (Possible) is a **heuristic estimate, not a calibrated
probability**. Kaner ch-11 notes that test risk ratings based on tester judgment
carry inherent uncertainty and should not be treated as actuarial probabilities.
This rating reflects the team's informed assessment based on: (a) the known
encoding issue in `oauth2-client v3.1.4`, (b) the absence of an existing test
covering plus-aliased emails in the pre-existing test suite, and (c) the number
of layers (proxy, handler, session store) each of which could independently
introduce the defect. **Recalibrate this rating after TC-AUTH-031 through
TC-AUTH-038 are executed.**

---

## Risk Status Update — 2026-05-24

**Risk has materialised.** DEF-AUTH-0017 confirms that the OAuth callback handler
does corrupt the `+` character (decoded to space via `application/x-www-form-urlencoded`
decoding), producing an HTTP 500 for all plus-aliased email logins. The likelihood
rating is moot; the risk is now a confirmed defect. The entry is retained in the risk
register to track the mitigation and contingency status.

---

## Mitigation Plan

| # | Action | Owner | Target date | Status |
|---|--------|-------|-------------|--------|
| M1 | Execute all RFC 5321 edge-case tests (TC-AUTH-031 through TC-AUTH-038) before the v2.42.0 release to confirm the fix is complete and no adjacent edge cases remain. | QA lead | 2026-05-28 | In progress |
| M2 | Add a CI-gated automated integration test that asserts verbatim email preservation through the full SSO callback flow. Fail the build if this test fails. | Auth squad | 2026-05-28 | Planned |
| M3 | Audit all HTTP middleware in the callback route for URL-decoding operations; document the expected encoding state at each middleware boundary. | Auth squad | 2026-05-27 | Planned |
| M4 | Update the `oauth2-client` library from v3.1.4 to v3.2.1 (which includes the fix for issue #412). | Auth squad | 2026-05-27 | Planned |
| M5 | Add plus-aliased email addresses to the smoke test suite that runs on every deployment to staging and production. | QA lead | 2026-05-28 | Planned |

---

## Contingency Plan

If DEF-AUTH-0017 is not resolved before the v2.42.0 release date (2026-05-30):

1. **Fallback to password login**: Enterprise users with plus-aliased emails can use the password login path if enabled for their account. Auth squad to confirm whether the password path is available for all affected accounts. This is a temporary workaround only.
2. **Communication**: Customer Success to notify affected enterprise customers with guidance on the workaround. Template to be prepared by 2026-05-25.
3. **Release gate decision**: If DEF-AUTH-0017 remains open on 2026-05-29, the release manager will convene a gate meeting. Options: (a) delay release, (b) release with workaround communication, (c) scope-limit release to exclude enterprise SSO users. See Gate 2 decision in RUN-20260524-001-overview.md.

---

## Linked Test Cases

| Test Case | Covers |
|-----------|--------|
| TC-AUTH-031 | Happy path SSO with single plus alias — primary risk scenario |
| TC-AUTH-032 | Multiple plus aliases — tests identity isolation risk |
| TC-AUTH-033 | Invalid email formats — tests over-rejection risk (valid emails rejected) |
| TC-AUTH-034 | Expired token callback — tests state handling at risk boundary |
| TC-AUTH-035 | Concurrent logins — tests identity isolation under concurrency |
| TC-AUTH-036 | PII-containing alias — tests privacy risk dimension |
| TC-AUTH-037 | Injected characters — tests security risk dimension |
| TC-AUTH-038 | Accessibility — tests usability risk for keyboard/AT users |

---

## Linked Artifacts

| Artifact | Relationship |
|----------|-------------|
| REQ-AUTH-04 | Requirement at risk |
| STORY-AUTH-204 | User story whose delivery is at risk |
| DEF-AUTH-0017 | Defect that materialised this risk |
