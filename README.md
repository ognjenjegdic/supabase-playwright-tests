# Supabase API + database tests

Playwright + JavaScript tests compare Supabase REST responses against PostgreSQL rows queried independently through `pg`. No browser download is required. This is separate from the Restful Booker project.

The project now includes a **restaurant ordering sandbox** with six related tables, menus, coupons, order numbers, and simulated card payments. See [RESTAURANTS.md](RESTAURANTS.md) for setup, API examples, and database queries. Run `npm run test:restaurants` for its 22 tests, or `npm test` for all 28 tests.

## Swagger API documentation

Run `npm run docs` and open http://127.0.0.1:3000 for interactive endpoint documentation and live examples. The local proxy keeps the backend key out of the browser. See [docs/API.md](docs/API.md) or import [docs/openapi.json](docs/openapi.json) into OpenAPI tooling.

## 1. Create a free Supabase project

1. Sign in at https://supabase.com/dashboard and choose **New project**.
2. Choose your personal organization and its Free plan, name the project `playwright-api-db`, and choose a nearby region.
3. Generate a strong database password and save it in your password manager. Wait for provisioning to finish.
4. Use a dedicated practice project: the tests create and delete their own disposable bookings.

## 2. Create the table

In your project's **SQL Editor**, create a new query. Paste the contents of `supabase/setup.sql` and run it once. It creates `public.pw_bookings`, price/date constraints, and grants for the backend API role.

The script enables Row Level Security and grants no anonymous access. These tests use a backend secret key with elevated access; they test CRUD and storage consistency, not end-user authorization. Do not add public `using (true)` policies to make tests pass. If the table already exists, inspect it rather than dropping it; this script deliberately stops on name conflicts.

## 3. Fill in the local configuration

Copy `.env.example` to `.env`. Open `.env` in your editor, not chat, and set:

| Variable | Where to find it |
| --- | --- |
| `SUPABASE_URL` | Project URL in the project's Connect dialog or Data API settings; usually `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | Settings > API Keys > Secret keys. Create/copy a key beginning `sb_secret_` |
| `DATABASE_URL` | Connect > Session pooler > URI. Copy it exactly and replace the password placeholder |
| `DATABASE_CA_PATH` | Optional local path to the downloaded Supabase database root certificate |

Use **Session pooler**, normally port 5432, for IPv4 compatibility on the free plan. The username includes your project reference. Do not use the REST API URL as the database host. Percent-encode reserved characters in the password inside the database URL. Keep `.env` values on one line each.

TLS certificate validation stays enabled. If the DB connection reports a certificate-chain error, download the database root certificate from Database settings > SSL, save it in `certs/prod-ca.crt`, and set `DATABASE_CA_PATH=./certs/prod-ca.crt`. Do not disable verification. The driver handles SSL configuration itself, overriding connection-string SSL parameters.

Keys, passwords, certificates, generated reports, and traces do not belong in Git. `.gitignore` excludes them. API traces are disabled, and transport errors suppress header details. Do not enable request debug logging with real secret keys. Modern secret keys are sent in the `apikey` header, not as bearer JWTs.

## 4. Install and run

Node.js 22+:

```sh
npm ci
npm run check:connection
npm test
npm run report
```

Useful commands:

```sh
npm run test:list                # Discover tests without credentials
npm run test:smoke               # Create/read comparison tests
npx playwright test -g 'PATCH'  # Run one scenario
```

Shell/CI environment values take precedence over `.env`. In CI, store the three required values as GitHub Actions secrets; never place them directly in workflow YAML. The repository contains only configuration examples; supply real credentials locally or through CI secrets.

## What the six tests verify

- **POST:** API response equals the submitted booking and its SQL row.
- **GET:** API response equals the expected booking and an independent SQL query.
- **PATCH:** updated fields persist; untouched fields remain the same; GET and SQL agree.
- **DELETE:** the booking disappears from both REST results and SQL results.
- **Invalid price:** the constraint rejects the request and SQL confirms no insertion.
- **Invalid dates:** the date constraint rejects the request and SQL confirms no insertion.

Each test allocates a UUID before its first write. Fixture cleanup deletes only that ID, even if an assertion fails. API requests mutate data; the SQL connection is configured read-only. Cleanup may be interrupted by a network outage or forced process exit. Tests use two workers and no automatic retries.

Date columns are formatted as `YYYY-MM-DD` by the SQL query so that date comparisons do not depend on the computer's timezone. Prices use integer units for this exercise, avoiding PostgreSQL numeric-string conversion differences.

The tests use real network connections. They do not silently skip when credentials are missing. Test discovery can be checked before cloud setup; live results require a configured, running Supabase project.

## Files

- `supabase/setup.sql`: one-time table setup.
- `tests/bookings.spec.js`: API/database comparison tests.
- `tests/fixtures.js`: isolated bookings, clients, cleanup.
- `lib/api.js`: Playwright HTTP client.
- `lib/database.js`: TLS PostgreSQL client and parameterized SQL.
- `lib/config.js`: local environment loading and validation.
- `scripts/check-connection.js`: non-mutating API/SQL connectivity check.

## Troubleshooting

- **Missing config:** fill in `.env`; do not leave `YOUR_` or `REPLACE_ME` placeholders.
- **API 401:** verify the project URL and `sb_secret_` key belong to the same project.
- **API 404 / PGRST205:** run the SQL setup, ensure `public` is exposed in Data API settings, and allow the schema cache to refresh.
- **Permission denied:** confirm the setup SQL grants privileges to `service_role` and the REST client uses a secret key.
- **DB connection failure:** resume a paused project, use the exact session-pooler URI, check encoded password and network access rules.
- **API works, DB row missing:** check both connections target the same project. The comparison test deliberately detects this mismatch.

## References

- https://supabase.com/docs/guides/api
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://node-postgres.com/features/ssl
- https://playwright.dev/docs/api-testing

## Test design categories

See [docs/TEST-DESIGN.md](docs/TEST-DESIGN.md) for the six category branches, design techniques, fixtures, and explicit capability gaps. On a category branch, run `npm run test:categories`.
