/**
 * @module git-client
 * Client-side git operations via the /api/runtime/git endpoint.
 */

import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('GitClient');

export interface GitCommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  timestamp: number;
  isoDate: string;
  additions: number;
  deletions: number;
}

async function gitApi<T>(op: string, projectId: string, extra: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch('/api/runtime/git', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, projectId, ...extra }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Git API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Create a commit with all current changes.
 */
export async function commit(projectId: string, message: string): Promise<string | null> {
  try {
    const result = await gitApi<{ sha: string | null; committed: boolean }>('commit', projectId, { message });
    return result.sha;
  } catch (error) {
    logger.error('Commit failed:', error);
    return null;
  }
}

/**
 * Get the git log for a project.
 */
export async function getLog(projectId: string, maxCount = 50): Promise<GitCommitInfo[]> {
  try {
    const result = await gitApi<{ commits: GitCommitInfo[] }>('log', projectId, { maxCount });
    return result.commits;
  } catch (error) {
    logger.error('Git log failed:', error);
    return [];
  }
}

/**
 * Checkout a specific commit (detached HEAD).
 */
export async function checkout(projectId: string, sha: string): Promise<boolean> {
  try {
    const result = await gitApi<{ success: boolean }>('checkout', projectId, { sha });
    return result.success;
  } catch (error) {
    logger.error('Checkout failed:', error);
    return false;
  }
}

/**
 * Return to the main branch.
 */
export async function checkoutMain(projectId: string): Promise<boolean> {
  try {
    const result = await gitApi<{ success: boolean }>('checkout-main', projectId);
    return result.success;
  } catch (error) {
    logger.error('Checkout main failed:', error);
    return false;
  }
}

/**
 * Get the diff stat for a commit.
 */
export async function getDiff(projectId: string, sha: string): Promise<string> {
  try {
    const result = await gitApi<{ diff: string }>('diff', projectId, { sha });
    return result.diff;
  } catch {
    return '';
  }
}

/**
 * Get files changed in a commit.
 */
export async function getCommitFiles(projectId: string, sha: string): Promise<string[]> {
  try {
    const result = await gitApi<{ files: string[] }>('commit-files', projectId, { sha });
    return result.files;
  } catch {
    return [];
  }
}

export interface FileChange {
  file: string;
  status: string;
}

/**
 * Get files changed in a commit with their change status (A/M/D).
 */
export async function getCommitFilesWithStatus(projectId: string, sha: string): Promise<FileChange[]> {
  try {
    const result = await gitApi<{ files: FileChange[] }>('commit-files-status', projectId, { sha });
    return result.files;
  } catch {
    return [];
  }
}

/**
 * Get the unified diff for a specific file in a commit.
 */
export async function getFileDiff(projectId: string, sha: string, file: string): Promise<string> {
  try {
    const result = await gitApi<{ diff: string }>('file-diff', projectId, { sha, file });
    return result.diff;
  } catch {
    return '';
  }
}

/**
 * Get the full diff for an entire commit.
 */
export async function getCommitDiff(projectId: string, sha: string): Promise<string> {
  try {
    const result = await gitApi<{ diff: string }>('commit-diff', projectId, { sha });
    return result.diff;
  } catch {
    return '';
  }
}

/**
 * Download a project archive (full or changed files only).
 * Triggers a browser download.
 */
export async function downloadArchive(projectId: string, sha: string, type: 'full' | 'changed'): Promise<void> {
  try {
    const response = await fetch('/api/runtime/git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'archive', projectId, sha, type }),
    });

    if (!response.ok) {
      throw new Error('Download failed');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-${sha.substring(0, 7)}-${type}.zip`;
    document.body.appendChild(a);
    a.click();

    // Clean up
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  } catch (error) {
    logger.error('Download archive failed:', error);
    throw error;
  }
}
