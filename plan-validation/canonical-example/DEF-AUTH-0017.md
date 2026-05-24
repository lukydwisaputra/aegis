# DEF-AUTH-0017 — Defect Report

| Field                  | Value |
|------------------------|-------|
| **Defect ID**          | DEF-AUTH-0017 |
| **Title (≤ 65 chars)** | SSO callback 500: '+' in email rejected by OAuth handler |
| **Module**             | AUTH |
| **Component**          | OAuth 2.0 callback handler (`/auth/callback`) |
| **Severity**           | Sev2 — Critical |
| **Priority**           | P1 — Fix before next release |
| **Status**             | Open — Root cause: Investigating |
| **Reported by**        | QA — Aegis automated run RUN-20260524-001 |
| **Reported date**      | 2026-05-24 |
| **Assigned to**        | Auth squad (unassigned to individual) |
| **Environment**        | Staging (`app-staging.werkdone.com`, deploy `v2.41.0-rc3`) |
| **Build / SHA**        | `v2.41.0-rc3` / `git:a3f1bc9` |

---

## IEEE 1044 Classification

| IEEE 1044 Field    | Value |
|--------------------|-------|
| **Defect type**    | Logic |
| **Phase introduced** | Code |
| **Phase found**    | System (integration test — SSO flow) |
| **Activity found** | Functional testing |

---

## Severity / Priority Rationale

*Applying Kaner ch-04 bug advocacy principles: describe the impact to real users, not just the technical symptom.*

- **Sev2 — Critical**: The defect blocks every user whose IdP-registered email contains a `+` character from logging in via SSO. SSO is the only login method for enterprise accounts without a password fallback enabled. Estimated 18% of active enterprise users are affected (from analytics, per STORY-AUTH-204).
- **Workaround exists**: Users can request their IdP admin to change their registered email to a non-aliased form. This workaround is operationally expensive and causes user friction; it does not reduce severity but prevents an Sev1 classification (which would require an emergency hotfix).
- **P1 — Next release**: The defect must be fixed before the v2.42.0 release. It is not a P0 (immediate hotfix) because the workaround prevents complete service outage for affected users.

---

## Description

When a user whose Okta-registered email contains a `+` character (e.g. `qa.engineer+smoke@werkdone.com`) completes the IdP login and is redirected to the application's OAuth callback endpoint (`/auth/callback`), the application throws an HTTP 500 Internal Server Error. The OAuth authorisation code is never exchanged for tokens, and no user session is created.

Preliminary investigation indicates the application's OAuth callback handler URL-decodes the `email` query parameter before passing it to the token exchange function. The `+` character, which in `application/x-www-form-urlencoded` encoding represents a literal space, is decoded as a space. The resulting email `qa.engineer smoke@werkdone.com` fails the application's own email format validation, causing an unhandled exception that returns a 500 instead of a graceful error.

---

## Reproduction Steps

*(Minimal, numbered — Kaner ch-04: reproduce in the fewest steps possible)*

1. Open a browser with no existing Werkdone session.
2. Navigate to `https://app-staging.werkdone.com/login`.
3. Click "Sign in with SSO".
4. In the Okta login prompt, enter `qa.engineer+smoke@werkdone.com` and the correct password.
5. Click "Sign In" on the Okta form.
6. Observe the browser redirect to `https://app-staging.werkdone.com/auth/callback?code=<CODE>&state=<STATE>`.
7. **Observed**: Browser displays HTTP 500 error page ("Something went wrong").

*Reproduced 3/3 times on 2026-05-24 using Chrome 125, Firefox 127, and Edge 125.*

---

## Expected vs Actual Result

| | Detail |
|--|--------|
| **Expected** | Browser is redirected to `/dashboard`. `GET /api/v1/me` returns `{ "email": "qa.engineer+smoke@werkdone.com" }`. |
| **Actual** | HTTP 500 response from `/auth/callback`. No session created. Application log shows: `UnhandledError: invalid email format 'qa.engineer smoke@werkdone.com'` (note: `+` decoded to space). |

