---
name: qa-deps-update
description: Tiered dependency update workflow — patch auto-apply, minor review, major opt-in, security advisories auto-applied
---

# /qa-deps-update

## Purpose
Automates dependency maintenance using a risk-tiered strategy. Patch updates are applied and validated with a smoke run automatically. Minor updates are staged and surfaced for review. Major updates require explicit opt-in. Security advisory fixes are always applied immediately regardless of semver level. Keeps the project current without risking unexpected breaking changes.

## Usage
```
/qa-deps-update [--allow-major] [--security-only] [--dry-run]
```

## Key flags
| Flag | Default | Description |
|------|---------|-------------|
| `--allow-major` | `false` | Include major version updates in the candidate set |
| `--security-only` | `false` | Apply only packages with active security advisories |
| `--dry-run` | `false` | Show what would be updated without modifying `package.json` or lock files |

## Behaviour
1. Run `pnpm outdated --recursive --json` to collect the full outdated package list.
2. Check each package against the GitHub Advisory Database for active CVEs.
3. Categorise candidates: `security` (any semver), `patch`, `minor`, `major`.
4. **Security**: apply immediately; do not gate behind smoke run (but run smoke afterwards).
5. **Patch**: apply all, then dispatch `/qa-smoke` to validate; revert if smoke fails.
6. **Minor**: stage updates in a summary report for human review; do not apply automatically.
7. **Major** (only if `--allow-major`): list candidates with changelog links; require explicit confirmation per package.
8. Write update report to `reports/deps-update-{date}.md` with per-package change summary and smoke result.

## Events emitted
- `deps.update.started` — candidate counts by tier
- `deps.applied` — package name, old version, new version, tier
- `deps.smoke.passed` / `deps.smoke.failed` — smoke gate result after patch application
- `deps.update.completed` — applied/staged/skipped counts

## Example
```
/qa-deps-update --security-only
```
Applies only packages with active security advisories and runs a smoke test to validate.
