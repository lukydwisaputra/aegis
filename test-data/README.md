# test-data/

Test data for QA cycles. Three categories with different gitignore rules.

## Layout

```
test-data/
├── README.md                          # this file
├── credentials/                       # human-provided creds per role
│   ├── README.md
│   ├── *.env.local.example            # COMMITTED templates
│   └── *.env.local                    # GITIGNORED (real creds)
├── synthetic/                         # AI-generated data — COMMITTED
│   ├── factories/                     # Faker.js factories per entity
│   ├── seed/                          # deterministic per-env seeds
│   └── README.md
└── fixtures/                          # static fixture files — COMMITTED
    ├── sample-images/
    ├── sample-uploads/
    └── README.md
```

## credentials/

Human-provided login credentials per role (e.g., `pm_staff`, `bishan_doctor`). The `.env.local` files are gitignored; only `.example` templates are committed.

Used by the Playwright auth fixture (`tests/fixtures/auth.fixture.ts`):

```
test.use({ adminPage })  → reads test-data/credentials/admin.env.local
```

## synthetic/

All test data created programmatically — never real PII. Factories produce realistic-looking data via Faker.js, seeded deterministically from test-case ID hashes (so tests are reproducible).

**Prefix conventions:** `qa_user_001@werkdone.com`, `test_admin_001`, `e2e_org_acme_001`, plus-aliases for email routing (`luky+sso@werkdone.com`).

## fixtures/

Static binary/JSON/CSV files that tests upload or compare against. Sample images, sample CSVs, golden outputs. Small files only; large fixtures live elsewhere (e.g., S3 with checksum verification).

## See also

- `docs/D11-secrets-handling.md`
