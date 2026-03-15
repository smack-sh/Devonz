import { type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router';
import { eq, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '~/lib/.server/db';
import { withSecurity } from '~/lib/security';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.db.chats');

/*
 * ---------------------------------------------------------------------------
 * Zod schemas
 * ---------------------------------------------------------------------------
 */

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const createChatSchema = z.object({
  id: z.string().min(1, 'id is required'),
  urlId: z.string().optional(),
  description: z.string().optional(),
  timestamp: z.string().optional(),
  metadata: z
    .object({
      gitUrl: z.string(),
      gitBranch: z.string().optional(),
      netlifySiteId: z.string().optional(),
    })
    .optional(),
});

/*
 * ---------------------------------------------------------------------------
 * GET  /api/db/chats — paginated chat list
 * ---------------------------------------------------------------------------
 */

async function chatsLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const parsed = paginationSchema.safeParse({
    page: url.searchParams.get('page') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: 'Invalid pagination parameters', details: parsed.error.issues }, { status: 400 });
  }

  const { page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const [rows, countResult] = await Promise.all([
    db.select().from(schema.chats).orderBy(desc(schema.chats.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(schema.chats),
  ]);

  const total = countResult[0]?.count ?? 0;

  logger.debug(`Returning ${rows.length} chats (page ${page}, total ${total})`);

  return Response.json({
    chats: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

/*
 * ---------------------------------------------------------------------------
 * POST /api/db/chats — create a new chat
 * ---------------------------------------------------------------------------
 */

async function chatsAction({ request }: ActionFunctionArgs) {
  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  const parsed = createChatSchema.safeParse(rawBody);

  if (!parsed.success) {
    logger.warn('Chat creation validation failed:', parsed.error.issues);

    return Response.json(
      {
        error: 'Invalid request',
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const { id, urlId, description, timestamp, metadata } = parsed.data;

  const now = new Date().toISOString();

  await db.insert(schema.chats).values({
    id,
    urlId: urlId ?? null,
    description: description ?? null,
    timestamp: timestamp ?? now,
    metadata: metadata ?? null,
    createdAt: now,
    updatedAt: now,
  });

  logger.info(`Created chat ${id}`);

  const created = await db.select().from(schema.chats).where(eq(schema.chats.id, id)).limit(1);

  return Response.json({ chat: created[0] }, { status: 201 });
}

/*
 * ---------------------------------------------------------------------------
 * DELETE /api/db/chats — bulk delete all chats
 * ---------------------------------------------------------------------------
 */

async function handleChatsAction({ request }: ActionFunctionArgs) {
  if (request.method === 'DELETE') {
    return bulkDeleteChats();
  }

  return chatsAction({ request } as ActionFunctionArgs);
}

async function bulkDeleteChats() {
  /*
   * Delete in dependency order: snapshots → messages → chats
   * (FK cascade handles this automatically, but being explicit for clarity)
   */
  await db.delete(schema.chats);

  logger.info('Deleted all chats (bulk delete)');

  return Response.json({ deleted: true });
}

/*
 * ---------------------------------------------------------------------------
 * Exports — withSecurity wrapper
 * ---------------------------------------------------------------------------
 */

export const loader = withSecurity(chatsLoader, {
  allowedMethods: ['GET'],
});

export const action = withSecurity(handleChatsAction, {
  allowedMethods: ['POST', 'DELETE'],
});
