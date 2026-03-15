import { type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router';
import { ApiError, resolveToken, unauthorizedResponse, externalFetch, handleApiError } from '~/lib/api/apiUtils';
import { withSecurity } from '~/lib/security';

const VERCEL_TOKEN_KEYS = ['VITE_VERCEL_ACCESS_TOKEN'];

async function vercelUserLoader({ request, context }: LoaderFunctionArgs) {
  return handleApiError('VercelUser', async () => {
    const token = resolveToken(request, context, ...VERCEL_TOKEN_KEYS);

    if (!token) {
      return unauthorizedResponse('Vercel');
    }

    const response = await externalFetch({ url: 'https://api.vercel.com/v2/user', token });

    if (!response.ok) {
      if (response.status === 401) {
        return Response.json({ error: 'Invalid Vercel token' }, { status: 401 });
      }

      throw new ApiError(`Vercel API error: ${response.status}`, response.status);
    }

    const userData = (await response.json()) as {
      user: {
        id: string;
        name: string | null;
        email: string;
        avatar: string | null;
        username: string;
      };
    };

    return Response.json({
      id: userData.user.id,
      name: userData.user.name,
      email: userData.user.email,
      avatar: userData.user.avatar,
      username: userData.user.username,
    });
  });
}

export const loader = withSecurity(vercelUserLoader, {
  rateLimit: true,
  allowedMethods: ['GET'],
});

async function vercelUserAction({ request, context }: ActionFunctionArgs) {
  return handleApiError('VercelUser', async () => {
    const token = resolveToken(request, context, ...VERCEL_TOKEN_KEYS);

    if (!token) {
      return unauthorizedResponse('Vercel');
    }

    const formData = await request.formData();
    const action = formData.get('action');

    if (action === 'get_projects') {
      const response = await externalFetch({ url: 'https://api.vercel.com/v13/projects', token });

      if (!response.ok) {
        throw new ApiError(`Vercel API error: ${response.status}`, response.status);
      }

      const data = (await response.json()) as {
        projects: Array<{
          id: string;
          name: string;
          framework: string | null;
          public: boolean;
          createdAt: string;
          updatedAt: string;
        }>;
      };

      return Response.json({
        projects: data.projects.map((project) => ({
          id: project.id,
          name: project.name,
          framework: project.framework,
          public: project.public,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        })),
        totalProjects: data.projects.length,
      });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  });
}

export const action = withSecurity(vercelUserAction, {
  rateLimit: true,
  allowedMethods: ['POST'],
});
