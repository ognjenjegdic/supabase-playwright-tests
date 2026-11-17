import { randomUUID } from 'node:crypto';
import { test as base, expect } from './fixtures.js';

const restaurant = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const test = base.extend({
  orderId: async ({ api }, use) => {
    const id = randomUUID();
    try { await use(id); } finally {
      const response = await api.send('DELETE', { id: `eq.${id}` }, undefined, 'orders');
      expect(response.status(), 'Order cleanup must succeed').toBe(200);
    }
  },
});

function checkout(orderId, overrides = {}) {
  return {
    p_order_id: orderId,
    p_restaurant_id: restaurant(1),
    p_items: [{ menu_item_id: item(1), quantity: 2 }, { menu_item_id: item(2), quantity: 1 }],
    p_coupon_code: null,
    p_test_card: 'test_card_approved',
    ...overrides,
  };
}

async function storedOrder(db, id) {
  const result = await db.query(`select id, order_number::integer, restaurant_id, coupon_id,
    status, currency, subtotal_cents, discount_cents, total_cents
    from public.orders where id = $1`, [id]);
  return result.rows;
}

async function assertStoredOrder(db, apiOrder) {
  const { created_at, ...fields } = apiOrder;
  expect(created_at).toEqual(expect.any(String));
  expect(await storedOrder(db, apiOrder.id)).toEqual([fields]);
}

async function assertNoOrder(db, id) {
  for (const table of ['orders', 'order_items', 'payments']) {
    const column = table === 'orders' ? 'id' : 'order_id';
    const result = await db.query(`select count(*)::integer as count from public.${table} where ${column} = $1`, [id]);
    expect(result.rows[0].count, `No partial records in ${table}`).toBe(0);
  }
}

test('list active restaurants matches PostgreSQL @smoke', async ({ api, db }) => {
  const response = await api.send('GET', { active: 'eq.true', id: `in.(${[1, 2, 3].map(restaurant).join(',')})`, select: '*', order: 'name' }, undefined, 'restaurants');
  expect(response.status()).toBe(200);
  const restaurants = await response.json();
  expect(restaurants).toHaveLength(3);
  const result = await db.query('select * from public.restaurants where active and id = any($1::uuid[]) order by name', [[1, 2, 3].map(restaurant)]);
  expect(restaurants).toEqual(result.rows);
});

for (const n of [1, 2, 3]) {
  test(`browse restaurant ${n} menu and compare prices with SQL`, async ({ api, db }) => {
    const response = await api.send('GET', {
      restaurant_id: `eq.${restaurant(n)}`, available: 'eq.true', order: 'name',
    }, undefined, 'menu_items');
    expect(response.status()).toBe(200);
    const menu = await response.json();
    expect(menu).toHaveLength(3);
    const result = await db.query('select * from public.menu_items where restaurant_id = $1 and available order by name', [restaurant(n)]);
    expect(menu).toEqual(result.rows);
    expect(menu.every(m => m.price_cents > 0)).toBe(true);
  });
}

test('approved checkout stores order, item snapshots, and a simulated payment @smoke', async ({ api, db, orderId }) => {
  const response = await api.send('POST', {}, checkout(orderId), 'rpc/place_order');
  expect(response.status()).toBe(200);
  const order = await response.json();
  expect(order).toMatchObject({ id: orderId, order_number: expect.any(Number), status: 'paid',
    subtotal_cents: 1447, discount_cents: 0, total_cents: 1447, currency: 'USD', coupon_id: null });
  expect(order.order_number).toBeGreaterThan(0);
  await assertStoredOrder(db, order);
  const lines = await db.query(`select menu_item_id, item_name, quantity, unit_price_cents, line_total_cents
    from public.order_items where order_id = $1 order by menu_item_id`, [orderId]);
  expect(lines.rows).toEqual([
    { menu_item_id: item(1), item_name: 'Classic Burger', quantity: 2, unit_price_cents: 599, line_total_cents: 1198 },
    { menu_item_id: item(2), item_name: 'Fries', quantity: 1, unit_price_cents: 249, line_total_cents: 249 },
  ]);
  const payment = await db.query('select amount_cents, status, provider, card_brand, card_last4 from public.payments where order_id = $1', [orderId]);
  expect(payment.rows).toEqual([{ amount_cents: 1447, status: 'approved', provider: 'simulated', card_brand: 'Visa', card_last4: '4242' }]);
  // Read the receipt through PostgREST's foreign-key relationships.
  const receipt = await api.send('GET', {
    id: `eq.${orderId}`, select: '*,order_items(*),payments(*)',
  }, undefined, 'orders');
  expect(receipt.status()).toBe(200);
  const [body] = await receipt.json();
  expect(body.order_number).toBe(order.order_number);
  expect(body.order_items).toHaveLength(2);
  expect(body.payments).toMatchObject({ amount_cents: 1447, status: 'approved' });
});

