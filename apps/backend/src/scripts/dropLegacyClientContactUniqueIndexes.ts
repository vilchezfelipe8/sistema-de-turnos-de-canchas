import 'dotenv/config';
import { Client } from 'pg';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL no está definido.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query('DROP INDEX IF EXISTS "Client_clubId_email_key";');
    await client.query('DROP INDEX IF EXISTS "Client_clubId_phone_key";');
    await client.query('DROP INDEX IF EXISTS "Client_clubId_dni_key";');
    await client.query('CREATE INDEX IF NOT EXISTS "Client_clubId_email_idx" ON "Client"("clubId", "email");');
    await client.query('CREATE INDEX IF NOT EXISTS "Client_clubId_phone_idx" ON "Client"("clubId", "phone");');
    await client.query('COMMIT');
    console.log('[ok] Índices legacy únicos de Client removidos/reemplazados.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[error] No se pudo ajustar índices de Client:', error);
  process.exit(1);
});

