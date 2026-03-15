import { type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router';
import { ApiError, resolveToken, unauthorizedResponse, externalFetch, handleApiError } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';

const GITHUB_TOKEN_KEYS = ['GITHUB_API_KEY', 'VITE_GITHUB_ACCESS_TOKEN', 'GITHUB_TOKEN'];

async function githubUserLoader({ request, context }: LoaderFunctionArgs) {
  return handleApiError('GitHubUser', async () => {
    const token = resolveToken(request, context, ...GITHUB_TOKEN_KEYS);

    if (!token) {
      return unauthorizedResponse('GitHub');
    }

    const response = await externalFetch({
      url: 'https://api.github.com/user',
      token,
      headers: { Accept: 'application/vnd.github.v3+json' },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return Response.json({ error: 'Invalid GitHub token' }, { status: 401 });
      }

      throw new ApiError(`GitHub API error: ${response.status}`, response.status);
    }

    const userData = (await response.json()) as {
      login: string;
      name: string | null;
      avatar_url: string;
      html_url: string;
      type: string;
    };

    return Response.json({
      login: userData.login,
      name: userData.name,
      avatar_url: userData.avatar_url,
      html_url: userData.html_url,
      type: userData.type,
    });
  });
}

export const loader = withSecurity(githubUserLoader, {
  rateLimit: true,
  allowedMethods: ['GET'],
});

async function githubUserAction({ request, context }: ActionFunctionArgs) {
  return handleApiError('GitHubUser', async () => {
    const token = resolveToken(request, context, ...GITHUB_TOKEN_KEYS);

    if (!token) {
      return unauthorizedResponse('GitHub');
    }

    let action: string | null = null;
    let repoFullName: string | null = null;
    let searchQuery: string | null = null;
    let perPage: number = 30;

    const contentType = request.headers.get('Content-Type') || '';

    if (contentType.includes('application/json')) {
      const jsonData = (await request.json()) as { action?: string; repo?: string; query?: string; per_page?: number };
      action = jsonData.action ?? null;
      repoFullName = jsonData.repo ?? null;
      searchQuery = jsonData.query ?? null;
      perPage = jsonData.per_page || 30;
    } else {
      const formData = await request.formData();
      action = formData.get('action') as string;
      repoFullName = formData.get('repo') as string;
      searchQuery = formData.get('query') as string;
      perPage = parseInt(formData.get('per_page') as string, 10) || 30;
    }

    const githubHeaders = { Accept: 'application/vnd.github.v3+json' };

    if (action === 'get_repos') {
      const response = await externalFetch({
        url: 'https://api.github.com/user/repos?sort=updated&per_page=100',
        token,
        headers: githubHeaders,
      });

      if (!response.ok) {
        throw new ApiError(`GitHub API error: ${response.status}`, response.status);
      }

      const repos = (await response.json()) as Array<{
        id: number;
        name: string;
        full_name: string;
        html_url: string;
        description: string | null;
        private: boolean;
        language: string | null;
        updated_at: string;
        stargazers_count: number;
        forks_count: number;
        topics: string[];
      }>;

      return Response.json({
        repos: repos.map((repo) => ({
          id: repo.id,
          name: repo.name,
          full_name: repo.full_name,
          html_url: repo.html_url,
          description: repo.description,
          private: repo.private,
          language: repo.language,
          updated_at: repo.updated_at,
          stargazers_count: repo.stargazers_count || 0,
          forks_count: repo.forks_count || 0,
          topics: repo.topics || [],
        })),
      });
    }

    if (action === 'get_branches') {
      if (!repoFullName) {
        return Response.json({ error: 'Repository name is required' }, { status: 400 });
      }

      const response = await externalFetch({
        url: `https://api.github.com/repos/${repoFullName}/branches`,
        token,
        headers: githubHeaders,
      });

      if (!response.ok) {
        throw new ApiError(`GitHub API error: ${response.status}`, response.status);
      }

      const branches = (await response.json()) as Array<{
        name: string;
        commit: { sha: string; url: string };
        protected: boolean;
      }>;

      return Response.json({
        branches: branches.map((branch) => ({
          name: branch.name,
          commit: { sha: branch.commit.sha, url: branch.commit.url },
          protected: branch.protected,
        })),
      });
    }

    if (action === 'get_token') {
      return Response.json({ token });
    }

    if (action === 'search_repos') {
      if (!searchQuery) {
        return Response.json({ error: 'Search query is required' }, { status: 400 });
      }

      const response = await externalFetch({
        url: `https://api.github.com/search/repositories?q=${encodeURIComponent(searchQuery)}&per_page=${perPage}&sort=updated`,
        token,
        headers: githubHeaders,
      });

      if (!response.ok) {
        throw new ApiError(`GitHub API error: ${response.status}`, response.status);
      }

      const searchData = (await response.json()) as {
        total_count: number;
        incomplete_results: boolean;
        items: Array<{
          id: number;
          name: string;
          full_name: string;
          html_url: string;
          description: string | null;
          private: boolean;
          language: string | null;
          updated_at: string;
          stargazers_count: number;
          forks_count: number;
          topics: string[];
          owner: { login: string; avatar_url: string };
        }>;
      };

      return Response.json({
        repos: searchData.items.map((repo) => ({
          id: repo.id,
          name: repo.name,
          full_name: repo.full_name,
          html_url: repo.html_url,
          description: repo.description,
          private: repo.private,
          language: repo.language,
          updated_at: repo.updated_at,
          stargazers_count: repo.stargazers_count || 0,
          forks_count: repo.forks_count || 0,
          topics: repo.topics || [],
          owner: { login: repo.owner.login, avatar_url: repo.owner.avatar_url },
        })),
        total_count: searchData.total_count,
        incomplete_results: searchData.incomplete_results,
      });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  });
}

export const action = withSecurity(githubUserAction, {
  rateLimit: true,
  allowedMethods: ['POST'],
});
