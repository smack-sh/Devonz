/**
 * @route /api/runtime/terminal
 * Server-side API route for terminal session management.
 *
 * POST operations:
 *   - spawn: Create a new terminal session (shell or command)
 *   - write: Send input to a terminal session
 *   - resize: Resize terminal dimensions
 *   - kill: Terminate a terminal session
 *   - list: List active sessions for a project
 *
 * GET operations:
 *   - stream: SSE stream of terminal output for a session
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { existsSync } from 'node:fs';
import { RuntimeManager } from '~/lib/runtime/local-runtime';
import { validateCommand, auditCommand } from '~/lib/runtime/command-safety';
import { withSecurity } from '~/lib/security';
import { terminalRequestSchema, parseOrError } from '~/lib/api/schemas';
import { createScopedLogger } from '~/utils/logger';

/**
 * Resolve the native Git Bash path on Windows.
 * Prefers Git Bash over WSL bash to avoid WSL port-forwarding issues
 * and keep the project's dev server on the Windows network stack.
 */
let _resolvedGitBash: string | null | undefined;

function resolveGitBash(): string | null {
  if (_resolvedGitBash !== undefined) {
    return _resolvedGitBash;
  }

  const candidates = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'];

  for (const p of candidates) {
    if (existsSync(p)) {
      _resolvedGitBash = p;
      return p;
    }
  }

  _resolvedGitBash = null;

  return null;
}

const logger = createScopedLogger('RuntimeTerminal');

/*
 * ---------------------------------------------------------------------------
 * GET — SSE output streaming
 * ---------------------------------------------------------------------------
 */

