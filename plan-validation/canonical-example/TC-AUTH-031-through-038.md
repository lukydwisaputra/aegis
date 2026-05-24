# Test Cases TC-AUTH-031 through TC-AUTH-038

**Feature:** SSO Login with Plus-Aliased Emails
**Requirement:** REQ-AUTH-04
**Story:** STORY-AUTH-204
**Module:** AUTH
**Environment:** Staging (okta-staging.werkdone.com + app-staging.werkdone.com)
**Last updated:** 2026-05-24

---

## TC-AUTH-031 — Happy path SSO with plus-aliased email

| Field               | Value |
|---------------------|-------|
| **ID**              | TC-AUTH-031 |
| **Title**           | Happy path: SSO login succeeds with a single plus-aliased email |
| **Technique**       | Boundary Value Analysis — Mohan ch-02 (minimum-complexity valid input: one `+`, one alias segment, valid domain) |
| **Priority**        | P1 — Critical path |
| **viewportScope**   | desktop |
| **automationStatus**| Automatable — Playwright candidate |
| **Compliance tags** | REQ-AUTH-04 / AC-1, ISO25010-Functional-Correctness |

**Book citation:** Mohan ch-02 — Boundary Value Analysis is applied here to select the simplest valid plus-aliased address (`user+a@domain.com`, where the alias segment is a single character — the lower boundary of a non-empty alias). This is the nominal representative of the valid input partition.

### Preconditions

1. Staging Okta tenant has an active account with email `qa.engineer+smoke@werkdone.com`.
2. Werkdone staging app is deployed at `https://app-staging.werkdone.com`.
3. The OAuth 2.0 PKCE client is registered in Okta with callback URL `https://app-staging.werkdone.com/auth/callback`.
4. Browser has no pre-existing Werkdone session cookies.

### Steps

| # | Action | Data |
|---|--------|------|
| 1 | Navigate to `https://app-staging.werkdone.com/login` | — |
| 2 | Click "Sign in with SSO" button | — |
| 3 | In the Okta login form, enter username | `qa.engineer+smoke@werkdone.com` |
| 4 | Enter password | `<vault:okta-staging/qa-smoke-pw>` |
| 5 | Click "Sign In" | — |
| 6 | Grant consent on the Okta consent screen (if shown) | — |
| 7 | Observe redirect back to `https://app-staging.werkdone.com/dashboard` | — |
| 8 | Inspect the session via `GET /api/v1/me` and record the `email` field | — |
| 9 | Inspect browser Network tab: find the `/auth/callback?code=...` request; confirm `code` param is present and no `+`-to-space corruption in the URL | — |

### Expected Result

- Redirect to `/dashboard` completes with HTTP 200.
- `GET /api/v1/me` returns `{ "email": "qa.engineer+smoke@werkdone.com" }` — `+` is preserved.
- No `%2B` or space replacement visible in session store (verify via `GET /api/v1/session/debug` endpoint).

### Actual Result

*(To be filled during execution.)*

### Pass/Fail Criteria

PASS if all expected results are met. FAIL if the `+` is absent, encoded, or replaced in any layer.

---

## TC-AUTH-032 — SSO with multiple plus aliases

| Field               | Value |
|---------------------|-------|
| **ID**              | TC-AUTH-032 |
| **Title**           | SSO with multiple distinct plus aliases treated as separate identities |
| **Technique**       | Equivalence Partitioning (Mohan ch-02) + Kaner ch-03 (partition the alias-count variable: one alias, two aliases, same base address) |
| **Priority**        | P1 |
| **viewportScope**   | desktop |
| **automationStatus**| Automatable — Playwright candidate |
| **Compliance tags** | REQ-AUTH-04 / AC-3, ISO25010-Functional-Correctness |

**Book citation:** Mohan ch-02 EP defines three partitions for the alias segment: (a) no alias, (b) one alias, (c) multiple aliases from the same base. Kaner ch-03 adds: test one representative from each partition rather than exhaustive enumeration; selecting `dev+alpha@werkdone.com` and `dev+beta@werkdone.com` (same base `dev@werkdone.com`) covers partition (c) with two representatives while confirming identity isolation.

### Preconditions

1. Two staging Okta accounts exist: `dev+alpha@werkdone.com` and `dev+beta@werkdone.com`. Both are distinct accounts — they are not aliases of the same Okta user record.
2. Each account has at least one distinct piece of profile data (e.g., different `displayName`) to enable differentiation during assertion.
3. Test runner can spawn two independent browser contexts (Playwright `browser.newContext()`).

