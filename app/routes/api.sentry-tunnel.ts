import { type ActionFunctionArgs } from 'react-router';

const MAX_BODY_SIZE = 1_048_576; // 1 MB

const ALLOWED_HOST_PATTERN = /^[a-z0-9-]+\.ingest(?:\.us)?\.sentry\.io$/;

/**
 * POST /api/sentry-tunnel
 *
 * Proxies Sentry event envelopes to the Sentry ingestion endpoint,
 * bypassing ad-blockers that block direct requests to sentry.io.
 *
 * The Sentry SDK sends envelopes as newline-delimited text where the
 * first line is a JSON header containing the DSN. We extract the DSN,
 * validate the target host against an allow-list, then forward the
 * raw envelope body upstream.
 *
 * This route intentionally does NOT use `withSecurity()` because
 * Sentry SDK requests do not carry CSRF tokens.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Enforce body size limit
  const contentLength = request.headers.get('content-length');

  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let envelope: string;

  try {
    envelope = await request.text();
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to read request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!envelope) {
    return new Response(JSON.stringify({ error: 'Empty envelope' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Additional size check for cases where Content-Length header is absent
  if (envelope.length > MAX_BODY_SIZE) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // The Sentry envelope format: first line is a JSON header with the DSN
  const firstNewline = envelope.indexOf('\n');

  if (firstNewline === -1) {
    return new Response(JSON.stringify({ error: 'Invalid envelope format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headerLine = envelope.slice(0, firstNewline);

  let header: { dsn?: string };

  try {
    header = JSON.parse(headerLine);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid envelope header' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const dsn = header.dsn;

  if (!dsn || typeof dsn !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing DSN in envelope header' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let dsnUrl: URL;

  try {
    dsnUrl = new URL(dsn);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid DSN format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sentryHost = dsnUrl.hostname;

  // SSRF protection: only allow known Sentry ingestion hosts
  if (!ALLOWED_HOST_PATTERN.test(sentryHost)) {
    return new Response(JSON.stringify({ error: 'Invalid Sentry host' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const projectId = dsnUrl.pathname.replace(/^\//, '');

  if (!projectId) {
    return new Response(JSON.stringify({ error: 'Missing project ID in DSN' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const upstreamUrl = `https://${sentryHost}/api/${projectId}/envelope/`;

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      body: envelope,
      headers: {
        'Content-Type': request.headers.get('content-type') || 'application/x-sentry-envelope',
      },
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: {
        'Content-Type': upstreamResponse.headers.get('content-type') || 'text/plain',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to forward envelope' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
