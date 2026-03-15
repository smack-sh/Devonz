/// <reference types="vitest/globals" />
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import * as schema from '~/lib/.server/db/schema';

function createTestDb() {
  const client = createClient({ url: ':memory:' });
  return drizzle(client, { schema });
}

/**
 * Create all tables in an in-memory database using raw SQL that mirrors the
 * Drizzle schema definitions. This avoids relying on drizzle-kit migrations
 * in tests and stays in sync with the schema module.
 */
async function migrateTestDb(testDb: ReturnType<typeof createTestDb>) {
  await testDb.run(sql`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      url_id TEXT UNIQUE,
      description TEXT,
      timestamp TEXT,
      metadata TEXT,
      user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await testDb.run(sql`CREATE INDEX IF NOT EXISTS idx_chats_url_id ON chats(url_id)`);
  await testDb.run(sql`CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id)`);
  await testDb.run(sql`CREATE INDEX IF NOT EXISTS idx_chats_created_at ON chats(created_at)`);

  await testDb.run(sql`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      full_message TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await testDb.run(sql`CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id)`);
  await testDb.run(sql`CREATE INDEX IF NOT EXISTS idx_messages_sort_order ON messages(chat_id, sort_order)`);

  await testDb.run(sql`
    CREATE TABLE IF NOT EXISTS snapshots (
      chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
      snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/*
 * ---------------------------------------------------------------------------
 * Tests
 * ---------------------------------------------------------------------------
 */

describe('Database schema', () => {
  let testDb: ReturnType<typeof createTestDb>;

  beforeEach(async () => {
    testDb = createTestDb();
    await migrateTestDb(testDb);
  });

  it('schema exports chats, messages, and snapshots tables', () => {
    expect(schema.chats).toBeDefined();
    expect(schema.messages).toBeDefined();
    expect(schema.snapshots).toBeDefined();
  });

  it('inserts and retrieves a chat with all columns', async () => {
    const now = new Date().toISOString();

    await testDb.insert(schema.chats).values({
      id: 'chat-1',
      urlId: 'url-1',
      description: 'Test chat',
      timestamp: now,
      metadata: { gitUrl: 'https://github.com/test/repo' },
      userId: 'user-42',
      createdAt: now,
      updatedAt: now,
    });

    const rows = await testDb.select().from(schema.chats);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'chat-1',
      urlId: 'url-1',
      description: 'Test chat',
      userId: 'user-42',
    });
    expect(rows[0].metadata).toEqual({ gitUrl: 'https://github.com/test/repo' });
    expect(rows[0].createdAt).toBeTruthy();
    expect(rows[0].updatedAt).toBeTruthy();
  });

  it('inserts and retrieves messages linked to a chat', async () => {
    await testDb.insert(schema.chats).values({ id: 'chat-msg-1' });

    await testDb.insert(schema.messages).values({
      id: 'msg-1',
      chatId: 'chat-msg-1',
      role: 'user',
      content: 'Hello',
      sortOrder: 0,
    });

    await testDb.insert(schema.messages).values({
      id: 'msg-2',
      chatId: 'chat-msg-1',
      role: 'assistant',
      content: 'Hi there!',
      fullMessage: { id: 'msg-2', role: 'assistant', content: 'Hi there!', parts: [] },
      sortOrder: 1,
    });

    const rows = await testDb.select().from(schema.messages);

    expect(rows).toHaveLength(2);
    expect(rows[0].role).toBe('user');
    expect(rows[1].role).toBe('assistant');
    expect(rows[1].fullMessage).toEqual({
      id: 'msg-2',
      role: 'assistant',
      content: 'Hi there!',
      parts: [],
    });
  });

  it('inserts and retrieves a snapshot linked to a chat', async () => {
    await testDb.insert(schema.chats).values({ id: 'chat-snap-1' });

    const snapshotData = { chatIndex: '0', files: {}, summary: 'initial' };

    await testDb.insert(schema.snapshots).values({
      chatId: 'chat-snap-1',
      snapshot: snapshotData,
    });

    const rows = await testDb.select().from(schema.snapshots);

    expect(rows).toHaveLength(1);
    expect(rows[0].chatId).toBe('chat-snap-1');
    expect(rows[0].snapshot).toEqual(snapshotData);
  });
});

describe('Drizzle client initialization', () => {
  it('creates a working client with in-memory database', async () => {
    const testDb = createTestDb();

    // Simple raw query to verify the connection works
    const result = await testDb.run(sql`SELECT 1 as ok`);
    expect(result).toBeDefined();
  });
});
