# MODULE Codes Registry

Living registry of all `MODULE` abbreviations used in Aegis IDs. Every ID follows the pattern `{KIND}-{MODULE}-{NNN}` (e.g., `TC-AUTH-031`, `DEF-AUTH-0017`).

Adding a new module = appending a row here + SPV review.

## Why a registry?

- **Self-describing IDs:** `TC-AUTH-031` tells you it's an authentication test case at a glance
- **Greppable:** searching for `AUTH-` finds everything related to authentication
- **Conflict prevention:** atomic counters per (kind, module) — no duplicate IDs

## Format rules

- Module codes are **3-5 uppercase letters**
- Codes must be unique
- Choose names that age well — `AUTH` is better than `LOGIN_V2`
- Use abbreviations of the feature/domain, not implementation detail

## Registered modules

> Populated during Phase B (when agents are designed against book content + canonical example).
> An initial seed below covers common domains; teams add their own.

| Code | Domain | Owner agent | Notes |
|---|---|---|---|
| AUTH | Authentication / SSO / login flows | `qa-test-designer` | Includes JWT, OAuth, password resets |
| BILL | Billing & payments | `qa-test-designer` | Stripe, invoicing, refunds |
| DASH | Dashboard / home views | `qa-test-designer` | Cross-module display surfaces |
| SRCH | Search / filtering | `qa-test-designer` | Full-text, faceted, autocomplete |
| NOTIF | Notifications (email, in-app, push) | `qa-test-designer` | |
| USER | User profile management | `qa-test-designer` | |
| ADMIN | Administrative / back-office | `qa-test-designer` | |
| API | Generic API endpoints (no domain) | `qa-api-specialist` | For cross-cutting API tests |
| PERF | Performance / load | `qa-performance-specialist` | |
| SEC | Security findings | `qa-security-specialist` | |
| A11Y | Accessibility findings | `qa-accessibility-specialist` | |

## How to add a new module

1. Pick a 3-5 letter uppercase code
2. Append a row above with code, domain, owner agent, notes
3. Open a PR with the change
4. SPV (`qa-test-planner-spv`) reviews to ensure no naming conflicts or ambiguity
5. After merge, `@qa/ids.nextId()` accepts the new module immediately

## See also

- `docs/34-module-codes-registry.md`
- `docs/21-naming-conventions.md`
- `@qa/ids` package
