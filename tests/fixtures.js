import { test as base, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { settings } from '../lib/config.js';
import { apiClient } from '../lib/api.js';
import { database } from '../lib/database.js';

export function bookingData() {
  return {
    id: randomUUID(), firstname: 'Playwright', lastname: 'Tester',
    totalprice: 150, depositpaid: true,
    checkin: '2027-05-10', checkout: '2027-05-15', additionalneeds: 'Breakfast',
  };
}

export const test = base.extend({
  api: async ({}, use) => {
    const api = await apiClient(settings());
    try { await use(api); } finally { await api.dispose(); }
  },
  db: async ({}, use) => {
    const db = database(settings());
    try { await use(db); } finally { await db.end(); }
  },
  booking: async ({ api }, use) => {
    const data = bookingData();
    try {
      await use(data);
    } finally {
      // UUID is allocated before POST, so cleanup runs even after a failed POST assertion.
      const response = await api.send('DELETE', { id: `eq.${data.id}` });
      expect(response.status(), 'Cleanup DELETE must succeed').toBe(200);
    }
  },
  savedBooking: async ({ api, booking }, use) => {
    const response = await api.send('POST', {}, booking);
    expect(response.status()).toBe(201);
    expect(await response.json()).toEqual([booking]);
    await use(booking);
  },
});
export { expect };
