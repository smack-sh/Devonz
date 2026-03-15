import { ApiError, externalFetch, handleApiError } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';
import type { GitLabProjectInfo } from '~/types/GitLab';

interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  description: string;
  web_url: string;
  http_url_to_repo: string;
  star_count: number;
  forks_count: number;
  updated_at: string;
  default_branch: string;
  visibility: string;
}

async function gitlabProjectsLoader({ request }: { request: Request }) {
  return handleApiError('GitLabProjects', async () => {
    const body = (await request.json()) as { token?: string; gitlabUrl?: string };
    const { token, gitlabUrl = 'https://gitlab.com' } = body;

    if (!token) {
      return Response.json({ error: 'GitLab token is required' }, { status: 400 });
    }

    const url = `${gitlabUrl}/api/v4/projects?membership=true&per_page=100&order_by=updated_at&sort=desc`;

    const response = await externalFetch({
      url,
      token,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return Response.json({ error: 'Invalid GitLab token' }, { status: 401 });
      }

      const errorText = await response.text().catch(() => 'Unknown error');
      throw new ApiError(`GitLab API error: ${response.status} – ${errorText}`, response.status);
    }

    const projects: GitLabProject[] = await response.json();

    const transformedProjects: GitLabProjectInfo[] = projects.map((project) => ({
      id: project.id,
      name: project.name,
      path_with_namespace: project.path_with_namespace,
      description: project.description || '',
      http_url_to_repo: project.http_url_to_repo,
      star_count: project.star_count,
      forks_count: project.forks_count,
      updated_at: project.updated_at,
      default_branch: project.default_branch,
      visibility: project.visibility,
    }));

    return Response.json({
      projects: transformedProjects,
      total: transformedProjects.length,
    });
  });
}

export const action = withSecurity(gitlabProjectsLoader);
