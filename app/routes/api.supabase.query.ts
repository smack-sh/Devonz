import { type ActionFunctionArgs } from '@remix-run/node';
import { handleApiError } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';

async function supabaseQueryAction({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    return new Response('No authorization token provided', { status: 401 });
  }

  return handleApiError(
    'api.supabase.query',
    async () => {
      const { projectId, query } = (await request.json()) as { projectId: string; query: string };

      const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;

        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText };
        }

        return new Response(
          JSON.stringify({
            error: {
              status: response.status,
              statusText: response.statusText,
              message: errorData.message || errorData.error || errorText,
              details: errorData,
            },
          }),
          {
            status: response.status,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      const result = await response.json();

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
    'Query execution failed',
  );
}

export const action = withSecurity(supabaseQueryAction, {
  allowedMethods: ['POST'],
  rateLimit: false,
});
