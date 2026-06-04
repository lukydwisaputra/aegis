---
book: full-stack-testing-mohan
chapter: 7
title: "Security Testing"
pages: "313-361"
topics:
  - security-testing
  - owasp
  - owasp-top-10
  - sast
  - dast
  - sca
  - iast
  - threat-modeling
  - stride
  - pen-testing
  - vulnerability-scanning
  - secrets-scanning
  - container-scanning
  - cve
  - shift-left
  - dependency-scanning
  - code-quality
  - security-gates
  - gdpr
  - pdpa
  - pii-handling
  - full-stack-testing
  - compliance
applies_to_agents:
  - qa-security-specialist
  - qa-compliance-gdpr
  - qa-compliance-pdpa
  - qa-automation-engineer
  - qa-shift-left
  - qa-generalist
---

# Chapter 7 — Security Testing

> _Security testing means thinking like a hacker: identifying vulnerabilities, threats, and risks at every layer of the system before attackers can exploit them. The chapter argues for shift-left security, weaving threat modeling, automated scanning (SAST, SCA, DAST), and functional security test automation into the ordinary delivery cycle rather than deferring everything to specialist pen testers at the end._

---

## Core concepts

### Why security matters
- Cybercrime annual global cost was estimated at $6 trillion in 2021 and projected to surpass $10.5 trillion by 2025. Social media-enabled cybercrime alone generates roughly $3.25 billion per year.
- All kinds of digital platforms — airlines, dating sites, energy companies, social networks — have been breached. Security is not optional.
- Governments enforce security and data privacy through regulations such as the EU General Data Protection Regulation (GDPR) and the Revised Payment Services Directive (PSD2).
- "Defense in depth": build security measures into multiple layers of the application (UI, API, database, infrastructure, network), not just a single outer perimeter.
- The system is only as strong as its weakest link; security testing exists to find those links.

### Key terminology
- **Assets**: critical entities that must be guarded (user data, financial data, infrastructure, brand reputation, business data).
- **Vulnerability**: a potential gap in the system that can be exploited.
- **Threat**: a potential negative action or event that exploits a vulnerability.
- **Attack**: an unauthorized malicious action performed on the system.
- **Security compromise**: a failure of defense mechanisms that exposes an asset.
- **Encryption**: scrambling data so only the holder of the decryption key can read it.
- **Hashing**: mapping data of any size to a fixed-size immutable output (one-way); used to store passwords. SHA-1 is considered insufficiently strong against modern brute-force.
- **Principle of least privilege**: granting users and services only the minimum permissions required for their task.
- **Zero trust**: assume no entity — internal or external — is inherently trustworthy; verify every request using a protocol such as OAuth 2.0 with bearer tokens.

---

## Common cyberattack types

### Web scraping
Automated crawlers harvest publicly visible personal data (phone numbers, locations) for malicious use. The 2019 Facebook incident exposed 419 million phone numbers that had previously been scraped when the feature was publicly visible.

### Brute force
Systematic trial of all possible credential combinations. A 2016 attack on FriendFinder Networks exposed 412 million records. Even SHA-1 hashed passwords were cracked with modern computing power, illustrating that algorithm choice matters.

### Social engineering
Psychological manipulation to obtain confidential information. In 2019 a UK energy CEO was manipulated by a convincing AI-generated voice call into transferring $243,000 to an attacker's account.

### Phishing
A social engineering variant using fraudulent email or messaging. Victims are lured into entering credentials on fake sites or opening malware attachments. A 2021 campaign targeted Microsoft 365 users with a fake price-revision attachment.

### Cross-site scripting (XSS)
Attackers inject scripts into an unsecured site to redirect or steal data. The 2018 British Airways XSS attack harvested 380,000 customers' credit card details by injecting a script into the payment flow; the company was fined heavily. TweetDeck suffered a public XSS demonstration where an auto-retweeting script propagated via a tweet.

### Ransomware
Malware locks systems until a ransom is paid. The Weather Channel went offline for an hour in 2019 due to ransomware; backup servers saved the situation.

