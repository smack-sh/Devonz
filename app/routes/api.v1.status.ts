import type { LoaderFunctionArgs } from 'react-router';
import { withSecurity } from '~/lib/security';
import { requireApiAuth } from '~/lib/.server/api/auth';
import type { V1StatusResponse } from '~/lib/.server/api/types';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('API');

const API_VERSION = '1.0.0';

async function statusLoader(_args: LoaderFunctionArgs): Promise<Response> {
  logger.debug('GET /api/v1/status');

  const body: V1StatusResponse = {
    status: 'ok',
    version: API_VERSION,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const loader = withSecurity(requireApiAuth(statusLoader), {
  allowedMethods: ['GET'],
  rateLimit: false, // rate limiting is handled by requireApiAuth (separate API pool)
});
