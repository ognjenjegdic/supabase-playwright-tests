# Negative equivalence partitions

Branch: `test/api-negative`.

Null, absent, wrong-type, nonexistent, and malformed restaurant/product/cart inputs; required RPC arguments; unavailable/cross-restaurant/duplicate items; invalid coupons and payment tokens; structured errors and no partial database writes; corrected retries.

Run:

```sh
npm ci
npm run test:categories
# Or select the tag after merging several category branches:
npx playwright test --grep @negative
```

The branch shares the test foundation commit with the other five categories. The six branches are independent siblings, not a chain. See [TEST-DESIGN.md](../TEST-DESIGN.md) for data ownership, schema validation, capability gaps, and merge/run instructions.

Live tests require the configured Supabase sandbox. They own and clean up randomly identified data; the original menus and sample orders are left unchanged. Trace recording is disabled because requests carry a backend secret.

New tests in this category: **27**. The combined validation run passed all 110 new tests and 28 existing tests; subsequent exact coupon-boundary/header refinements passed their four targeted checks.
