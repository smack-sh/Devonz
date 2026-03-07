import { atom } from 'nanostores';
import { createScopedLogger } from '~/utils/logger';

/* ------------------------------------------------------------------ */
/*  Base constraint — every deployment connection must at least have:  */
/*    • user  (nullable)                                               */
/*    • token (string)                                                 */
/*    • stats (optional)                                               */
/* ------------------------------------------------------------------ */

/** Minimal shape that every deployment connection state must satisfy. */
export interface BaseConnection {
  user: unknown;
  token: string;
  stats?: unknown;
}

/* ------------------------------------------------------------------ */
/*  Config accepted by the factory                                     */
/* ------------------------------------------------------------------ */

export interface DeploymentStoreConfig<TConnection extends BaseConnection> {
  /**
   * Human-readable name used for scoped logging (e.g. `'GitHub'`, `'Vercel'`).
   */
  name: string;

  /**
   * Key used to persist the connection state in `localStorage`.
   */
  localStorageKey: string;

  /**
   * Optional Vite environment variable name that holds a pre-configured
   * access token (e.g. `'VITE_NETLIFY_ACCESS_TOKEN'`).
   *
   * When provided, the `initialize` function will attempt to auto-connect
   * using this token if the store has no token yet.
   */
  envTokenVar?: string;

  /**
   * The default connection state used when nothing is stored in
   * `localStorage` and no environment token is available.
   */
  defaultConnection: TConnection;

  /**
   * Called by `fetchStats()`.
   *
   * Receives the current token and an `updateConnection` callback so the
   * implementation can write stats back into the store.
   *
   * If omitted, the returned `fetchStats` will be a no-op.
   */
  fetchStats?: (
    token: string,
    updateConnection: (updates: Partial<TConnection>) => void,
    getConnection: () => TConnection,
  ) => Promise<void>;

  /**
   * Called during `initialize()` to validate the env-token and fetch the
   * initial user profile.
   *
   * Should return a partial connection update that includes at least the
   * `user` field so the store can record a successful connection.
   *
   * If omitted, `initialize()` will still set the token and call
   * `fetchStats` (when available), but won't attempt user validation.
   */
  fetchUser?: (token: string) => Promise<Partial<TConnection>>;

  /**
   * Optional hook called after `localStorage` is parsed and before the
   * atom is created. Lets stores apply per-parse fixups (e.g. Vercel
   * clears stored data when both `user` and `token` are missing).
   *
   * Return `null` to signal "discard parsed data, use default".
   */
  sanitizeParsed?: (parsed: TConnection, envToken: string | undefined) => TConnection | null;
}

/* ------------------------------------------------------------------ */
/*  Return type of the factory                                         */
/* ------------------------------------------------------------------ */

export interface DeploymentStore<TConnection extends BaseConnection> {
  /** The main reactive atom holding the connection state. */
  connection: ReturnType<typeof atom<TConnection>>;

  /** `true` while the store is performing the initial connect / user fetch. */
  isConnecting: ReturnType<typeof atom<boolean>>;

  /** `true` while `fetchStats()` is in-flight. */
  isFetchingStats: ReturnType<typeof atom<boolean>>;

  /**
   * Merge a partial update into the connection state and persist the
   * result to `localStorage`.
   */
  updateConnection: (updates: Partial<TConnection>) => void;

  /**
   * Fetch stats for the current connection. Delegates to the
   * `config.fetchStats` callback.
   */
  fetchStats: (token: string) => Promise<void>;

