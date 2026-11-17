# API test categories

Six independent category branches share the same fixture/contract support commit on top of merged PR #1. Each branch adds one category spec and one category guide. They can be merged in any order; the identical shared commit is included only once by Git. Existing production SQL and API behavior are not changed by these test branches.

| Category | Branch | File |
| --- | --- | --- |
| Positive / contracts | `test/api-positive` | `tests/categories/positive.spec.js` |
| Negative / partitions | `test/api-negative` | `tests/categories/negative.spec.js` |
| Boundaries / Unicode | `test/api-boundaries` | `tests/categories/boundaries.spec.js` |
| Security / roles | `test/api-security` | `tests/categories/security.spec.js` |
| Integration / SQL | `test/api-integration` | `tests/categories/integration.spec.js` |
| Concurrency / recovery | `test/api-senior` | `tests/categories/senior.spec.js` |

On any category branch: `npm ci`, configure `.env` and certificate as in README, then `npm run test:categories`. With all branches merged, that command runs all six specs. `npm test` runs the existing suite too. Category names are tags usable with `--grep @security`, etc. Smoke tests have `@smoke`; all new cases are regression tests.

## Test design

- Arrange–Act–Assert, data-driven equivalence partitions, boundary value analysis, and coupon/payment decision tables.
- Ajv validates the published OpenAPI response schemas, including UUID/date formats, required properties, types, and enums. This is provider response-contract validation, not a separate consumer-driven contract such as Pact. Schemas do not currently forbid all additional properties, so security tests separately check sensitive fields.
- Assertions include status, Content-Type, business results, relational counts/totals, read-after-write visibility, and cleanup. No automatic test retries, arbitrary sleeps, or execution-order assumptions.
- Each test owns a randomly named restaurant, menu entries, coupons, and UUIDs allocated before requests. Cleanup runs in fixture teardown, including failures. Tests never change the three seeded restaurant menus or sample orders. The older restaurant-list assertion is scoped to its three seeded IDs so category fixtures do not cause false failures.
- SQL reads are parameterized and read-only. Cross-table aggregation and cascading deletes verify side effects that actually exist.
- Performance is a single-request latency smoke check with `API_LATENCY_BUDGET_MS` (default 10000), not a load test, percentile SLO, or benchmark. The measured duration is attached to the report.

## Capability limits: do not infer coverage for missing features

| Requested concept | Current system and test treatment |
| --- | --- |
| AuthN / invalid token | Missing and invalid API keys at the real HTTP gateway; malformed JWT with a valid backend key is checked where applicable |
| RBAC | Database `anon`/`authenticated` grants, RLS, function privileges, and rejected role reads are checked. The backend key intentionally has elevated service-role access |
| Expiry / iss / aud / valid JWT signature | No application login/user JWT fixture is configured. Invalid-token rejection does not prove these claims independently; add real signed-user fixtures before claiming coverage |
| Tenants, BOLA/IDOR, customer ownership | No tenant/customer column or RLS ownership policy exists. Restaurant ownership checks on cart items/coupons are business rules, not tenant isolation. The service role bypasses RLS; using it to claim cross-user isolation would be incorrect |
| Mass assignment | RPC extra parameters and client-provided price/status fields are checked. Raw service-role CRUD is administrative and deliberately powerful |
| Rate limiting | No application rate-limit policy exists. Do not flood the free sandbox to look for a provider limit |
| Events / emails | No event publisher, queue, email provider, or outbox exists. Tests verify orders, lines, payments, and cascades, not imaginary notifications |
| Stock / last item race | No inventory counter exists. Real concurrency checks cover duplicate order UUIDs and independent orders, not last-item reservation |
| State machine | Only checkout outcomes `paid` and `payment_failed` exist. No CREATED/SHIPPED/DELIVERED transitions are exposed. Duplicate attempts must not change an existing outcome |
| Timeouts / retries | A lost response after commit is simulated explicitly. The test reconciles by UUID using bounded polling and retries the same UUID to prove duplicate prevention. This is not a claim that the client is transparently idempotent or that a real provider timeout was induced |
| HTTP 202 / eventual consistency | Checkout is synchronous HTTP 200. Tests require the committed result and use bounded polling only for recovery; there is no 202 workflow to certify |
| Field lengths | Text columns have no maximum-length business rule. Long unknown coupon codes are rejected as unknown; Unicode round-trips are checked without inventing a length limit |

New production features (tenants, stock, events, state transitions, gateway payments) need their own migrations and contracts before corresponding tests can provide meaningful coverage. Unimplemented scenarios are recorded here, not added as permanently skipped or misleading green tests.
