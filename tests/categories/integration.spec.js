import { test, expect, json, submit, receipt, assertOrder, counts, noOrder, measure, assertSchema } from '../support/restaurant.js';

test.describe('Database integration and side effects @integration @regression', () => {
  test('checkout produces one linked order, exact lines, and matching payment amount @smoke', async ({ api, db, sandbox }) => {
    const draft = sandbox.draft({ p_items: [{ menu_item_id: sandbox.items[0].id, quantity: 10 }, { menu_item_id: sandbox.items[1].id, quantity: 2 }], p_coupon_code: 'TEN' });
    const order = await json(await submit(api, draft));
    expect(order).toMatchObject({ subtotal_cents: 1398, discount_cents: 139, total_cents: 1259 });
    await assertOrder(db, order);
    const joined = await db.query(`select o.id, o.total_cents, p.amount_cents,
      sum(i.line_total_cents)::int as lines_total, count(i.id)::int as lines
      from public.orders o join public.order_items i on i.order_id=o.id
      join public.payments p on p.order_id=o.id where o.id=$1 group by o.id,p.amount_cents`, [order.id]);
    expect(joined.rows).toEqual([{ id: order.id, total_cents: 1259, amount_cents: 1259, lines_total: 1398, lines: 2 }]);
    const [view] = await json(await receipt(api, order.id));
    expect(view.order_items.map(i=>i.menu_item_id).sort()).toEqual(draft.p_items.map(i=>i.menu_item_id).sort());
    expect(view.payments.order_id).toBe(order.id);
  });

  test('mixed valid/invalid cart is atomic and can be corrected', async ({ api, db, sandbox }) => {
    const draft = sandbox.draft({ p_items: [{ menu_item_id: sandbox.items[0].id, quantity: 1 }, { menu_item_id: sandbox.items[21].id, quantity: 1 }] });
    expect((await submit(api, draft)).status()).toBe(400); await noOrder(db, draft.p_order_id);
    const order = await json(await submit(api, { ...draft, p_items: draft.p_items.slice(0,1) }));
    await assertOrder(db, order); expect(await counts(db, order.id)).toEqual({ orders: 1, items: 1, payments: 1 });
  });

  test('menu price changes affect future checkout, not existing receipt snapshots', async ({ api, db, sandbox }) => {
    const first = await json(await submit(api, sandbox.draft({ p_items: [{ menu_item_id: sandbox.items[0].id, quantity: 1 }] })));
    await json(await api.send('PATCH', { id: `eq.${sandbox.items[0].id}` }, { price_cents: 175, name: 'Updated QA menu item' }, 'menu_items'));
    const next = await json(await submit(api, sandbox.draft({ p_items: [{ menu_item_id: sandbox.items[0].id, quantity: 1 }] })));
    expect(next.total_cents).toBe(175); expect(first.total_cents).toBe(100);
    const [oldReceipt] = await json(await receipt(api, first.id));
    expect(oldReceipt.order_items[0]).toMatchObject({ item_name: sandbox.items[0].name, unit_price_cents: 100, line_total_cents: 100 });
    const [newReceipt] = await json(await receipt(api, next.id));
    expect(newReceipt.order_items[0]).toMatchObject({ item_name: 'Updated QA menu item', unit_price_cents: 175 });
    await assertOrder(db, first); await assertOrder(db, next);
  });

  test('order deletion cascades to lines/payment but preserves restaurant/menu/coupon', async ({ api, db, sandbox }) => {
    const order = await json(await submit(api, sandbox.draft({ p_coupon_code: 'TEN' })));
    const deleted = await json(await api.send('DELETE', { id: `eq.${order.id}` }, undefined, 'orders'));
    expect(deleted).toEqual([order]); await noOrder(db, order.id);
    expect(await json(await receipt(api, order.id))).toEqual([]);
    const retained = await db.query(`select
      (select count(*)::int from public.restaurants where id=$1) as restaurants,
      (select count(*)::int from public.menu_items where restaurant_id=$1) as menu,
      (select count(*)::int from public.coupons where restaurant_id=$1) as coupons`, [sandbox.restaurant.id]);
    expect(retained.rows).toEqual([{ restaurants: 1, menu: 22, coupons: 4 }]);
    expect(await json(await api.send('DELETE', { id: `eq.${order.id}` }, undefined, 'orders'))).toEqual([]);
  });

  test('JOIN, GROUP BY/HAVING and LEFT JOIN distinguish purchased and unused menu items', async ({ api, db, sandbox }) => {
    const a = await json(await submit(api, sandbox.draft({ p_items: [{ menu_item_id: sandbox.items[0].id, quantity: 2 }] })));
    const b = await json(await submit(api, sandbox.draft({ p_items: [{ menu_item_id: sandbox.items[0].id, quantity: 3 }] })));
    const groups = await db.query(`select i.menu_item_id, sum(i.quantity)::int as quantity,
      sum(i.line_total_cents)::int as sales from public.order_items i
      join public.orders o on o.id=i.order_id where o.restaurant_id=$1 and o.status='paid'
      group by i.menu_item_id having sum(i.quantity)>4`, [sandbox.restaurant.id]);
    expect(groups.rows).toEqual([{ menu_item_id: sandbox.items[0].id, quantity: 5, sales: 500 }]);
    const unused = await db.query(`select m.id from public.menu_items m left join public.order_items i
      on i.menu_item_id=m.id where m.restaurant_id=$1 and i.id is null`, [sandbox.restaurant.id]);
    expect(unused.rows).toHaveLength(21);
    expect(unused.rows.some(r=>r.id === sandbox.items[0].id)).toBe(false);
    await assertOrder(db, a); await assertOrder(db, b);
  });

  test('unsupported shipping status is rejected by the storage constraint', async ({ api, db, sandbox }) => {
    // Enum validity only: the API does not implement a shipping state machine.
    const order = await json(await submit(api, sandbox.draft()));
    const error = await json(await api.send('PATCH', { id: `eq.${order.id}` }, { status: 'shipped' }, 'orders'), 400);
    expect(error.code).toBe('23514'); await assertOrder(db, order);
    expect(await counts(db, order.id)).toEqual({ orders: 1, items: 1, payments: 1 });
  });

  test('independent SQL connection sees a committed order after the API responds', async ({ api, db, sandbox }) => {
    const order = await json(await submit(api, sandbox.draft()));
    const client = await db.connect();
    try {
      const result = await client.query('select status,total_cents from public.orders where id=$1', [order.id]);
      expect(result.rows).toEqual([{ status: 'paid', total_cents: 1000 }]);
    } finally { client.release(); }
  });

  test('single read latency smoke check with an explicit configurable budget', async ({ api }, info) => {
    const budget = Number(process.env.API_LATENCY_BUDGET_MS || 10_000);
    expect(Number.isFinite(budget) && budget > 0).toBe(true);
    const { response, elapsedMs } = await measure(()=>api.send('GET', { id: 'eq.10000000-0000-4000-8000-000000000001' }, undefined, 'restaurants'));
    const [body] = await json(response); assertSchema('Restaurant', body);
    await info.attach('read-latency.json', { body: JSON.stringify({ elapsedMs, budgetMs: budget, scope: 'one request; not an SLO/load test' }), contentType: 'application/json' });
    expect(elapsedMs).toBeLessThan(budget);
  });
});
