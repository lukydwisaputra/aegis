# Canonical Running Example — SSO Login with Plus-Aliased Emails

**Aegis HANDBOOK — Phase A.B Step 5**
**Feature:** Login with SSO + plus-aliased email addresses
**Artifact set version:** 1.0 (2026-05-24)

---

## What Feature Is Being Tested

The feature is the application's SSO (Single Sign-On) login flow, specifically the
handling of RFC 5321-compliant plus-aliased email addresses (e.g.,
`user+alias@domain.com`). Enterprise users commonly use plus aliases for inbox
filtering. The feature must accept these addresses through the full OAuth 2.0 PKCE
flow — from the IdP login form, through the application's `/auth/callback` handler,
to session persistence — without corrupting, stripping, or misidentifying the `+`
character at any layer.

The complete requirement is documented in REQ-AUTH-04. The user story is STORY-AUTH-204.

---

## Why This Feature Was Chosen

This feature was selected as the canonical running example because it exercises every
major pattern in the Aegis framework within a single, compact feature boundary:

| Pattern exercised | How it appears in this feature |
|-------------------|-------------------------------|
| Requirement analysis with ambiguity flags | AMB-01 through AMB-04 in REQ-AUTH-04 (e.g., RFC 5321 case-folding ambiguity) |
| Multiple test design techniques | BVA, EP, Decision Table, State Transition, All-Pairs, Security, Privacy, Accessibility |
| Realistic defect found and documented | DEF-AUTH-0017: `+` decoded to space by OAuth callback handler → HTTP 500 |
| Risk that materialises | RISK-AUTH-007: known `oauth2-client` library issue; likelihood was 3/5; confirmed by execution |
| Compliance coverage | GDPR Art. 32, WCAG 2.2, OWASP WSTG-AUTH-01, CWE-287, ISO 25010 |
| Multi-phase test run with gate decisions | RUN-20260524-001: Gate 1 approved, Gate 2 conditionally approved, Gate 3 pending fix |
| INVEST assessment and DoR/DoD | Full INVEST tick in STORY-AUTH-204; all 5 DoR and 5 DoD items populated |

The `+` character is a genuine encoding hazard in HTTP form submissions (`application/x-www-form-urlencoded` treats `+` as a space). It is a real class of bug that appears regularly in OAuth integrations. Using it as the canonical example means every technique in the HANDBOOK is demonstrated on a bug class that testers will actually encounter.

---

## How Each Artifact Maps to a Book Technique

| Artifact | File | Primary book technique |
|----------|------|------------------------|
| Requirement | REQ-AUTH-04.md | Kaner ch-01 — Testability heuristics (Observable, Controllable, Decomposable, Understandable) |
| User story | STORY-AUTH-204.md | Agile INVEST model; Connextra format; Kaner ch-11 — risk-informed DoR/DoD |
| TC-AUTH-031 | TC-AUTH-031-through-038.md | Mohan ch-02 — Boundary Value Analysis (minimum-complexity valid input) |
| TC-AUTH-032 | TC-AUTH-031-through-038.md | Mohan ch-02 + Kaner ch-03 — Equivalence Partitioning (alias-count partitions) |
| TC-AUTH-033 | TC-AUTH-031-through-038.md | Kaner ch-03 — Decision Table / Five-fold system (conditions: `+` position, alias segment, domain, consecutive `++`, trailing `+`) |
| TC-AUTH-034 | TC-AUTH-031-through-038.md | Mohan ch-02 — State Transition Testing (OAuth flow state machine; expired-code exceptional transition) |
| TC-AUTH-035 | TC-AUTH-031-through-038.md | Kaner ch-03 — All-Pairs / Pairwise (device × network × session-state × alias-format) |
| TC-AUTH-036 | TC-AUTH-031-through-038.md | GDPR Art. 32 + WCAG 2.2 compliance testing (PII-containing alias; data minimisation) |
| TC-AUTH-037 | TC-AUTH-031-through-038.md | OWASP WSTG-AUTH-01 + CWE-287 security testing (injection via email local-part) |
| TC-AUTH-038 | TC-AUTH-031-through-038.md | WCAG 2.2 SC 1.4.3 / 2.1.1 / 4.1.2 + axe-core accessibility testing |
| Defect report | DEF-AUTH-0017.md | Kaner ch-04 — Bug advocacy model (impact framing, 65-char title, variation axes, IEEE 1044 classification) |
| Risk register | RISK-AUTH-007.md | ISO 31000 5×5 matrix + Kaner ch-11 — heuristic likelihood disclaimer |
| Run overview | RUN-20260524-001-overview.md | Aegis full-run structure: 8 phases, gate decisions, token budget tracking |

