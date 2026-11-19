import { randomUUID } from 'node:crypto';
import { test, expect, json, invalid, submit, assertOrder, noOrder } from '../support/restaurant.js';

test.describe('Negative equivalence partitions @negative @regression', () => {
  for (const [label, changes, code] of [
    ['null restaurant', { p_restaurant_id: null }, 'P0001'],
    ['nonexistent restaurant', { p_restaurant_id: randomUUID() }, 'P0001'],
    ['invalid restaurant UUID', { p_restaurant_id: 'not-a-uuid' }, '22P02'],
    ['null cart', { p_items: null }, 'P0001'],
    ['object instead of cart array', { p_items: {} }, 'P0001'],
    ['string instead of cart array', { p_items: 'cart' }, 'P0001'],
    ['empty cart', { p_items: [] }, 'P0001'],
    ['null item', { p_items: [null] }, 'P0001'],
    ['missing product ID', { p_items: [{ quantity: 1 }] }, 'P0001'],
    ['null product ID', { p_items: [{ menu_item_id: null, quantity: 1 }] }, 'P0001'],
    ['nonexistent product', { p_items: [{ menu_item_id: randomUUID(), quantity: 1 }] }, 'P0001'],
    ['malformed product UUID', { p_items: [{ menu_item_id: 'broken', quantity: 1 }] }, '22P02'],
    ['invalid card', { p_test_card: 'unsupported' }, 'P0001'],
    ['null card', { p_test_card: null }, 'P0001'],
  ]) {
    test(`reject ${label}; no partial order, lines, or payment`, async ({ api, db, sandbox }) => {
      await invalid(api, db, sandbox.draft(changes), code);
    });
  }
  for (const field of ['p_order_id', 'p_restaurant_id', 'p_items']) {
    test(`missing required RPC argument ${field} fails function resolution`, async ({ api, db, sandbox }) => {
      const body = sandbox.draft(); const id = body.p_order_id; delete body[field];
      await invalid(api, db, body, 'PGRST202', 404);
      await noOrder(db, id);
    });
  }
  for (const label of ['unavailable', 'different restaurant', 'duplicate', 'missing quantity']) {
    test(`reject ${label} cart entry`, async ({ api, db, sandbox }) => {
      const own = sandbox.items[0].id;
      const entries = {
        unavailable: [{ menu_item_id: sandbox.items[21].id, quantity: 1 }],
        'different restaurant': [{ menu_item_id: '20000000-0000-4000-8000-000000000001', quantity: 1 }],
        duplicate: [{ menu_item_id: own, quantity: 1 }, { menu_item_id: own, quantity: 2 }],
        'missing quantity': [{ menu_item_id: own }],
      };
      await invalid(api, db, sandbox.draft({ p_items: entries[label] }));
    });
  }
  for (const coupon of ['UNKNOWN', 'EXPIRED', 'DISABLED', 'SAVE10']) {
    test(`reject coupon partition ${coupon}`, async ({ api, db, sandbox }) => {
      await invalid(api, db, sandbox.draft({ p_coupon_code: coupon }));
    });
  }
  test('rejected request can be corrected with the same UUID', async ({ api, db, sandbox }) => {
    const body = sandbox.draft({ p_coupon_code: 'UNKNOWN' });
    await invalid(api, db, body);
    const order = await json(await submit(api, { ...body, p_coupon_code: 'TEN' }));
    expect(order).toMatchObject({ id: body.p_order_id, status: 'paid', total_cents: 900 });
    await assertOrder(db, order);
  });
  test('malformed read filter is rejected as structured JSON', async ({ api, sandbox }) => {
    const error = await json(await api.send('GET', { id: 'eq.not-a-uuid' }, undefined, 'orders'), 400);
    expect(error).toMatchObject({ code: '22P02', message: expect.any(String) });
  });
});
