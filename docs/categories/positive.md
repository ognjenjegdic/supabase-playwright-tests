# Positive and contract tests

Branch: `test/api-positive`.

Happy-path response schemas and required fields for every restaurant read endpoint; headers, SQL values, checkout coupon/payment decision table, default parameters, receipt lookup, pagination/filter/projection, empty results, and the legacy booking lifecycle.

Run:

```sh
npm ci
npm run test:categories
# Or select the tag after merging several category branches:
npx playwright test --grep @positive
```

The branch shares the test foundation commit with the other five categories. The six branches are independent siblings, not a chain. See [TEST-DESIGN.md](../TEST-DESIGN.md) for data ownership, schema validation, capability gaps, and merge/run instructions.

Live tests require the configured Supabase sandbox. They own and clean up randomly identified data; the original menus and sample orders are left unchanged. Trace recording is disabled because requests carry a backend secret.

New tests in this category: **15**. The combined validation run passed all 110 new tests and 28 existing tests; subsequent exact coupon-boundary/header refinements passed their four targeted checks.