---

## How to Use This in HANDBOOK Chapters

Use the cross-reference table below to find which artifact is the primary exhibit for
each chapter. Every chapter should reference at least one artifact from this set;
chapters that introduce a technique should show the specific test case or section
that applies that technique.

| Chapter | Topic | Primary artifact | Exhibit focus |
|---------|-------|-----------------|---------------|
| Ch-01 | Testability and Requirement Quality | REQ-AUTH-04.md | Testability Notes section; AMB-01 through AMB-04 |
| Ch-02 | User Stories and Acceptance Criteria | STORY-AUTH-204.md | Connextra format; INVEST table; DoR/DoD |
| Ch-03 | Equivalence Partitioning | TC-AUTH-032 (in TC file) | Alias-count partition table |
| Ch-04 | Boundary Value Analysis | TC-AUTH-031 (in TC file) | Minimum-complexity valid input; BVA rationale |
| Ch-05 | Decision Table Testing | TC-AUTH-033 (in TC file) | Five-fold decision table for email validation conditions |
| Ch-06 | State Transition Testing | TC-AUTH-034 (in TC file) | OAuth state machine diagram; expired-code transition |
| Ch-07 | All-Pairs / Pairwise Testing | TC-AUTH-035 (in TC file) | All-pairs matrix: device × network × session × alias |
| Ch-08 | Security Testing | TC-AUTH-037 (in TC file) | OWASP WSTG-AUTH-01; injection payload matrix; CWE-287 |
| Ch-09 | Accessibility Testing | TC-AUTH-038 (in TC file) | axe-core scan; keyboard navigation steps; contrast check |
| Ch-10 | Privacy and Compliance Testing | TC-AUTH-036 (in TC file) | GDPR Art. 32; PII in plus alias; log and storage checks |
| Ch-11 | Risk-Based Testing | RISK-AUTH-007.md | ISO 31000 5×5 matrix; heuristic likelihood note; materialised risk |
| Ch-12 | Defect Reporting and Advocacy | DEF-AUTH-0017.md | Kaner ch-04 bug advocacy; variation axes; 65-char title |
| Ch-13 | Test Planning and Estimation | RUN-20260524-001-overview.md | Phase timeline; token estimates; scope decisions |
| Ch-14 | Test Execution and Run Management | RUN-20260524-001-overview.md | Execution results table; environment setup notes |
| Ch-15 | Gate Reviews and Release Decisions | RUN-20260524-001-overview.md | Gate 1, Gate 2 (conditional), Gate 3 (pending) |
| Ch-16 | End-to-End Framework Integration | All 7 artifacts | Full traceability: Story → Req → Risk → TCs → Run → Defect |

---

## Artifact ID Consistency Reference

All cross-references use these exact IDs throughout the set:

| ID | Type | File |
|----|------|------|
| REQ-AUTH-04 | Requirement | REQ-AUTH-04.md |
| STORY-AUTH-204 | User story | STORY-AUTH-204.md |
| TC-AUTH-031 | Test case | TC-AUTH-031-through-038.md |
| TC-AUTH-032 | Test case | TC-AUTH-031-through-038.md |
| TC-AUTH-033 | Test case | TC-AUTH-031-through-038.md |
| TC-AUTH-034 | Test case | TC-AUTH-031-through-038.md |
| TC-AUTH-035 | Test case | TC-AUTH-031-through-038.md |
| TC-AUTH-036 | Test case | TC-AUTH-031-through-038.md |
| TC-AUTH-037 | Test case | TC-AUTH-031-through-038.md |
| TC-AUTH-038 | Test case | TC-AUTH-031-through-038.md |
| DEF-AUTH-0017 | Defect report | DEF-AUTH-0017.md |
| RISK-AUTH-007 | Risk register entry | RISK-AUTH-007.md |
| RUN-20260524-001 | Test run | RUN-20260524-001-overview.md |
