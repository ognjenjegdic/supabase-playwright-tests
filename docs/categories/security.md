# Authentication, authorization, and security

Branch: `test/api-security`.

Missing/invalid API keys on every restaurant read endpoint and checkout; forged JWT rejection; anon/authenticated SQL grants and role reads; RLS/function privileges; RPC and item-level mass assignment; SQL-like input; sensitive-field leakage. Valid user JWT/tenant/rate-limit coverage is explicitly out of scope until those features and fixtures exist.

Run:

```sh
npm ci
npm run test:categories
# Or select the tag after merging several category branches:
npx playwright test --grep @security
```

The branch shares the test foundation commit with the other five categories. The six branches are independent siblings, not a chain. See [TEST-DESIGN.md](../TEST-DESIGN.md) for data ownership, schema validation, capability gaps, and merge/run instructions.

Live tests require the configured Supabase sandbox. They own and clean up randomly identified data; the original menus and sample orders are left unchanged. Trace recording is disabled because requests carry a backend secret.

New tests in this category: **26**. The combined validation run passed all 110 new tests and 28 existing tests; subsequent exact coupon-boundary/header refinements passed their four targeted checks.
