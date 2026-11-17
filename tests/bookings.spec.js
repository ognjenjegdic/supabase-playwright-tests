import { test, expect } from './fixtures.js';
import { readBooking } from '../lib/database.js';

test('POST creates a booking matching the PostgreSQL row @smoke', async ({ api, db, booking }) => {
  const response = await api.send('POST', {}, booking);
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body).toEqual([booking]);
  expect(await readBooking(db, booking.id)).toEqual(body);
});

test('GET response matches the independently queried database row @smoke', async ({ api, db, savedBooking }) => {
  const response = await api.send('GET', { id: `eq.${savedBooking.id}`, select: '*' });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toEqual([savedBooking]);
  expect(await readBooking(db, savedBooking.id)).toEqual(body);
});

test('PATCH persists the changed fields and preserves the others', async ({ api, db, savedBooking }) => {
  const changes = { totalprice: 275, depositpaid: false, additionalneeds: 'Dinner' };
  const response = await api.send('PATCH', { id: `eq.${savedBooking.id}` }, changes);
  expect(response.status()).toBe(200);
  const expected = [{ ...savedBooking, ...changes }];
  expect(await response.json()).toEqual(expected);
  expect(await readBooking(db, savedBooking.id)).toEqual(expected);
  const get = await api.send('GET', { id: `eq.${savedBooking.id}` });
  expect(get.status()).toBe(200);
  expect(await get.json()).toEqual(expected);
});

test('DELETE removes the row from the API and PostgreSQL', async ({ api, db, savedBooking }) => {
  const response = await api.send('DELETE', { id: `eq.${savedBooking.id}` });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual([savedBooking]);
  expect(await readBooking(db, savedBooking.id)).toEqual([]);
  const get = await api.send('GET', { id: `eq.${savedBooking.id}` });
  expect(get.status()).toBe(200); // PostgREST filters return an empty array, not 404.
  expect(await get.json()).toEqual([]);
});

test('invalid price is rejected and no row is inserted', async ({ api, db, booking }) => {
  const response = await api.send('POST', {}, { ...booking, totalprice: -1 });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ code: '23514' });
  expect(await readBooking(db, booking.id)).toEqual([]);
});

test('invalid dates are rejected and no row is inserted', async ({ api, db, booking }) => {
  const response = await api.send('POST', {}, { ...booking, checkout: booking.checkin });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ code: '23514' });
  expect(await readBooking(db, booking.id)).toEqual([]);
});
