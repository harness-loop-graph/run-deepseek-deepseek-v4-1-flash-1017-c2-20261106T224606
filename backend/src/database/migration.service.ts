import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { migrations } from './migrations';
import { runSeed } from './seed';

@Injectable()
export class MigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MigrationService.name);

  constructor(private readonly db: DatabaseService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.migrate();
    await runSeed(this.db);
  }

  async migrate(): Promise<void> {
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version text PRIMARY KEY,
         descripcion text NOT NULL,
         aplicada_en timestamptz NOT NULL DEFAULT now()
       )`,
    );

    for (const migration of migrations) {
      const existing = await this.db.query<{ version: string }>(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [migration.version],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        continue;
      }
      await this.db.transaction(async (client) => {
        for (const statement of migration.up) {
          await client.query(statement);
        }
        await client.query(
          'INSERT INTO schema_migrations (version, descripcion) VALUES ($1, $2)',
          [migration.version, migration.description],
        );
      });
      this.logger.log(`Applied migration ${migration.version}`);
    }
  }
}
