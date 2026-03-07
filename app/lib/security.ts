import { timingSafeEqual } from 'node:crypto';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('Security');

// Rate limiting store (in-memory for serverless environments)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Rate limit configuration
const RATE_LIMITS = {
  // General API endpoints
  '/api/*': { windowMs: 15 * 60 * 1000, maxRequests: 100 }, // 100 requests per 15 minutes

  // LLM API (more restrictive)
  '/api/llmcall': { windowMs: 60 * 1000, maxRequests: 10 }, // 10 requests per minute

  // GitHub API endpoints
  '/api/github-*': { windowMs: 60 * 1000, maxRequests: 30 }, // 30 requests per minute

  // Netlify API endpoints
  '/api/netlify-*': { windowMs: 60 * 1000, maxRequests: 20 }, // 20 requests per minute
};

/**
 * Rate limiting middleware
 */
export function checkRateLimit(request: Request, endpoint: string): { allowed: boolean; resetTime?: number } {
  const clientIP = getClientIP(request);
  const key = `${clientIP}:${endpoint}`;

  // Find matching rate limit rule (prefer specific over wildcard)
  const entries = Object.entries(RATE_LIMITS);

  // Check exact matches first
  const exactMatch = entries.find(([pattern]) => pattern === endpoint);

  // Then check prefix patterns (e.g. '/api/github-*')
  const prefixMatch = entries.find(([pattern]) => {
    if (pattern.endsWith('-*')) {
      const basePattern = pattern.slice(0, -1);
      return endpoint.startsWith(basePattern);
    }

    return false;
  });

  // Then check wildcard patterns (e.g. '/api/*')
  const wildcardMatch = entries.find(([pattern]) => {
    if (pattern.endsWith('/*')) {
      const basePattern = pattern.slice(0, -2);
      return endpoint.startsWith(basePattern);
    }

    return false;
  });

  const rule = exactMatch || prefixMatch || wildcardMatch;

  if (!rule) {
    return { allowed: true }; // No rate limit for this endpoint
  }

  const [, config] = rule;
  const now = Date.now();

  // Clean up expired entries — resetTime is the absolute expiry timestamp
  for (const [storedKey, data] of rateLimitStore.entries()) {
    if (data.resetTime < now) {
      rateLimitStore.delete(storedKey);
    }
  }

  // Get or create rate limit data
  const rateLimitData = rateLimitStore.get(key) || { count: 0, resetTime: now + config.windowMs };

  if (rateLimitData.count >= config.maxRequests) {
    return { allowed: false, resetTime: rateLimitData.resetTime };
  }

  // Update rate limit data
  rateLimitData.count++;
  rateLimitStore.set(key, rateLimitData);

  return { allowed: true };
}

/**
 * Get client IP address from request
 */
function getClientIP(request: Request): string {
  // Try various headers that might contain the real IP
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const cfConnectingIP = request.headers.get('cf-connecting-ip');

  // Return the first available IP or a fallback
  return cfConnectingIP || realIP || forwardedFor?.split(',')[0]?.trim() || 'unknown';
}

/**
 * Build a Content Security Policy string based on environment context.
 *
 * ### CSP strategy
 *
 * Full nonce-based CSP is impractical in this Remix/React stack because
 * UnoCSS, Radix UI portals and Framer Motion all inject inline styles,
 * and the theme-init script runs inline before React hydrates.
 *
 * **`style-src 'unsafe-inline'`** — kept in every environment.  Migrating
 * all inline styles to external sheets or nonces is not feasible today.
 *
 * **`script-src 'unsafe-eval'`** — allowed **only in development** so Vite
 * HMR can function.  Removed entirely in production.
 *
 * **`script-src 'unsafe-inline'`** — kept for the theme-init script that
 * must run before hydration.  In production, when `'strict-dynamic'` is
 * present, modern browsers ignore `'unsafe-inline'`; it remains as a
 * fallback for older user-agents.
 *
 * **`script-src 'strict-dynamic'`** — added in production so that scripts
 * loaded by trusted first-party scripts are automatically trusted without
 * needing an explicit allowlist for every sub-resource.
 *
 * **`upgrade-insecure-requests`** — added in production to automatically
 * promote any remaining HTTP sub-resource requests to HTTPS.
 *
 * **`object-src 'none'`**, **`base-uri 'self'`**, **`form-action 'self'`**
 * harden against plugin injection, base-tag hijacking and form-action
 * hijacking respectively.
 *
 * @param isProduction - Whether the app is running in production mode.
 * @returns The assembled CSP header value.
 */
