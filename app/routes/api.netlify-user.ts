import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from '@remix-run/node';
import { ApiError, resolveToken, unauthorizedResponse, externalFetch, handleApiError } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';

const NETLIFY_TOKEN_KEYS = ['VITE_NETLIFY_ACCESS_TOKEN'];

async function netlifyUserLoader({ request, context }: LoaderFunctionArgs) {
  return handleApiError('NetlifyUser', async () => {
    const token = resolveToken(request, context, ...NETLIFY_TOKEN_KEYS);

    if (!token) {
      return unauthorizedResponse('Netlify');
    }

    const response = await externalFetch({ url: 'https://api.netlify.com/api/v1/user', token });

    if (!response.ok) {
      if (response.status === 401) {
        return json({ error: 'Invalid Netlify token' }, { status: 401 });
      }

      throw new ApiError(`Netlify API error: ${response.status}`, response.status);
    }

    const userData = (await response.json()) as {
      id: string;
      name: string | null;
      email: string;
      avatar_url: string | null;
      full_name: string | null;
    };

    return json({
      id: userData.id,
      name: userData.name,
      email: userData.email,
      avatar_url: userData.avatar_url,
      full_name: userData.full_name,
    });
  });
}

export const loader = withSecurity(netlifyUserLoader, {
  rateLimit: true,
  allowedMethods: ['GET'],
});

async function netlifyUserAction({ request, context }: ActionFunctionArgs) {
  return handleApiError('NetlifyUser', async () => {
    const token = resolveToken(request, context, ...NETLIFY_TOKEN_KEYS);

    if (!token) {
      return unauthorizedResponse('Netlify');
    }

    const formData = await request.formData();
    const action = formData.get('action');

    if (action === 'get_sites') {
      const response = await externalFetch({ url: 'https://api.netlify.com/api/v1/sites', token });

      if (!response.ok) {
        throw new ApiError(`Netlify API error: ${response.status}`, response.status);
      }

      const sites = (await response.json()) as Array<{
        id: string;
        name: string;
        url: string;
        admin_url: string;
        build_settings: Record<string, unknown>;
        created_at: string;
        updated_at: string;
      }>;

      return json({
        sites: sites.map((site) => ({
          id: site.id,
          name: site.name,
          url: site.url,
          admin_url: site.admin_url,
          build_settings: site.build_settings,
          created_at: site.created_at,
          updated_at: site.updated_at,
        })),
        totalSites: sites.length,
      });
    }

    return json({ error: 'Invalid action' }, { status: 400 });
  });
}

export const action = withSecurity(netlifyUserAction, {
  rateLimit: true,
  allowedMethods: ['POST'],
});
