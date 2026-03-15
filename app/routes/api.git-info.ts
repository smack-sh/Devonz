import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { handleApiError } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';

async function gitInfoLoader() {
  return handleApiError('GitInfo', async () => {
    if (!existsSync('.git')) {
      return Response.json({
        branch: 'unknown',
        commit: 'unknown',
        isDirty: false,
      });
    }

    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();

    const statusOutput = execSync('git status --porcelain', { encoding: 'utf8' });
    const isDirty = statusOutput.trim().length > 0;

    let remoteUrl: string | undefined;

    try {
      remoteUrl = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    } catch {
      // No remote origin
    }

    let lastCommit: { message: string; date: string; author: string } | undefined;

    try {
      const commitInfo = execSync('git log -1 --pretty=format:"%s|%ci|%an"', { encoding: 'utf8' }).trim();
      const [message, date, author] = commitInfo.split('|');
      lastCommit = {
        message: message || 'unknown',
        date: date || 'unknown',
        author: author || 'unknown',
      };
    } catch {
      // Could not get commit info
    }

    return Response.json({
      branch,
      commit,
      isDirty,
      remoteUrl,
      lastCommit,
    });
  });
}

export const loader = withSecurity(gitInfoLoader, {
  allowedMethods: ['GET'],
  rateLimit: false,
});
