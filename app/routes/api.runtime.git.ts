/**
 * @route /api/runtime/git
 * Server-side API route for git operations on project directories.
 *
 * POST operations:
 *   - commit: Stage all changes and create a commit
 *   - log: Get commit history
 *   - checkout: Checkout a specific commit
 *   - checkout-main: Return to main branch
 *   - diff: Get diff stat for a commit
 *   - commit-files: Get files changed in a commit
 */

import type { ActionFunctionArgs } from 'react-router';
import { RuntimeManager } from '~/lib/runtime/local-runtime';
import {
  autoCommit,
  getGitLog,
  getDiff,
  checkoutCommit,
  checkoutMain,
  getCommitFiles,
  getCommitFilesWithStatus,
  getFileDiff,
  getCommitDiff,
  archiveCommit,
  archiveChangedFiles,
} from '~/lib/runtime/git-manager';
import { withSecurity } from '~/lib/security';
import { gitRequestSchema, parseOrError } from '~/lib/api/schemas';

async function gitAction({ request }: ActionFunctionArgs) {
  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  const parsed = parseOrError(gitRequestSchema, rawBody, 'RuntimeGit');

  if (!parsed.success) {
    return parsed.response;
  }

  const body = parsed.data;
  const { op, projectId } = body;

  const manager = RuntimeManager.getInstance();

  let runtime;

  try {
    runtime = await manager.getRuntime(projectId);
  } catch {
    return Response.json({ error: 'Runtime not found for project' }, { status: 404 });
  }

  const workdir = runtime.workdir;

  switch (op) {
    case 'commit': {
      const { message } = body;
      const sha = autoCommit(workdir, message);

      return Response.json({ sha, committed: !!sha });
    }

    case 'log': {
      const maxCount = body.maxCount ?? 50;
      const commits = getGitLog(workdir, maxCount);

      return Response.json({ commits });
    }

    case 'checkout': {
      const { sha } = body;
      const success = checkoutCommit(workdir, sha);

      return Response.json({ success });
    }

    case 'checkout-main': {
      const success = checkoutMain(workdir);
      return Response.json({ success });
    }

    case 'diff': {
      const { sha } = body;
      const diff = getDiff(workdir, sha);

      return Response.json({ diff });
    }

    case 'commit-files': {
      const { sha } = body;
      const files = getCommitFiles(workdir, sha);

      return Response.json({ files });
    }

    case 'commit-files-status': {
      const { sha } = body;
      const files = getCommitFilesWithStatus(workdir, sha);

      return Response.json({ files });
    }

    case 'file-diff': {
      const { sha, file } = body;
      const diff = getFileDiff(workdir, sha, file);

      return Response.json({ diff });
    }

    case 'commit-diff': {
      const { sha } = body;
      const diff = getCommitDiff(workdir, sha);

      return Response.json({ diff });
    }

    case 'archive': {
      const { sha, type: archiveType } = body;

      try {
        const zipBuffer = archiveType === 'changed' ? archiveChangedFiles(workdir, sha) : archiveCommit(workdir, sha);

        return new Response(new Uint8Array(zipBuffer), {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="project-${sha.substring(0, 7)}.zip"`,
            'Content-Length': String(zipBuffer.length),
          },
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Archive failed';
        return Response.json({ error: msg }, { status: 500 });
      }
    }

    default: {
      return Response.json({ error: `Unknown git operation: ${op}` }, { status: 400 });
    }
  }
}

export const action = withSecurity(gitAction, { rateLimit: false });
