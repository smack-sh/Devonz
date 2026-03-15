/**
 * Vercel Domains API
 *
 * Handles domain management for Vercel projects:
 * - List project domains
 * - Add custom subdomain
 * - Remove domain
 */

import { type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router';
import { externalFetch, handleApiError, resolveToken, unauthorizedResponse } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';

const VERCEL_API_BASE = 'https://api.vercel.com';

interface DomainRequest {
  /** Project ID */
  projectId: string;

  /** Action to perform */
  action: 'list' | 'add' | 'remove';

  /** Domain name (for add/remove) */
  domain?: string;
}

/**
 * Handle GET requests - list domains for a project
 */
async function vercelDomainsLoader({ request, context }: LoaderFunctionArgs) {
  const vercelToken = resolveToken(request, context, 'VITE_VERCEL_ACCESS_TOKEN');

  if (!vercelToken) {
    return unauthorizedResponse('Vercel');
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');

  if (!projectId) {
    return Response.json({ error: 'Project ID is required' }, { status: 400 });
  }

  return handleApiError('VercelDomains.loader', async () => {
    const response = await externalFetch({
      url: `${VERCEL_API_BASE}/v9/projects/${projectId}/domains`,
      token: vercelToken,
    });

    if (!response.ok) {
      const errorData = await response.json();

      return Response.json(
        {
          error: `Failed to fetch domains: ${response.status}`,
          details: errorData,
        },
        { status: response.status },
      );
    }

    const data = await response.json();

    return Response.json(data);
  });
}

/**
 * Handle POST requests - add or remove domains
 */
async function vercelDomainsAction({ request, context }: ActionFunctionArgs) {
  const vercelToken = resolveToken(request, context, 'VITE_VERCEL_ACCESS_TOKEN');

  if (!vercelToken) {
    return unauthorizedResponse('Vercel');
  }

  return handleApiError('VercelDomains.action', async () => {
    const body: DomainRequest = await request.json();
    const { projectId, action, domain } = body;

    if (!projectId) {
      return Response.json({ error: 'Project ID is required' }, { status: 400 });
    }

    if (action === 'add') {
      if (!domain) {
        return Response.json({ error: 'Domain name is required for add action' }, { status: 400 });
      }

      const response = await externalFetch({
        url: `${VERCEL_API_BASE}/v9/projects/${projectId}/domains`,
        token: vercelToken,
        method: 'POST',
        body: { name: domain },
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          return Response.json(
            {
              error: 'Domain already exists',
              details: data,
            },
            { status: 409 },
          );
        }

        if (response.status === 400) {
          const errorMessage =
            data?.error?.message || data?.message || 'Invalid domain name or domain already registered on another team';

          return Response.json(
            {
              error: errorMessage,
              details: data,
            },
            { status: 400 },
          );
        }

        return Response.json(
          {
            error: `Failed to add domain: ${response.status}`,
            details: data,
          },
          { status: response.status },
        );
      }

      return Response.json({ success: true, domain: data });
    }

    if (action === 'remove') {
      if (!domain) {
        return Response.json({ error: 'Domain name is required for remove action' }, { status: 400 });
      }

      const response = await externalFetch({
        url: `${VERCEL_API_BASE}/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}`,
        token: vercelToken,
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();

        return Response.json(
          {
            error: `Failed to remove domain: ${response.status}`,
            details: data,
          },
          { status: response.status },
        );
      }

      return Response.json({ success: true, removed: domain });
    }

    if (action === 'list') {
      const response = await externalFetch({
        url: `${VERCEL_API_BASE}/v9/projects/${projectId}/domains`,
        token: vercelToken,
      });

      if (!response.ok) {
        const errorData = await response.json();

        return Response.json(
          {
            error: `Failed to fetch domains: ${response.status}`,
            details: errorData,
          },
          { status: response.status },
        );
      }

      const data = await response.json();

      return Response.json(data);
    }

    return Response.json({ error: 'Invalid action. Use: list, add, or remove' }, { status: 400 });
  });
}

export const loader = withSecurity(vercelDomainsLoader, {
  rateLimit: true,
  allowedMethods: ['GET'],
});

export const action = withSecurity(vercelDomainsAction, {
  rateLimit: true,
  allowedMethods: ['POST'],
});
