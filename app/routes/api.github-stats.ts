import { type LoaderFunctionArgs } from 'react-router';
import { ApiError, externalFetch, handleApiError, resolveToken, unauthorizedResponse } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';
import type { GitHubUserResponse, GitHubStats } from '~/types/GitHub';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('GitHubStats');

interface GitHubRepoApiResponse {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url?: string;
  description: string | null;
  private: boolean;
  language: string | null;
  updated_at: string;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  topics: string[];
  fork: boolean;
  archived: boolean;
  size: number;
  default_branch: string;
  languages_url: string;
  branches_count?: number;
}

const GH_HEADERS = { Accept: 'application/vnd.github.v3+json' };

async function githubStatsLoader({ request, context }: LoaderFunctionArgs) {
  return handleApiError('GitHubStats', async () => {
    const githubToken = resolveToken(request, context, 'GITHUB_API_KEY', 'VITE_GITHUB_ACCESS_TOKEN', 'GITHUB_TOKEN');

    if (!githubToken) {
      return unauthorizedResponse('GitHub');
    }

    const userResponse = await externalFetch({
      url: 'https://api.github.com/user',
      token: githubToken,
      headers: GH_HEADERS,
    });

    if (!userResponse.ok) {
      if (userResponse.status === 401) {
        return Response.json({ error: 'Invalid GitHub token' }, { status: 401 });
      }

      throw new ApiError(`GitHub API error: ${userResponse.status}`, userResponse.status);
    }

    const user = (await userResponse.json()) as GitHubUserResponse;

    let allRepos: GitHubRepoApiResponse[] = [];
    let page = 1;
    const maxPages = 20; // Safety cap: 20 pages × 100 = 2000 repos max
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const repoResponse = await externalFetch({
        url: `https://api.github.com/user/repos?sort=updated&per_page=100&page=${page}&affiliation=owner,organization_member`,
        token: githubToken,
        headers: GH_HEADERS,
      });

      if (!repoResponse.ok) {
        throw new ApiError(`GitHub API error: ${repoResponse.status}`, repoResponse.status);
      }

      const repos = (await repoResponse.json()) as GitHubRepoApiResponse[];
      allRepos = allRepos.concat(repos);

      if (repos.length < 100) {
        hasMore = false;
      } else {
        page += 1;
      }
    }

    const reposWithBranches = await Promise.allSettled(
      allRepos.slice(0, 50).map(async (repo) => {
        try {
          const branchesResponse = await externalFetch({
            url: `https://api.github.com/repos/${repo.full_name}/branches?per_page=1`,
            token: githubToken,
            headers: GH_HEADERS,
          });

          if (branchesResponse.ok) {
            const linkHeader = branchesResponse.headers.get('Link');
            let branchesCount = 1;

            if (linkHeader) {
              const match = linkHeader.match(/page=(\d+)>; rel="last"/);

              if (match) {
                branchesCount = parseInt(match[1], 10);
              }
            }

            return {
              ...repo,
              branches_count: branchesCount,
            };
          }

          return repo;
        } catch (error) {
          logger.warn(`Failed to fetch branches for ${repo.full_name}:`, error);
          return repo;
        }
      }),
    );

    allRepos = allRepos.map((repo, index) => {
      if (index < reposWithBranches.length && reposWithBranches[index].status === 'fulfilled') {
        return reposWithBranches[index].value;
      }

      return repo;
    });

    const now = new Date();
    const publicRepos = allRepos.filter((repo) => !repo.private).length;
    const privateRepos = allRepos.filter((repo) => repo.private).length;

    const languageStats = new Map<string, number>();
    allRepos.forEach((repo) => {
      if (repo.language) {
        languageStats.set(repo.language, (languageStats.get(repo.language) || 0) + 1);
      }
    });

    const totalStars = allRepos.reduce((sum, repo) => sum + (repo.stargazers_count || 0), 0);
    const totalForks = allRepos.reduce((sum, repo) => sum + (repo.forks_count || 0), 0);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const stats: GitHubStats = {
      repos: allRepos.map((repo) => ({
        id: String(repo.id),
        name: repo.name,
        full_name: repo.full_name,
        html_url: repo.html_url,
        clone_url: repo.clone_url || '',
        description: repo.description || '',
        private: repo.private,
        language: repo.language || '',
        updated_at: repo.updated_at,
        stargazers_count: repo.stargazers_count || 0,
        forks_count: repo.forks_count || 0,
        watchers_count: repo.watchers_count || 0,
        topics: repo.topics || [],
        fork: repo.fork || false,
        archived: repo.archived || false,
        size: repo.size || 0,
        default_branch: repo.default_branch || 'main',
        languages_url: repo.languages_url || '',
      })),
      organizations: [],
      recentActivity: [],
      languages: {},
      totalGists: user.public_gists || 0,
      publicRepos,
      privateRepos,
      stars: totalStars,
      forks: totalForks,
      totalStars,
      totalForks,
      followers: user.followers || 0,
      publicGists: user.public_gists || 0,
      privateGists: 0,
      lastUpdated: now.toISOString(),
    };

    return Response.json(stats);
  });
}

export const loader = withSecurity(githubStatsLoader, {
  rateLimit: true,
  allowedMethods: ['GET'],
});