  /**
   * Auto-connect using an environment token (when configured).
   *
   * 1. Reads `import.meta.env[config.envTokenVar]`.
   * 2. If a token exists and the store has no token yet, sets it.
   * 3. Optionally calls `config.fetchUser` to validate and populate `user`.
   * 4. Calls `fetchStats`.
   */
  initialize: () => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  localStorage helper (SSR-safe)                                     */
/* ------------------------------------------------------------------ */

function getStorage(): Storage | null {
  try {
    if (
      typeof globalThis !== 'undefined' &&
      typeof globalThis.localStorage !== 'undefined' &&
      typeof globalThis.localStorage.getItem === 'function'
    ) {
      return globalThis.localStorage;
    }
  } catch {
    /* Private browsing or restricted context */
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

/**
 * Creates a reusable deployment store with a consistent pattern for:
 *
 * - A **connection atom** holding `user`, `token`, and optional `stats`
 * - **Loading-state atoms** (`isConnecting`, `isFetchingStats`)
 * - An **updateConnection** function that merges partial updates and
 *   persists to `localStorage`
 * - A **fetchStats** function gated behind an `isFetchingStats` flag
 * - An **initialize** function for env-token auto-connect
 *
 * ### Generic type parameters
 *
 * | Param         | Description |
 * |---------------|-------------|
 * | `TConnection` | The full connection-state shape. Must extend `BaseConnection`. |
 *
 * ### Usage example (GitHub store)
 *
 * ```ts
 * import { createDeploymentStore } from './deploymentStoreFactory';
 * import type { GitHubConnection } from '~/types/GitHub';
 *
 * const {
 *   connection: githubConnection,
 *   isConnecting,
 *   isFetchingStats,
 *   updateConnection: updateGitHubConnection,
 *   fetchStats: fetchGitHubStats,
 *   initialize: initializeGitHub,
 * } = createDeploymentStore<GitHubConnection>({
 *   name: 'GitHub',
 *   localStorageKey: 'github_connection',
 *   defaultConnection: { user: null, token: '', tokenType: 'classic' },
 *   fetchStats: async (token, updateConnection, getConnection) => {
 *     const response = await fetch('/api/github-user', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ action: 'get_repos' }),
 *     });
 *     if (!response.ok) throw new Error(`Failed: ${response.status}`);
 *     const data = await response.json();
 *     updateConnection({ ...getConnection(), stats: buildStats(data) });
 *   },
 * });
 *
 * export {
 *   githubConnection,
 *   isConnecting,
 *   isFetchingStats,
 *   updateGitHubConnection,
 *   fetchGitHubStats,
 *   initializeGitHub,
 * };
 * ```
 */
export function createDeploymentStore<TConnection extends BaseConnection>(
  config: DeploymentStoreConfig<TConnection>,
): DeploymentStore<TConnection> {
  const logger = createScopedLogger(`${config.name}Store`);
  const storage = getStorage();

  /* ---------- resolve env token ---------- */

  let envToken: string | undefined;

  if (config.envTokenVar) {
    try {
      /*
       * import.meta.env is a static object in Vite — we index dynamically
       * so the factory stays generic across stores.
       */
      envToken = (import.meta.env as Record<string, string | undefined>)?.[config.envTokenVar];
    } catch {
      /* SSR or non-Vite context */
    }
  }

  /* ---------- hydrate initial state from localStorage ---------- */

  let initialConnection: TConnection = config.defaultConnection;
  const raw = storage?.getItem(config.localStorageKey) ?? null;

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as TConnection;

      if (config.sanitizeParsed) {
        const sanitized = config.sanitizeParsed(parsed, envToken);
        initialConnection = sanitized ?? { ...config.defaultConnection, token: envToken ?? '' };

        if (!sanitized && storage) {
          storage.removeItem(config.localStorageKey);
        }
      } else {
        initialConnection = parsed;
      }
    } catch {
      logger.warn(`Failed to parse stored ${config.name} connection, using defaults`);
      storage?.removeItem(config.localStorageKey);

      // If an env token is available, seed the default with it
      if (envToken) {
        initialConnection = { ...config.defaultConnection, token: envToken };
      }
    }
  } else if (envToken) {
    // No stored data but we have an env token — pre-populate
    initialConnection = { ...config.defaultConnection, token: envToken };
  }

  /* ---------- atoms ---------- */

  const connection = atom<TConnection>(initialConnection);
  const isConnecting = atom<boolean>(false);
  const isFetchingStats = atom<boolean>(false);

  /* ---------- updateConnection ---------- */

  function updateConnection(updates: Partial<TConnection>): void {
    const currentState = connection.get();
    const newState = { ...currentState, ...updates } as TConnection;
    connection.set(newState);

    if (storage) {
      try {
        storage.setItem(config.localStorageKey, JSON.stringify(newState));
      } catch {
        /* localStorage full or unavailable — skip */
      }
    }
  }

  /* ---------- fetchStats ---------- */

  async function fetchStats(token: string): Promise<void> {
    if (!config.fetchStats) {
      return;
    }

    try {
      isFetchingStats.set(true);
      await config.fetchStats(token, updateConnection, () => connection.get());
    } catch (error) {
      logger.error(`${config.name} fetchStats error:`, error);
      throw error;
    } finally {
      isFetchingStats.set(false);
    }
  }

  /* ---------- initialize ---------- */

  async function initialize(): Promise<void> {
    const currentState = connection.get();

    // Nothing to auto-connect with
    if (!envToken) {
      return;
    }

    // Already connected or already have a token — just ensure stats
    if (currentState.user) {
      return;
    }

    if (!currentState.token && envToken) {
      updateConnection({ token: envToken } as Partial<TConnection>);
    }

    try {
      isConnecting.set(true);

      if (config.fetchUser) {
        const userUpdates = await config.fetchUser(envToken);
        updateConnection(userUpdates);
      }

      await fetchStats(envToken);
    } catch (error) {
      logger.error(`${config.name} initialization error:`, error);
    } finally {
      isConnecting.set(false);
    }
  }

  /* ---------- return public API ---------- */

  return {
    connection,
    isConnecting,
    isFetchingStats,
    updateConnection,
    fetchStats,
    initialize,
  };
}