### Steps

| # | Action | Context |
|---|--------|---------|
| 1 | In Context A, complete SSO login as `dev+alpha@werkdone.com` | Browser A |
| 2 | Record `GET /api/v1/me` response for Context A | Browser A |
| 3 | In Context B, complete SSO login as `dev+beta@werkdone.com` | Browser B |
| 4 | Record `GET /api/v1/me` response for Context B | Browser B |
| 5 | Assert Context A email equals `dev+alpha@werkdone.com` | — |
| 6 | Assert Context B email equals `dev+beta@werkdone.com` | — |
| 7 | Assert Context A session ID differs from Context B session ID | — |
| 8 | In Context A, call `GET /api/v1/user/profile`; confirm profile belongs to alpha account only | Browser A |

### Expected Result

- Each context has an independent session with its correct email verbatim.
- No cross-contamination: Context A never shows beta data; Context B never shows alpha data.
- Both logins succeed with HTTP 200.

---

## TC-AUTH-033 — SSO with invalid email format

| Field               | Value |
|---------------------|-------|
| **ID**              | TC-AUTH-033 |
| **Title**           | Pre-auth validation rejects malformed plus-aliased addresses before OAuth redirect |
| **Technique**       | Decision Table Testing — Kaner ch-03 Five-fold system (conditions: `+` position, alias segment content, domain validity, consecutive `+`, trailing `+`) |
| **Priority**        | P2 |
| **viewportScope**   | desktop |
| **automationStatus**| Automatable — API-level test (bypass UI) |
| **Compliance tags** | REQ-AUTH-04 / AC-4, ISO25010-Functional-Reliability |

**Book citation:** Kaner ch-03 Five-fold Decision Table system: enumerate conditions that govern the validation outcome (valid/invalid), combine them into a minimal set of rules that covers all distinct outcomes without testing every possible combination. The table below is the derived reduced set.

### Decision Table

| Rule | `+` present | Alias segment non-empty | Valid domain | Consecutive `++` | Trailing `+` | **Outcome** |
|------|-------------|------------------------|--------------|-----------------|--------------|-------------|
| R1   | No  | N/A | Yes | No | No | ACCEPT (plain email) |
| R2   | Yes | Yes | Yes | No | No | ACCEPT (valid plus-alias) |
| R3   | Yes | No  | Yes | No | Yes | REJECT — EMAIL_FORMAT_INVALID |
| R4   | Yes | Yes | Yes | Yes | No | REJECT — EMAIL_FORMAT_INVALID |
| R5   | Yes | Yes | No  | No | No | REJECT — EMAIL_FORMAT_INVALID |

This test case targets **Rules R3 and R4** (the invalid states introduced by plus-aliasing).

### Preconditions

1. Staging app pre-auth validation endpoint: `POST /api/v1/auth/sso/initiate` with body `{ "email": "<value>" }`.
2. No Okta session required — this tests the application layer before OAuth redirect.

### Steps

| # | Input email | Expected HTTP status | Expected error code |
|---|-------------|---------------------|---------------------|
| 1 | `user++bad@werkdone.com` | 422 | `EMAIL_FORMAT_INVALID` |
| 2 | `user+@werkdone.com` | 422 | `EMAIL_FORMAT_INVALID` |
| 3 | `user+alias@` (no domain) | 422 | `EMAIL_FORMAT_INVALID` |
| 4 | `user+valid@werkdone.com` | 302 (OAuth redirect initiated) | — (pass) |
| 5 | `plain@werkdone.com` | 302 (OAuth redirect initiated) | — (pass) |

### Expected Result

- Steps 1–3: `HTTP 422` with `{ "error": "EMAIL_FORMAT_INVALID" }` and no `Location` redirect header.
- Steps 4–5: `HTTP 302` with a `Location` header pointing to the Okta authorisation endpoint. No validation error.

---

## TC-AUTH-034 — SSO callback with expired token

| Field               | Value |
|---------------------|-------|
| **ID**              | TC-AUTH-034 |
| **Title**           | SSO callback with an expired OAuth authorisation code returns a graceful error |
| **Technique**       | State Transition Testing — Mohan ch-02 (OAuth flow state machine: Initiated → Code Issued → Code Exchanged → Session Created; test the invalid transition Initiated → Expired Code → Exchange Attempted) |
| **Priority**        | P2 |
| **viewportScope**   | desktop |
| **automationStatus**| Automatable — requires time-manipulation (mock clock or Okta test token API) |
| **Compliance tags** | REQ-AUTH-04, ISO25010-Functional-Reliability, ISO25010-Security |

