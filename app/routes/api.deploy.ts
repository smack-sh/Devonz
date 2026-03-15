import type { ActionFunctionArgs } from 'react-router';
import { z } from 'zod';
import { withSecurity } from '~/lib/security';
import { handleApiError } from '~/lib/api/apiUtils';
import { createScopedLogger } from '~/utils/logger';
import { DeploymentService } from '~/lib/services/deployment-service';
import type { DeployStatusEvent } from '~/types/streaming-events';

const logger = createScopedLogger('ApiDeploy');

const deployRequestSchema = z.object({
  provider: z.enum(['vercel']),
  projectName: z.string().min(1).max(100),
  files: z.record(z.string(), z.string()),
  token: z.string().min(1),
  teamId: z.string().optional(),
});

async function deployAction({ request }: ActionFunctionArgs) {
  return handleApiError('Deploy.action', async () => {
    const rawBody: unknown = await request.json();

    const parsed = deployRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      logger.warn('Validation failed:', parsed.error.flatten());

      return Response.json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const { provider, projectName, files, token, teamId } = parsed.data;

    if (provider !== 'vercel') {
      return Response.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
    }

    logger.info(`Deploy request: provider=${provider}, project=${projectName}, files=${Object.keys(files).length}`);

    const service = new DeploymentService(token, teamId);

    const events: DeployStatusEvent[] = [];

    const onStatus = (event: DeployStatusEvent) => {
      events.push(event);
      logger.info(`Deploy status: ${event.state}`, event.url ?? '');
    };

    const controller = new AbortController();

    // Abort if the client disconnects
    request.signal.addEventListener('abort', () => {
      controller.abort();
    });

    try {
      const result = await service.deployToVercel(files, projectName, onStatus, controller.signal);

      return Response.json({
        success: true,
        url: result.url,
        deploymentId: result.deploymentId,
        events,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Deployment failed';
      logger.error('Deployment failed:', message);

      return Response.json(
        {
          success: false,
          error: message,
          events,
        },
        { status: 500 },
      );
    }
  });
}

export const action = withSecurity(deployAction, {
  allowedMethods: ['POST'],
  rateLimit: false,
});