### Cookie forging
Manipulating cookies to impersonate users. Yahoo! disclosed in 2017 that 32 million accounts were breached after attackers forged session cookies using stolen proprietary code.

### Cryptojacking
Bots crawl public repositories (e.g., GitHub) for infrastructure keys (e.g., AWS), then silently mine cryptocurrency. Tesla was a victim in 2018. Prevention requires secrets scanning before any commit reaches the repository.

### Attacks across layers
Threats exist at the application layer (injection, XSS), infrastructure layer (misconfigured permissions, exposed admin endpoints), and network layer (DDoS, man-in-the-middle). A comprehensive security posture must address all three.

---

## The STRIDE Threat Model

STRIDE was invented by Loren Kohnfelder and Praerit Garg at Microsoft. It is an acronym covering six categories of security threat, used to structure a brainstorming exercise for any feature or user story.

| Letter | Category | Description | Example defenses |
|--------|----------|-------------|-----------------|
| **S** | Spoofed identity | Attacker assumes another entity's identity | Multifactor authentication (MFA), strong password policy, encryption in transit and at rest |
| **T** | Tampering with inputs | Malicious modification of code, data, or memory | Input validation, parameterized queries, authentication and authorization controls |
| **R** | Repudiation of actions | Malicious user denies performing an action; no audit trail | Comprehensive logs with timestamps, non-repudiation mechanisms, auditing |
| **I** | Information disclosure | Unauthorized access to application assets | Strong authorization, encryption of secrets, secure transmission protocols (HTTPS) |
| **D** | Denial of service | Overloading or crashing the application | Load balancers, request throttling per IP, IP allowlists, auto-scaling, surge monitoring |
| **E** | Escalation of privileges | Gaining elevated access beyond intended permissions | Principle of least privilege, role-based access controls, access token rotation |

Additional STRIDE defenses mentioned in the chapter:
- Against spoofing: frequent access token refreshes, multi-signature transaction authorization, secrets stored in vaults.
- Against escalation of privileges: separate roles with clearly bounded permissions, code-commit rights restricted to developers by default.

---

## Application vulnerabilities

### Code / SQL injection
When user input is passed directly into a database query without sanitization, an attacker can append destructive SQL (e.g., `DROP TABLE`) or other commands. Proper parameterized queries and input validation prevent this. Testing must cover all input vectors at UI, API, and DB layers.

### Cross-site scripting (XSS)
Absence of input validation allows attackers to inject scripts that run in other users' browsers, enabling session hijacking, redirects, or site defacement. Mitigation: validate and sanitize all user-supplied content before rendering it.

### Unhandled known vulnerabilities (vulnerable dependencies)
Third-party libraries and frameworks regularly receive CVE (Common Vulnerabilities and Exposures) disclosures. Teams that do not promptly apply patches remain exposed. Tools such as GitHub Dependabot, OWASP Dependency-Check, and Snyk can automate the detection and remediation of vulnerable dependencies.

### Authentication and session mismanagement
Weak session management leaves session tokens open to theft. Risks include: session IDs exposed in URLs, unencrypted transmission of authentication data, failure to invalidate old tokens. Sessions should use short-lived tokens refreshed frequently, and older cookies/tokens must be invalidated promptly.

### Unencrypted private data
Storing or transmitting sensitive data in plain text — in logs, databases, code repositories, configuration files, or hosted documents — is a serious vulnerability. Use strong cryptographic algorithms such as AES, HMAC, or SHA-256 with dynamic salt and pepper techniques to protect data at rest and in transit.

### Application misconfigurations
Granting broad admin permissions to all users for convenience violates the principle of least privilege and expands the attack surface. Misconfigured permissions, folders, or systems can lead to unauthorized access to databases, admin endpoints, and infrastructure.

### Application secrets exposure
Hardcoding credentials, API keys, environment secrets, or SSH keys in source code or configuration files in plain text is a high-risk practice. The correct approach is to use secrets management services (vaults) and retrieve secrets only at runtime. This applies to application code, CI/CD pipeline definitions, and all configuration files.

