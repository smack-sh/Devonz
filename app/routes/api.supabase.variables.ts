import { json, type ActionFunctionArgs } from '@remix-run/node';
import { handleApiError, externalFetch, ApiError } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';

async function supabaseVariablesAction({ request }: ActionFunctionArgs) {
  return handleApiError('SupabaseVars', async () => {
    const body = (await request.json()) as { projectId?: string; token?: string };
    const { projectId, token } = body;

    if (!projectId || !token) {
      return json({ error: 'Project ID and token are required' }, { status: 400 });
    }

    const response = await externalFetch({
      url: `https://api.supabase.com/v1/projects/${projectId}/api-keys`,
      token,
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new ApiError(`Failed to fetch API keys: ${response.statusText}`, response.status);
    }

    const apiKeys = await response.json();

    return json({ apiKeys });
  });
}

export const action = withSecurity(supabaseVariablesAction, {
  allowedMethods: ['POST'],
  rateLimit: false,
});
