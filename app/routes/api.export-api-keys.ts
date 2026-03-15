import { type LoaderFunctionArgs } from 'react-router';
import { getApiKeysFromCookie } from '~/lib/api/cookies';
import { withSecurity } from '~/lib/security';

async function exportApiKeysLoader({ request }: LoaderFunctionArgs) {
  /*
   * Only return API keys the user explicitly set via cookies.
   * Server-side environment variables (process.env, Cloudflare env) are
   * intentionally NOT exposed here to prevent leaking admin-configured
   * secrets to the client.
   */
  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);

  return Response.json(apiKeys);
}

export const loader = withSecurity(exportApiKeysLoader, {
  allowedMethods: ['GET'],
  rateLimit: false,
});
