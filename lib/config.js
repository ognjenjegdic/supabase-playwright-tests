import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

export function settings() {
  const required = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'DATABASE_URL'];
  const missing = required.filter(name => !process.env[name] || /REPLACE_ME|YOUR_|ENCODED_PASSWORD/.test(process.env[name]));
  if (missing.length) throw new Error(`Configure ${missing.join(', ')} in .env. Follow README.md.`);
  const url = new URL(process.env.SUPABASE_URL);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.username || url.password) {
    throw new Error('SUPABASE_URL must be your HTTPS project endpoint on supabase.co.');
  }
  if (!process.env.SUPABASE_SECRET_KEY.startsWith('sb_secret_')) {
    throw new Error('Use a Supabase sb_secret_ key from Settings > API Keys > Secret keys.');
  }
  return {
    url: url.origin,
    key: process.env.SUPABASE_SECRET_KEY,
    databaseUrl: process.env.DATABASE_URL,
    caPath: process.env.DATABASE_CA_PATH,
  };
}
