import * as Sentry from '@sentry/remix';
import { RemixBrowser } from '@remix-run/react';
import { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';

const sentryDsn = import.meta.env.SENTRY_DSN;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [Sentry.browserTracingIntegration({})],
  });
} else {
  console.warn('[Sentry] SENTRY_DSN not set — client-side error monitoring disabled.');
}

startTransition(() => {
  hydrateRoot(document.getElementById('root')!, <RemixBrowser />);
});
