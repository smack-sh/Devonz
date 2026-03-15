import * as Sentry from '@sentry/node';

interface ApiErrorContext {
  route: string;
  method: string;
}

/**
 * Capture an API error to Sentry with route/method context and return a
 * sanitized JSON Response (no stack traces or internal details).
 */
export function captureApiError(error: unknown, context: ApiErrorContext): Response {
  const { route, method } = context;

  Sentry.withScope((scope: Sentry.Scope) => {
    scope.setTag('route', route);
    scope.setTag('method', method);

    Sentry.addBreadcrumb({
      category: 'api.error',
      message: `${method} ${route} failed`,
      level: 'error',
    });

    Sentry.captureException(error);
  });

  return new Response(JSON.stringify({ error: 'Internal server error' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}