for (const scenario of [
  { restaurant: 1, item: 1, coupon: 'SAVE10', subtotal: 1198, discount: 119 },
  { restaurant: 2, item: 5, coupon: 'CHICKEN15', subtotal: 1298, discount: 194 },
  { restaurant: 3, item: 8, coupon: 'KING10', subtotal: 1398, discount: 139 },
]) {
  test(`coupon ${scenario.coupon} discounts the matching restaurant order`, async ({ api, db, orderId }) => {
    const response = await api.send('POST', {}, checkout(orderId, {
      p_restaurant_id: restaurant(scenario.restaurant),
      p_items: [{ menu_item_id: item(scenario.item), quantity: 2 }], p_coupon_code: scenario.coupon,
    }), 'rpc/place_order');
    expect(response.status()).toBe(200);
    const order = await response.json();
    expect(order).toMatchObject({ status: 'paid', subtotal_cents: scenario.subtotal,
      discount_cents: scenario.discount, total_cents: scenario.subtotal - scenario.discount });
    expect(order.coupon_id).not.toBeNull();
    await assertStoredOrder(db, order);
    const result = await db.query('select amount_cents from public.payments where order_id = $1', [orderId]);
    expect(result.rows).toEqual([{ amount_cents: scenario.subtotal - scenario.discount }]);
  });
}

test('declined test card records a failed payment, not a paid order', async ({ api, db, orderId }) => {
  const response = await api.send('POST', {}, checkout(orderId, { p_test_card: 'test_card_declined' }), 'rpc/place_order');
  expect(response.status()).toBe(200);
  const order = await response.json();
  expect(order.status).toBe('payment_failed');
  await assertStoredOrder(db, order);
  const result = await db.query('select status, amount_cents from public.payments where order_id = $1', [orderId]);
  expect(result.rows).toEqual([{ status: 'declined', amount_cents: 1447 }]);
});

test('checkout ignores client-supplied prices and totals', async ({ api, db, orderId }) => {
  const response = await api.send('POST', {}, checkout(orderId, {
    p_items: [{ menu_item_id: item(1), quantity: 2, price_cents: 1, total_cents: 1 }],
  }), 'rpc/place_order');
  expect(response.status()).toBe(200);
  const order = await response.json();
  expect(order.total_cents).toBe(1198);
  await assertStoredOrder(db, order);
});

for (const [name, changes] of [
  ['expired coupon', { p_coupon_code: 'EXPIRED' }],
  ['disabled coupon', { p_coupon_code: 'DISABLED' }],
  ['unknown coupon', { p_coupon_code: 'NO_SUCH_COUPON' }],
  ['another restaurant coupon', { p_coupon_code: 'KING10' }],
  ['coupon below its minimum', { p_items: [{ menu_item_id: item(1), quantity: 1 }], p_coupon_code: 'SAVE10' }],
  ['unavailable item', { p_items: [{ menu_item_id: item(4), quantity: 1 }] }],
  ['another restaurant item', { p_items: [{ menu_item_id: item(5), quantity: 1 }] }],
  ['zero quantity', { p_items: [{ menu_item_id: item(1), quantity: 0 }] }],
  ['fractional quantity', { p_items: [{ menu_item_id: item(1), quantity: 1.5 }] }],
  ['empty cart', { p_items: [] }],
  ['duplicate items', { p_items: [{ menu_item_id: item(1), quantity: 1 }, { menu_item_id: item(1), quantity: 1 }] }],
  ['unsupported card token', { p_test_card: 'unknown_test_token' }],
]) {
  test(`reject ${name} without partial database records`, async ({ api, db, orderId }) => {
    const response = await api.send('POST', {}, checkout(orderId, changes), 'rpc/place_order');
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'P0001' });
    await assertNoOrder(db, orderId);
  });
}
