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
  const windowStart = now - config.windowMs;

  // Clean up old entries
  for (const [storedKey, data] of rateLimitStore.entries()) {
    if (data.resetTime < windowStart) {
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
 * Security headers middleware
 */
export function createSecurityHeaders() {
  return {
    // Prevent clickjacking
    'X-Frame-Options': 'DENY',

    // Prevent MIME type sniffing
    'X-Content-Type-Options': 'nosniff',

    // Enable XSS protection
    'X-XSS-Protection': '1; mode=block',

    // Content Security Policy - restrict to same origin and trusted sources
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Allow inline scripts for React
      "style-src 'self' 'unsafe-inline'", // Allow inline styles
      "img-src 'self' data: https: blob:", // Allow images from same origin, data URLs, and HTTPS
      "font-src 'self' data:", // Allow fonts from same origin and data URLs
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
      "frame-src 'self' http://localhost:*", // Allow preview iframes from localhost dev servers
      "object-src 'none'", // Prevent object embedding
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),

    // Referrer Policy
    'Referrer-Policy': 'strict-origin-when-cross-origin',

    // Permissions Policy (formerly Feature Policy)
    'Permissions-Policy': ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()'].join(', '),

    // HSTS (HTTP Strict Transport Security) - only in production
    ...(process.env.NODE_ENV === 'production'
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
