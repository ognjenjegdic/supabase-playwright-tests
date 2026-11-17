import { test, expect, json, submit, receipt, assertOrder, assertSchema, counts } from '../support/restaurant.js';

test.describe('Positive and provider contracts @positive @regression', () => {
  for (const [resource, model, filter] of [
    ['restaurants', 'Restaurant', 'id'], ['menu_items', 'MenuItem', 'restaurant_id'],
    ['coupons', 'Coupon', 'restaurant_id'], ['orders', 'Order', 'id'],
    ['order_items', 'OrderItem', 'order_id'], ['payments', 'Payment', 'order_id'],
  ]) {
    test(`GET ${resource}: headers, full schema, and SQL values`, async ({ api, db, sandbox }) => {
      const order = await json(await submit(api, sandbox.draft()));
      const value = ['restaurants', 'menu_items', 'coupons'].includes(resource) ? sandbox.restaurant.id : order.id;
      const body = await json(await api.send('GET', { [filter]: `eq.${value}`, order: 'id.asc' }, undefined, resource));
      expect(body.length).toBeGreaterThan(0);
      for (const row of body) assertSchema(model, row);
      const result = await db.query(`select to_jsonb(t) as value from public.${resource} t where ${filter}=$1 order by id`, [value]);
      expect(body).toEqual(result.rows.map(r => r.value));
    });
  }

  for (const coupon of [null, 'TEN']) for (const card of ['test_card_approved', 'test_card_declined']) {
    test(`checkout decision table: coupon=${coupon}, card=${card} @smoke`, async ({ api, db, sandbox }) => {
      const draft = sandbox.draft({ p_coupon_code: coupon, p_test_card: card });
      const order = await json(await submit(api, draft));
      expect(order).toMatchObject({ id: draft.p_order_id, restaurant_id: sandbox.restaurant.id,
        subtotal_cents: 1000, discount_cents: coupon ? 100 : 0, total_cents: coupon ? 900 : 1000,
        status: card === 'test_card_approved' ? 'paid' : 'payment_failed' });
      expect(order.order_number).toBeGreaterThan(0);
      await assertOrder(db, order);
      const [body] = await json(await receipt(api, order.id));
      assertSchema('Receipt', body);
      expect(body.order_items).toHaveLength(1);
      expect(body.payments).toMatchObject({ status: card === 'test_card_approved' ? 'approved' : 'declined', amount_cents: order.total_cents });
      expect(await counts(db, order.id)).toEqual({ orders: 1, items: 1, payments: 1 });
    });
  }

  test('omitted optional checkout fields use documented defaults', async ({ api, db, sandbox }) => {
    const draft = sandbox.draft(); delete draft.p_test_card; delete draft.p_coupon_code;
    const order = await json(await submit(api, draft));
    expect(order).toMatchObject({ status: 'paid', coupon_id: null, discount_cents: 0, total_cents: 1000 });
    await assertOrder(db, order);
  });

  test('menu filtering, ordering, pagination, and field projection agree', async ({ api, sandbox }) => {
    const expected = sandbox.items.filter(i => i.available && i.category === 'main').sort((a,b) => a.price_cents-b.price_cents || a.id.localeCompare(b.id));
    const body = await json(await api.send('GET', { restaurant_id: `eq.${sandbox.restaurant.id}`, available: 'eq.true',
      category: 'eq.main', order: 'price_cents.asc,id.asc', limit: 2, offset: 1, select: 'id,name,price_cents' }, undefined, 'menu_items'));
    expect(body).toEqual(expected.slice(1,3).map(({id,name,price_cents})=>({id,name,price_cents})));
  });

  test('lookup by returned order number finds exactly the created order', async ({ api, sandbox }) => {
    const order = await json(await submit(api, sandbox.draft()));
    expect(await json(await api.send('GET', { order_number: `eq.${order.order_number}` }, undefined, 'orders'))).toEqual([order]);
  });

  test('unknown order lookup returns a JSON empty array, not a false 404', async ({ api, sandbox }) => {
    const draft = sandbox.draft();
    expect(await json(await receipt(api, draft.p_order_id))).toEqual([]);
  });

  test('legacy booking create/read/update/delete preserves contract and SQL state', async ({ api, db, booking }) => {
    const createdResponse = await api.send('POST', {}, booking);
    expect(createdResponse.headers()['preference-applied']).toContain('return=representation');
    const [created] = await json(createdResponse, 201);
    assertSchema('Booking', created); expect(created).toEqual(booking);
    const [updated] = await json(await api.send('PATCH', { id: `eq.${booking.id}` }, { totalprice: 175 }));
    assertSchema('Booking', updated); expect(updated).toEqual({ ...booking, totalprice: 175 });
    expect(await json(await api.send('GET', { id: `eq.${booking.id}` }))).toEqual([updated]);
    const result = await db.query('select totalprice from public.pw_bookings where id=$1', [booking.id]);
    expect(result.rows).toEqual([{ totalprice: 175 }]);
    expect(await json(await api.send('DELETE', { id: `eq.${booking.id}` }))).toEqual([updated]);
    expect(await json(await api.send('GET', { id: `eq.${booking.id}` }))).toEqual([]);
    expect((await db.query('select count(*)::int as n from public.pw_bookings where id=$1', [booking.id])).rows[0].n).toBe(0);
  });
});
