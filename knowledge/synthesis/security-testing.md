---
topic: security-testing
sources:
  - book: full-stack-testing-mohan
    chapters: [7]
    role: primary
ingestedAt: "2026-05-24"
---

# Security Testing (Synthesis)

> Security testing requires adopting an adversarial mindset to locate vulnerabilities across all system layers — UI, API, database, infrastructure, and network — before malicious actors can exploit them. The field is driven by a shift-left philosophy: rather than delegating all security work to specialist pen testers at release time, teams weave threat modeling, automated scanning (SAST, SCA, DAST), and functional security test automation into the ordinary delivery cycle. The OWASP Top 10 and STRIDE threat model are the two most widely used reference frameworks for categorizing and systematically addressing security risks (full-stack-testing-mohan ch-07).

---

## OWASP Top 10

The Open Web Application Security Project publishes a regularly updated list of the ten most critical web application security risks. The 2021 edition is the basis referenced here (full-stack-testing-mohan ch-07).

1. **Broken Access Control** — Authenticated users can reach functionality or data they are not permitted to access. Test by verifying that each role is strictly limited to its intended endpoints and data; attempt to access privileged resources with lower-privileged tokens. Tools: functional API test automation, OWASP ZAP.

2. **Cryptographic Failures** — Sensitive data (passwords, payment details, health records) is not adequately protected in transit or at rest, exposing it to interception or theft. Test by confirming HTTPS enforcement, checking that passwords are hashed with a strong algorithm and salt, and verifying encrypted storage. Tools: Chrome DevTools Security tab, OWASP ZAP passive scan.

3. **Injection** — User-supplied input is passed to an interpreter (SQL, NoSQL, OS, LDAP) without sanitization, enabling attackers to execute arbitrary commands. Test by supplying SQL metacharacters and script payloads to all input vectors at the UI, API, and database layers. Tools: OWASP ZAP active scan, manual Postman testing.

4. **Insecure Design** — Security controls are absent or ineffective because they were never considered at the architecture and design phase. Mitigate through iterative threat modeling per user story; test by executing derived abuser-story acceptance criteria. Tools: STRIDE threat modeling, functional test automation.

5. **Security Misconfiguration** — Insecure defaults, incomplete configuration, open cloud storage buckets, verbose error messages, or unnecessary enabled features create exploitable gaps. Test by enumerating exposed admin endpoints, reviewing error responses for information leakage, and auditing permission settings. Tools: OWASP ZAP, infrastructure-as-code linting with Snyk IaC.

6. **Vulnerable and Outdated Components** — Third-party libraries, frameworks, and operating system packages with published CVEs are used without patching. Test by running software composition analysis on the full dependency tree and failing builds when known-vulnerable versions are detected. Tools: OWASP Dependency-Check, Snyk, GitHub Dependabot.

7. **Identification and Authentication Failures** — Weak credential management, absence of MFA, session token weaknesses, or failure to invalidate expired tokens allow unauthorized access. Test by attempting login with brute-force credentials, verifying lockout after configured failed attempts, and confirming that expired or tampered tokens return the expected error. Tools: OWASP ZAP, Postman with Bearer token configuration.

8. **Software and Data Integrity Failures** — Code and infrastructure are not protected against integrity violations such as unsigned auto-updates, insecure CI/CD pipelines, or unsafe deserialization of untrusted data. Test by reviewing pipeline configurations for integrity checks and validating that deserialization paths reject malformed input. Tools: SAST pipeline integration, pipeline configuration review.

9. **Security Logging and Monitoring Failures** — Insufficient logging and alerting means breaches go undetected. Test by verifying that all significant actions (especially admin operations) produce timestamped log entries, and that passwords and PII are not logged in plain text. Tools: log assertion in functional security test automation.

10. **Server-Side Request Forgery (SSRF)** — The server fetches a remote resource based on a user-supplied URL without validation, allowing attackers to probe internal services. Test by submitting internal IP addresses and localhost references as URL parameters and confirming they are rejected. Tools: OWASP ZAP active scan, manual Postman testing.

---

## STRIDE Threat Modeling

