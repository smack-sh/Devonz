import { json, type LoaderFunctionArgs } from '@remix-run/node';
import { withSecurity } from '~/lib/security';

/**
 * GET /api/version-check
 *
 * Compares the local commit hash against the latest commit on main
 * from the GitHub API. Returns whether an update is available.
 */
async function versionCheckLoader(_args: LoaderFunctionArgs) {
  const owner = 'zebbern';
  const repo = 'Devonz';
  const branch = 'main';

  // Get local commit hash (set at build time by pre-start.cjs)
  let localHash = 'unknown';

  try {
    const { execSync } = await import('child_process');
    localHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // git not available or not a git repo — use the build-time value
  }

  // Fetch latest commit from GitHub (unauthenticated — 60 req/hr limit, fine for local use)
  let remoteHash = 'unknown';
  let remoteDate = '';
  let remoteMessage = '';
  let updateAvailable = false;

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${branch}`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Devonz-UpdateCheck',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        sha: string;
        commit: {
          message: string;
          committer: { date: string };
        };
      };
      remoteHash = data.sha.substring(0, 7);
      remoteMessage = data.commit.message.split('\n')[0]; // first line only
      remoteDate = data.commit.committer.date;
      updateAvailable = localHash !== 'unknown' && remoteHash !== 'unknown' && localHash !== remoteHash;
    }
  } catch {
    // Network error — can't check for updates, that's fine
  }

  return json({
    local: { hash: localHash },
    remote: { hash: remoteHash, date: remoteDate, message: remoteMessage },
    updateAvailable,
  });
}

export const loader = withSecurity(versionCheckLoader, {
  allowedMethods: ['GET'],
  rateLimit: false,
});
