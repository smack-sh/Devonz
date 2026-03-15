import { ApiError, externalFetch, handleApiError } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';

interface GitLabBranch {
  name: string;
  commit: { id: string; short_id: string };
  protected: boolean;
  default: boolean;
  can_push: boolean;
}

interface BranchInfo {
  name: string;
  sha: string;
  protected: boolean;
  isDefault: boolean;
  canPush: boolean;
}

async function gitlabBranchesHandler({ request }: { request: Request }) {
  return handleApiError('GitLabBranches', async () => {
    const body = (await request.json()) as { token?: string; gitlabUrl?: string; projectId?: string };
    const { token, gitlabUrl = 'https://gitlab.com', projectId } = body;

    if (!token) {
      return Response.json({ error: 'GitLab token is required' }, { status: 400 });
    }

    if (!projectId) {
      return Response.json({ error: 'Project ID is required' }, { status: 400 });
    }

    const branchesResponse = await externalFetch({
      url: `${gitlabUrl}/api/v4/projects/${projectId}/repository/branches?per_page=100`,
      token,
      headers: { Accept: 'application/json' },
    });

    if (!branchesResponse.ok) {
      if (branchesResponse.status === 401) {
        return Response.json({ error: 'Invalid GitLab token' }, { status: 401 });
      }

      if (branchesResponse.status === 404) {
        return Response.json({ error: 'Project not found or no access' }, { status: 404 });
      }

      throw new ApiError(`GitLab API error: ${branchesResponse.status}`, branchesResponse.status);
    }

    const branches: GitLabBranch[] = await branchesResponse.json();

    const projectResponse = await externalFetch({
      url: `${gitlabUrl}/api/v4/projects/${projectId}`,
      token,
      headers: { Accept: 'application/json' },
    });

    let defaultBranchName = 'main';

    if (projectResponse.ok) {
      const projectInfo = (await projectResponse.json()) as { default_branch?: string };
      defaultBranchName = projectInfo.default_branch || 'main';
    }

    const transformedBranches: BranchInfo[] = branches.map((branch) => ({
      name: branch.name,
      sha: branch.commit.id,
      protected: branch.protected,
      isDefault: branch.name === defaultBranchName,
      canPush: branch.can_push,
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
      defaultBranch: defaultBranchName,
      total: transformedBranches.length,
    });
  });
}

export const action = withSecurity(gitlabBranchesHandler);