---

## OWASP Top 10

The Open Web Application Security Project (OWASP) publishes a widely referenced list of the ten most critical web application security risks. The chapter references this list as a companion to the vulnerabilities discussed above. The canonical OWASP Top 10 categories (2021 edition) are:

1. **Broken Access Control** — Restrictions on authenticated users are not properly enforced, allowing unauthorized access to functionality or data.
2. **Cryptographic Failures** (previously "Sensitive Data Exposure") — Failure to protect data in transit or at rest using appropriate cryptography; exposes passwords, credit card numbers, health data, etc.
3. **Injection** — User-supplied data is sent to an interpreter as part of a command or query (SQL, NoSQL, OS, LDAP injection). Covered in depth with the SQL injection example in this chapter.
4. **Insecure Design** — Missing or ineffective security controls at the design and architecture phase; threat modeling is the primary mitigation.
5. **Security Misconfiguration** — Insecure default configurations, incomplete setups, open cloud storage, verbose error messages, unnecessary features enabled. Corresponds to the application misconfigurations vulnerability discussed above.
6. **Vulnerable and Outdated Components** — Using components with known vulnerabilities (libraries, frameworks, OS). Mitigated by SCA tools such as OWASP Dependency-Check and Snyk.
7. **Identification and Authentication Failures** (previously "Broken Authentication") — Weak credential management, session token weaknesses, lack of MFA. Corresponds to authentication and session mismanagement above.
8. **Software and Data Integrity Failures** — Code and infrastructure not protected against integrity violations (insecure CI/CD pipelines, auto-updates without verification, deserialization of untrusted data).
9. **Security Logging and Monitoring Failures** — Insufficient logging, monitoring, and alerting to detect and respond to breaches. The chapter's test cases explicitly include verifying log coverage, especially for admin actions.
10. **Server-Side Request Forgery (SSRF)** — The server fetches a remote resource without validating the user-supplied URL, enabling attackers to make requests to internal services.

---

## Threat modeling

### Purpose and cadence
Threat modeling is a structured approach to aggregating all potential security threats for a feature or user story. It should be done iteratively throughout development, keeping scope small — the chapter recommends approximately 15 minutes of threat modeling per user story. New features can uncover new threats to older features.

### Cost vs. value rule of thumb
The cost of the security measure should not exceed the value of the asset being protected. A $400K monitoring system for a low-traffic blogging platform is disproportionate; a code injection defense for an ecommerce site that stores credit card data is clearly justified.

### Abuser stories
Security threats are captured as "abuser" or "evil user" stories. Example: "As an abusive user, I cannot inject code to redirect the content of the website." These stories drive acceptance criteria, test cases, and implementation backlog items.

### Threat modeling steps

1. **Define the feature**: scope the feature, draw user flows, identify actors (types of users), and map the data flow between components and integrations.
2. **Define the assets**: identify what needs protection and document the impact and severity of losing each asset.
3. **Black hat thinking**: using the STRIDE model as a framework, the team brainstorms attack vectors freely ("Let's break the system!") and captures all ideas without filtering.
4. **Prioritize threats and capture stories**: analyze probability and impact, prioritize the threats, and translate high-priority threats into abuser stories and security-related test cases.

### Worked example: order management system (OMS)
Actors: store assistant, customer service executive, system administrator.
Assets: order data, customer PII (names, phone numbers, payment details, addresses), database with full sales history, application infrastructure.

Threats identified using STRIDE:
- **Spoofed identity**: social engineering or shoulder surfing targeting the system admin; unattended logged-in sessions exploited by store staff.
- **Tampering with inputs**: unprotected order service endpoints tampered with directly; code injection during order placement to steal payment details.
- **Repudiation of actions**: system admin with no audit logs bulk-inserts orders for personal gain.
- **Information disclosure**: plain-text database exposed via a back door; passwords stolen from unencrypted logs; customer service executive exceeds their read-only role; unrestricted /viewOrders endpoint returns all records.
- **Denial of service**: DDoS attack brings down the order service.
- **Escalation of privileges**: attacker with admin credentials adds users or elevates privileges permanently; no admin action logs make this undetectable.

