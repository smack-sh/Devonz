import { atom } from 'nanostores';
import type { VercelConnection, VercelUserResponse, VercelProject } from '~/types/vercel';
import { logStore } from './logs';
import { toast } from 'react-toastify';
import { vercelApi } from '~/lib/api/vercel-client';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('VercelStore');

// Auto-connect using environment variable
const envToken = import.meta.env?.VITE_VERCEL_ACCESS_TOKEN;

// Initialize with stored connection or defaults
const storedConnection = typeof window !== 'undefined' ? localStorage.getItem('vercel_connection') : null;
let initialConnection: VercelConnection;

if (storedConnection) {
  try {
    const parsed = JSON.parse(storedConnection);

    // If we have a stored connection but no user and no token, clear it and use env token
    if (!parsed.user && !parsed.token && envToken) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('vercel_connection');
      }

      initialConnection = {
        user: null,
        token: envToken,
        stats: undefined,
      };
    } else {
      initialConnection = parsed;
    }
  } catch (error) {
    logger.error('Error parsing saved Vercel connection:', error);
    initialConnection = {
      user: null,
      token: envToken || '',
      stats: undefined,
    };
  }
} else {
  initialConnection = {
    user: null,
    token: envToken || '',
    stats: undefined,
  };
}

export const vercelConnection = atom<VercelConnection>(initialConnection);
export const isConnecting = atom<boolean>(false);
export const isFetchingStats = atom<boolean>(false);

export const updateVercelConnection = (updates: Partial<VercelConnection>) => {
  const currentState = vercelConnection.get();
  const newState = { ...currentState, ...updates };
  vercelConnection.set(newState);

  // Persist to localStorage
  if (typeof window !== 'undefined') {
    localStorage.setItem('vercel_connection', JSON.stringify(newState));
  }
};

// Auto-connect using environment token
export async function autoConnectVercel() {
  if (!envToken) {
    logger.error('No Vercel token found in environment');
    return { success: false, error: 'No Vercel token found in environment' };
  }

  try {
    isConnecting.set(true);

    // Test the connection via proxy (bypasses CORS)
    const result = await vercelApi.testConnection(envToken);

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Vercel API error');
    }

    const userData = result.data as VercelUserResponse;
    const userObj = userData.user ?? userData;

    // Update connection
    updateVercelConnection({
      user: {
        id: userObj.id ?? '',
        username: userObj.username ?? '',
        email: userObj.email ?? '',
        name: userObj.name ?? '',
        avatar: userObj.avatar,
      },
      token: envToken,
    });

    logStore.logInfo('Auto-connected to Vercel', {
      type: 'system',
      message: `Auto-connected to Vercel as ${userData.user?.username || userData.username}`,
    });

    // Fetch stats
    await fetchVercelStats(envToken);

    return { success: true };
  } catch (error) {
    logger.error('Failed to auto-connect to Vercel:', error);
    logStore.logError(`Vercel auto-connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
      type: 'system',
      message: 'Vercel auto-connection failed',
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    isConnecting.set(false);
  }
}

export function initializeVercelConnection() {
  // Auto-connect using environment variable if available
  const envToken = import.meta.env?.VITE_VERCEL_ACCESS_TOKEN;

  if (envToken && !vercelConnection.get().token) {
    updateVercelConnection({ token: envToken });
    fetchVercelStats(envToken).catch((error) => logger.error('Failed to fetch Vercel stats during init', error));
  }
}

export const fetchVercelStatsViaAPI = fetchVercelStats;

export async function fetchVercelStats(token: string) {
  try {
    isFetchingStats.set(true);

    // Fetch projects via proxy (bypasses CORS)
    const projectsResult = await vercelApi.get<{ projects: VercelProject[] }>('/v9/projects', token);

    if (!projectsResult.success || !projectsResult.data) {
      throw new Error(projectsResult.error || 'Failed to fetch projects');
    }

    const projects = projectsResult.data.projects || [];

    // Fetch latest deployment for each project
    const projectsWithDeployments = await Promise.all(
      projects.map(async (project: VercelProject) => {
        try {
          const deploymentsResult = await vercelApi.get<{
            deployments: NonNullable<VercelProject['latestDeployments']>;
          }>(`/v6/deployments?projectId=${project.id}&limit=1`, token);

          if (deploymentsResult.success && deploymentsResult.data) {
            return {
              ...project,
              latestDeployments: deploymentsResult.data.deployments || [],
            };
          }

          return project;
        } catch (error) {
          logger.error(`Error fetching deployments for project ${project.id}:`, error);
          return project;
        }
      }),
    );

    const currentState = vercelConnection.get();
    updateVercelConnection({
      ...currentState,
      stats: {
        projects: projectsWithDeployments,
        totalProjects: projectsWithDeployments.length,
      },
    });
  } catch (error) {
    logger.error('Vercel API Error:', error);
    logStore.logError('Failed to fetch Vercel stats', { error });
    toast.error('Failed to fetch Vercel statistics');
  } finally {
    isFetchingStats.set(false);
  }
}
