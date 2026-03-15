import { type LoaderFunctionArgs } from 'react-router';
import { ApiError, externalFetch, handleApiError, resolveToken, unauthorizedResponse } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';

interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

interface BranchInfo {
  name: string;
  sha: string;
  protected: boolean;
  isDefault: boolean;
}

const GH_HEADERS = { Accept: 'application/vnd.github.v3+json' };

async function githubBranchesLoader({ request, context }: LoaderFunctionArgs) {
  return handleApiError('GitHubBranches', async () => {
    let owner: string;
    let repo: string;
    let githubToken: string;

    if (request.method === 'POST') {
      const body = (await request.json()) as { owner: string; repo: string; token: string };
      owner = body.owner;
      repo = body.repo;
      githubToken = body.token;

      if (!owner || !repo) {
        return Response.json({ error: 'Owner and repo parameters are required' }, { status: 400 });
      }

      if (!githubToken) {
        return Response.json({ error: 'GitHub token is required' }, { status: 400 });
      }
    } else {
      const url = new URL(request.url);
      owner = url.searchParams.get('owner') || '';
      repo = url.searchParams.get('repo') || '';

      if (!owner || !repo) {
        return Response.json({ error: 'Owner and repo parameters are required' }, { status: 400 });
      }

      const token = resolveToken(request, context, 'GITHUB_API_KEY', 'VITE_GITHUB_ACCESS_TOKEN', 'GITHUB_TOKEN');
      githubToken = token || '';
    }

    if (!githubToken) {
      return unauthorizedResponse('GitHub');
    }

    const repoResponse = await externalFetch({
      url: `https://api.github.com/repos/${owner}/${repo}`,
      token: githubToken,
      headers: GH_HEADERS,
    });

    if (!repoResponse.ok) {
      if (repoResponse.status === 404) {
        return Response.json({ error: 'Repository not found' }, { status: 404 });
      }

      if (repoResponse.status === 401) {
        return Response.json({ error: 'Invalid GitHub token' }, { status: 401 });
      }

      throw new ApiError(`GitHub API error: ${repoResponse.status}`, repoResponse.status);
    }

    const repoInfo = (await repoResponse.json()) as { default_branch: string };
    const defaultBranch = repoInfo.default_branch;

    const branchesResponse = await externalFetch({
      url: `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
      token: githubToken,
      headers: GH_HEADERS,
    });

    if (!branchesResponse.ok) {
      throw new ApiError(`Failed to fetch branches: ${branchesResponse.status}`, branchesResponse.status);
    }

    const branches: GitHubBranch[] = await branchesResponse.json();

    const transformedBranches: BranchInfo[] = branches.map((branch) => ({
      name: branch.name,
      sha: branch.commit.sha,
      protected: branch.protected,
      isDefault: branch.name === defaultBranch,
    }));

    transformedBranches.sort((a, b) => {
      if (a.isDefault) {
        return -1;
      }

      if (b.isDefault) {
        return 1;
      }

      return a.name.localeCompare(b.name);
    });

    return Response.json({
      branches: transformedBranches,
      defaultBranch,
      total: transformedBranches.length,
    });
  });
}

export const loader = withSecurity(githubBranchesLoader);
export const action = withSecurity(githubBranchesLoader);
