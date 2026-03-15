import * as Sentry from '@sentry/remix';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 1.0,
    autoInstrumentRemix: true,
  });
} else {
  // eslint-disable-next-line no-console
  console.warn('[Sentry] SENTRY_DSN not set — server-side error monitoring disabled.');
}
