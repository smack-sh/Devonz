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

import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { RuntimeManager } from '~/lib/runtime/local-runtime';
import { isValidProjectId, isSafePath } from '~/lib/runtime/runtime-provider';
import { validateCommand, auditCommand, DEFAULT_EXEC_TIMEOUT_MS } from '~/lib/runtime/command-safety';
import { withSecurity } from '~/lib/security';
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
    return json({ error: 'Invalid or missing projectId' }, { status: 400 });
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
      return json({ error: `Unknown GET operation: ${op}` }, { status: 400 });
    }
  }
}

/*
 * ---------------------------------------------------------------------------
 * POST — Command execution & lifecycle
 * ---------------------------------------------------------------------------
 */

async function execAction({ request }: ActionFunctionArgs) {
  const body = await request.json();
  const { op, projectId } = body;

  if (!projectId || !isValidProjectId(projectId)) {
    return json({ error: 'Invalid or missing projectId' }, { status: 400 });
  }

  const manager = RuntimeManager.getInstance();

  switch (op) {
    case 'boot': {
      try {
        const runtime = await manager.getRuntime(projectId);

        return json({
          success: true,
          workdir: runtime.workdir,
          projectId: runtime.projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Boot failed';
        logger.error(`Boot failed for "${projectId}":`, error);

        return json({ error: message }, { status: 500 });
      }
    }

    case 'exec': {
      const { command, cwd, env } = body;

      if (!command || typeof command !== 'string') {
        return json({ error: 'Missing or invalid command' }, { status: 400 });
      }

      if (cwd && !isSafePath(cwd)) {
        return json({ error: 'Invalid cwd: traversal detected' }, { status: 400 });
      }

      const validation = validateCommand(command);

      if (!validation.allowed) {
        logger.warn(`Blocked command for project "${projectId}": ${command}`);

        return json(
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

        return json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Exec failed';
        logger.error(`Exec failed: ${command}`, error);

        return json({ error: message, exitCode: 1, output: message }, { status: 500 });
      }
    }

    case 'teardown': {
      try {
        await manager.removeRuntime(projectId);
        return json({ success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Teardown failed';
        logger.error(`Teardown failed for "${projectId}":`, error);

        return json({ error: message }, { status: 500 });
      }
    }

    default: {
      return json({ error: `Unknown operation: ${op}` }, { status: 400 });
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
