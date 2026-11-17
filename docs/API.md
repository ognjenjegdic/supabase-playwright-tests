# Restaurant API documentation

## Open Swagger

From the project folder:

```sh
npm ci
npm run docs
```

Open http://127.0.0.1:3000. If port 3000 is busy, run `DOCS_PORT=3001 npm run docs` instead.

The Swagger UI shows request/response schemas, examples, filters, status codes, and the Try it out button. Assets are installed locally; it does not use an external Swagger CDN or validator.

The local UI is connected to the **live practice database** configured in `.env`. Execute on checkout creates a simulated order. Delete removes a demo order and its items/payment. Do not delete the persistent samples if you want to keep them for browsing.

## Endpoint index

The actual Supabase base URL is `https://<project-ref>.supabase.co/rest/v1`.

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/restaurants` | List/filter active restaurants |
| GET | `/menu_items` | Browse a restaurant's menu, category, prices, availability |
| GET | `/coupons` | List restaurant coupons; checkout validates expiry/minimum |
| POST | `/rpc/place_order` | Place order, apply optional coupon, simulate payment, return order number |
| GET | `/orders` | List orders, find one by UUID/order number, or embed a receipt |
| DELETE | `/orders` | Administrative cleanup of one order; cascades to its items/payment |
| GET | `/order_items` | Read purchased item snapshots and quantities |
| GET | `/payments` | Read simulated payment status and amount |
| GET | `/pw_bookings` | List/filter legacy practice bookings |
| POST | `/pw_bookings` | Create a legacy booking |
| PATCH | `/pw_bookings` | Update a legacy booking by UUID |
| DELETE | `/pw_bookings` | Delete a legacy booking by UUID |

These are the supported practice workflows and cleanup operations. The elevated database role also has raw administrative CRUD grants on the restaurant tables, but those operations are intentionally not presented as a checkout interface. Use `place_order` for normal ordering so totals, validation, and atomic writes are enforced.

## Try the ordering flow

1. Expand **Browse > GET /restaurants** and Execute to see restaurant IDs.
2. Expand **GET /menu_items**, set `restaurant_id` to `eq.<restaurant UUID>`, and `available` to `eq.true`.
3. Expand **Checkout > POST /rpc/place_order**. The approved example buys two McDonald's Demo burgers with SAVE10. Expected subtotal: 1198 cents; discount: 119; total: 1079.
4. Click Execute and copy `order_number` or `id` from the response.
5. Under **Orders > GET /orders**, set `order_number` to `eq.<number>` (or `id` to `eq.<UUID>`). Clear unrelated filters/examples. Set `select` to `*,order_items(*),payments(*)` for the full receipt.
6. Inspect `order_items` and `payments` either in the receipt or their individual endpoints.
7. Optional cleanup: DELETE `/orders` with `id=eq.<UUID>` for the order you created.

Swagger examples use an all-zero order UUID. The local UI replaces it with a new random UUID on every checkout execution. A custom UUID is preserved. Direct API clients must supply a fresh UUID themselves; they do not get this UI convenience. A repeated UUID returns HTTP 409.

Select the **declined** request example to test a failed payment. Checkout still returns HTTP 200 but `status=payment_failed`. Payments are test-token simulations, with no real card data or charges.

## Filters and responses

This is PostgREST's table-style API: there is no `/orders/7` route. Use query filters:

```text
/restaurants?active=eq.true
/menu_items?restaurant_id=eq.<UUID>&available=eq.true&category=eq.main
/orders?order_number=eq.7&select=*,order_items(*),payments(*)
/order_items?order_id=eq.<UUID>
/payments?order_id=eq.<UUID>
```

Read endpoints return arrays; no matches returns HTTP 200 with `[]`. The checkout RPC returns one order object. `payments` is an object when embedded in an order receipt; the standalone `/payments` endpoint returns an array.

Use `order=created_at.desc`, `limit=20`, and `offset=0` where appropriate for pagination. Column projection via `select` changes response fields. The spec schemas describe full rows, including the optional embedded receipt structure.

Write examples use `Prefer: return=representation` to return JSON. Raw PostgREST table writes without that preference can return HTTP 204 with no body. RPC checkout returns its JSON result with HTTP 200.

All prices are integer USD cents. Quantities must be integers from 1 to 20. Coupons apply to one restaurant and one order at a time; percentages round down to whole cents. Invalid carts/coupons are HTTP 400 and leave no partial order/items/payment records. PostgREST errors include `code`, `message`, `details`, and `hint`. Authentication-gateway errors can have a different body.

## Authentication and local proxy

Actual server-side API calls require `apikey: <SUPABASE_SECRET_KEY>`. These backend secrets bypass RLS and must not be put into browser Swagger's Authorize dialog.

The local docs server:

- Listens only on `127.0.0.1`.
- Reads credentials from `.env` and adds them to upstream requests server-side.
- Serves a browser-specific copy of the spec with `/api` as its base URL and no API-key input.
- Restricts calls to the documented methods/paths and documented query parameter names.
- Requires a per-process token added by Swagger, blocks foreign hosts/origins, and refuses redirects.
- Requires exact UUID filters for DELETE and PATCH so unfiltered bulk changes are blocked.
- Does not log credentials and suppresses raw transport error details.

The proxy is a local development convenience, not a hosted authentication service. Anyone with local access to this UI can invoke its supported operations. Do not expose its port publicly or deploy it as a customer backend.

## OpenAPI file and checks

`docs/openapi.json` is a portable **OpenAPI 3.0.3** specification. Import it into tooling or share it as API documentation; it contains no real keys or project credentials. The exported spec describes direct Supabase access using a `projectRef` server variable. The live local copy substitutes the proxy URL instead.

```sh
npm run docs:validate  # Validate the OpenAPI specification
npm run test:docs      # Check proxy access controls and secret isolation
```

The local proxy intentionally supports the workflow's documented parameters, not every possible PostgREST query feature. Request shapes/business rules are validated by Supabase and the database; the proxy is not an OpenAPI schema-validation gateway.

For setup, menu IDs, coupon rules, and SQL examples, see [RESTAURANTS.md](../RESTAURANTS.md).
