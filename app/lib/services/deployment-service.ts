import { externalFetch } from '~/lib/api/apiUtils';
import { createScopedLogger } from '~/utils/logger';
import type { DeployStatusEvent } from '~/types/streaming-events';

const logger = createScopedLogger('DeploymentService');

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_DURATION_MS = 120_000;

interface DeploymentFile {
  file: string;
  data: string;
}

interface VercelDeploymentResponse {
  id: string;
  url?: string;
  readyState?: string;
  name?: string;
}

interface VercelApiErrorResponse {
  error?: { message: string; code?: string };
}

type StatusCallback = (event: DeployStatusEvent) => void;

function makeDeployEvent(
  state: DeployStatusEvent['state'],
  opts?: { url?: string; errorMessage?: string },
): DeployStatusEvent {
  return {
    type: 'deploy_status',
    timestamp: new Date().toISOString(),
    state,
    ...(opts?.url ? { url: opts.url } : {}),
    ...(opts?.errorMessage ? { errorMessage: opts.errorMessage } : {}),
  };
}

export class DeploymentService {
  private readonly _token: string;
  private readonly _teamId?: string;

  constructor(token: string, teamId?: string) {
    if (!token) {
      throw new Error('Vercel token is required');
    }

    this._token = token;
    this._teamId = teamId;
  }

  async deployToVercel(
    files: Record<string, string>,
    projectName: string,
    onStatus?: StatusCallback,
    signal?: AbortSignal,
  ): Promise<{ url: string; deploymentId: string }> {
    logger.info(`Starting deployment for project: ${projectName}`);

    const emit = (event: DeployStatusEvent) => {
      onStatus?.(event);
    };

    // --- Phase 1: Upload ---
    emit(makeDeployEvent('uploading'));

    const deploymentFiles: DeploymentFile[] = [];

    for (const [filePath, content] of Object.entries(files)) {
      const normalizedPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
      deploymentFiles.push({ file: normalizedPath, data: content });
    }

    if (deploymentFiles.length === 0) {
      const msg = 'No files to deploy';
      logger.error(msg);
      emit(makeDeployEvent('error', { errorMessage: msg }));
      throw new Error(msg);
    }

    const teamQuery = this._teamId ? `?teamId=${encodeURIComponent(this._teamId)}` : '';

    let deployResponse: Response;

    try {
      deployResponse = await externalFetch({
        url: `https://api.vercel.com/v13/deployments${teamQuery}`,
        token: this._token,
        method: 'POST',
        body: {
          name: projectName,
          files: deploymentFiles,
          target: 'preview',
        },
        timeoutMs: 60_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload request failed';
      logger.error('Deployment upload failed:', msg);
      emit(makeDeployEvent('error', { errorMessage: msg }));
      throw new Error(msg);
    }

    if (!deployResponse.ok) {
      const errorData = (await deployResponse.json().catch(() => ({}))) as VercelApiErrorResponse;
      const msg = errorData.error?.message ?? `Vercel API error: ${deployResponse.status}`;
      logger.error('Deployment creation failed:', msg);
      emit(makeDeployEvent('error', { errorMessage: msg }));
      throw new Error(msg);
    }

    const deployment = (await deployResponse.json()) as VercelDeploymentResponse;
    const deploymentId = deployment.id;

    logger.info(`Deployment created: ${deploymentId}`);

    // --- Phase 2: Poll for build completion ---
    emit(makeDeployEvent('building'));

    const startTime = Date.now();

    const url = await new Promise<string>((resolve, reject) => {
      const poll = async () => {
        if (signal?.aborted) {
          const msg = 'Deployment cancelled';
          logger.info(msg);
          emit(makeDeployEvent('error', { errorMessage: msg }));
          reject(new Error(msg));

          return;
        }

        const elapsed = Date.now() - startTime;

        if (elapsed >= MAX_POLL_DURATION_MS) {
          const msg = `Deployment timed out after ${MAX_POLL_DURATION_MS / 1_000} seconds`;
          logger.error(msg);
          emit(makeDeployEvent('error', { errorMessage: msg }));
          reject(new Error(msg));

          return;
        }

        try {
          const statusResponse = await externalFetch({
            url: `https://api.vercel.com/v13/deployments/${deploymentId}${teamQuery}`,
            token: this._token,
            timeoutMs: 15_000,
          });

          if (!statusResponse.ok) {
            logger.warn(`Status poll returned ${statusResponse.status}, retrying…`);
            scheduleNext();

            return;
          }

          const status = (await statusResponse.json()) as VercelDeploymentResponse;
          const readyState = status.readyState ?? '';

          if (readyState === 'READY') {
            const deployUrl = status.url ? `https://${status.url}` : `https://${projectName}.vercel.app`;
            logger.info(`Deployment ready: ${deployUrl}`);
            emit(makeDeployEvent('ready', { url: deployUrl }));
            resolve(deployUrl);

            return;
          }

          if (readyState === 'ERROR' || readyState === 'CANCELED') {
            const msg = `Deployment ended with state: ${readyState}`;
            logger.error(msg);
            emit(makeDeployEvent('error', { errorMessage: msg }));
            reject(new Error(msg));

            return;
          }

          // Still building — schedule next poll
          scheduleNext();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Status poll failed';
          logger.warn(`Poll error: ${msg}, retrying…`);
          scheduleNext();
        }
      };

      const scheduleNext = () => {
        setTimeout(poll, POLL_INTERVAL_MS);
      };

      // First poll immediately after a short delay for the API to register
      setTimeout(poll, 1_000);
    });

    return { url, deploymentId };
  }
}