STRIDE was developed by Loren Kohnfelder and Praerit Garg at Microsoft. It provides a six-category framework for brainstorming security threats against any feature or user story. The recommended cadence is roughly 15 minutes of threat modeling per user story, keeping scope small and repeating iteratively as new features may introduce threats to existing ones (full-stack-testing-mohan ch-07).

### Spoofed Identity
An attacker assumes the identity of a legitimate user or service component. Example abuser story: "As an abusive user, I exploit an unattended logged-in workstation to impersonate a store assistant and manipulate orders." Defenses include multifactor authentication, frequent access token rotation, and secrets stored in vaults rather than in code. (full-stack-testing-mohan ch-07)

### Tampering with Inputs
Malicious modification of data, code, or messages in transit. Example abuser story: "As an abusive user, I inject SQL commands into the order placement form to extract or corrupt payment details." Defenses include input validation, parameterized queries, and authentication controls on all endpoints. (full-stack-testing-mohan ch-07)

### Repudiation of Actions
A malicious actor performs harmful actions and then denies responsibility because no audit trail exists. Example abuser story: "As a privileged system administrator, I bulk-insert fraudulent orders for personal gain, knowing no logs capture my actions." Defenses include comprehensive timestamped logging of all system actions, especially admin operations, and non-repudiation mechanisms. (full-stack-testing-mohan ch-07)

### Information Disclosure
Unauthorized parties gain access to protected data. Example abuser story: "As an abusive user, I exploit an unrestricted /viewOrders endpoint to retrieve all customer records, or I read passwords from plain-text application logs." Defenses include strong role-based authorization, encryption of data at rest and in transit, and removal of sensitive values from logs. (full-stack-testing-mohan ch-07)

### Denial of Service
The application is rendered unavailable by overloading or crashing it. Example abuser story: "As an abusive user, I flood the order service with requests until it becomes unresponsive for legitimate customers." Defenses include load balancers, per-IP request throttling, IP allowlists, auto-scaling, and surge monitoring. (full-stack-testing-mohan ch-07)

### Escalation of Privileges
An attacker gains access rights beyond those intended for their role, either temporarily or permanently. Example abuser story: "As an attacker who has obtained admin credentials, I create new privileged accounts or permanently elevate my own role, with no admin action logs to reveal the activity." Defenses include principle of least privilege, clearly bounded role definitions, and restricted commit rights by default. (full-stack-testing-mohan ch-07)

---

## Tooling Categories

(full-stack-testing-mohan ch-07)

### SAST (Static Application Security Testing)

SAST tools analyze source code, bytecode, or compiled code for known vulnerability patterns without executing the application. They provide the earliest possible feedback loop, surfacing issues during active development before code is ever committed. SAST integrates into IDE plug-ins, command-line tools, and CI pipeline steps so that every commit triggers a scan (full-stack-testing-mohan ch-07).

Key tools:
- **Snyk IDE plug-in** (JetBrains / IntelliJ, WebStorm, PyCharm) — combines SCA and SAST in a single free plug-in; surfaces vulnerability type, affected component, and remediation suggestion inline while the developer writes code.
- **Checkmarx SAST** — enterprise SAST platform integrated into CI pipelines.
- **Security Code Scan** — a SAST library option for CI integration.
- **Talisman** — a pre-commit or pre-push Git hook that scans specifically for secrets (private keys, AWS credentials, SSH keys, `.pem` files, hex-encoded secrets) and blocks the commit if any are detected.

### DAST (Dynamic Application Security Testing)

DAST tools test a running application as a black box, sending specially crafted attack payloads and observing how the application responds. Because the application is live, DAST can detect runtime vulnerabilities that static analysis cannot see, such as live SQL injection, reflected XSS, and runtime misconfigurations. Active scans can take hours; they are best scheduled as nightly regression stages or triggered manually per story rather than on every commit (full-stack-testing-mohan ch-07).

Key tools:
- **OWASP ZAP** (open source) — supports passive scanning (traffic inspection without modification) and active scanning (attack simulation); integrates with CI via its Python API; pairs with Selenium WebDriver to benefit from an authenticated session; offers predefined GitHub Actions for baseline and full scans.
- **Burp Suite** — widely used professional DAST and proxy tool for manual and automated security testing.

### SCA (Software Composition Analysis)

