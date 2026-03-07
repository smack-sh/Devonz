import { Octokit, type RestEndpointMethodTypes } from '@octokit/rest';
import type { FileMap } from '~/lib/stores/files';
import { extractRelativePath } from '~/utils/diff';
import Cookies from 'js-cookie';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('RepositoryPushService');

export interface PushOptions {
  provider: 'github' | 'gitlab';
  repoName: string;
  commitMessage?: string;
  username?: string;
  token?: string;
  isPrivate?: boolean;
  branchName?: string;
}

/**
 * Push files to a GitHub or GitLab repository.
 * Returns the repository URL on success.
 */
export async function pushToRepository(files: FileMap, options: PushOptions): Promise<string> {
  const { provider, repoName, commitMessage, username, token, isPrivate = false, branchName = 'main' } = options;

  const isGitHub = provider === 'github';
  const isGitLab = provider === 'gitlab';

  const authToken = token || Cookies.get(isGitHub ? 'githubToken' : 'gitlabToken');
  const owner = username || Cookies.get(isGitHub ? 'githubUsername' : 'gitlabUsername');

  if (!authToken || !owner) {
    throw new Error(`${provider} token or username is not set in cookies or provided.`);
  }

  if (!files || Object.keys(files).length === 0) {
    throw new Error('No files found to push');
  }

  if (isGitHub) {
    return pushToGitHub(files, { authToken, owner, repoName, commitMessage, isPrivate });
  }

  if (isGitLab) {
    return pushToGitLab(files, { authToken, owner, repoName, commitMessage, isPrivate, branchName });
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

// ---- GitHub ----

interface GitHubPushParams {
  authToken: string;
  owner: string;
  repoName: string;
  commitMessage?: string;
  isPrivate: boolean;
}

async function pushToGitHub(files: FileMap, params: GitHubPushParams): Promise<string> {
  const { authToken, owner, repoName, commitMessage, isPrivate } = params;
  const octokit = new Octokit({ auth: authToken });

  let repo: RestEndpointMethodTypes['repos']['get']['response']['data'];
  let visibilityJustChanged = false;

  try {
    const resp = await octokit.repos.get({ owner, repo: repoName });
    repo = resp.data;
    logger.debug('Repository already exists, using existing repo');

    // Check if we need to update visibility of existing repo
    if (repo.private !== isPrivate) {
      logger.debug(
        `Updating repository visibility from ${repo.private ? 'private' : 'public'} to ${isPrivate ? 'private' : 'public'}`,
      );

      try {
        const { data: updatedRepo } = await octokit.repos.update({
          owner,
          repo: repoName,
          private: isPrivate,
        });

        logger.debug('Repository visibility updated successfully');
        repo = updatedRepo;
        visibilityJustChanged = true;

        // Add a delay after changing visibility to allow GitHub to fully process the change
        logger.debug('Waiting for visibility change to propagate...');
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch (visibilityError) {
        logger.error('Failed to update repository visibility:', visibilityError);

        // Continue with push even if visibility update fails
      }
    }
  } catch (error) {
    if (error instanceof Error && 'status' in error && (error as { status: number }).status === 404) {
      logger.debug(`Creating new repository with private=${isPrivate}`);

      const { data: newRepo } = await octokit.repos.createForAuthenticatedUser({
        name: repoName,
        private: isPrivate,
        auto_init: true,
      });

      logger.debug('Repository created:', newRepo.html_url, 'Private:', newRepo.private);
      repo = newRepo;

      // Allow GitHub to fully initialize the repository
      logger.debug('Waiting for repository to initialize...');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } else {
      logger.error('Cannot create repo:', error);
      throw error;
    }
  }

  return pushFilesToGitHub(octokit, repo, files, {
    owner,
    repoName,
    commitMessage,
    visibilityJustChanged,
  });
}

interface PushFilesParams {
  owner: string;
  repoName: string;
  commitMessage?: string;
  visibilityJustChanged: boolean;
}

async function pushFilesToGitHub(
  octokit: Octokit,
  repo: RestEndpointMethodTypes['repos']['get']['response']['data'],
  files: FileMap,
  params: PushFilesParams,
  attempt = 1,
): Promise<string> {
  const maxAttempts = 3;
  const { owner, repoName, commitMessage, visibilityJustChanged } = params;

  try {
    logger.debug(`Pushing files to repository (attempt ${attempt}/${maxAttempts})...`);

    // Create blobs for each file
    const blobs = await Promise.all(
      Object.entries(files).map(async ([filePath, dirent]) => {
        if (dirent?.type === 'file' && dirent.content) {
          const { data: blob } = await octokit.git.createBlob({
            owner: repo.owner.login,
            repo: repo.name,
            content: Buffer.from(dirent.content).toString('base64'),
            encoding: 'base64',
          });

          return { path: extractRelativePath(filePath), sha: blob.sha };
        }

        return null;
      }),
    );

    const validBlobs = blobs.filter(Boolean);

    if (validBlobs.length === 0) {
      throw new Error('No valid files to push');
    }

    // Refresh repository reference
    const repoRefresh = await octokit.repos.get({ owner, repo: repoName });
    repo = repoRefresh.data;

    // Get the latest commit SHA
    const { data: ref } = await octokit.git.getRef({
      owner: repo.owner.login,
      repo: repo.name,
      ref: `heads/${repo.default_branch || 'main'}`,
    });
    const latestCommitSha = ref.object.sha;

    // Create a new tree
    const { data: newTree } = await octokit.git.createTree({
      owner: repo.owner.login,
      repo: repo.name,
      base_tree: latestCommitSha,
      tree: validBlobs.map((blob) => ({
        path: blob!.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blob!.sha,
      })),
    });

    // Create a new commit
    const { data: newCommit } = await octokit.git.createCommit({
      owner: repo.owner.login,
      repo: repo.name,
      message: commitMessage || 'Initial commit from your app',
      tree: newTree.sha,
      parents: [latestCommitSha],
    });

    // Update the reference
    await octokit.git.updateRef({
      owner: repo.owner.login,
      repo: repo.name,
      ref: `heads/${repo.default_branch || 'main'}`,
      sha: newCommit.sha,
    });

    logger.debug('Files successfully pushed to repository');

    return repo.html_url;
  } catch (error) {
    logger.error(`Error during push attempt ${attempt}:`, error);

    if ((visibilityJustChanged || attempt === 1) && attempt < maxAttempts) {
      const delayMs = attempt * 2000;
      logger.debug(`Waiting ${delayMs}ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      return pushFilesToGitHub(octokit, repo, files, params, attempt + 1);
    }

    throw error;
  }
}

// ---- GitLab ----

interface GitLabPushParams {
  authToken: string;
  owner: string;
  repoName: string;
  commitMessage?: string;
  isPrivate: boolean;
  branchName: string;
}

async function pushToGitLab(files: FileMap, params: GitLabPushParams): Promise<string> {
  const { authToken, owner, repoName, commitMessage, isPrivate, branchName } = params;

  const { GitLabApiService: gitLabApiServiceClass } = await import('~/lib/services/gitlabApiService');
  const gitLabApiService = new gitLabApiServiceClass(authToken, 'https://gitlab.com');

  // Check or create repo
  let repo = await gitLabApiService.getProject(owner, repoName);

  if (!repo) {
    repo = await gitLabApiService.createProject(repoName, isPrivate);
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Check if branch exists, create if not
  const branchRes = await gitLabApiService.getFile(repo.id, 'README.md', branchName).catch(() => null);

  if (!branchRes || !branchRes.ok) {
    await gitLabApiService.createBranch(repo.id, branchName, repo.default_branch);
    await new Promise((r) => setTimeout(r, 1000));
  }

  const actions = Object.entries(files).reduce(
    (acc, [filePath, dirent]) => {
      if (dirent?.type === 'file' && dirent.content) {
        acc.push({
          action: 'create' as const,
          file_path: extractRelativePath(filePath),
          content: dirent.content,
        });
      }

      return acc;
    },
    [] as { action: 'create' | 'update'; file_path: string; content: string }[],
  );

  // Check which files exist and update action accordingly
  for (const action of actions) {
    const fileCheck = await gitLabApiService.getFile(repo.id, action.file_path, branchName);

    if (fileCheck.ok) {
      action.action = 'update';
    }
  }

  // Commit all files
  await gitLabApiService.commitFiles(repo.id, {
    branch: branchName,
    commit_message: commitMessage || 'Commit multiple files',
    actions,
  });

  return repo.web_url;
}
