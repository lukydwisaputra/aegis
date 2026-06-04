---
topic: compliance-and-regulations
sources:
  - book: full-stack-testing-mohan
    chapters: [5, 7, 9, 10]
    role: primary
ingestedAt: "2026-05-24"
---

# Compliance & Regulations (Synthesis)

> _Summary: regulations the book touches — OWASP, WCAG, GDPR, PDPA, PCI DSS, PSD2, ISO 25010 — and how Aegis enforces them via compliance-tagged tests, dedicated reviewer agents, RTM compliance columns, and per-regulation closure reports._

---

## OWASP (security)

### OWASP Top 10

The Open Web Application Security Project publishes the most widely referenced catalog of critical web application security risks. The 2021 edition, referenced in ch-07, defines ten categories. Each entry below names the risk, what it covers, and the primary test technique Aegis applies.

| # | Category | What it covers | Test technique |
|---|---|---|---|
| 1 | Broken Access Control | Restrictions on authenticated users are not properly enforced; unauthorized access to data or functionality | Role-based service tests verifying endpoint returns 401/403 for out-of-scope roles (ch-07) |
| 2 | Cryptographic Failures | Failure to protect data in transit or at rest; exposes passwords, card numbers, health data | Data-layer assertions that sensitive fields are hashed/encrypted; HTTPS verification via Chrome DevTools Security tab (ch-07) |
| 3 | Injection | User input passed to an interpreter as part of a SQL, NoSQL, OS, or LDAP command | Parameterized query validation; input field tests with SQL syntax characters including apostrophes (ch-07, ch-05) |
| 4 | Insecure Design | Missing or ineffective security controls at the architecture phase | Threat modeling per user story using the STRIDE model; abuser stories captured as acceptance criteria (ch-07) |
| 5 | Security Misconfiguration | Insecure defaults, open cloud storage, verbose error messages, unnecessary features enabled | Infrastructure tests against terraform plan output using terraform-compliance; IaC scanning with Snyk IaC (ch-07, ch-10) |
| 6 | Vulnerable and Outdated Components | Using libraries or frameworks with known CVEs | SCA with OWASP Dependency-Check or Snyk; Dependabot on the repository (ch-07) |
| 7 | Identification and Authentication Failures | Weak credential management, session token weaknesses, absent MFA | Session expiry tests; expired/tampered token tests via Postman; failed-login lockout tests (ch-07) |
| 8 | Software and Data Integrity Failures | Insecure CI/CD pipelines; unverified auto-updates; unsafe deserialization | Secrets scanning with Talisman pre-commit hook; verified pipeline artifact signing (ch-07) |
| 9 | Security Logging and Monitoring Failures | Insufficient logging, monitoring, and alerting to detect and respond to breaches | Test cases asserting all admin actions are logged with timestamps; assert passwords and PII are absent from log output (ch-07) |
| 10 | Server-Side Request Forgery (SSRF) | Server fetches a remote resource at an attacker-supplied URL, enabling requests to internal services | DAST active scan with OWASP ZAP targeting internal-resource URL parameters (ch-07) |

### OWASP WSTG (Web Security Testing Guide)

The OWASP Web Security Testing Guide provides a structured catalog of test cases used by security specialists when executing manual and tool-assisted security assessments.

- Tag format: `WSTG-v42-AUTH-01` (guide version, category abbreviation, sequence number)
- Used by `qa-security-specialist` when tagging test cases in test-case JSON frontmatter
- Categories include AUTH (authentication), SESS (session management), INPVAL (input validation), AUTHZ (authorization), CRYPT (cryptography), INFO (information gathering), IDNT (identity), BUSLOGIC (business logic), CLNTSIDE (client-side), APIT (API testing)
- The tag appears in the test `.json` frontmatter alongside OWASP Top 10 category references, enabling RTM columns to surface coverage per WSTG area

---

## CWE (Common Weakness Enumeration)

CWE is a community-developed catalog of software and hardware weakness types maintained by MITRE. Ch-07 references specific weakness classes when discussing vulnerability categories; the tags below map common web-application weaknesses to the OWASP categories described above.

