import { type ActionFunctionArgs } from 'react-router';
import { z } from 'zod';
import { db, schema } from '~/lib/.server/db';
import { withSecurity } from '~/lib/security';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.db.migrate');

const BATCH_SIZE = 50;

/*
 * ---------------------------------------------------------------------------
 * Zod schemas — validate IndexedDB export format
 * ---------------------------------------------------------------------------
 */

const messageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
});

const chatMetadataSchema = z
  .object({
    gitUrl: z.string(),
    gitBranch: z.string().optional(),
    netlifySiteId: z.string().optional(),
  })
  .optional()
  .nullable();

const chatSchema = z.object({
  id: z.string().min(1),
  urlId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  timestamp: z.string().optional().nullable(),
  messages: z.array(z.any()).default([]),
  metadata: chatMetadataSchema,
});

const snapshotSchema = z.object({
  chatId: z.string().min(1),
  snapshot: z.any(),
});

const migrationPayloadSchema = z.object({
  chats: z.array(chatSchema),
  snapshots: z.array(snapshotSchema).default([]),
});

/*
 * ---------------------------------------------------------------------------
 * POST /api/db/migrate — bulk-import IndexedDB data into SQLite
 * ---------------------------------------------------------------------------
 */

async function migrateAction({ request }: ActionFunctionArgs) {
  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  const parsed = migrationPayloadSchema.safeParse(rawBody);

  if (!parsed.success) {
    logger.warn('Migration payload validation failed:', parsed.error.issues);

    return Response.json(
      {
        error: 'Invalid migration payload',
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const { chats, snapshots } = parsed.data;

  if (chats.length === 0) {
    return Response.json({
      migrated: { chats: 0, messages: 0, snapshots: 0 },
      skipped: [],
      total: 0,
    });
  }

  const now = new Date().toISOString();
  let migratedChats = 0;
  let migratedMessages = 0;
  let migratedSnapshots = 0;
  const skipped: Array<{ chatId: string; reason: string }> = [];

  // Process chats in batches
  const totalBatches = Math.ceil(chats.length / BATCH_SIZE);

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batch = chats.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);

    for (const chat of batch) {
      try {
        // Insert chat row (upsert: skip if already exists)
        await db
          .insert(schema.chats)
          .values({
            id: chat.id,
            urlId: chat.urlId ?? null,
            description: chat.description ?? null,
            timestamp: chat.timestamp ?? now,
            metadata: chat.metadata ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();

        migratedChats++;

        // Insert messages for this chat
        const rawMessages = Array.isArray(chat.messages) ? chat.messages : [];

        for (let i = 0; i < rawMessages.length; i++) {
          const msg = rawMessages[i];
          const parsedMsg = messageSchema.safeParse(msg);

          if (!parsedMsg.success) {
            // Skip malformed messages but continue with valid ones
            logger.warn(`Skipping malformed message in chat ${chat.id} at index ${i}`);
            continue;
          }

          await db
            .insert(schema.messages)
            .values({
              id: parsedMsg.data.id,
              chatId: chat.id,
              role: parsedMsg.data.role,
              content: parsedMsg.data.content,
              fullMessage: msg,
              sortOrder: i,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing();

          migratedMessages++;
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Unknown error';
        logger.error(`Failed to migrate chat ${chat.id}:`, err);
        skipped.push({ chatId: chat.id, reason });
        migratedChats--; // undo the optimistic increment
      }
    }
  }

  // Process snapshots
  for (const snap of snapshots) {
    try {
      const parsedSnap = snapshotSchema.safeParse(snap);

      if (!parsedSnap.success) {
        logger.warn(`Skipping malformed snapshot for chatId ${snap?.chatId}`);
        continue;
      }

      await db
        .insert(schema.snapshots)
        .values({
          chatId: parsedSnap.data.chatId,
          snapshot: parsedSnap.data.snapshot,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();

      migratedSnapshots++;
    } catch (err) {
      logger.warn(`Failed to migrate snapshot for chat ${snap?.chatId}:`, err);
    }
  }

  logger.info(
    `Migration complete: ${migratedChats} chats, ${migratedMessages} messages, ${migratedSnapshots} snapshots. ${skipped.length} skipped.`,
  );

  return Response.json({
    migrated: {
      chats: migratedChats,
      messages: migratedMessages,
      snapshots: migratedSnapshots,
    },
    skipped,
    total: chats.length,
  });
}

/*
 * ---------------------------------------------------------------------------
 * Export — withSecurity wrapper
 * ---------------------------------------------------------------------------
 */

export const action = withSecurity(migrateAction, {
  allowedMethods: ['POST'],
});
