import { test, expect, json, submit, receipt, assertOrder, counts, invalid } from '../support/restaurant.js';

test.describe('Concurrency and recovery @senior @regression', () => {
  test('two simultaneous submissions of the same UUID create one order/payment', async ({ api, db, sandbox }) => {
    const draft = sandbox.draft();
    const responses = await Promise.all([submit(api, draft), submit(api, draft)]);
    expect(responses.map(r=>r.status()).sort()).toEqual([200,409]);
    const winner = await json(responses.find(r=>r.status()===200));
    const conflict = await json(responses.find(r=>r.status()===409),409);
    expect(conflict.code).toBe('23505');
    await assertOrder(db, winner);
    expect(await counts(db, winner.id)).toEqual({ orders: 1, items: 1, payments: 1 });
  });

  test('independent concurrent buyers get unique order numbers and correct totals', async ({ api, db, sandbox }) => {
    const drafts = [1,2,3].map(quantity=>sandbox.draft({ p_items: [{ menu_item_id: sandbox.items[0].id, quantity }] }));
    const responses = await Promise.all(drafts.map(body=>submit(api,body)));
    const orders = await Promise.all(responses.map(r=>json(r)));
    expect(new Set(orders.map(o=>o.order_number)).size).toBe(3);
    for (let i=0;i<orders.length;i++) {
      expect(orders[i]).toMatchObject({ id: drafts[i].p_order_id, total_cents: (i+1)*100 });
      await assertOrder(db,orders[i]);
      expect(await counts(db,orders[i].id)).toEqual({ orders:1,items:1,payments:1 });
    }
  });

  test('lost response after commit: reconcile by UUID, then retry cannot duplicate payment', async ({ api, db, sandbox }) => {
    const draft = sandbox.draft();
    // Fault simulation at the client boundary: the server really commits, then the
    // client loses that response. This does not induce a real network timeout.
    const loseResponseAfterCommit = async () => {
      const response = await submit(api,draft);
      expect(response.status()).toBe(200);
      const error = new Error('Simulated response loss after server commit'); error.code='SIMULATED_RESPONSE_LOSS'; throw error;
    };
    await expect(loseResponseAfterCommit()).rejects.toMatchObject({ code:'SIMULATED_RESPONSE_LOSS' });
    let recovered;
    await expect.poll(async()=>{
      const rows=await json(await receipt(api,draft.p_order_id));
      recovered=rows[0];return rows.length;
    },{ timeout:5000, intervals:[100,250,500] }).toBe(1);
    expect(recovered).toMatchObject({ id:draft.p_order_id,status:'paid',total_cents:1000 });
    const retryError=await json(await submit(api,draft),409);
    expect(retryError.code).toBe('23505');
    const [unchanged]=await json(await receipt(api,draft.p_order_id));
    expect(unchanged.order_number).toBe(recovered.order_number);
    expect(await counts(db,draft.p_order_id)).toEqual({ orders:1,items:1,payments:1 });
  });

  test('a conflicting replay with a changed cart cannot overwrite the original order', async ({ api, db, sandbox }) => {
    const draft=sandbox.draft();const original=await json(await submit(api,draft));
    const replay={...draft,p_items:[{menu_item_id:sandbox.items[0].id,quantity:20}],p_coupon_code:'TEN'};
    const error=await json(await submit(api,replay),409);expect(error.code).toBe('23505');
    await assertOrder(db,original);
    const [view]=await json(await receipt(api,original.id));
    expect(view.order_items[0]).toMatchObject({quantity:10,line_total_cents:1000});
    expect(view.payments.amount_cents).toBe(1000);
  });

  test('failed validation rolls back so the same UUID can recover on a valid attempt', async ({ api, db, sandbox }) => {
    const draft=sandbox.draft({p_coupon_code:'EXPIRED'});await invalid(api,db,draft);
    const order=await json(await submit(api,{...draft,p_coupon_code:'TEN'}));
    expect(order.total_cents).toBe(900);await assertOrder(db,order);
    expect(await counts(db,order.id)).toEqual({orders:1,items:1,payments:1});
  });

  test('replaying a declined order with an approved token does not silently change its state', async ({ api, db, sandbox }) => {
    const draft=sandbox.draft({p_test_card:'test_card_declined'});
    const original=await json(await submit(api,draft));expect(original.status).toBe('payment_failed');
    const error=await json(await submit(api,{...draft,p_test_card:'test_card_approved'}),409);
    expect(error.code).toBe('23505');await assertOrder(db,original);
    const [view]=await json(await receipt(api,original.id));expect(view.payments.status).toBe('declined');
    expect(await counts(db,original.id)).toEqual({orders:1,items:1,payments:1});
  });

  test('a declined checkout does not poison a later fresh checkout', async ({ api, db, sandbox }) => {
    const failed=await json(await submit(api,sandbox.draft({p_test_card:'test_card_declined'})));
    const paid=await json(await submit(api,sandbox.draft()));
    expect(failed.status).toBe('payment_failed');expect(paid.status).toBe('paid');
    expect(failed.order_number).not.toBe(paid.order_number);
    await assertOrder(db,failed);await assertOrder(db,paid);
  });
});
