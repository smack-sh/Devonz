import * as Sentry from '@sentry/node';
import type { AppLoadContext, EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';
import { isbot } from 'isbot';
import { renderToPipeableStream } from 'react-dom/server';
import { PassThrough } from 'node:stream';
import { createScopedLogger } from '~/utils/logger';

// Register AES-256-GCM decryptor for encrypted cookie values (side-effect import)
import '~/lib/.server/init-decryptor';

// Re-export WebSocket upgrade handler for custom server (server.ts) consumption
export { handleUpgrade as handleWebSocketUpgrade } from '~/lib/.server/ws/ws-server';

export function handleError(error: unknown) {
  if (Sentry.isInitialized()) {
    Sentry.captureException(error);
  }
}

const logger = createScopedLogger('EntryServer');

const ABORT_DELAY = 5_000;

/*
 * ---------------------------------------------------------------------------
 * Global EPIPE / connection-reset error handler
 * ---------------------------------------------------------------------------
 * SSE streams (portEvents, terminal, fs-watch) write to long-lived HTTP
 * sockets. When the browser tab closes or Vite HMR refreshes the page, the
 * socket is torn down before the server finishes writing.  Node.js surfaces
 * this as an EPIPE (write to broken pipe) or ECONNRESET error that —without
 * a handler— crashes the entire process.
 *
 * We catch these specific errors at the process level, log them at debug
 * level, and allow the server to continue.  All other uncaught exceptions
 * are re-thrown so they still crash loudly.
 * ---------------------------------------------------------------------------
 */
const IGNORABLE_EPIPE_CODES = new Set([
  'EPIPE',
  'ECONNRESET',
  'ERR_STREAM_WRITE_AFTER_END',
  'ERR_STREAM_PREMATURE_CLOSE',
]);

if (!(globalThis as Record<string, unknown>).__epipeHandlerInstalled) {
  (globalThis as Record<string, unknown>).__epipeHandlerInstalled = true;

  process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    if (IGNORABLE_EPIPE_CODES.has(err.code ?? '')) {
      logger.debug('Ignored broken-pipe error (client disconnected):', err.code);
      return;
    }

    // Re-throw anything that is NOT a broken-pipe error
    logger.error('Uncaught exception:', err);
    throw err;
  });

  process.on('unhandledRejection', (reason: unknown) => {
    if (reason instanceof Error && IGNORABLE_EPIPE_CODES.has((reason as NodeJS.ErrnoException).code ?? '')) {
      logger.debug('Ignored broken-pipe rejection (client disconnected):', (reason as NodeJS.ErrnoException).code);
      return;
    }

    logger.error('Unhandled rejection:', reason);
  });
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  const callbackName = isbot(request.headers.get('user-agent') || '') ? 'onAllReady' : 'onShellReady';

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(<ServerRouter context={remixContext} url={request.url} />, {
      [callbackName]: () => {
        shellRendered = true;

        const body = new PassThrough();

        responseHeaders.set('Content-Type', 'text/html');

        resolve(
          new Response(body as unknown as ReadableStream, {
            headers: responseHeaders,
            status: responseStatusCode,
          }),
        );

        // Write doctype (React doesn't emit it) then pipe the full document from Layout
        body.write('<!DOCTYPE html>');
        pipe(body);
      },
      onShellError(error: unknown) {
        reject(error);
      },
      onError(error: unknown) {
        responseStatusCode = 500;

        if (shellRendered) {
          logger.error(error);
        }
      },
    });

    setTimeout(abort, ABORT_DELAY);
  });
}
