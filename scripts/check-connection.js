import { settings } from '../lib/config.js';
import { database } from '../lib/database.js';
import { apiClient } from '../lib/api.js';

let db, api;
try {
  const config = settings();
  db = database(config);
  api = await apiClient(config);
  await db.query('select id from public.pw_bookings limit 0');
  console.log('PostgreSQL: connected; pw_bookings is readable.');
  const response = await api.send('GET', { select: 'id', limit: 0 });
  if (response.status() !== 200) throw new Error(`REST API returned HTTP ${response.status()}`);
  console.log('REST API: connected; pw_bookings is accessible.');
  console.log('Ready: run npm test to check API/database consistency.');
} catch (error) {
  // Do not print raw database errors, which may contain connection details.
  console.error('Connection check failed. Confirm .env, project status, SQL setup, and SSL certificate.');
  if (error.code) console.error(`Error code: ${error.code}`);
  process.exitCode = 1;
} finally {
  await api?.dispose();
  await db?.end();
}
