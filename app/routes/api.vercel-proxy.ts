/**
 * Vercel API Proxy
 *
 * A flexible proxy that routes all Vercel API requests through the server
 * to bypass CORS restrictions. This is necessary because Vercel's API
 * doesn't allow browser-based requests with custom headers.
 *
 * Usage:
 *   POST /api/vercel-proxy
 *   Body: { endpoint: '/v2/user', method: 'GET', body?: object }
 *
 * The proxy will:
 * 1. Get the Vercel token from cookies or Authorization header
 * 2. Make the request to Vercel API server-side
 * 3. Return the response to the client
 */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/node';
import { externalFetch, handleApiError, resolveToken, unauthorizedResponse } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';

const VERCEL_API_BASE = 'https://api.vercel.com';

interface ProxyRequest {
  /** Vercel API endpoint path (e.g., '/v2/user', '/v9/projects') */
  endpoint: string;

  /** HTTP method */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

  /** Request body for POST/PUT/PATCH */
  body?: Record<string, unknown>;

  /** Query parameters */
  params?: Record<string, string>;
}

/**
 * Handle GET requests - simple user info endpoint
 */
async function vercelProxyLoader({ request, context }: LoaderFunctionArgs) {
  const vercelToken = resolveToken(request, context, 'VITE_VERCEL_ACCESS_TOKEN');

  if (!vercelToken) {
    return unauthorizedResponse('Vercel');
  }

  return handleApiError('VercelProxy.loader', async () => {
    const response = await externalFetch({
      url: `${VERCEL_API_BASE}/v2/user`,
      token: vercelToken,
    });

    if (!response.ok) {
      const errorText = await response.text();

      return json(
        {
          error: `Vercel API error: ${response.status}`,
          details: errorText,
        },
        { status: response.status },
      );
    }

    const data = await response.json();

    return json(data);
  });
}

/**
 * Handle POST requests - flexible proxy for any Vercel API endpoint
 */
async function vercelProxyAction({ request, context }: ActionFunctionArgs) {
  const vercelToken = resolveToken(request, context, 'VITE_VERCEL_ACCESS_TOKEN');

  if (!vercelToken) {
    return unauthorizedResponse('Vercel');
  }

  return handleApiError('VercelProxy.action', async () => {
    const proxyRequest: ProxyRequest = await request.json();
    const { endpoint, method = 'GET', body, params } = proxyRequest;

    if (!endpoint) {
      return json({ error: 'Missing endpoint in request body' }, { status: 400 });
    }

    let url = `${VERCEL_API_BASE}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

    if (params && Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    const fetchOptions: RequestInit = {
      method,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        'User-Agent': 'devonz-app',
        'Content-Type': 'application/json',
      },
    };

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    const contentType = response.headers.get('content-type');
    let responseData: unknown;

    if (contentType?.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    if (!response.ok) {
      return json(
        {
          error: `Vercel API error: ${response.status}`,
          details: responseData,
        },
        { status: response.status },
      );
    }

    return json(responseData);
  });
}

export const loader = withSecurity(vercelProxyLoader, {
  rateLimit: true,
  allowedMethods: ['GET'],
});

export const action = withSecurity(vercelProxyAction, {
  rateLimit: true,
  allowedMethods: ['POST'],
});