**Book citation:** Mohan ch-02 State Transition diagrams: draw the valid state machine for the OAuth 2.0 authorisation code flow, identify all transitions, then test the invalid/exceptional transitions (expired code exchange, double-code-use, code from a different client). TC-AUTH-034 tests the "Code Expired" exceptional transition.

### State Machine (OAuth Code Flow)

```
[Idle]
  → click SSO → [Auth Initiated]
  → IdP login OK → [Code Issued]  (code TTL: 60 s by Okta default)
  → app POSTs /token → [Session Created]    ← HAPPY PATH

  [Code Issued] + TTL elapsed → [Code Expired]
  → app POSTs /token with expired code → [Exchange Failed]  ← THIS TEST
```

### Preconditions

1. Staging Okta tenant allows short-lived test tokens (use Okta Event Hooks or a mock OIDC server such as `node-oidc-provider`).
2. Alternatively: capture a real authorisation code via a network intercept, wait 65 seconds, then replay it.
3. Test account: `sso.expiry.test+alias@werkdone.com`.

### Steps

| # | Action |
|---|--------|
| 1 | Initiate SSO for `sso.expiry.test+alias@werkdone.com`; intercept the callback URL containing `?code=<CODE>` before the app processes it. |
| 2 | Wait 65 seconds (past the Okta 60 s code TTL). |
| 3 | Release / replay the intercepted callback request to the app. |
| 4 | Observe the application response. |
| 5 | Confirm the user is redirected to `/login?error=sso_failed` (or equivalent error page). |
| 6 | Confirm no partial session is created (call `GET /api/v1/me` — expect 401). |
| 7 | Confirm the error message shown is user-friendly and does not expose internal OAuth error details. |

### Expected Result

- Application responds with an error page / redirect, not a 500.
- Session store has no entry for the test user from this attempt.
- Error page copy does not expose `invalid_grant` or token details to the end user.

---

## TC-AUTH-035 — Concurrent SSO login from two devices

| Field               | Value |
|---------------------|-------|
| **ID**              | TC-AUTH-035 |
| **Title**           | Concurrent SSO logins from two devices for the same plus-aliased account both succeed independently |
| **Technique**       | All-Pairs (Pairwise) Testing — Kaner ch-03 (pair: device-type × session-state × alias-format) |
| **Priority**        | P2 |
| **viewportScope**   | all |
| **automationStatus**| Manual — requires two physical/virtual device contexts; partially automatable with Playwright parallel workers |
| **Compliance tags** | REQ-AUTH-04, ISO25010-Functional-Correctness, ISO25010-Performance-Concurrency |

**Book citation:** Kaner ch-03 All-Pairs method: identify the variables that could interact during concurrent login (device type: desktop/mobile; network: WiFi/LTE; session state: fresh/existing cookie; alias: single-plus/multi-plus). Generate the minimal pairwise coverage matrix. The three pairs selected here are: (desktop × fresh session), (mobile × fresh session), (desktop × existing cookie + new SSO).

### All-Pairs Matrix (Reduced)

| Test | Device    | Network | Session State   | Alias Format          |
|------|-----------|---------|-----------------|------------------------|
| P1   | Desktop   | WiFi    | Fresh           | `user+desk@werkdone.com` |
| P2   | Mobile    | LTE     | Fresh           | `user+mob@werkdone.com`  |
| P3   | Desktop   | WiFi    | Existing cookie | `user+desk@werkdone.com` |

For this test case we execute **P1 and P2 concurrently** (same account base, two aliases).

### Preconditions

1. Two test accounts: `concurrent.test+desk@werkdone.com` (desktop) and `concurrent.test+mob@werkdone.com` (mobile viewport simulation).
2. Both accounts exist in staging Okta.
3. Playwright can run two workers simultaneously or use two browser profiles.

### Steps

| # | Action |
|---|--------|
| 1 | Launch Desktop context and Mobile context simultaneously (Playwright `--workers=2`). |
| 2 | Both contexts navigate to `/login` and click "Sign in with SSO" within 2 seconds of each other. |
| 3 | Desktop context authenticates as `concurrent.test+desk@werkdone.com`. |
| 4 | Mobile context authenticates as `concurrent.test+mob@werkdone.com`. |
| 5 | Record timestamps and session IDs from both `GET /api/v1/me` responses. |
| 6 | Verify no session mixing: desktop session email = `+desk`, mobile session email = `+mob`. |
| 7 | Verify both sessions have independent JWT tokens with distinct `sub` claims. |