SCA tools identify known vulnerabilities (CVEs) in the application's third-party open source dependencies. They complement SAST: SAST covers first-party code; SCA covers the dependency tree. SCA can run during development and in CI pipelines, generating reports that list each vulnerable component with its CVE ID and remediation guidance (full-stack-testing-mohan ch-07).

Key tools:
- **OWASP Dependency-Check** — open source; command-line or plugin; produces an HTML report per component with CVE ID, description, and advisory.
- **Snyk** — commercial with a free tier; available as IDE plug-in (combined with SAST), CLI, and CI integration.
- **npm audit** — built-in Node.js tooling for auditing JavaScript dependency trees.
- **GitHub Dependabot** — automated pull requests to upgrade vulnerable dependencies.

### Secrets Scanning

Secrets scanning detects credentials, API keys, and other sensitive values before they are committed to version control or published in repositories. Automated bots continuously crawl public repositories for leaked credentials, making pre-commit scanning a critical first line of defense (full-stack-testing-mohan ch-07).

Key tools:
- **Talisman** — Git pre-commit or pre-push hook; scans for private keys, AWS secrets, SSH keys, `.pem` files, environment credentials, and hex-encoded secrets; blocks the commit and reports the offending file and matched pattern.
- **Gitleaks** — open source secrets scanner that can be run against the full git history or as a pre-commit hook.

### Container Scanning

Container images and infrastructure-as-code definitions must be scanned for vulnerabilities when the application is containerized or deployed via cloud-native infrastructure (full-stack-testing-mohan ch-07).

Key tools:
- **Trivy** — open source vulnerability scanner for container images and filesystems.
- **Snyk Container** — scans container images for OS and application-level vulnerabilities.
- **Anchore** — container analysis and policy enforcement.
- **docker scan** — Docker's built-in image scanning capability.
- **Snyk IaC** — lints Terraform and Kubernetes manifests for security best practices.

---

## Shift-Left Security Practices

Shifting security left means integrating security validation as early and continuously as possible in the delivery cycle, reducing the cost and risk of late-discovered vulnerabilities (full-stack-testing-mohan ch-07).

- Configure a pre-commit secrets scan (Talisman or Gitleaks) on every developer workstation so credentials can never reach version control.
- Install SAST and SCA IDE plug-ins (e.g., Snyk IDE plug-in) so vulnerability feedback is available while writing code, without context switching.
- Run OWASP Dependency-Check or Snyk SCA as a CI pipeline step on every commit; fail the build when vulnerable dependencies are detected.
- Derive functional security test cases from threat modeling sessions (approximately 15 minutes per user story) and automate them alongside regression tests in CI.
- Schedule DAST scans (OWASP ZAP active scan) as nightly regression jobs or manual triggers per story, rather than deferring them to a terminal pen-test phase.
- Lint container images and infrastructure-as-code in the pipeline to catch misconfigurations before deployment.
- Reserve professional penetration testing for high-criticality applications or where team security competency requires specialist augmentation; do not treat it as the sole security activity.
- Make security awareness a daily team habit: question every shared credential, every architecture diagram posted in an online portal, and every sensitive value in a chat message.

---

## Named Pitfalls

- **Security as an afterthought** — treating security as a final-gate pen-test-only activity makes vulnerabilities expensive to fix and increases the likelihood that they ship to production (full-stack-testing-mohan ch-07).
- **Shared credentials over chat** — passing secrets through messaging channels (e.g., Slack) bypasses secrets management controls and leaves credentials exposed in chat history (full-stack-testing-mohan ch-07).
- **Public architecture diagrams** — posting system architecture diagrams in publicly accessible online portals reveals the attack surface to adversaries (full-stack-testing-mohan ch-07).
- **Blanket admin permissions** — granting all users broad administrative access to reduce maintenance overhead violates least privilege and dramatically expands the blast radius of any compromise (full-stack-testing-mohan ch-07).
- **Trusting any single technique alone** — relying exclusively on SAST, DAST, SCA, or pen testing misses the vulnerability classes that each technique cannot detect; an effective security posture combines multiple complementary approaches across the entire delivery cycle (full-stack-testing-mohan ch-07).

---

## Pointers

- Used by agent: qa-security-specialist (primary)
- Used by agents: qa-compliance-gdpr, qa-compliance-pdpa
