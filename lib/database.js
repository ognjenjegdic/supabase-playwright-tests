import pg from 'pg';
import { readFileSync } from 'node:fs';

export function database(config) {
  const url = new URL(config.databaseUrl);
  // Keep SSL validation in our explicit SSL object, not URL overrides.
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(key);
  return new pg.Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ...(config.caPath ? { ca: readFileSync(config.caPath, 'utf8') } : {}) },
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    query_timeout: 10_000,
    statement_timeout: 10_000,
    // DB checks are read-only. Test data mutations go through the API.
    options: '-c default_transaction_read_only=on',
  });
}

export async function readBooking(db, id) {
  const { rows } = await db.query(`
    select id, firstname, lastname, totalprice, depositpaid,
           to_char(checkin, 'YYYY-MM-DD') as checkin,
           to_char(checkout, 'YYYY-MM-DD') as checkout, additionalneeds
    from public.pw_bookings where id = $1
  `, [id]);
  return rows;
}
