import { type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '~/lib/.server/db';
import { withSecurity } from '~/lib/security';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.db.chats.$id');

const idParamSchema = z.string().min(1, 'Chat ID is required');

/*
 * ---------------------------------------------------------------------------
 * GET  /api/db/chats/:id — single chat with messages + snapshot
 * ---------------------------------------------------------------------------
 */

async function chatByIdLoader({ params }: LoaderFunctionArgs) {
  const parsed = idParamSchema.safeParse(params.id);

  if (!parsed.success) {
    return Response.json({ error: 'Invalid chat ID' }, { status: 400 });
  }

  const chatId = parsed.data;

  const [chatRows, messageRows, snapshotRows] = await Promise.all([
    db.select().from(schema.chats).where(eq(schema.chats.id, chatId)).limit(1),
    db.select().from(schema.messages).where(eq(schema.messages.chatId, chatId)).orderBy(schema.messages.sortOrder),
    db.select().from(schema.snapshots).where(eq(schema.snapshots.chatId, chatId)).limit(1),
  ]);

  const chat = chatRows[0];

  if (!chat) {
    return Response.json({ error: 'Chat not found' }, { status: 404 });
  }

  logger.debug(`Returning chat ${chatId} with ${messageRows.length} messages`);

  return Response.json({
    chat: {
      ...chat,
      messages: messageRows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        ...(m.fullMessage ? (m.fullMessage as Record<string, unknown>) : {}),
      })),
      snapshot: snapshotRows[0]?.snapshot ?? null,
    },
  });
}

/*
 * ---------------------------------------------------------------------------
 * DELETE /api/db/chats/:id — delete a single chat (cascades to messages + snapshots)
 * ---------------------------------------------------------------------------
 */

async function chatByIdAction({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'DELETE') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const parsed = idParamSchema.safeParse(params.id);

  if (!parsed.success) {
    return Response.json({ error: 'Invalid chat ID' }, { status: 400 });
  }

  const chatId = parsed.data;

  // Verify chat exists before deleting
  const existing = await db
    .select({ id: schema.chats.id })
    .from(schema.chats)
    .where(eq(schema.chats.id, chatId))
    .limit(1);

  if (existing.length === 0) {
    return Response.json({ error: 'Chat not found' }, { status: 404 });
  }

  // Messages and snapshots cascade-delete via FK constraints
  await db.delete(schema.chats).where(eq(schema.chats.id, chatId));

  logger.info(`Deleted chat ${chatId}`);

  return Response.json({ deleted: true, id: chatId });
}

/*
 * ---------------------------------------------------------------------------
 * Exports — withSecurity wrapper
 * ---------------------------------------------------------------------------
 */

export const loader = withSecurity(chatByIdLoader, {
  allowedMethods: ['GET'],
});

export const action = withSecurity(chatByIdAction, {
  allowedMethods: ['DELETE'],
});
