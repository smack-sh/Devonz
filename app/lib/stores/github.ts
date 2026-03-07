import { atom } from 'nanostores';
import type { GitHubConnection, GitHubRepoInfo } from '~/types/GitHub';
import { logStore } from './logs';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('GitHubStore');

// Initialize with stored connection or defaults
let storedConnection: string | null = null;

try {
  storedConnection = typeof window !== 'undefined' ? localStorage.getItem('github_connection') : null;
} catch {
  /* localStorage unavailable (private browsing, etc.) */
}

const defaultConnection: GitHubConnection = {
  user: null,
  token: '',
  tokenType: 'classic',
};

let initialConnection: GitHubConnection = defaultConnection;

if (storedConnection) {
  try {
    initialConnection = JSON.parse(storedConnection);
  } catch {
    logger.warn('Failed to parse stored GitHub connection, using defaults');
    localStorage.removeItem('github_connection');
  }
}

export const githubConnection = atom<GitHubConnection>(initialConnection);
export const isConnecting = atom<boolean>(false);
export const isFetchingStats = atom<boolean>(false);

// Function to fetch GitHub stats via server-side API
export async function fetchGitHubStatsViaAPI() {
  try {
    isFetchingStats.set(true);

    const response = await fetch('/api/github-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'get_repos' }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch repositories: ${response.status}`);
    }

    const data = (await response.json()) as { repos: GitHubRepoInfo[] };
    const repos = data.repos || [];

    const currentState = githubConnection.get();
    updateGitHubConnection({
      ...currentState,
      stats: {
        repos,
        recentActivity: [],
        languages: {},
        totalGists: 0,
        publicRepos: repos.filter((r) => !r.private).length,
        privateRepos: repos.filter((r) => r.private).length,
        stars: repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0),
        forks: repos.reduce((sum, r) => sum + (r.forks_count || 0), 0),
        totalStars: repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0),
        totalForks: repos.reduce((sum, r) => sum + (r.forks_count || 0), 0),
        followers: 0,
        publicGists: 0,
        privateGists: 0,
        lastUpdated: new Date().toISOString(),
        organizations: [],
        totalBranches: 0,
        totalContributors: 0,
        totalIssues: 0,
        totalPullRequests: 0,
        mostUsedLanguages: [],
      },
    });

    logStore.logSystem('GitHub stats fetched successfully');
  } catch (error) {
    logger.error('GitHub API Error:', error);
    logStore.logError('Failed to fetch GitHub stats', { error });
  } finally {
    isFetchingStats.set(false);
  }
}

export const updateGitHubConnection = (updates: Partial<GitHubConnection>) => {
  const currentState = githubConnection.get();
  const newState = { ...currentState, ...updates };
  githubConnection.set(newState);

  // Persist to localStorage
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('github_connection', JSON.stringify(newState));
    } catch {
      /* localStorage full or unavailable — skip */
    }
  }
};