---

## Root Cause Status

**Investigating.** Hypothesis: the OAuth callback route handler calls `URLSearchParams.get('email')` (or equivalent) on the raw query string, which applies `application/x-www-form-urlencoded` decoding and converts `+` to space. The email is not sourced from the query string in a standard OIDC flow (it should come from the ID token claim after the code exchange), suggesting either (a) the handler has a non-standard path that reads email from the query string directly, or (b) a middleware layer is injecting a decoded email parameter before the handler runs.

**Next step**: Auth squad to trace the callback route middleware chain and identify where the email value is first read from the request.

---

## Bug Variation Axes

*Applying Kaner ch-04 bug variation axes: define the dimensions along which the bug may vary, to bound the scope of regression testing.*

### Axis 1 — Behaviour Variations

| Variation | Test needed? |
|-----------|-------------|
| Single `+` in local part (`user+a@`) | YES — core case (TC-AUTH-031) |
| Multiple `+` in local part (`user+a+b@`) | YES — is the second `+` also decoded to space? |
| `+` at start of local part (`+user@`) — technically invalid per RFC 5321 | YES — does the handler crash differently or return 422? |
| No `+` in email (plain address) | YES — regression check (TC not failing = not regressed) |
| `%2B` pre-encoded by the IdP | YES — some IdPs send `%2B` instead of `+`; does the double-decode cause a different failure? |

### Axis 2 — State Variations

| State | Test needed? |
|-------|-------------|
| Fresh browser, no cookies | YES — confirmed (core reproduction) |
| Existing Werkdone session + new SSO login (re-auth flow) | YES — does an existing session mask the bug? |
| User previously logged in successfully (before this build) — session cookie still valid | YES — does re-authentication through the broken handler invalidate the existing session? |

### Axis 3 — Environment Variations

| Environment | Test needed? |
|-------------|-------------|
| Staging (`v2.41.0-rc3`) | YES — confirmed |
| Production (`v2.40.2`) | VERIFY — check if the bug was introduced in v2.41.0-rc3 only, or if it also exists in production |
| Local dev (`localhost:3000`) | YES — to enable faster debug iteration |
| Mobile browser (Chrome iOS, Safari iOS) | LOW — same server-side code path; verify only if mobile-specific middleware exists |

---

## Evidence References

| Artifact | Description |
|----------|-------------|
| `TC-AUTH-031_step3_20260524T1430Z.png` | Screenshot of the HTTP 500 error page in Chrome 125, captured at step 7 of TC-AUTH-031 on 2026-05-24 at 14:30 UTC |
| `TC-AUTH-031_network_20260524T1430Z.har` | Chrome DevTools Network HAR export showing the full `/auth/callback` request and 500 response, including request headers and response body |

---

## Compliance Impact

| Tag | Impact |
|-----|--------|
| **GDPR-Art32** | If the decoded email `qa.engineer smoke@werkdone.com` is written to any log before the exception is thrown, it constitutes processing of an incorrectly decoded personal data value. Confirm with DPO whether the error log entry constitutes a notifiable processing error. |
| **CWE-287** | Improper authentication: users with plus-aliased emails are unable to authenticate. Depending on whether this is exploitable (e.g., could an attacker force a `+`-to-space decode to hijack a session), further security assessment is needed. |
| **ISO25010-Security-Authenticity** | The authentication mechanism fails for a class of valid users, undermining authenticity guarantees for those users. |

---

## Linked Artifacts

| Artifact | Relationship |
|----------|-------------|
| TC-AUTH-031 | Test case that exposed the defect (step 3 failure) |
| REQ-AUTH-04 | Requirement violated — AC-1 not met |
| STORY-AUTH-204 | User story whose DoD is blocked by this defect |
| RISK-AUTH-007 | Risk materialised — likelihood was rated 3 (Possible); defect confirms the risk is real |
