# Boundary value analysis

Branch: `test/api-boundaries`.

Quantity values -1, 0, 1, 2, 19, 20, 21 plus null, fractional, and string values; cart sizes 0, 1, 2, 19, 20, 21; coupon minimum spend; empty/null/trimmed/case-insensitive coupon input; Unicode names/codes, long unknown input, and fractional-cent rounding.

Run:

```sh
npm ci
npm run test:categories
# Or select the tag after merging several category branches:
npx playwright test --grep @boundaries
```

The branch shares the test foundation commit with the other five categories. The six branches are independent siblings, not a chain. See [TEST-DESIGN.md](../TEST-DESIGN.md) for data ownership, schema validation, capability gaps, and merge/run instructions.

Live tests require the configured Supabase sandbox. They own and clean up randomly identified data; the original menus and sample orders are left unchanged. Trace recording is disabled because requests carry a backend secret.

New tests in this category: **27**. The combined validation run passed all 110 new tests and 28 existing tests; subsequent exact coupon-boundary/header refinements passed their four targeted checks.
