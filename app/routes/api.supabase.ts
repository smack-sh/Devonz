import { type ActionFunctionArgs } from 'react-router';
import type { SupabaseProject } from '~/types/supabase';
import { handleApiError, externalFetch, ApiError } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';

async function supabaseAction({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  return handleApiError(
    'SupabaseAPI',
    async () => {
      const { token } = (await request.json()) as { token: string };

      const projectsResponse = await externalFetch({
        url: 'https://api.supabase.com/v1/projects',
        token,
        headers: { 'Content-Type': 'application/json' },
      });

      if (!projectsResponse.ok) {
        const errorText = await projectsResponse.text();
        throw new ApiError(`Failed to fetch projects: ${errorText}`, 401);
      }

      const projects = (await projectsResponse.json()) as SupabaseProject[];

      const uniqueProjectsMap = new Map<string, SupabaseProject>();

      for (const project of projects) {
        if (!uniqueProjectsMap.has(project.id)) {
          uniqueProjectsMap.set(project.id, project);
        }
      }

      const uniqueProjects = Array.from(uniqueProjectsMap.values());

      uniqueProjects.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return Response.json({
        user: { email: 'Connected', role: 'Admin' },
        stats: {
          projects: uniqueProjects,
          totalProjects: uniqueProjects.length,
        },
      });
    },
    'Authentication failed',
  );
}

export const action = withSecurity(supabaseAction, {
  allowedMethods: ['POST'],
  rateLimit: false,
});
