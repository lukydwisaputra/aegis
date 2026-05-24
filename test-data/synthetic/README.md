# test-data/synthetic/

AI-generated test data via factories + deterministic seeds. **Committed** to git so tests are reproducible across machines.

## factories/

One TypeScript file per entity, using Faker.js + the entity's domain rules. Example:

```typescript
// factories/user.factory.ts
import { faker } from '@faker-js/faker';

export function userFactory(overrides: Partial<User> = {}): User {
  faker.seed(hashTestCaseId(getCurrentTestId()));   // deterministic per TC
  return {
    id: faker.string.uuid(),
    email: `qa_user_${faker.number.int(1000)}@example.com`,
    firstName: faker.person.firstName(),
    ...overrides,
  };
}
```

## seed/

Deterministic per-env JSON seeds. Loaded by `qa-environment-engineer` before each cycle.

```
seed/
├── development.json     # local dev seed
├── testing.json         # ephemeral PR-instance seed
└── staging.json         # staging fixed-baseline seed
```

## Naming conventions

- Prefix all created entities: `qa_`, `test_`, or `e2e_`
- Use plus-aliases for email routing: `base+qa@example.com`, `base+sso@example.com`
- Org names: `qa_org_<slug>`
- IDs: synthetic UUIDs (never reuse production IDs)

## Cleanup

Every factory must pair `create()` with `cleanup()` so test data doesn't accumulate across runs. Specialists call `cleanup()` in `afterEach`.

## Production safety

`@qa/path-guard.assertEnvSafe()` refuses to run factories against environments flagged `readOnly: true` (production). No real DB inserts on prod, ever.
