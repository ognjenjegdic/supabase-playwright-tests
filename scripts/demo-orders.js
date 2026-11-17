import { settings } from '../lib/config.js';
import { apiClient } from '../lib/api.js';

const api = await apiClient(settings());
try {
  for (const sample of [
    { n: 1, item: 1, coupon: 'SAVE10', card: 'test_card_approved' },
    { n: 2, item: 5, coupon: 'CHICKEN15', card: 'test_card_approved' },
    { n: 3, item: 8, coupon: null, card: 'test_card_declined' },
  ]) {
    const id = `40000000-0000-4000-8000-${String(sample.n).padStart(12, '0')}`;
    const existing = await api.send('GET', { id: `eq.${id}` }, undefined, 'orders');
    if (existing.status() !== 200) throw new Error('Cannot check sample orders.');
    let [order] = await existing.json();
    if (!order) {
      const response = await api.send('POST', {}, {
        p_order_id: id,
        p_restaurant_id: `10000000-0000-4000-8000-${String(sample.n).padStart(12, '0')}`,
        p_items: [{ menu_item_id: `20000000-0000-4000-8000-${String(sample.item).padStart(12, '0')}`, quantity: 2 }],
        p_coupon_code: sample.coupon, p_test_card: sample.card,
      }, 'rpc/place_order');
      if (response.status() !== 200) throw new Error(`Sample checkout failed: HTTP ${response.status()}`);
      order = await response.json();
    }
    console.log(`Sample order #${order.order_number}: ${order.status}; ${order.currency} ${(order.total_cents / 100).toFixed(2)}`);
  }
} catch {
  console.error('Could not create sample orders. Check the restaurant setup and connection.');
  process.exitCode = 1;
} finally {
  await api.dispose();
}
