/**
 * @route /api/runtime/exec
 * Server-side API route for command execution and runtime lifecycle.
 *
 * POST operations:
 *   - boot: Initialize a runtime for a project
 *   - exec: Execute a command and return its result
 *   - teardown: Tear down a project's runtime
 *
 * GET operations:
 *   - portEvents: SSE stream of port open/close events
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { RuntimeManager } from '~/lib/runtime/local-runtime';
import { isValidProjectId, isSafePath } from '~/lib/runtime/runtime-provider';
import { validateCommand, auditCommand, DEFAULT_EXEC_TIMEOUT_MS } from '~/lib/runtime/command-safety';
import { withSecurity } from '~/lib/security';
import { execRequestSchema, parseOrError } from '~/lib/api/schemas';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('RuntimeExec');

/*
 * ---------------------------------------------------------------------------
 * GET — SSE streams
 * ---------------------------------------------------------------------------
 */

async function execLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const op = url.searchParams.get('op');
  const projectId = url.searchParams.get('projectId');

  if (!projectId || !isValidProjectId(projectId)) {
    return Response.json({ error: 'Invalid or missing projectId' }, { status: 400 });
  }

  switch (op) {
    case 'portEvents': {
      const manager = RuntimeManager.getInstance();
      const runtime = await manager.getRuntime(projectId);

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          // Send heartbeat so client knows connection is alive
          controller.enqueue(encoder.encode('data: {"type":"heartbeat"}\n\n'));

          const dispose = runtime.onPortEvent((event) => {
            try {
              const data = `data: ${JSON.stringify(event)}\n\n`;
              controller.enqueue(encoder.encode(data));
            } catch {
              // Stream may have been closed
            }
          });

          // Heartbeat every 30 seconds to keep connection alive
          const heartbeat = setInterval(() => {
            try {
              controller.enqueue(encoder.encode('data: {"type":"heartbeat"}\n\n'));
            } catch {
              clearInterval(heartbeat);
            }
          }, 30_000);

          // Clean up when client disconnects
          request.signal.addEventListener('abort', () => {
            dispose();
            clearInterval(heartbeat);

            try {
              controller.close();
            } catch {
              // Controller may already be closed
            }
          });
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    default: {
      return Response.json({ error: `Unknown GET operation: ${op}` }, { status: 400 });
    }
  }
}

/*
 * ---------------------------------------------------------------------------
 * POST — Command execution & lifecycle
 * ---------------------------------------------------------------------------
 */

async function execAction({ request }: ActionFunctionArgs) {
  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  const parsed = parseOrError(execRequestSchema, rawBody, 'RuntimeExec');

  if (!parsed.success) {
    return parsed.response;
  }

  const body = parsed.data;
  const { op, projectId } = body;

  const manager = RuntimeManager.getInstance();

  switch (op) {
    case 'boot': {
      try {
        const runtime = await manager.getRuntime(projectId);

        /*
         * Kill orphaned sessions from previous page loads / client reconnects.
         * This prevents dev-server processes from stacking up on different ports.
         */
        await runtime.cleanSessions();

        return Response.json({
          success: true,
          workdir: runtime.workdir,
          projectId: runtime.projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Boot failed';
        logger.error(`Boot failed for "${projectId}":`, error);

        return Response.json({ error: message }, { status: 500 });
      }
    }

    case 'exec': {
      const { command, cwd, env } = body;

      if (cwd && !isSafePath(cwd)) {
        return Response.json({ error: 'Invalid cwd: traversal detected' }, { status: 400 });
      }

      const validation = validateCommand(command);

      if (!validation.allowed) {
        logger.warn(`Blocked command for project "${projectId}": ${command}`);

        return Response.json(
          {
            error: `Command blocked: ${validation.reason}`,
            exitCode: 1,
            output: `Command blocked: ${validation.reason}`,
          },
          { status: 403 },
        );
      }

      auditCommand(projectId, command, 'exec');

      try {
        const runtime = await manager.getRuntime(projectId);
        const timeoutMs = body.timeout ?? DEFAULT_EXEC_TIMEOUT_MS;

        const result = await runtime.exec(command, { cwd, env, timeout: timeoutMs });

        return Response.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Exec failed';
        logger.error(`Exec failed: ${command}`, error);

        return Response.json({ error: message, exitCode: 1, output: message }, { status: 500 });
      }
    }

    case 'teardown': {
      try {
        await manager.removeRuntime(projectId);
        return Response.json({ success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Teardown failed';
        logger.error(`Teardown failed for "${projectId}":`, error);

        return Response.json({ error: message }, { status: 500 });
      }
    }

    case 'allocatePort': {
      try {
        const runtime = await manager.getRuntime(projectId);
        const port = await runtime.allocatePort();

        return Response.json({ port });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Port allocation failed';
        logger.error(`Port allocation failed for "${projectId}":`, error);

        return Response.json({ error: message }, { status: 500 });
      }
    }

    default: {
      return Response.json({ error: `Unknown operation: ${op}` }, { status: 400 });
    }
  }
}

/*
 * ---------------------------------------------------------------------------
 * Exports
 * ---------------------------------------------------------------------------
 */

export const loader = withSecurity(execLoader, { rateLimit: false });
export const action = withSecurity(execAction, { rateLimit: false });
