/**
 * Vercel API Client
 *
 * A client-side utility for making Vercel API requests through the server proxy.
 * This bypasses CORS restrictions by routing all requests through /api/vercel-proxy.
 *
 * Usage:
 *   import { vercelApi } from '~/lib/api/vercel-client';
 *
 *   // GET user info
 *   const user = await vercelApi.get('/v2/user');
 *
 *   // GET projects
 *   const projects = await vercelApi.get('/v9/projects');
 *
 *   // POST deployment
 *   const deployment = await vercelApi.post('/v1/deployments', token, { name: 'my-project' });
 */

interface VercelApiError {
  error: string;
  details?: unknown;
}

interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

class VercelApiClient {
  private _proxyEndpoint = '/api/vercel-proxy';

  /**
   * Make a GET request to Vercel API
   */
  async get<T = unknown>(endpoint: string, token: string): Promise<ApiResult<T>> {
    return this._request<T>('GET', endpoint, token);
  }

  /**
   * Make a POST request to Vercel API
   */
  async post<T = unknown>(endpoint: string, token: string, body?: Record<string, unknown>): Promise<ApiResult<T>> {
    return this._request<T>('POST', endpoint, token, body);
  }

  /**
   * Make a PUT request to Vercel API
   */
  async put<T = unknown>(endpoint: string, token: string, body?: Record<string, unknown>): Promise<ApiResult<T>> {
    return this._request<T>('PUT', endpoint, token, body);
  }

  /**
   * Make a DELETE request to Vercel API
   */
  async delete<T = unknown>(endpoint: string, token: string): Promise<ApiResult<T>> {
    return this._request<T>('DELETE', endpoint, token);
  }

  /**
   * Make a request to Vercel API through the proxy
   */
  private async _request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    endpoint: string,
    token: string,
    body?: Record<string, unknown>,
  ): Promise<ApiResult<T>> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };

      const response = await fetch(this._proxyEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          endpoint,
          method,
          body,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const error = data as VercelApiError;
        return { success: false, error: error.error || `Vercel API error: ${response.status}` };
      }

      return { success: true, data: data as T };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Request failed' };
    }
  }

  /**
   * Test connection to Vercel (simple GET to /v2/user)
   */
  async testConnection(token: string): Promise<{
    success: boolean;
    data?: { user?: { id: string; username: string; email: string; name?: string; avatar?: string } };
    error?: string;
  }> {
    try {
      const response = await fetch(this._proxyEndpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        return { success: false, error: errorData.error || 'Connection failed' };
      }

      const data = (await response.json()) as {
        user?: { id: string; username: string; email: string; name?: string; avatar?: string };
      };

      return {
        success: true,
        data,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  /**
   * List domains for a project
   */
  async listDomains(
    projectId: string,
    token: string,
  ): Promise<{
    success: boolean;
    domains?: Array<{ name: string; verified: boolean }>;
    error?: string;
  }> {
    try {
      const response = await fetch(`/api/vercel-domains?projectId=${encodeURIComponent(projectId)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to list domains' };
      }

      return { success: true, domains: data.domains || [] };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to list domains' };
    }
  }

  /**
   * Add a domain to a project
   */
  async addDomain(
    projectId: string,
    domain: string,
    token: string,
  ): Promise<{
    success: boolean;
    domain?: { name: string; verified: boolean };
    error?: string;
  }> {
    try {
      const response = await fetch('/api/vercel-domains', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId,
          action: 'add',
          domain,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to add domain' };
      }

      return { success: true, domain: data.domain };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to add domain' };
    }
  }

  /**
   * Remove a domain from a project
   */
  async removeDomain(
    projectId: string,
    domain: string,
    token: string,
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const response = await fetch('/api/vercel-domains', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId,
          action: 'remove',
          domain,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to remove domain' };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to remove domain' };
    }
  }
}

// Export singleton instance
export const vercelApi = new VercelApiClient();

/**
 * Legacy helper for direct fetch replacement
 * Use this for quick migration from direct API calls
 *
 * Instead of:
 *   fetch('https://api.vercel.com/v2/user', { headers: { Authorization: `Bearer ${token}` } })
 *
 * Use:
 *   fetchVercelApi('/v2/user', token)
 */
export async function fetchVercelApi(
  endpoint: string,
  token: string,
  options?: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: Record<string, unknown>;
    params?: Record<string, string>;
  },
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch('/api/vercel-proxy', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      endpoint,
      method: options?.method || 'GET',
      body: options?.body,
      params: options?.params,
    }),
  });

  return response;
}
