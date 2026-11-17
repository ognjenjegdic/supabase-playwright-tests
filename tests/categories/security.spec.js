import { test, expect, json, submit, receipt, invalid, untrustedClient, noOrder, assertOrder } from '../support/restaurant.js';
import { settings } from '../../lib/config.js';

const resources = ['restaurants', 'menu_items', 'coupons', 'orders', 'order_items', 'payments'];
test.describe('Existing API access controls @security @regression', () => {
  for (const [label, headers] of [['missing API key', {}], ['invalid API key', { apikey: 'invalid-test-key' }]]) {
    for (const resource of [...resources, 'rpc/place_order']) {
      test(`${label}: ${resource} is denied before business logic`, async ({ db, sandbox }) => {
        const client = await untrustedClient(headers);
        const body = sandbox.draft();
        try {
          const response = await client.send(resource.startsWith('rpc/') ? 'POST' : 'GET', resource, resource.startsWith('rpc/') ? body : undefined);
          const error = await json(response, 401);
          expect(error.message).toEqual(expect.any(String));
          await noOrder(db, body.p_order_id);
        } finally { await client.dispose(); }
      });
    }
  }

  test('forged user JWT is rejected even with a valid API key', async ({ db, sandbox }) => {
    // Invalid signature test only. This does not independently verify valid-token exp/iss/aud handling.
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const jwt = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: sandbox.restaurant.id, role: 'authenticated', exp: 1 })}.Zm9yZ2VkLXNpZ25hdHVyZQ`;
    const client = await untrustedClient({ apikey: settings().key, Authorization: `Bearer ${jwt}` });
    const body = sandbox.draft();
    try {
      const error = await json(await client.send('POST', 'rpc/place_order', body), 401);
      expect(error.message).toEqual(expect.any(String)); await noOrder(db, body.p_order_id);
    } finally { await client.dispose(); }
  });

  for (const role of ['anon', 'authenticated']) {
    test(`${role} has no table privileges and cannot execute checkout`, async ({ db }) => {
      for (const resource of resources) {
        const { rows } = await db.query(`select
          has_table_privilege($1,$2,'SELECT') as read,
          has_table_privilege($1,$2,'INSERT') as insert,
          has_table_privilege($1,$2,'UPDATE') as update,
          has_table_privilege($1,$2,'DELETE') as delete`, [role, `public.${resource}`]);
        expect(rows).toEqual([{ read: false, insert: false, update: false, delete: false }]);
      }
      const fn = await db.query("select has_function_privilege($1, 'public.place_order(uuid,uuid,jsonb,text,text)', 'EXECUTE') as allowed", [role]);
      expect(fn.rows).toEqual([{ allowed: false }]);
    });
    test(`${role} SQL role cannot read a known restaurant record`, async ({ db, sandbox }) => {
      const client = await db.connect();
      try {
        await client.query('begin');
        // Role names come exclusively from the constant test matrix above.
        await client.query(`set local role ${role}`);
        let code;
        try { await client.query('select id from public.restaurants where id=$1', [sandbox.restaurant.id]); }
        catch (error) { code = error.code; }
        expect(code).toBe('42501');
      } finally { await client.query('rollback'); client.release(); }
    });
  }

  test('RLS remains enabled for all six restaurant tables', async ({ db }) => {
    const result = await db.query(`select relname, relrowsecurity from pg_class
      where relnamespace='public'::regnamespace and relname=any($1::text[])`, [resources]);
    expect(result.rows).toHaveLength(6);
    expect(result.rows.every(r=>r.relrowsecurity)).toBe(true);
  });

  for (const extra of [{ p_status: 'paid' }, { p_total_cents: 1 }, { p_role: 'admin' }]) {
    test(`RPC rejects mass assignment through ${Object.keys(extra)[0]}`, async ({ api, db, sandbox }) => {
      await invalid(api, db, sandbox.draft(extra), 'PGRST202', 404);
    });
  }
  test('item-level forged totals and status do not override server calculations', async ({ api, db, sandbox }) => {
    const order = await json(await submit(api, sandbox.draft({
      p_test_card: 'test_card_declined',
      p_items: [{ menu_item_id: sandbox.items[0].id, quantity: 10, unit_price_cents: 0,
        total_cents: 0, status: 'paid', role: 'admin', discount_cents: 1000 }],
    })));
    expect(order).toMatchObject({ status: 'payment_failed', total_cents: 1000, discount_cents: 0 });
    await assertOrder(db, order);
  });
  test('SQL-like coupon text is data, not executable input', async ({ api, db, sandbox }) => {
    await invalid(api, db, sandbox.draft({ p_coupon_code: "TEN' OR 1=1 --" }));
    const [restaurant] = await json(await api.send('GET', { id: `eq.${sandbox.restaurant.id}` }, undefined, 'restaurants'));
    expect(restaurant.id).toBe(sandbox.restaurant.id);
  });
  test('receipt exposes no secret, password, full card number, or CVV fields', async ({ api, sandbox }) => {
    const order = await json(await submit(api, sandbox.draft()));
    const body = await json(await receipt(api, order.id));
    const forbidden = /^(password|secret|api_key|apikey|access_token|card_number|pan|cvv|cvc)$/i;
    const inspect = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, nested] of Object.entries(value)) { expect(forbidden.test(key), `Unexpected sensitive field ${key}`).toBe(false); inspect(nested); }
    };
    inspect(body);
    expect(JSON.stringify(body).includes(settings().key)).toBe(false);
    expect(body[0].payments.card_last4).toMatch(/^\d{4}$/);
  });
});
