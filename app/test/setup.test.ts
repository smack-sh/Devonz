/// <reference types="vitest/globals" />
import { createMockRequest, createMockContext } from '~/test/test-utils';

describe('test infrastructure smoke test', () => {
  it('vitest runs with globals enabled', () => {
    expect(true).toBe(true);
  });

  it('createMockRequest() creates a valid Request', () => {
    const req = createMockRequest({ method: 'GET', url: '/api/health' });

    expect(req).toBeInstanceOf(Request);
    expect(req.method).toBe('GET');
    expect(new URL(req.url).pathname).toBe('/api/health');
  });

  it('createMockRequest() supports search params', () => {
    const req = createMockRequest({
      url: '/api/check-env-key',
      searchParams: { provider: 'openai' },
    });

    const url = new URL(req.url);
    expect(url.searchParams.get('provider')).toBe('openai');
  });

  it('createMockRequest() supports JSON body for POST', async () => {
    const req = createMockRequest({
      method: 'POST',
      url: '/api/chat',
      body: { message: 'hello' },
    });

    expect(req.method).toBe('POST');
    expect(req.headers.get('Content-Type')).toBe('application/json');

    const body = await req.json();
    expect(body).toEqual({ message: 'hello' });
  });

  it('createMockContext() creates LoaderFunctionArgs-compatible object', () => {
    const ctx = createMockContext({
      url: '/api/health',
      params: { id: '123' },
      cloudflareEnv: { OPENAI_API_KEY: 'test-key' },
    });

    expect(ctx.request).toBeInstanceOf(Request);
    expect(ctx.params).toEqual({ id: '123' });
    expect(ctx.context).toBeDefined();
    expect((ctx.context as any).cloudflare.env.OPENAI_API_KEY).toBe('test-key');
  });
});