### Expected Result

- Both sessions complete without error.
- No session data from one account appears in the other context.
- No race condition producing a 5xx error is observed.

---

## TC-AUTH-036 — SSO with PII-containing plus alias

| Field               | Value |
|---------------------|-------|
| **ID**              | TC-AUTH-036 |
| **Title**           | Plus-aliased email containing PII identifiers is handled per GDPR Art. 32 data-minimisation requirements |
| **Technique**       | Compliance / Privacy Testing — GDPR Art. 32 + WCAG 2.2 (data minimisation, access control, secure storage) |
| **Priority**        | P1 |
| **viewportScope**   | desktop |
| **automationStatus**| Manual — requires DPA log review and DB inspection |
| **Compliance tags** | GDPR-Art32, ISO25010-Security-Confidentiality, REQ-AUTH-04 |

**Book citation:** GDPR Art. 32 requires that personal data is processed with appropriate technical measures. A plus alias such as `john.doe+payroll@werkdone.com` can embed role or department information (PII by context). The test verifies that the application's Data Processing Agreement obligations are met: data is encrypted at rest, not logged in plain text in application logs, and not exposed in error messages.

### Preconditions

1. Test account with deliberately PII-rich alias: `john.doe+payroll@werkdone.com` in staging Okta.
2. Access to staging application logs (Datadog or equivalent log stream).
3. Access to staging database to inspect `user_sessions` table.
4. Confirm with DPO that this test account is covered under the test-data processing agreement.

### Steps

| # | Action | Check |
|---|--------|-------|
| 1 | Authenticate via SSO as `john.doe+payroll@werkdone.com` | Login succeeds |
| 2 | Pull application log stream for the 60 s window around the SSO event | No plain-text email in log lines at INFO or DEBUG level |
| 3 | Query `user_sessions` table: `SELECT email FROM user_sessions WHERE email LIKE '%payroll%'` | Email stored in encrypted/hashed form OR stored plaintext per DPA agreement |
| 4 | Call `GET /api/v1/me` — inspect response for over-exposure of email in additional fields (e.g., `rawClaim`, `idpEmail`) | Only `email` field returned; no duplicate raw fields |
| 5 | Trigger a 422 error by sending malformed data with the session active — inspect error response body | No email address appears in error body |
| 6 | Check that the email is not present in any CDN or reverse-proxy access log (Cloudflare log export) | Not present in URL path or query string |

### Expected Result

- Application logs do not contain the plain-text email at any level except the audit log (which is encrypted and access-controlled).
- Session store holds the email in accordance with the DPA (encrypted or plaintext per agreed processing).
- Error responses never include the user's email address.
- No email leakage in CDN/proxy logs.

---

## TC-AUTH-037 — SSO with injected characters in email

| Field               | Value |
|---------------------|-------|
| **ID**              | TC-AUTH-037 |
| **Title**           | SSO pre-auth validation sanitises injected characters in email parameter |
| **Technique**       | Security Testing — OWASP WSTG-AUTH-01 (Authentication bypass); CWE-287 (Improper Authentication); input injection via email local-part |
| **Priority**        | P1 |
| **viewportScope**   | all |
| **automationStatus**| Automatable — API-level; include in security regression suite |
| **Compliance tags** | CWE-287, OWASP-WSTG-AUTH-01, GDPR-Art32, ISO25010-Security-Authenticity, REQ-AUTH-04 |

**Book citation:** OWASP WSTG-AUTH-01 covers authentication bypass through parameter manipulation. CWE-287 covers improper authentication when input is not adequately validated. The `+` character creates a natural injection point: attackers may attempt to embed SQL fragments, LDAP wildcards, or CRLF sequences in the local-part before or after the `+` character.

### Preconditions

1. Staging environment with WAF in monitoring-only mode (so injected payloads reach the app layer for testing).
2. API access to `POST /api/v1/auth/sso/initiate`.
3. No existing session.

### Injection Payloads (Test Matrix)

| # | Payload | Attack class | Expected outcome |
|---|---------|-------------|-----------------|
| 1 | `user+' OR '1'='1@werkdone.com` | SQL Injection | HTTP 422, `EMAIL_FORMAT_INVALID` |
| 2 | `user+<script>alert(1)</script>@werkdone.com` | XSS | HTTP 422, `EMAIL_FORMAT_INVALID` |
| 3 | `user+%0d%0aSet-Cookie:injected=1@werkdone.com` | CRLF Injection | HTTP 422, `EMAIL_FORMAT_INVALID` |
| 4 | `user+*)(uid=*))(|(uid=*@werkdone.com` | LDAP Injection | HTTP 422, `EMAIL_FORMAT_INVALID` |
| 5 | `user+alias@werkdone.com\x00evil` | Null-byte injection | HTTP 422 or strip null byte — no 5xx |
| 6 | `user+alias@werkdone.com` (valid control) | — | HTTP 302, OAuth redirect initiated |

