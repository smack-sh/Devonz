import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Hoist mock refs so they exist when vi.mock factories run
const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn(),
}));

// Mock the cookies module - we control return value via mockReturnValue in tests
vi.mock('~/lib/api/cookies', () => ({
  getApiKeysFromCookie: vi.fn(() => ({})),
}));

// Mock the logger for handleApiError tests - capture error fn to assert it was called
vi.mock('~/utils/logger', () => ({
  createScopedLogger: () => ({
    error: mockLoggerError,
  }),
}));

import { ApiError, resolveToken, unauthorizedResponse, externalFetch, handleApiError } from './apiUtils';

// Import getApiKeysFromCookie for direct control in resolveToken tests
import { getApiKeysFromCookie } from '~/lib/api/cookies';

function createRequest(overrides: { headers?: Record<string, string> } = {}) {
  return new Request('http://localhost/test', {
    headers: overrides.headers ?? {},
  });
}

describe('apiUtils', () => {
  describe('ApiError', () => {
    it('has correct name, message, and status', () => {
      const err = new ApiError('Forbidden', 403);
      expect(err.name).toBe('ApiError');
      expect(err.message).toBe('Forbidden');
      expect(err.status).toBe(403);
    });

    it('is instanceof Error', () => {
      const err = new ApiError('Bad request', 400);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ApiError);
    });
  });

  describe('resolveToken', () => {
    const mockGetApiKeysFromCookie = vi.mocked(getApiKeysFromCookie);

    beforeEach(() => {
      vi.clearAllMocks();

      // Reset process.env for tests that use it
      delete process.env.TOKEN_KEY_1;
      delete process.env.TOKEN_KEY_2;
    });

    afterEach(() => {
      delete process.env.TOKEN_KEY_1;
      delete process.env.TOKEN_KEY_2;
    });

    it('returns cookie value when available (first priority)', () => {
      mockGetApiKeysFromCookie.mockReturnValue({ TOKEN_KEY_1: 'cookie-token' });

      const request = createRequest({ headers: { Cookie: 'apiKeys={"TOKEN_KEY_1":"cookie-token"}' } });
      expect(resolveToken(request, undefined, 'TOKEN_KEY_1')).toBe('cookie-token');
    });

    it('returns cloudflare env value when no cookie', () => {
      mockGetApiKeysFromCookie.mockReturnValue({});

      const request = createRequest();
      const context = {
        cloudflare: { env: { TOKEN_KEY_1: 'cf-token' } },
      };
      expect(resolveToken(request, context, 'TOKEN_KEY_1')).toBe('cf-token');
    });

    it('returns process.env value when no cookie or cloudflare', () => {
      mockGetApiKeysFromCookie.mockReturnValue({});
      process.env.TOKEN_KEY_1 = 'env-token';

      const request = createRequest();
      expect(resolveToken(request, undefined, 'TOKEN_KEY_1')).toBe('env-token');
    });

    it('returns Authorization header bearer token as last resort', () => {
      mockGetApiKeysFromCookie.mockReturnValue({});

      const request = createRequest({
        headers: { Authorization: 'Bearer header-token' },
      });
      expect(resolveToken(request, undefined, 'TOKEN_KEY_1')).toBe('header-token');
    });

    it('returns null when no token found anywhere', () => {
      mockGetApiKeysFromCookie.mockReturnValue({});

      const request = createRequest();
      expect(resolveToken(request, undefined, 'TOKEN_KEY_1')).toBe(null);
    });

    it('cookie values take priority over env values for the SAME key', () => {
      mockGetApiKeysFromCookie.mockReturnValue({ TOKEN_KEY_1: 'cookie-wins' });
      process.env.TOKEN_KEY_1 = 'env-token';

      const request = createRequest({ headers: { Cookie: 'apiKeys={"TOKEN_KEY_1":"cookie-wins"}' } });
      const context = { cloudflare: { env: { TOKEN_KEY_1: 'cf-token' } } };
      expect(resolveToken(request, context, 'TOKEN_KEY_1')).toBe('cookie-wins');
    });

    it('cookie values for first key take priority over env values for second key', () => {
      mockGetApiKeysFromCookie.mockReturnValue({ TOKEN_KEY_1: 'cookie-first-key' });
      process.env.TOKEN_KEY_2 = 'env-second-key';

      const request = createRequest({ headers: { Cookie: 'apiKeys={"TOKEN_KEY_1":"cookie-first-key"}' } });
      const context = { cloudflare: { env: { TOKEN_KEY_2: 'cf-second-key' } } };

      // Cookie for first key should win over env for second key (priority: all cookies first, then all env)
      expect(resolveToken(request, context, 'TOKEN_KEY_1', 'TOKEN_KEY_2')).toBe('cookie-first-key');
    });

    it('handles undefined context gracefully', () => {
      mockGetApiKeysFromCookie.mockReturnValue({});
      process.env.TOKEN_KEY_1 = 'env-token';

      const request = createRequest();
      expect(resolveToken(request, undefined, 'TOKEN_KEY_1')).toBe('env-token');
    });
  });

  describe('unauthorizedResponse', () => {
    it('returns 401 status', async () => {
      const response = unauthorizedResponse('OpenAI');
      expect(response.status).toBe(401);
    });

    it('includes service name in error message', async () => {
      const response = unauthorizedResponse('GitHub');
      const body = await response.json();
      expect(body).toEqual({ error: 'GitHub token not found' });
    });
  });

  describe('handleApiError', () => {
    it('returns the fn result on success', async () => {
      const successResponse = new Response('OK', { status: 200 });
      const fn = vi.fn().mockResolvedValue(successResponse);
      const result = await handleApiError('test', fn);
      expect(result).toBe(successResponse);
      expect(fn).toHaveBeenCalled();
    });

    it('returns ApiError status code when ApiError is thrown', async () => {
      const fn = vi.fn().mockRejectedValue(new ApiError('Rate limited', 429));
      const result = await handleApiError('test', fn);
      expect(result.status).toBe(429);

      const body = await result.json();
      expect(body.error).toBe('Rate limited');
    });

    it('returns 503 for fetch/network errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fetch failed'));
      const result = await handleApiError('test', fn);
      expect(result.status).toBe(503);

      const body = await result.json();
      expect(body.error).toBe('Network error. Please check your connection.');
    });

    it('returns 500 for generic errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Something broke'));
      const result = await handleApiError('test', fn);
      expect(result.status).toBe(500);

      const body = await result.json();
      expect(body.error).toBe('Something broke');
    });

    it('returns fallback message for non-Error throws', async () => {
      const fn = vi.fn().mockRejectedValue('string error');
      const result = await handleApiError('test', fn, 'Custom fallback');
      expect(result.status).toBe(500);

      const body = await result.json();
      expect(body.error).toBe('Custom fallback');
    });

    it('logs errors', async () => {
      mockLoggerError.mockClear();

      const fn = vi.fn().mockRejectedValue(new Error('Logged error'));
      await handleApiError('test-scope', fn);
      expect(mockLoggerError).toHaveBeenCalledWith('[test-scope]', expect.any(Error));
    });
  });

  describe('externalFetch', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
      mockFetch.mockResolvedValue(new Response('{}'));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('adds Authorization Bearer header', async () => {
      await externalFetch({ url: 'https://api.example.com', token: 'my-token' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-token',
          }),
        }),
      );
    });

    it('adds User-Agent header', async () => {
      await externalFetch({ url: 'https://api.example.com', token: 'token' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'devonz-app',
          }),
        }),
      );
    });

    it('adds Content-Type for body requests', async () => {
      await externalFetch({
        url: 'https://api.example.com',
        token: 'token',
        body: { key: 'value' },
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ key: 'value' }),
        }),
      );
    });

    it('passes custom headers', async () => {
      await externalFetch({
        url: 'https://api.example.com',
        token: 'token',
        headers: { 'X-Custom': 'custom-value' },
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom': 'custom-value',
          }),
        }),
      );
    });

    it('uses correct HTTP method', async () => {
      await externalFetch({
        url: 'https://api.example.com',
        token: 'token',
        method: 'POST',
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('defaults to GET when method not specified', async () => {
      await externalFetch({ url: 'https://api.example.com', token: 'token' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com',
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });
  });
});
