import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './app/lib/.server/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DEVONZ_DB_PATH
      ? process.env.DEVONZ_DB_PATH.startsWith('file:')
        ? process.env.DEVONZ_DB_PATH
        : `file:${process.env.DEVONZ_DB_PATH}`
      : 'file:./data/devonz.db',
  },
});