### Steps

| # | Action |
|---|--------|
| 1 | POST each payload from the matrix to `POST /api/v1/auth/sso/initiate` as `{ "email": "<payload>" }`. |
| 2 | Record HTTP status, response body, and response headers for each. |
| 3 | For any payload that produces a 302, inspect the redirect URL for evidence that the injected content reached the IdP. |
| 4 | Review application error logs: confirm no stack trace or DB query fragment is exposed in any 422 response. |
| 5 | For payload #3 (CRLF), inspect response headers for any injected `Set-Cookie`. |
| 6 | Run the control payload (#6) last to confirm the endpoint is still functional. |

### Expected Result

- Payloads 1–5: HTTP 422 with `EMAIL_FORMAT_INVALID`; no 5xx; no injected content in response body or headers.
- Payload 6 (control): HTTP 302 redirect to Okta.
- No evidence of injection reaching the IdP or the database query layer.

---

## TC-AUTH-038 — Accessibility: SSO button keyboard navigation

| Field               | Value |
|---------------------|-------|
| **ID**              | TC-AUTH-038 |
| **Title**           | SSO "Sign in with SSO" button is operable by keyboard and meets WCAG 2.2 Success Criteria 1.4.3 and 2.1.1 |
| **Technique**       | Accessibility Testing — WCAG 2.2 SC 1.4.3 (Contrast Minimum), SC 2.1.1 (Keyboard), SC 4.1.2 (Name, Role, Value); tooling: axe-core 4.x |
| **Priority**        | P2 |
| **viewportScope**   | desktop |
| **automationStatus**| Automatable — axe-core integration in Playwright |
| **Compliance tags** | WCAG-2.2-1.4.3, WCAG-2.2-2.1.1, WCAG-2.2-4.1.2, ISO25010-Usability |

**Book citation:** WCAG 2.2 SC 1.4.3 requires a contrast ratio of at least 4.5:1 for normal text on the SSO button. SC 2.1.1 requires that all functionality is operable from the keyboard alone. axe-core is used as the automated scanning baseline; manual keyboard testing supplements it for focus-order and modal trap scenarios.

### Preconditions

1. Login page `https://app-staging.werkdone.com/login` is accessible.
2. Playwright test environment has `axe-core` 4.x installed (`@axe-core/playwright`).
3. Test is run in a headful browser (Chrome) for visual contrast validation.

### Steps

#### Part A — Automated axe-core scan

| # | Action |
|---|--------|
| 1 | Navigate to `/login`. |
| 2 | Inject and run `axe.run({ include: [['#sso-signin-btn']] })`. |
| 3 | Assert zero violations with impact `critical` or `serious`. |
| 4 | Log any `moderate` or `minor` violations as advisory items for UX team. |

#### Part B — Manual keyboard navigation

| # | Action | Expected |
|---|--------|----------|
| 5 | Place focus at the top of the login page (Tab from browser address bar) | First focusable element receives visible focus ring |
| 6 | Tab through all interactive elements until the "Sign in with SSO" button is reached | Button receives focus with clearly visible focus indicator (≥ 2 CSS px outline, WCAG 2.2 SC 2.4.11) |
| 7 | Press Enter on the focused SSO button | SSO flow initiates (same as mouse click) |
| 8 | Press Space on the focused SSO button (in a fresh page load) | SSO flow initiates |
| 9 | After IdP login, verify Tab focus returns to a logical element on the dashboard (not the body) | Focus lands on the first dashboard heading or skip-link |

#### Part C — Contrast check

| # | Action |
|---|--------|
| 10 | Using browser DevTools colour picker, record foreground and background colours of the SSO button label at rest state. |
| 11 | Calculate contrast ratio using WebAIM Contrast Checker. |
| 12 | Assert ratio ≥ 4.5:1. |

### Expected Result

- axe-core scan: zero critical/serious violations on `#sso-signin-btn`.
- Keyboard: SSO button is reachable via Tab alone; Enter and Space both trigger the flow.
- Contrast: button label contrast ratio ≥ 4.5:1 in both light and dark mode.
- Focus return after login: logical focus placement on dashboard.
