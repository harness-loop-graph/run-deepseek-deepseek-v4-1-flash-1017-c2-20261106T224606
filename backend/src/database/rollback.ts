import { Pool } from 'pg';
import { loadConfig } from '../config/config';
import { migrations } from './migrations';

/**
 * Reverts the last `count` applied migrations in reverse order using each
 * migration's `down` statements (RF-02). Run it against the same database the
 * backend uses:
 *
 *   node dist/database/rollback.js 1
 *
 * The schema is only ever changed by migrations: this script never touches
 * tables that no migration created.
 */
export async function rollbackLast(pool: Pool, count: number): Promise<string[]> {
  const applied = await pool.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY aplicada_en DESC, version DESC',
  );
  const appliedVersions = applied.rows.map((row) => row.version);
  const reverted: string[] = [];

  for (const migration of [...migrations].reverse()) {
    if (reverted.length >= count) {
      break;
    }
    if (!appliedVersions.includes(migration.version)) {
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const statement of migration.down) {
        await client.query(statement);
      }
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [migration.version]);
      await client.query('COMMIT');
      reverted.push(migration.version);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  return reverted;
}

async function main(): Promise<void> {
  const requested = Number.parseInt(process.argv[2] ?? '1', 10);
  const count = Number.isInteger(requested) && requested > 0 ? requested : 1;
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
  try {
    const reverted = await rollbackLast(pool, count);
    if (reverted.length === 0) {
      process.stdout.write('No applied migration to revert\n');
      return;
    }
    process.stdout.write(`Reverted ${reverted.join(', ')}\n`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`Rollback failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
