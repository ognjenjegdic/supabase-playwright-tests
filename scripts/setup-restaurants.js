import { readFileSync } from 'node:fs';
import { settings } from '../lib/config.js';
import { database } from '../lib/database.js';

// Explicit one-time setup command; normal tests always use read-only SQL clients.
const db = database(settings(), { readOnly: false });
try {
  const sql = readFileSync(new URL('../supabase/restaurant-demo.sql', import.meta.url), 'utf8');
  await db.query(sql);
  console.log('Restaurant demo created: six tables, checkout RPC, three restaurants, menus, and coupons.');
} catch (error) {
  console.error('Restaurant setup failed. Existing-table conflicts are deliberate; do not rerun on an installed schema.');
  console.error('Error code:', error.code || 'connection error');
  process.exitCode = 1;
} finally {
  await db.end();
}
