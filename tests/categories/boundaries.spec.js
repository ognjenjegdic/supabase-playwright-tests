import { test, expect, json, invalid, submit, assertOrder, receipt } from '../support/restaurant.js';

test.describe('Boundary value analysis @boundaries @regression', () => {
  for (const quantity of [-1, 0, 1, 2, 19, 20, 21, null, '1', 1.5]) {
    test(`quantity boundary/type ${JSON.stringify(quantity)}`, async ({ api, db, sandbox }) => {
      const body = sandbox.draft({ p_items: [{ menu_item_id: sandbox.items[0].id, quantity }] });
      if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 20) {
        const order = await json(await submit(api, body));
        expect(order.total_cents).toBe(quantity * 100); await assertOrder(db, order);
      } else await invalid(api, db, body);
    });
  }
  for (const size of [0, 1, 2, 19, 20, 21]) {
    test(`cart distinct-item boundary ${size}`, async ({ api, db, sandbox }) => {
      const selected = sandbox.items.slice(0, size);
      const body = sandbox.draft({ p_items: selected.map(i => ({ menu_item_id: i.id, quantity: 1 })) });
      if (size >= 1 && size <= 20) {
        const order = await json(await submit(api, body));
        expect(order.total_cents).toBe(selected.reduce((n,i)=>n+i.price_cents,0));
        const [view] = await json(await receipt(api, order.id)); expect(view.order_items).toHaveLength(size);
        await assertOrder(db, order);
      } else await invalid(api, db, body);
    });
  }
  for (const [subtotal, accepted] of [[999,false],[1000,true],[1001,true]]) {
    test(`coupon threshold subtotal ${subtotal} cents`, async ({ api, db, sandbox }) => {
      await json(await api.send('PATCH', { id: `eq.${sandbox.items[0].id}` }, { price_cents: subtotal }, 'menu_items'));
      const body = sandbox.draft({ p_items: [{ menu_item_id: sandbox.items[0].id, quantity: 1 }], p_coupon_code: 'TEN' });
      if (!accepted) return invalid(api, db, body);
      const order = await json(await submit(api, body));
      expect(order.discount_cents).toBe(Math.floor(subtotal * 10 / 100)); await assertOrder(db, order);
    });
  }
  for (const code of [null, '', '   ', ' ten ', 'tEn']) {
    test(`nullable/trimmed/case-insensitive coupon ${JSON.stringify(code)}`, async ({ api, db, sandbox }) => {
      const order = await json(await submit(api, sandbox.draft({ p_coupon_code: code })));
      expect(order.discount_cents).toBe(code?.trim() ? 100 : 0); await assertOrder(db, order);
    });
  }
  test('English menu names with Unicode symbols round-trip without corruption', async ({ api, db, sandbox }) => {
    const order = await json(await submit(api, sandbox.draft({ p_coupon_code: 'welcome10' })));
    const [body] = await json(await receipt(api, order.id));
    expect(body.order_items[0].item_name).toBe(sandbox.items[0].name);
    expect(body.order_items[0].item_name).toContain('Burger 🍔');
    expect(order.discount_cents).toBe(100); await assertOrder(db, order);
  });
  test('long unknown coupon is a business rejection, not a server failure', async ({ api, db, sandbox }) => {
    // No text-length limit is defined: this tests the unknown-code partition, not an invented max length.
    await invalid(api, db, sandbox.draft({ p_coupon_code: 'X'.repeat(10_000) }));
  });
  test('fractional-cent percentage discount rounds down once', async ({ api, db, sandbox }) => {
    const order = await json(await submit(api, sandbox.draft({ p_items: [{ menu_item_id: sandbox.items[1].id, quantity: 1 }], p_coupon_code: 'WELCOME10' })));
    expect(order).toMatchObject({ subtotal_cents: 199, discount_cents: 19, total_cents: 180 });
    await assertOrder(db, order);
  });
});
