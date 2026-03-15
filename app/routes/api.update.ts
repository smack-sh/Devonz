import { type ActionFunctionArgs } from 'react-router';
import { withSecurity } from '~/lib/security';
import { clearVersionCheckCache } from './api.version-check';
import type { UpdateStepResult } from '~/types/api-types';

// Concurrency guard — only one update at a time
let isUpdating = false;

/**
 * POST /api/update
 *
 * Triggers a one-click update: stash changes, pull latest from main,
 * and install dependencies. The build step is skipped because the
 * dev server will rebuild automatically on page reload.
 *
 * Blocked in Docker environments — use `docker compose pull` instead.
 */
async function updateAction(_args: ActionFunctionArgs) {
  const isDocker = process.env.RUNNING_IN_DOCKER === 'true';

  if (isDocker) {
    return Response.json(
      {
        success: false,
        message: 'Update is not available in Docker environments. Use `docker compose pull` instead.',
        steps: [],
      },
      { status: 403 },
    );
  }

  if (isUpdating) {
    return Response.json(
      {
        success: false,
        message: 'An update is already in progress. Please wait for it to complete.',
        steps: [],
      },
      { status: 409 },
    );
  }

  isUpdating = true;

  const steps: UpdateStepResult[] = [];

  try {
    const { execSync } = await import('child_process');
    const { existsSync } = await import('fs');
    const { resolve } = await import('path');

    const ROOT = resolve(process.cwd());

    // Step 1: Verify git repo
    if (!existsSync(resolve(ROOT, '.git'))) {
      steps.push({ name: 'Check git repo', status: 'failed', error: 'Not a git repository' });

      return Response.json(
        {
          success: false,
          message: 'Not a git repository. Cannot update.',
          steps,
        },
        { status: 400 },
      );
    }

    steps.push({ name: 'Check git repo', status: 'completed' });

    // Step 2: Stash uncommitted changes
    try {
      const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' }).trim();

      if (status) {
        execSync('git stash push -m "auto-stash before update"', { cwd: ROOT, encoding: 'utf8' });
        steps.push({ name: 'Stash changes', status: 'completed' });
      } else {
        steps.push({ name: 'Stash changes', status: 'skipped' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stash changes';
      steps.push({ name: 'Stash changes', status: 'failed', error: message });

      return Response.json(
        {
          success: false,
          message: 'Failed to stash uncommitted changes.',
          steps,
        },
        { status: 500 },
      );
    }

    // Step 3: Pull latest from main
    try {
      execSync('git pull origin main --rebase', { cwd: ROOT, encoding: 'utf8' });
      steps.push({ name: 'Pull latest', status: 'completed' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to pull latest changes';
      steps.push({ name: 'Pull latest', status: 'failed', error: message });

      return Response.json(
        {
          success: false,
          message: 'Failed to pull latest changes. You may have merge conflicts.',
          steps,
        },
        { status: 500 },
      );
    }

    // Step 4: Install dependencies
    try {
      execSync('pnpm install --frozen-lockfile', { cwd: ROOT, encoding: 'utf8' });
      steps.push({ name: 'Install dependencies', status: 'completed' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to install dependencies';
      steps.push({ name: 'Install dependencies', status: 'failed', error: message });

      return Response.json(
        {
          success: false,
          message: 'Failed to install dependencies.',
          steps,
        },
        { status: 500 },
      );
    }

    // Step 5: Skip build — dev server will rebuild on reload
    steps.push({ name: 'Build', status: 'skipped' });

    // Get updated version info
    let hash = 'unknown';

    try {
      hash = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    } catch {
      // git info not critical
    }

    // Clear cached version-check so the banner disappears after reload
    clearVersionCheckCache();

    return Response.json({
      success: true,
      message: `Updated successfully to ${hash}. Reload the page to apply changes.`,
      steps,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred during update';

    return Response.json(
      {
        success: false,
        message,
        steps,
      },
      { status: 500 },
    );
  } finally {
    isUpdating = false;
  }
}

export const action = withSecurity(updateAction, {
  allowedMethods: ['POST'],
  rateLimit: true,
});

/**
 * GET /api/update — not supported, return 405.
 * Remix requires a loader export to handle GET requests without throwing.
 */
export function loader() {
  return Response.json(
    {
      success: false,
      message: 'Method not allowed. Use POST to trigger an update.',
      steps: [],
    },
    { status: 405, headers: { Allow: 'POST' } },
  );
}