Sample abuser stories derived:
- "As an abusive user, I should not be able to see customer details even if I gain access to the database."
- "As an abusive user, I should not be able to take advantage of open browser sessions."
- "As a store assistant, I should be the only person authorized to make edit requests to the order service."

### Security test cases from the threat model (OMS, OAuth 2.0 / zero-trust)

**UI layer**
- After session timeout, the user is prompted to re-authenticate.
- Credentials are locked after a configured number of failed login attempts.
- Input fields reject illegitimate inputs such as JavaScript code and SQL queries.
- Access tokens expire after a short window; a refresh token call keeps the session alive until deliberate logout.
- System admin and customer service executive roles have no "edit order" option in the UI.

**API layer**
- Reusing an expired access token returns 401 Unauthorized (or 400 to avoid disclosing implementation details).
- API parameters are validated in the same way as UI input fields; invalid inputs return 404.
- The /editOrder endpoint returns 401 when called with a system admin or customer service executive token.

**Database layer**
- Passwords are stored as hashes with dynamic salt, per NIST guidelines.
- Sensitive customer details are encrypted at rest.

**Application logs**
- Passwords and sensitive PII are not logged in plain text.
- All system actions, including system admin actions, are logged with timestamps.

---

## Security testing strategy (shift-left)

The shift-left security testing strategy covers multiple stages, starting from development and progressing to production. Each stage adds a layer of automated or manual security validation.

### Static Application Security Testing (SAST)
- Analyzes static source code, bytecode, and assembled code for known vulnerability patterns (e.g., unencrypted secrets in code).
- Available as IDE plug-ins, libraries, and SaaS (e.g., Snyk IDE plug-in, Checkmarx SAST, Security Code Scan).
- Integrates with CI pipelines to run on every commit.
- Provides the earliest possible feedback — during active development.
- Talisman (a pre-commit hook, not a traditional SAST tool) specifically scans for secrets such as private keys and environment credentials before they are committed to source control.

### Software Composition Analysis (SCA)
- Identifies known vulnerabilities (CVEs) in the application's third-party open source dependencies.
- Key tools: OWASP Dependency-Check (open source, command-line or plugin), Snyk (commercial with a free tier), GitHub Dependabot.
- Can be run during development and integrated into CI for per-commit feedback.
- Complements SAST: SAST covers first-party code; SCA covers dependencies.
- OWASP Dependency-Check generates an HTML report listing each vulnerable component with its CVE ID and advisory details.

### Functional security test automation
- Security test cases derived from threat modeling can be automated using standard functional automation frameworks (see `[[ch-03-automated-functional-testing]]`).
- Example: a service-layer test verifying that only the store assistant role can call the edit-order endpoint.
- These tests run within the existing CI pipeline alongside functional regression tests.

### Image / container scanning
- Container images must be scanned for vulnerabilities if the application is containerized.
- Tools: Snyk Container, Anchore, Docker's built-in `docker scan`, Amazon ECR image scanning.
- Infrastructure-as-Code (Terraform, Kubernetes manifests) can be linted for security best practices with Snyk IaC and terraform-compliance.

### Dynamic Application Security Testing (DAST)
- Black-box testing technique: the application is running and the tool sends specially crafted attack requests, observing how the application responds.
- Detects runtime vulnerabilities that static analysis cannot find (e.g., live SQL injection, XSS, misconfigurations only visible at runtime).
- Key tools: OWASP ZAP (open source), Burp Suite.
- Can be integrated into CI, but active scans can take hours; schedule as a nightly regression stage or on a manual trigger per story.

### Interactive Application Security Testing (IAST)
- A newer technique that combines SAST and DAST by instrumenting the application at runtime.
- Scans for vulnerabilities in real time as the application executes.
- Example tools: Contrast Security, Acunetix.
- The space is actively evolving.

