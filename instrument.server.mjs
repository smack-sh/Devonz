import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;
const environment = process.env.SENTRY_ENVIRONMENT || 'development';
const release = process.env.SENTRY_RELEASE || 'dev';
const isProduction = process.env.NODE_ENV === 'production';

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: isProduction ? 0.1 : 1.0,
  });
} else {
  // eslint-disable-next-line no-console
  console.warn('[Sentry] SENTRY_DSN not set — server-side error monitoring disabled.');
}
