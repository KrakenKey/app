/* eslint-disable */
import { Client } from 'pg';

function getEnv(key: string, fallback?: string) {
  return process.env[key] ?? fallback;
}

async function main() {
  const host = getEnv('TYPEORM_HOST', 'localhost');
  const port = parseInt(getEnv('TYPEORM_PORT', '5432')!, 10);
  const user = getEnv('TYPEORM_USERNAME', getEnv('DB_USER', 'postgres'))!;
  const password = getEnv('TYPEORM_PASSWORD', getEnv('DB_PASS', ''))!;
  const targetDb = getEnv('TYPEORM_DATABASE', getEnv('DB_NAME', 'krakenkey'))!;
  const adminDb = getEnv('ADMIN_DB', 'postgres');

  const client = new Client({ host, port, user, password, database: adminDb });

  try {
    await client.connect();

    const res = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [targetDb]);
    if (res.rowCount === 0) {
      console.log(`Database "${targetDb}" not found — creating...`);
      // Note: identifiers should be quoted to allow mixed-case names
      await client.query(`CREATE DATABASE "${targetDb}"`);
      console.log('Database created.');
    } else {
      console.log(`Database "${targetDb}" already exists.`);
    }
  } catch (err: any) {
    console.error('Failed to create or check database:', err?.message ?? err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