- Tag format: `CWE-{id}` — examples:
  - `CWE-89` — SQL injection (Injection, OWASP #3)
  - `CWE-79` — Cross-site scripting (Injection / Broken Access Control adjacency)
  - `CWE-287` — Improper authentication (Identification and Authentication Failures, OWASP #7)
  - `CWE-311` — Missing encryption of sensitive data (Cryptographic Failures, OWASP #2)
  - `CWE-798` — Use of hard-coded credentials (Security Misconfiguration, OWASP #5; Secrets exposure, ch-07)
  - `CWE-200` — Exposure of sensitive information (Information Disclosure, STRIDE-I, ch-07)
- CWE IDs are mapped to ISO 5055 maintainability weaknesses where the weakness category overlaps with structural code quality (see ISO 5055 section below)
- Tools such as OWASP Dependency-Check surface CVE IDs; CVEs are linked to CWE categories in the National Vulnerability Database, enabling consistent cross-referencing

---

## WCAG 2.x (accessibility)

Source: ch-09.

### Principles (POUR)

WCAG 2.0 organises all success criteria under four overarching principles. Every piece of web content must satisfy all four.

| Principle | What it requires | Representative test cases (ch-09) |
|---|---|---|
| Perceivable | Users must be able to receive all information regardless of sensory ability | Alt text on all non-text content; synchronised captions on video; colour not the sole means of conveying information; minimum colour contrast ratios enforced |
| Operable | Users must be able to interact with all controls using any input modality | Full keyboard-only navigation with visible focus indicators; no keyboard traps; skip-navigation links; descriptive link text (not "click here") |
| Understandable | Content and interfaces must be comprehensible | Plain, actionable error messages without numeric codes; expansions for abbreviations; descriptive form labels; no unexpected context changes |
| Robust | Content must be reliably parsed by a wide variety of user agents and assistive technologies | Correctly opened and closed HTML tags; no duplicate IDs; WAI-ARIA role, name, and state attributes on custom widgets |

WAI-ARIA is the mechanism for exposing custom, non-semantic elements to the accessibility tree (e.g., `role="checkbox"` and `aria-checked="true|false"` on a `<li>` styled as a checkbox). ARIA attributes have no visual effect but supply the semantic metadata that screen readers require (ch-09).

### Conformance levels (A / AA / AAA — AA is Aegis default per industry norm)

| Level | Scope | Typical mandate |
|---|---|---|
| A | Minimum requirements without which the site is functionally inaccessible: captions, keyboard access, non-colour-only cues | Baseline for all Aegis-tested sites |
| AA | All Level A requirements plus stricter colour contrast ratios across the full site | Aegis default; commonly required by national legal policies for government and public-sector sites; specified in pa11y-ci configuration as `WCAG2AA` |
| AAA | All A and AA requirements plus enhanced provisions such as sign language interpretation; not expected across an entire site | Voluntary or high-commitment scenarios only |

WCAG 2.1 adds success criteria for cognitive, learning, and low-vision needs. WCAG 2.2 extends these further, particularly for motor accessibility (ch-09). Teams must check whether their jurisdiction mandates 2.0, 2.1, or 2.2.

- Tag format: `WCAG-2.2-{principle-number}.{guideline-number}.{criterion-number}` — example: `WCAG-2.2-1.4.3` (Perceivable, criterion 1.4.3: minimum contrast ratio)
- Automated tools (axe-core, Pa11y CI, Lighthouse CI) return WCAG criterion codes in their violation reports, which are mapped directly to test tags (ch-09)
- Automated tools cover approximately 30-40% of WCAG success criteria; manual screen-reader walkthroughs and user testing with people with disabilities are required to close the remaining gap (ch-09)

---

## GDPR (Europe — data protection)

Source: ch-07 (security measures), ch-10 (compliance testing), ch-05 (data-layer touch-points).

The General Data Protection Regulation protects private data of EU citizens. It applies to any entity that serves EU citizens online, regardless of where the entity is incorporated. Non-compliance penalties reach up to 4% of annual global revenue (ch-10).

- Article references seen in sources: Art 32 (security of processing — technical measures to protect personal data at rest and in transit)
- Tag format: `GDPR-Art{N}` — examples: `GDPR-Art32`, `GDPR-Art17` (right to erasure), `GDPR-Art20` (data portability)

### Private data categories (ch-10)

GDPR's definition of private data is broad: name, email, IP addresses, MAC addresses, mobile device IDs, cookies, user account IDs, racial or ethnic origin, religious beliefs, sexual orientation, genetic and biometric data, and criminal records. All of these are in scope for test-data controls.

### Technical implementation measures (ch-10, ch-07)

- Protect data at rest using dynamic salts and hashing (NIST guidelines); use AES, HMAC, or SHA-256 with salt and pepper (ch-07)
- Encrypt data in transit (HTTPS enforced; verified via Chrome DevTools Security tab)
- Apply the principle of least privilege to database access, API roles, and service accounts
- Use pseudonymisation and anonymisation; never copy real production PII into test environments (ch-05, ch-10)

### User rights that must be tested (ch-10)

| Right | What must work | Test approach |
|---|---|---|
| Right to be informed | Privacy policy accurately discloses data use | Content review; functional test of consent flows |
| Right of access | Users can request and receive their stored personal records | API test: authenticated user data export endpoint |
| Right to be forgotten (Art 17) | Personal data deleted on request when no compelling retention reason exists | Assert records removed from DB, cache, event stream, and backups |
| Right to restrict processing | Data stored but not actively processed after restriction request | Assert processing flags updated; downstream services do not act on restricted records |
| Right to rectification | Users can correct inaccurate or incomplete records | Update flow end-to-end; assert all related tables reflect correction |
| Right to data portability (Art 20) | Users can download their data in a portable format | Export endpoint returns complete, parseable data |
| Right to object | Users can block use of their data for marketing, research, or statistics | Assert marketing pipeline excludes opted-out users |
| Rights related to automated decision-making | Explicit consent required before automated profile-based decisions | Consent flag checked before decision engine invoked |

Automation target (ch-10): assert no implicit opt-in; assert personal data stored only after consent; assert personal information absent from application logs.

---

## PDPA (Singapore — data protection)

Source: ch-07 (listed as a parallel regulation alongside GDPR), ch-05 (PII handling footnote).

The Personal Data Protection Act governs personal data of Singapore residents. Ch-07 notes that governments enforce data privacy through regulations such as GDPR and PDPA and that both require the same category of security and privacy controls in testing.

- Section references: Sec 24 (protection of personal data — obligation to protect data by reasonable security measures)
- Tag format: `PDPA-Sec{N}` — example: `PDPA-Sec24`
- PDPA mirrors GDPR principles for SG jurisdictions: lawful collection, purpose limitation, data accuracy, retention limits, access rights, and security obligations
- The same data-layer controls described under GDPR apply: no real PII in test environments, pseudonymisation, encryption at rest and in transit, least-privilege access (ch-05, ch-07)
- Ch-05 groups GDPR and PDPA together when stating that copying production data into test environments violates both regulations
- `qa-compliance-pdpa` reviews test suites for SG-specific jurisdictional requirements; tags allow RTM filtering by jurisdiction

---

## ISO 25010 (product quality model)

Source: ch-10.

ISO 25010 defines eight product quality characteristics used by ch-10 as the conceptual backbone for classifying CFRs. The table below maps each characteristic to the relevant CFR categories from the book's canonical list and to Aegis tag format.

| Characteristic | CFR categories mapped (ch-10) | Aegis tag example |
|---|---|---|
| Functional suitability | Compliance, Reliability, Interoperability | `ISO25010-FunctionalSuitability-Completeness` |
| Performance efficiency | Performance, Scalability, Availability | `ISO25010-PerformanceEfficiency-TimeBehaviour` |
| Compatibility | Compatibility, Portability | `ISO25010-Compatibility-Interoperability` |
| Usability | Usability, Accessibility, Localization | `ISO25010-Usability-Accessibility` |
| Reliability | Reliability, Recoverability, Resilience, Availability | `ISO25010-Reliability-Recoverability` |
| Security | Security, Authentication, Authorization, Privacy, Auditability | `ISO25010-Security-Authenticity` |
| Maintainability | Maintainability, Testability, Extensibility, Reusability | `ISO25010-Maintainability-Testability` |
| Portability | Portability, Installability | `ISO25010-Portability-Installability` |

- Tag format: `ISO25010-{Characteristic}-{SubCharacteristic}` — example: `ISO25010-Security-Authenticity`
- Used by `qa-compliance-iso25010` when assigning quality model coverage to test cases
- Architecture tests (ArchUnit, JDepend) and fitness functions (ch-10) guard ISO 25010 evolutionary characteristics such as Maintainability and Portability on a continuous basis

---

## ISO 5055 (code quality)

Not deeply covered by this book — noted as a gap for future ingest.

ISO 5055 measures automated source code quality across four critical weaknesses: security, reliability, performance efficiency, and maintainability. It maps directly to CWE identifiers, making CWE tags the primary cross-reference point.

- Tag format: `ISO5055-{WeaknessCategory}-CWE-{id}` — example: `ISO5055-Maintainability-CWE-1042`
- The CWE tags established in test frontmatter (see CWE section above) serve as the bridge between OWASP findings and ISO 5055 structural quality metrics
- Full ISO 5055 agent coverage (`qa-compliance-iso5055`) depends on a future ingest of dedicated code-quality material; the tag schema is pre-defined for forward compatibility

---

## ISTQB (testing terminology)

Not covered by this book — noted as a gap; a dedicated ISTQB-aligned reference is queued for ingest.

- Tag format: `ISTQB-{Level}-{Section}` — example: `ISTQB-Foundation-2.1.3`
- `qa-compliance-istqb` will apply these tags once the reference material is ingested
- ISTQB terms such as test basis, test condition, and test charter appear informally in the source chapters but are not formally mapped to ISTQB syllabus sections

---

## CMMI (process maturity)

Not covered by this book — noted as a gap.

CMMI (Capability Maturity Model Integration) defines process maturity levels for verification and validation practices. It is not referenced in any of the four source chapters.

- Tag format: `CMMI-{ProcessArea}-{SpecificPractice}` — example: `CMMI-V&V-SP1.1`
- `qa-compliance-cmmi` will apply these tags once a suitable CMMI-aligned source is ingested
- Future ingest candidates: CMMI for Development v2.0, ISTQB Advanced Level Test Manager syllabus (which covers process improvement)

---

## PCI DSS / PSD2 (payment compliance)

Source: ch-10 (both covered explicitly in the Compliance Testing section).

### PCI DSS (Payment Card Industry Data Security Standard)

PCI DSS is a global contractual standard from the PCI Security Standards Council. It applies to any entity that stores, processes, or transmits cardholder data, including donation sites. It is not a legal requirement but a mandatory obligation from banks and merchant acquirers; fines apply per contract (ch-10).

Key PCI DSS obligations relevant to testing (ch-10):
- Encrypt card data in transit
- Maintain a firewall; keep anti-virus software updated
- Mask card details in UI and all storage layers
- Restrict access to cardholder data to the minimum necessary roles
- Exclude card details from application logs

Testing approach: threat model all payment flows using STRIDE (ch-07 cross-reference from ch-10); functional service tests asserting that card fields are masked in API responses and absent from logs; role-based access tests confirming only authorized roles reach card-data endpoints.

Compliance is validated via a self-assessment questionnaire (SAQ) submitted to the acquiring bank.

- Tag format: `PCI-DSS-{req-number}` — example: `PCI-DSS-3.4` (render PAN unreadable wherever stored)

### PSD2 (Payment Services Directive 2)

PSD2 is EU law mandating compliance for all payment service providers operating in or reaching the EU. The trigger is whether even one leg of a transaction involves an EU member state (ch-10).

Primary compliance obligation: **Strong Customer Authentication (SCA)** — equivalent to multifactor authentication using at least two of the following three factors:
- Something the user knows (password or PIN)
- Something the user possesses (card, registered mobile device, hardware token)
- Something the user is (biometric: face, voice, fingerprint)

Options (ch-10): integrate a pre-compliant payment provider such as Stripe or PayPal (delegates SCA compliance), or build SCA features in-house (all SCA journeys then require thorough functional and security testing).

- Tag format: `PSD2-Art{N}` — example: `PSD2-Art97` (SCA obligation article)
- Test cases cover: each valid two-factor combination succeeds; single-factor alone is rejected; biometric fallback path; SCA exemption flows (low-value transactions, trusted beneficiaries) behave correctly

---

## How Aegis enforces compliance

- Each regulation has a dedicated compliance reviewer agent: `qa-compliance-gdpr`, `qa-compliance-pdpa`, `qa-compliance-iso25010`, `qa-compliance-iso5055`, `qa-compliance-istqb`, `qa-compliance-cmmi`
- Tests carry compliance tags in their `.json` frontmatter; the tag schema is validated at write-time by `@qa/contracts` using regex rules per standard (e.g., `^GDPR-Art\d+$`, `^WCAG-2\.[012]-\d+\.\d+\.\d+$`)
- The Requirements Traceability Matrix (RTM) gains a `compliance` column showing per-row clauses satisfied; compliance reviewer agents populate this column during test-case review
- Per-regulation compliance reports are generated at cycle closure, summarising test coverage, pass/fail status, and any uncovered clauses
- Fitness functions (ch-10) enforce non-tradeable compliance characteristics — encryption at rest and in transit, access controls, consent gating — as automated guardrails that block the CI pipeline on violation
- Infrastructure compliance is tested against `terraform plan` output using terraform-compliance (BDD, Python) without requiring live infrastructure (ch-10)

---

## Named pitfalls

- **Using real production data in tests** — production records contain real PII; copying them into test environments violates GDPR and PDPA, exposes data to a broader audience, and constitutes a breach of Art 32 / Sec 24 obligations (ch-05, ch-10). Synthetic or anonymised test data is mandatory.
- **Compliance theater** — passing automated scans (OWASP ZAP, Pa11y CI, Dependency-Check) without genuine coverage of failure modes. Automated tools cover only a fraction of each standard's criteria; manual and exploratory coverage is required to close the gap (ch-07, ch-09).
- **Treating compliance as a one-time pre-release check** — regulations require continuous adherence. Shift-left practices (SAST, SCA, accessibility linting, architecture tests, fitness functions) provide continuous, low-cost feedback throughout the delivery cycle rather than a single gate at release (ch-07, ch-09, ch-10).
- **Ignoring jurisdictional variation** — GDPR applies to EU citizen data; PDPA applies to Singapore resident data; CCPA applies to California resident data. A product serving multiple regions must satisfy multiple frameworks simultaneously; tagging by jurisdiction enables targeted reporting (ch-07, ch-10).
- **Treating pen testing as the only security compliance activity** — specialist pen testers are valuable but expensive and slow; they cannot substitute for continuous shift-left security controls (ch-07).
- **Assuming automated WCAG passes imply full compliance** — automated tools cover approximately 30-40% of WCAG success criteria. A green Lighthouse score does not certify accessibility; user testing with real assistive devices is required before conformance evaluation (ch-09).
- **No threat model for payment flows** — PCI DSS and PSD2 require that payment data is protected by design. Skipping STRIDE threat modeling for order and payment services leaves entire attack categories (tampering, information disclosure, escalation of privilege) unaddressed (ch-07, ch-10).

---

## Pointers

- Used by agents: `qa-compliance-iso25010`, `qa-compliance-iso5055`, `qa-compliance-istqb`, `qa-compliance-cmmi`, `qa-compliance-gdpr`, `qa-compliance-pdpa`
- Cross-ref: [[synthesis/security-testing.md]], [[synthesis/accessibility-testing.md]], [[synthesis/data-testing.md]]
