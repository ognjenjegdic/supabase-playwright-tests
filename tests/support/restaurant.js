import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { request } from '@playwright/test';
import { test as base, expect } from '../fixtures.js';
import { settings } from '../../lib/config.js';
import { assertSchema } from './schema.js';

export const test = base.extend({
  sandbox: async ({ api }, use) => {
    const restaurant = { id: randomUUID(), name: `QA restaurant ${randomUUID()}`, currency: 'USD', active: true };
    const items = Array.from({ length: 22 }, (_, i) => ({
      id: randomUUID(), restaurant_id: restaurant.id,
      name: `${i === 0 ? 'Бургер 🍔' : `Item ${i}`} ${randomUUID()}`,
      category: i % 3 === 0 ? 'main' : i % 3 === 1 ? 'side' : 'drink',
      price_cents: i === 1 ? 199 : 100, available: i < 21,
    }));
    const coupons = [
      { code: 'TEN', percent_off: 10, minimum_cents: 1000, active: true, expires_at: '2099-01-01T00:00:00Z' },
      { code: 'EXPIRED', percent_off: 10, minimum_cents: 0, active: true, expires_at: '2020-01-01T00:00:00Z' },
      { code: 'DISABLED', percent_off: 10, minimum_cents: 0, active: false, expires_at: '2099-01-01T00:00:00Z' },
      { code: 'ПОПУСТ10', percent_off: 10, minimum_cents: 0, active: true, expires_at: '2099-01-01T00:00:00Z' },
    ].map(c => ({ id: randomUUID(), restaurant_id: restaurant.id, ...c }));
    const orderIds = new Set();
    const sandbox = {
      restaurant, items, coupons,
      draft(overrides = {}) {
        const id = randomUUID();
        orderIds.add(id);
        const body = {
          p_order_id: id, p_restaurant_id: restaurant.id,
          p_items: [{ menu_item_id: items[0].id, quantity: 10 }],
          p_coupon_code: null, p_test_card: 'test_card_approved', ...overrides,
        };
        // Track overridden UUIDs too, while leaving malformed IDs to negative tests.
        if (/^[0-9a-f-]{36}$/i.test(body.p_order_id || '')) orderIds.add(body.p_order_id);
        return body;
      },
    };
    try {
      await json(await api.send('POST', {}, restaurant, 'restaurants'), 201);
      await json(await api.send('POST', {}, items, 'menu_items'), 201);
      await json(await api.send('POST', {}, coupons, 'coupons'), 201);
      await use(sandbox);
    } finally {
      // No seed/shared records are modified or deleted. IDs exist before requests.
      const cleanups = [];
      if (orderIds.size) cleanups.push(['orders', { id: `in.(${[...orderIds].join(',')})` }]);
      cleanups.push(['coupons', { restaurant_id: `eq.${restaurant.id}` }],
        ['menu_items', { restaurant_id: `eq.${restaurant.id}` }], ['restaurants', { id: `eq.${restaurant.id}` }]);
      const failed = [];
      for (const [resource, params] of cleanups) {
        try { const r = await api.send('DELETE', params, undefined, resource); if (r.status() !== 200) failed.push(resource); }
        catch { failed.push(resource); }
      }
      expect(failed, 'Cleanup failed for owned test resources').toEqual([]);
    }
  },
});
export { expect, assertSchema };

export async function json(response, expectedStatus = 200) {
  expect(response.status()).toBe(expectedStatus);
  expect(response.headers()['content-type']).toContain('application/json');
  return response.json();
}
export const submit = (api, body) => api.send('POST', {}, body, 'rpc/place_order');
export const receipt = (api, id) => api.send('GET', { id: `eq.${id}`, select: '*,order_items(*),payments(*)' }, undefined, 'orders');

export async function counts(db, id) {
  const { rows } = await db.query(`select
    (select count(*)::integer from public.orders where id=$1) as orders,
    (select count(*)::integer from public.order_items where order_id=$1) as items,
    (select count(*)::integer from public.payments where order_id=$1) as payments`, [id]);
  return rows[0];
}
export async function noOrder(db, id) {
  expect(await counts(db, id)).toEqual({ orders: 0, items: 0, payments: 0 });
}
export async function assertOrder(db, order) {
  assertSchema('Order', order);
  const { rows } = await db.query('select to_jsonb(o) as value from public.orders o where id=$1', [order.id]);
  expect(rows.map(r => r.value)).toEqual([order]);
}
export async function invalid(api, db, body, expectedCode = 'P0001', status = 400) {
  const error = await json(await submit(api, body), status);
  assertSchema('Error', error);
  expect(error.code).toBe(expectedCode);
  if (/^[0-9a-f-]{36}$/i.test(body.p_order_id || '')) await noOrder(db, body.p_order_id);
  return error;
}

export async function untrustedClient(headers = {}) {
  const context = await request.newContext({ baseURL: settings().url, timeout: 15_000,
    extraHTTPHeaders: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers } });
  return {
    async send(method, resource, data, params = {}) {
      try { return await context.fetch(`/rest/v1/${resource}`, { method, params, data, maxRedirects: 0 }); }
      catch { throw new Error('Unauthenticated request failed at transport level; header details suppressed.'); }
    },
    dispose: () => context.dispose(),
  };
}
export async function measure(call) {
  const start = performance.now();
  const response = await call();
  return { response, elapsedMs: performance.now() - start };
}