async function terminalLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const op = url.searchParams.get('op');

  switch (op) {
    case 'stream': {
      const sessionId = url.searchParams.get('sessionId');

      if (!sessionId) {
        return Response.json({ error: 'Missing sessionId' }, { status: 400 });
      }

      // Find the session across all runtimes
      const manager = RuntimeManager.getInstance();
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          // Search all runtimes for the session
          for (const projectId of manager.listProjects()) {
            // We need to use an async IIFE to manage the Promise-based getRuntime
            void (async () => {
              try {
                const runtime = await manager.getRuntime(projectId);
                const session = runtime.getSession(sessionId);

                if (!session) {
                  return;
                }

                // Register data listener for this session
                session.dataListeners.push((data: string) => {
                  try {
                    const payload = JSON.stringify({ type: 'data', data });
                    controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
                  } catch {
                    // Stream may have been closed
                  }
                });

                // Listen for process exit
                session.exitPromise
                  .then((exitCode) => {
                    try {
                      const payload = JSON.stringify({ type: 'exit', exitCode });
                      controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
                      controller.close();
                    } catch {
                      // Stream may already be closed
                    }
                  })
                  .catch(() => {
                    try {
                      controller.close();
                    } catch {
                      // Already closed
                    }
                  });

                // Send initial heartbeat
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`));
              } catch (err) {
                logger.error('Error setting up terminal stream:', err);
              }
            })();
          }

          // Heartbeat every 15 seconds
          const heartbeat = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`));
            } catch {
              clearInterval(heartbeat);
            }
          }, 15_000);

          // Clean up on disconnect
          request.signal.addEventListener('abort', () => {
            clearInterval(heartbeat);

            try {
              controller.close();
            } catch {
              // Already closed
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
 * POST — Session management
 * ---------------------------------------------------------------------------
 */

async function terminalAction({ request }: ActionFunctionArgs) {
  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  const parsed = parseOrError(terminalRequestSchema, rawBody, 'RuntimeTerminal');

  if (!parsed.success) {
    return parsed.response;
  }

  const body = parsed.data;
  const { op } = body;

  switch (op) {
    case 'spawn': {
      const { projectId, command, cols, rows, env, cwd } = body;

      /*
       * Normalize shell command for the current platform.
       * The client (browser) cannot detect the OS and defaults to /bin/bash.
       * On Windows, prefer Git Bash over WSL bash to keep the dev server on
       * the native Windows network stack and avoid WSL port-forwarding issues.
       */
      let shellCommand = command ?? '';

      if (process.platform === 'win32' && shellCommand) {
        // Strip Unix-style absolute path prefix (e.g. /bin/bash → bash)
        const stripped = shellCommand.replace(/^\/(?:usr\/)?bin\/((?:ba|z|fi|da)sh)\b/, '$1');

        // If the command resolves to a simple bash name, prefer Git Bash
        if (/^bash\b/.test(stripped)) {
          const gitBash = resolveGitBash();

          if (gitBash) {
            shellCommand = stripped.replace(/^bash/, `"${gitBash}"`);
            logger.debug(`Using Git Bash: ${shellCommand}`);
          } else {
            shellCommand = stripped;
            logger.debug(`Git Bash not found, falling back to PATH bash: ${shellCommand}`);
          }
        } else {
          shellCommand = stripped;
        }
      }

      if (!shellCommand) {
        shellCommand = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
      }

      if (command) {
        const validation = validateCommand(command);

        if (!validation.allowed) {
          logger.warn(`Blocked terminal command for project "${projectId}": ${command}`);
          return Response.json({ error: `Command blocked: ${validation.reason}` }, { status: 403 });
        }
      }

      auditCommand(projectId, shellCommand, 'terminal');

      try {
        const manager = RuntimeManager.getInstance();
        const runtime = await manager.getRuntime(projectId);

        const spawnedProcess = await runtime.spawn(shellCommand, [], {
          terminal: { cols: cols ?? 80, rows: rows ?? 24 },
          env,
          cwd,
        });

        return Response.json({
          sessionId: spawnedProcess.id,
          pid: spawnedProcess.pid,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Spawn failed';
        logger.error('Terminal spawn failed:', error);

        return Response.json({ error: message }, { status: 500 });
      }
    }

    case 'write': {
      const { sessionId, data } = body;

      try {
        const manager = RuntimeManager.getInstance();

        // Search all runtimes for the session
        for (const projectId of manager.listProjects()) {
          const runtime = await manager.getRuntime(projectId);

          try {
            runtime.writeToSession(sessionId, data);
            return Response.json({ success: true });
          } catch {
            // Session not in this runtime, try next
          }
        }

        return Response.json({ error: 'Session not found' }, { status: 404 });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Write failed';
        logger.error('Terminal write failed:', error);

        return Response.json({ error: message }, { status: 500 });
      }
    }

    case 'resize': {
      const { sessionId, cols, rows } = body;

      // Resize is a no-op for basic child_process (Phase 2: node-pty)
      logger.debug(`Resize request for ${sessionId}: ${cols}x${rows} (no-op in Phase 1)`);

      return Response.json({ success: true });
    }

    case 'kill': {
      const { sessionId, signal } = body;

      try {
        const manager = RuntimeManager.getInstance();

        for (const projectId of manager.listProjects()) {
          const runtime = await manager.getRuntime(projectId);

          try {
            runtime.killSession(sessionId, signal ?? 'SIGTERM');
            return Response.json({ success: true });
          } catch {
            // Session not in this runtime, try next
          }
        }

        return Response.json({ error: 'Session not found' }, { status: 404 });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Kill failed';
        logger.error('Terminal kill failed:', error);

        return Response.json({ error: message }, { status: 500 });
      }
    }

    case 'list': {
      const { projectId } = body;

      try {
        const manager = RuntimeManager.getInstance();
        const runtime = await manager.getRuntime(projectId);
        const sessions = runtime.listSessions();

        return Response.json({ sessions });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'List failed';
        logger.error('Terminal list failed:', error);

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

export const loader = withSecurity(terminalLoader, { rateLimit: false });
export const action = withSecurity(terminalAction, { rateLimit: false });