export function buildContentSecurityPolicy(isProduction: boolean): string {
  const scriptSrc = isProduction
    ? "script-src 'self' 'unsafe-inline' 'strict-dynamic'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

  const directives: string[] = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: blob:",
    "font-src 'self' data:",
    [
      "connect-src 'self'",

      // Git providers
      'https://api.github.com',
      'https://models.github.ai',
      'https://gitlab.com',

      // Deployment platforms
      'https://api.netlify.com',
      'https://api.vercel.com',
      'https://*.supabase.co',
      'https://api.supabase.com',

      // LLM providers - Major
      'https://api.openai.com',
      'https://api.anthropic.com',
      'https://generativelanguage.googleapis.com',

      // LLM providers - Other
      'https://api.groq.com',
      'https://api.mistral.ai',
      'https://api.cohere.com',
      'https://api.deepseek.com',
      'https://api.perplexity.ai',
      'https://api.x.ai',
      'https://api.together.xyz',
      'https://api.hyperbolic.xyz',
      'https://api.moonshot.ai',
      'https://openrouter.ai',
      'https://api-inference.huggingface.co',

      // WebSocket support for real-time features
      'wss://*.supabase.co',
    ].join(' '),
    "frame-src 'self' http://localhost:*",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  if (isProduction) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

/**
 * Security headers middleware.
 *
 * @param env - Optional override for the runtime environment
 *              (defaults to `process.env.NODE_ENV`).
 */
export function createSecurityHeaders(env?: string) {
  const isProduction = (env ?? process.env.NODE_ENV) === 'production';

  return {
    // Prevent clickjacking
    'X-Frame-Options': 'DENY',

    // Prevent MIME type sniffing
    'X-Content-Type-Options': 'nosniff',

    // Enable XSS protection
    'X-XSS-Protection': '1; mode=block',

    // Content Security Policy
    'Content-Security-Policy': buildContentSecurityPolicy(isProduction),

    // Referrer Policy
    'Referrer-Policy': 'strict-origin-when-cross-origin',

    // Permissions Policy (formerly Feature Policy)
    'Permissions-Policy': ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()'].join(', '),

    // HSTS (HTTP Strict Transport Security) - only in production
    ...(isProduction
      ? {
          'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
        }
      : {}),
  };
}

/**
 * Validate API key format (basic validation)
 */
export function validateApiKeyFormat(apiKey: string, provider: string): boolean {
  if (!apiKey || typeof apiKey !== 'string') {
    return false;
  }

  // Basic length checks for different providers
  const minLengths: Record<string, number> = {
    anthropic: 50,
    openai: 50,
    groq: 50,
    google: 30,
    github: 30,
    netlify: 30,
  };

  const minLength = minLengths[provider.toLowerCase()] || 20;

  return apiKey.length >= minLength && !apiKey.includes('your_') && !apiKey.includes('here');
}

/**
 * Sanitize error messages to prevent information leakage
 */
export function sanitizeErrorMessage(error: unknown, isDevelopment = false): string {
  if (isDevelopment) {
    // In development, show full error details
    return error instanceof Error ? error.message : String(error);
  }

  // In production, show generic messages to prevent information leakage
  if (error instanceof Error) {
    // Check for sensitive information in error messages
    if (error.message.includes('API key') || error.message.includes('token') || error.message.includes('secret')) {
      return 'Authentication failed';
    }

    if (error.message.includes('rate limit') || error.message.includes('429')) {
      return 'Rate limit exceeded. Please try again later.';
    }
  }

  return 'An unexpected error occurred';
}

/**
 * Validates the auth token from the request against the configured
 * `DEVONZ_AUTH_TOKEN` environment variable.
 *
 * Token is read from the `X-Auth-Token` header or the `devonz-auth` cookie.
 * If `DEVONZ_AUTH_TOKEN` is not set, auth is bypassed (local dev friendly).
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param request - The incoming request to validate.
 * @returns `true` if the token is valid or if no auth token is configured.
 */
export function validateAuthToken(request: Request): boolean {
  const expected = process.env.DEVONZ_AUTH_TOKEN;

  // If no auth token is configured, bypass auth (local dev friendly)
  if (!expected) {
    return true;
  }

  // Extract token from X-Auth-Token header
  let token = request.headers.get('X-Auth-Token');

  // Fall back to devonz-auth cookie
  if (!token) {
    const cookies = request.headers.get('Cookie') ?? '';
    const match = cookies.match(/(?:^|;\s*)devonz-auth=([^;]*)/);
    token = match?.[1] ?? null;
  }

  if (!token) {
    return false;
  }

  // Timing-safe comparison — both buffers must be the same length
  try {
    const expectedBuf = Buffer.from(expected, 'utf-8');
    const actualBuf = Buffer.from(token, 'utf-8');

    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }

    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

/**
 * Security wrapper for API routes.
 * Accepts handlers that may or may not consume the args parameter.
 */
export function withSecurity(
  handler: (args: ActionFunctionArgs | LoaderFunctionArgs) => Promise<Response> | Response,
  options: {
    requireAuth?: boolean;
    rateLimit?: boolean;
    allowedMethods?: string[];
  } = {},
) {
  return async (args: ActionFunctionArgs | LoaderFunctionArgs): Promise<Response> => {
    const { request } = args;
    const url = new URL(request.url);
    const endpoint = url.pathname;

    // Check allowed methods
    if (options.allowedMethods && !options.allowedMethods.includes(request.method)) {
      return new Response('Method not allowed', {
        status: 405,
        headers: createSecurityHeaders(),
      });
    }

    // Check auth token when requireAuth is enabled
    if (options.requireAuth && !validateAuthToken(request)) {
      logger.warn(`Unauthorized request to ${endpoint} from ${getClientIP(request)}`);

      return new Response(JSON.stringify({ error: true, message: 'Unauthorized' }), {
        status: 401,
        headers: {
          ...createSecurityHeaders(),
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer',
        },
      });
    }

    // Apply rate limiting
    if (options.rateLimit !== false) {
      const rateLimitResult = checkRateLimit(request, endpoint);

      if (!rateLimitResult.allowed) {
        return new Response('Rate limit exceeded', {
          status: 429,
          headers: {
            ...createSecurityHeaders(),
            'Retry-After': Math.ceil((rateLimitResult.resetTime! - Date.now()) / 1000).toString(),
            'X-RateLimit-Reset': rateLimitResult.resetTime!.toString(),
          },
        });
      }
    }

    try {
      // Execute the handler
      const response = await handler(args);

      // Add security headers to response
      const responseHeaders = new Headers(response.headers);
      Object.entries(createSecurityHeaders()).forEach(([key, value]) => {
        responseHeaders.set(key, value);
      });

      /*
       * For SSE / streaming responses we must NOT re-wrap the body in a new
       * Response — doing so loses the original controller reference and can
       * surface EPIPE errors when the client disconnects mid-stream.
       * Instead, mutate the original response headers in-place and return it.
       */
      const contentType = response.headers.get('Content-Type') ?? '';
      const isStreaming = contentType.includes('text/event-stream') || contentType.includes('application/octet-stream');

      if (isStreaming) {
        Object.entries(createSecurityHeaders()).forEach(([key, value]) => {
          response.headers.set(key, value);
        });

        return response;
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      // Silently ignore broken-pipe errors from SSE client disconnects
      const code = (error as NodeJS.ErrnoException)?.code;

      if (code === 'EPIPE' || code === 'ECONNRESET' || code === 'ERR_STREAM_WRITE_AFTER_END') {
        logger.debug('Client disconnected during response (ignored):', code);

        return new Response(null, { status: 499, headers: createSecurityHeaders() });
      }

      logger.error('Security-wrapped handler error:', error);

      const errorMessage = sanitizeErrorMessage(error, process.env.NODE_ENV === 'development');

      return new Response(
        JSON.stringify({
          error: true,
          message: errorMessage,
        }),
        {
          status: 500,
          headers: {
            ...createSecurityHeaders(),
            'Content-Type': 'application/json',
          },
        },
      );
    }
  };
}
