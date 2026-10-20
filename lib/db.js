import pg from 'pg';
import { readFileSync } from 'node:fs';

const ca = readFileSync(new URL('./supabase-prod-ca.crt', import.meta.url), 'utf8');

export async function withKittyDatabase(run) {
  if (!process.env.KITTY_DB_PASSWORD) throw new Error('database_unconfigured');
  const client = new pg.Client({
    host: 'aws-0-ap-south-1.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres.idjtoxhcrkqkmhzqgrqo',
    password: process.env.KITTY_DB_PASSWORD,
    ssl: { ca, rejectUnauthorized: true },
    application_name: 'kitty-vercel',
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 5500,
  });
  try {
    await client.connect();
    return await run(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export async function kittyDatabaseReady() {
  return withKittyDatabase(async client => {
    const { rows } = await client.query("select to_regclass('kitty_private.members') is not null as members, to_regclass('grasany_ops.heartbeat') is not null as heartbeat");
    return rows[0]?.members === true && rows[0]?.heartbeat === true;
  });
}
