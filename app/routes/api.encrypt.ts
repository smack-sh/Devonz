import type { ActionFunctionArgs } from 'react-router';
import { z } from 'zod';
import { encrypt } from '~/lib/.server/encryption';
import { withSecurity } from '~/lib/security';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.encrypt');

const encryptRequestSchema = z.object({
  value: z.string().min(1, 'Value is required'),
});

async function encryptAction({ request }: ActionFunctionArgs) {
  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  const parsed = encryptRequestSchema.safeParse(rawBody);

  if (!parsed.success) {
    logger.warn('Encrypt request validation failed:', parsed.error.issues);

    return Response.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  try {
    const encrypted = `enc:${encrypt(parsed.data.value)}`;
    return Response.json({ encrypted });
  } catch (error) {
    logger.error('Encryption failed:', error);
    return Response.json({ error: 'Encryption failed' }, { status: 500 });
  }
}

export const action = withSecurity(encryptAction, {
  allowedMethods: ['POST'],
});