### Manual exploratory security testing
- Uses the mindset and techniques from `[[ch-02-manual-exploratory-testing]]` to explore security-related test cases at UI, service, and database layers.
- Chrome DevTools and Postman are practical tools for manual security exploration (configuring auth tokens, verifying HTTPS status, testing expired or tampered tokens).

### Penetration (pen) testing
- Carried out by professional security testers, typically near the end of the delivery cycle.
- Appropriate for high-criticality applications or where the team's own security competency is limited.
- Should not be the only security activity; shift-left practices reduce reliance on pen testing as the sole safety net.

### Runtime Application Self Protection (RASP)
- Monitors the application in the production environment for active attacks and automatically takes protective action (e.g., terminating cryptomining processes, rejecting malicious request payloads, blocking malware).
- Tools: Twistlock, Aqua Security.
- Extends the traditional firewall concept to work within the application runtime.
- Currently available only as paid products.

---

## Techniques and templates

### Secrets scanning with Talisman
- Configure as a pre-commit or pre-push Git hook.
- Scans for private keys, AWS credentials, SSH keys, environment secrets, `.pem` files, and hex-encoded secrets.
- Blocks the commit if secrets are detected, printing a structured report identifying the offending file and pattern.
- Critical because bots continuously crawl public repositories for leaked credentials.

### SCA with OWASP Dependency-Check (exercise)
- Install: `brew install dependency-check` (macOS) or download the ZIP binary.
- Run: `dependency-check --project <name> -s <path> --prettyPrint`
- Output: HTML report listing each vulnerable library, its CVE ID, description, and remediation guidance.
- Example CVE from exercise: CVE-2012-6708 in jquery-1.8.2 — "jQuery before 1.9.0 is vulnerable to Cross-site Scripting (XSS) attacks."
- Integrate with CI: run the command in the pipeline and fail the build on vulnerability detection.

### DAST with OWASP ZAP (exercise)
- Install: `brew install cask owasp-zap` (macOS) or use official binaries.
- OWASP Juice Shop is the recommended target for learning (never run against a public site without authorization — it is illegal).
- Two exploration methods:
  - **Manual Explore**: open the application URL in ZAP's embedded browser, walk through user flows manually; ZAP records the site tree and URL history.
  - **ZAP Spider**: automatically crawls the site. The standard Spider handles static content; the AJAX Spider handles JavaScript-rendered content.
- Two scanning modes:
  - **Passive scanning**: inspects messages exchanged between browser and application without modifying them; runs automatically during spidering; alerts categorized by severity (high/red, medium/orange, low/yellow).
  - **Active scanning**: intercepts and modifies requests to simulate attacks (SQL injection, XSS, etc.); takes longer but reveals exploitable vulnerabilities.
- Integrating ZAP with CI via its API:
  - `zap.urlopen(target)` — open the application.
  - `zap.spider.scan(target)` — passive spider.
  - `zap.ascan.scan(target)` — active attack scan.
  - `zap.core.alerts()` — retrieve results.
  - Can embed ZAP API calls inside Selenium WebDriver tests so ZAP benefits from the test's authenticated session.
  - GitHub Actions: use the predefined OWASP ZAP Baseline Scan and OWASP ZAP Full Scan actions to run scans and create GitHub issues automatically.
- Additional ZAP features:
  - OpenAPI specification import for API security testing.
  - "Breaks" feature to inject specific test data into a request for targeted testing.
  - Request replay in the browser.
  - Hidden input field disclosure.
  - Community add-ons with expert-crafted attack scripts.

### Snyk IDE plug-in (JetBrains)
- Combines SCA and SAST in a single free IDE plug-in (IntelliJ IDEA, WebStorm, PyCharm, etc.).
- Scans both application code and dependencies while the developer is writing code, displaying results in the IDE bottom panel.
- Reports vulnerability type, affected component, and suggested remediation — enabling developers to fix issues without leaving the IDE.
- Snyk CLI provides SCA-only integration for CI pipelines; additional paid services are available.

### Chrome DevTools for manual security testing
- The Security tab shows whether pages are served over HTTPS and flags any third-party resources not served securely, which could enable man-in-the-middle attacks.

