import { type LoaderFunctionArgs } from 'react-router';
import { LLMManager } from '~/lib/modules/llm/manager';
import { getApiKeysFromCookie } from '~/lib/api/cookies';
import { withSecurity } from '~/lib/security';

/**
 * Bulk endpoint to check which cloud providers have server-side env keys configured.
 * Returns a map of provider names to their env key status.
 * This only checks server-side env vars (not cookie keys) so the frontend
 * can distinguish between user-entered keys and server-configured keys.
 */
async function checkEnvKeysLoader({ context, request }: LoaderFunctionArgs) {
  const llmManager = LLMManager.getInstance(context?.cloudflare?.env ?? {});
  const providers = llmManager.getAllProviders();
  const cookieHeader = request.headers.get('Cookie');
  const cookieKeys = getApiKeysFromCookie(cookieHeader);

  const result: Record<string, { hasEnvKey: boolean; hasCookieKey: boolean }> = {};

  for (const provider of providers) {
    const tokenKey = provider.config.apiTokenKey;
    const providerName = provider.name;

    // Check server-side env vars only (not cookie)
    const hasEnvKey = tokenKey
      ? !!(
          (context?.cloudflare?.env as Record<string, any>)?.[tokenKey] ||
          process.env[tokenKey] ||
          llmManager.env[tokenKey]
        )
      : false;

    // Check cookie key
    const hasCookieKey = !!cookieKeys?.[providerName]?.trim();

    result[providerName] = { hasEnvKey, hasCookieKey };
  }

  return Response.json(result);
}

export const loader = withSecurity(checkEnvKeysLoader, {
  allowedMethods: ['GET'],
  rateLimit: false,
});
