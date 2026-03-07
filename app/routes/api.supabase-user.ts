import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from '@remix-run/node';
import { ApiError, resolveToken, unauthorizedResponse, externalFetch, handleApiError } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';

const SUPABASE_TOKEN_KEYS = ['VITE_SUPABASE_ACCESS_TOKEN'];

interface SupabaseProject {
  id: string;
  name: string;
  region: string;
  status: string;
  organization_id: string;
  created_at: string;
}

async function supabaseUserLoader({ request, context }: LoaderFunctionArgs) {
  return handleApiError('SupabaseUser', async () => {
    const token = resolveToken(request, context, ...SUPABASE_TOKEN_KEYS);

    if (!token) {
      return unauthorizedResponse('Supabase');
    }

    const response = await externalFetch({ url: 'https://api.supabase.com/v1/projects', token });

    if (!response.ok) {
      if (response.status === 401) {
        return json({ error: 'Invalid Supabase token' }, { status: 401 });
      }

      throw new ApiError(`Supabase API error: ${response.status}`, response.status);
    }

    const projects = (await response.json()) as SupabaseProject[];

    const user =
      projects.length > 0
        ? {
            id: projects[0].organization_id,
            name: 'Supabase User',
            email: 'user@supabase.co',
          }
        : null;

    return json({
      user,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        region: p.region,
        status: p.status,
        organization_id: p.organization_id,
        created_at: p.created_at,
      })),
    });
  });
}

export const loader = withSecurity(supabaseUserLoader, {
  rateLimit: true,
  allowedMethods: ['GET'],
});

async function supabaseUserAction({ request, context }: ActionFunctionArgs) {
  return handleApiError('SupabaseUser', async () => {
    const token = resolveToken(request, context, ...SUPABASE_TOKEN_KEYS);

    if (!token) {
      return unauthorizedResponse('Supabase');
    }

    const formData = await request.formData();
    const action = formData.get('action');

    if (action === 'get_projects') {
      const response = await externalFetch({ url: 'https://api.supabase.com/v1/projects', token });

      if (!response.ok) {
        throw new ApiError(`Supabase API error: ${response.status}`, response.status);
      }

      const projects = (await response.json()) as SupabaseProject[];

      const user =
        projects.length > 0
          ? {
              id: projects[0].organization_id,
              name: 'Supabase User',
              email: 'user@supabase.co',
            }
          : null;

      return json({
        user,
        stats: {
          projects: projects.map((p) => ({
            id: p.id,
            name: p.name,
            region: p.region,
            status: p.status,
            organization_id: p.organization_id,
            created_at: p.created_at,
          })),
          totalProjects: projects.length,
        },
      });
    }

    if (action === 'get_api_keys') {
      const projectId = formData.get('projectId');

      if (!projectId) {
        return json({ error: 'Project ID is required' }, { status: 400 });
      }

      const response = await externalFetch({
        url: `https://api.supabase.com/v1/projects/${projectId}/api-keys`,
        token,
      });

      if (!response.ok) {
        throw new ApiError(`Supabase API error: ${response.status}`, response.status);
      }

      const apiKeys = (await response.json()) as Array<{ name: string; api_key: string }>;

      return json({
        apiKeys: apiKeys.map((key) => ({ name: key.name, api_key: key.api_key })),
      });
    }

    return json({ error: 'Invalid action' }, { status: 400 });
  });
}

export const action = withSecurity(supabaseUserAction, {
  rateLimit: true,
  allowedMethods: ['POST'],
});