### Postman for manual security testing
- Supports configuring auth tokens (Bearer, OAuth 2.0) directly in API request collections, enabling scenarios such as expired token testing, tampered token testing, and role-based access verification.

---

## Examples (paraphrased)

- **OWASP Dependency-Check** scan on a Selenium WebDriver project identifies a vulnerable jquery-1.8.2 library via CVE-2012-6708, recommending an upgrade to jQuery 1.9+.
- **OWASP ZAP** passive scan on OWASP Juice Shop detects a private IP address exposed in a response; active scan discovers a SQL injection vulnerability in the Juice Shop login flow.
- **Talisman pre-commit hook** blocks a commit that contains an `awsSecretKey` in a `.pem` file, displaying the file name, matched pattern, and hex-encoded secret value.
- **Snyk IDE plug-in** surfaces an "Information disclosure" vulnerability in IntelliJ IDEA during development and offers a one-click remediation option.
- **ZAP embedded in Selenium**: a `testSecurityVulnerabilities()` test spiders the application, enables passive scanning, triggers an active scan, collects alerts, and asserts `alerts.size() == 0`, failing the CI build if any vulnerabilities are found.
- **OWASP Juice Shop XSS**: a TweetDeck user demonstrated an XSS vulnerability by posting a self-retweeting tweet containing a JavaScript `<script>` payload — the tweet auto-retweeted itself on any timeline that rendered it.
- **British Airways (2018)**: an injected XSS script harvested credit card details from 380,000 customers; the company received a substantial regulatory fine.

---

## Pitfalls / anti-patterns

- **Security as an afterthought**: treating security as a final-gate activity (pen testing only at the end) means vulnerabilities are expensive to fix and may ship to production.
- **No threat model**: skipping the threat modeling exercise means entire categories of threats go unidentified. Even a 15-minute exercise per user story yields significant insights.
- **Ignored dependencies**: failing to apply patches to known vulnerable third-party libraries is one of the most common and preventable vulnerabilities.
- **Plain-text secrets in code or config files**: hardcoded credentials, API keys, or SSH keys committed to version control are automatically discovered by bots scanning public repositories.
- **Overly broad permissions**: granting blanket admin access to reduce maintenance overhead violates least privilege and dramatically increases the blast radius of any compromise.
- **Unencrypted sensitive data in logs**: logging passwords, PII, or session tokens in plain text creates an easily exploitable side channel.
- **Unencrypted data at rest**: storing customer payment details, passwords, or PII without encryption means a database breach immediately exposes all assets.
- **No session expiry or token refresh**: long-lived session cookies and tokens give attackers ample time to exploit stolen credentials.
- **Security awareness not a team habit**: one-off tooling and training are insufficient. Daily, unconscious security awareness — questioning every shared credential, every architecture diagram in an online portal, every Slack message containing a secret — is the ultimate defense.
- **Running DAST against production or live public sites without authorization**: explicitly illegal. Always use sandboxed environments or dedicated test targets such as OWASP Juice Shop.
- **Treating pen testing as the only security activity**: specialist pen testers are valuable but expensive and slow; shift-left tooling provides continuous, low-cost feedback throughout the cycle.

---

## Cross-refs

- `[[foreword]]`
- `[[ch-01-introduction-to-full-stack-testing]]`
- `[[ch-02-manual-exploratory-testing]]` — exploratory testing mindset used to derive security test cases from the threat model
- `[[ch-03-automated-functional-testing]]` — functional automation tools used for security test automation (Selenium WebDriver, service tests)
- `[[ch-04-continuous-testing]]` — CI pipeline integration strategy; choosing the right CI stage for time-intensive DAST scans
- `[[ch-05-data-testing]]`
- `[[ch-06-visual-testing]]`
- `[[ch-08-performance-testing]]`
- `[[ch-09-accessibility-testing]]`
- `[[ch-10-cross-functional-requirements-testing]]`
- `[[ch-11-mobile-testing]]`
- `[[ch-12-moving-beyond-first-principles]]`
- `[[ch-13-introduction-to-testing-in-emerging-technologies]]`
