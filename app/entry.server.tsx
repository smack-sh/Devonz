import * as Sentry from '@sentry/remix';
import type { AppLoadContext, EntryContext } from '@remix-run/node';
import { RemixServer } from '@remix-run/react';
import { isbot } from 'isbot';
import { renderToPipeableStream } from 'react-dom/server';
import { renderHeadToString } from 'remix-island';
import { Head } from './root';
import { themeStore } from '~/lib/stores/theme';
import { PassThrough, Transform } from 'node:stream';
import { createScopedLogger } from '~/utils/logger';

// Register AES-256-GCM decryptor for encrypted cookie values (side-effect import)
import '~/lib/.server/init-decryptor';

// Re-export WebSocket upgrade handler for custom server (server.ts) consumption
export { handleUpgrade as handleWebSocketUpgrade } from '~/lib/.server/ws/ws-server';

export const handleError = Sentry.wrapHandleErrorWithSentry;

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
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer context={remixContext} url={request.url} abortDelay={ABORT_DELAY} />,
      {
        [callbackName]: () => {
          shellRendered = true;

          const body = new PassThrough();
          const head = renderHeadToString({ request, remixContext, Head });

          responseHeaders.set('Content-Type', 'text/html');

          /*
           * COEP/COOP headers removed — they were only required by the
           * WebContainer runtime.  The local runtime doesn't need them,
           * and they interfere with cross-origin iframe loading
           * (e.g. project preview on a different localhost port).
           * See plan/adr-001-local-runtime-migration.md §18.
           */

          // Write the HTML shell
          body.write(
            `<!DOCTYPE html><html lang="en" data-theme="${themeStore.value}"><head>${head}</head><body><noscript><p style="padding:2rem;color:#fff;background:#0a0a0a;text-align:center">JavaScript is required to use Devonz.</p></noscript><div id="root" class="w-full h-full">`,
          );

          resolve(
            new Response(body as unknown as ReadableStream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );

          // Create a transform stream to append closing tags after React content
          const appendClosingTags = new Transform({
            transform(chunk, encoding, callback) {
              callback(null, chunk);
            },
            flush(callback) {
              this.push('</div></body></html>');
              callback();
            },
          });

          // Pipe React content through transform (which appends closing tags) to body
          pipe(appendClosingTags).pipe(body);
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
      },
    );

    setTimeout(abort, ABORT_DELAY);
  });
}
