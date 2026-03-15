import path from 'node:path';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { createScopedLogger } from '~/utils/logger';
import { resolveDbUrl } from './resolve-db-url';
import * as schema from './schema';

const logger = createScopedLogger('Database');

const url = resolveDbUrl();

logger.info(`Initializing SQLite database at ${url}`);

const client = createClient({ url });

export const db = drizzle(client, { schema });

// Auto-run migrations to ensure tables exist
const migrationsFolder = path.resolve(process.cwd(), 'drizzle');

try {
  await migrate(db, { migrationsFolder });
  logger.info('Database migrations applied successfully');
} catch (err) {
  logger.error('Failed to apply database migrations:', err);
  throw err;
}

export { schema };
