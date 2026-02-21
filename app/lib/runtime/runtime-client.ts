/**
 * @module runtime-client
 * Client-side implementation of {@link RuntimeProvider} that proxies all
 * operations to the server via HTTP API routes.
 *
 * This replaces the WebContainer singleton in the browser. Stores and
 * components that previously imported `webcontainer` will import `runtime`
 * instead and get this client proxy.
 *
 * @remarks BROWSER-ONLY — this code runs in the client bundle.
 *
 * Communication pattern:
 * - File operations: POST/GET to `/api/runtime/fs`
 * - Command execution: POST to `/api/runtime/exec`
 * - Terminal sessions: POST for spawn/write/kill, SSE for streaming output
 */

import type {
  RuntimeProvider,
  RuntimeType,
  RuntimeFileSystem,
  ProcessResult,
  SpawnedProcess,
  SpawnOptions,
  PortEvent,
  DirEntry,
  FileStat,
  WatchEvent,
  WatchCallback,
  Disposer,
} from './runtime-provider';
import { WORK_DIR } from '~/utils/constants';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('RuntimeClient');

/*
 * ---------------------------------------------------------------------------
 * Client FileSystem (proxies to /api/runtime/fs)
 * ---------------------------------------------------------------------------
 */

class ClientFileSystem implements RuntimeFileSystem {
  #projectId: string;

  constructor(projectId: string) {
    this.#projectId = projectId;
  }

  /** Update the project ID (called when runtime is re-booted). */
  setProjectId(projectId: string): void {
    this.#projectId = projectId;
  }

  /** Guard: throw if no project is booted yet (prevents 400 errors from server). */
  #requireProject(operation: string): void {
    if (!this.#projectId) {
      throw new Error(`Cannot ${operation}: no project booted yet`);
    }
  }

  async readFile(path: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    this.#requireProject('readFile');

    const params = new URLSearchParams({
      projectId: this.#projectId,
      path,
      encoding,
    });

    const response = await fetch(`/api/runtime/fs?${params}&op=readFile`);

    if (!response.ok || response.status === 204) {
      throw new Error(`Failed to read file "${path}": not found`);
    }

    return response.text();
  }

  async readFileRaw(path: string): Promise<Uint8Array> {
    this.#requireProject('readFileRaw');

    const params = new URLSearchParams({
      projectId: this.#projectId,
      path,
      op: 'readFileRaw',
    });

    const response = await fetch(`/api/runtime/fs?${params}`);

    if (!response.ok || response.status === 204) {
      throw new Error(`Failed to read file "${path}": not found`);
    }

    const buffer = await response.arrayBuffer();

    return new Uint8Array(buffer);
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    this.#requireProject('writeFile');

    const isBinary = content instanceof Uint8Array;

    let encodedContent: string;

    if (isBinary) {
      /*
       * Convert Uint8Array to base64 in chunks to avoid
       * "Maximum call stack size exceeded" when spreading
       * large arrays into String.fromCharCode().
       */
      const chunkSize = 8192;
      let binary = '';

      for (let i = 0; i < content.length; i += chunkSize) {
        const slice = content.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...slice);
      }

      encodedContent = btoa(binary);
    } else {
      encodedContent = content;
    }

    const body = JSON.stringify({
      projectId: this.#projectId,
      path,
      content: encodedContent,
      binary: isBinary,
    });

    const response = await fetch('/api/runtime/fs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to write file "${path}": ${error}`);
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.#requireProject('mkdir');

    const body = JSON.stringify({
      projectId: this.#projectId,
      path,
      recursive: options?.recursive ?? false,
      op: 'mkdir',
    });

    const response = await fetch('/api/runtime/fs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create directory "${path}": ${error}`);
    }
  }

  async readdir(path: string): Promise<DirEntry[]> {
    this.#requireProject('readdir');

    const params = new URLSearchParams({
      projectId: this.#projectId,
      path,
      op: 'readdir',
    });

    const response = await fetch(`/api/runtime/fs?${params}`);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to read directory "${path}": ${error}`);
    }

    return response.json();
  }

  async stat(path: string): Promise<FileStat> {
    this.#requireProject('stat');

    const params = new URLSearchParams({
      projectId: this.#projectId,
      path,
      op: 'stat',
    });

    const response = await fetch(`/api/runtime/fs?${params}`);

    // 204 = file does not exist (server returns 204 to avoid browser console 404 noise)
    if (response.status === 204) {
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to stat "${path}": ${error}`);
    }

    return response.json();
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    this.#requireProject('rm');

    const body = JSON.stringify({
      projectId: this.#projectId,
      path,
      recursive: options?.recursive ?? false,
      force: options?.force ?? false,
      op: 'rm',
    });

    const response = await fetch('/api/runtime/fs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to remove "${path}": ${error}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    if (!this.#projectId) {
      return false;
    }

    const params = new URLSearchParams({
      projectId: this.#projectId,
      path,
      op: 'exists',
    });

    const response = await fetch(`/api/runtime/fs?${params}`);

    if (!response.ok) {
      return false;
    }

    const result = await response.json();

    return result.exists;
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    this.#requireProject('rename');

    const body = JSON.stringify({
      projectId: this.#projectId,
      oldPath,
      newPath,
      op: 'rename',
    });

    const response = await fetch('/api/runtime/fs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to rename "${oldPath}" to "${newPath}": ${error}`);
    }
  }

  /**
   * Watch for file-system changes via SSE.
   *
   * Opens an SSE connection to `/api/runtime/fs?op=watch` which streams
   * file change events from the server's file watcher.
   */
  watch(glob: string, callback: WatchCallback): Disposer {
    if (!this.#projectId) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return () => {};
    }

    const params = new URLSearchParams({
      projectId: this.#projectId,
      glob,
      op: 'watch',
    });

    let eventSource: EventSource | null = null;

    try {
      eventSource = new EventSource(`/api/runtime/fs?${params}`);

      eventSource.onmessage = (event) => {
        try {
          const events: WatchEvent[] = JSON.parse(event.data);
          callback(events);
        } catch (err) {
          logger.error('Failed to parse watch event:', err);
        }
      };

      eventSource.onerror = () => {
        logger.warn('File watch SSE connection error, will attempt reconnect');
      };
    } catch (err) {
      logger.error('Failed to start file watcher:', err);
    }

    return () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }
}

/*
 * ---------------------------------------------------------------------------
 * RuntimeClient
 * ---------------------------------------------------------------------------
 */

/**
 * Client-side runtime proxy that communicates with the server via HTTP.
 *
 * Implements the same {@link RuntimeProvider} interface as the server-side
 * {@link LocalRuntime}, enabling seamless migration from WebContainer.
 */
export class RuntimeClient implements RuntimeProvider {
  readonly type: RuntimeType = 'local';

  #projectId = '';
  #workdir = '';
  #fs: ClientFileSystem;
  #portListeners: Array<(event: PortEvent) => void> = [];
  #activeSessions = new Map<
    string,
    { eventSource: EventSource | null; dataListeners: Array<(data: string) => void> }
  >();
  #portEventSource: EventSource | null = null;

  constructor() {
    this.#fs = new ClientFileSystem('');
  }

  get projectId(): string {
    return this.#projectId;
  }

  get workdir(): string {
    return this.#workdir;
  }

  get fs(): RuntimeFileSystem {
    return this.#fs;
  }

  async boot(projectId: string): Promise<void> {
    const response = await fetch('/api/runtime/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'boot', projectId }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to boot runtime for "${projectId}": ${error}`);
    }

    /* Consume the response body (server returns workdir + status). */
    await response.json();

    this.#projectId = projectId;

    /*
     * Use the virtual WORK_DIR as the client-facing workdir.
     * All stores use WORK_DIR-prefixed paths as keys; the server resolves
     * the actual filesystem path via the projectId.
     */
    this.#workdir = WORK_DIR;
    this.#fs.setProjectId(projectId);

    // Start listening for port events via SSE
    this.#startPortListener();

    logger.info(`Runtime booted for project "${projectId}" at ${this.#workdir}`);
  }

  async spawn(command: string, args: string[] = [], options: SpawnOptions = {}): Promise<SpawnedProcess> {
    const response = await fetch('/api/runtime/terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'spawn',
        projectId: this.#projectId,
        command: args.length > 0 ? `${command} ${args.join(' ')}` : command,
        cols: options.terminal?.cols ?? 80,
        rows: options.terminal?.rows ?? 24,
        env: options.env,
        cwd: options.cwd,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to spawn process: ${error}`);
    }

    const { sessionId, pid } = await response.json();
    const dataListeners: Array<(data: string) => void> = [];

    // Open SSE connection for this session's output
    const eventSource = new EventSource(`/api/runtime/terminal?op=stream&sessionId=${encodeURIComponent(sessionId)}`);

    /*
     * Wait for the SSE connection to be fully established before returning.
     * The server sends a `{ type: 'connected' }` handshake once the
     * data listener is added to the session's dataListeners array.
     * Without this, writes can race ahead of the SSE listener setup,
     * causing shell readiness markers to be lost on page refresh.
     */
    const sseReady = new Promise<void>((resolve) => {
      const SSE_CONNECT_TIMEOUT_MS = 10_000;
      let settled = false;

      const settle = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      };

      const timer = setTimeout(() => {
        logger.warn(`SSE connect timeout for session ${sessionId}, proceeding anyway`);
        settle();
      }, SSE_CONNECT_TIMEOUT_MS);

      // Resolve on the 'connected' handshake from the server
      const onConnect = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data);

          if (parsed.type === 'connected') {
            eventSource.removeEventListener('message', onConnect);
            settle();
          }
        } catch {
          // Not JSON — ignore
        }
      };

      eventSource.addEventListener('message', onConnect);

      // If the SSE errors out before connecting, don't block forever
      eventSource.addEventListener('error', () => {
        if (eventSource.readyState === EventSource.CLOSED) {
          logger.warn(`SSE failed to connect for session ${sessionId}`);
          settle();
        }
      });
    });

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);

        if (parsed.type === 'data') {
          for (const listener of dataListeners) {
            listener(parsed.data);
          }
        } else if (parsed.type === 'exit') {
          eventSource.close();
          this.#activeSessions.delete(sessionId);
        }
      } catch {
        // Raw text data
        for (const listener of dataListeners) {
          listener(event.data);
        }
      }
    };

    eventSource.onerror = () => {
      logger.warn(`Terminal SSE error for session ${sessionId}`);
    };

    this.#activeSessions.set(sessionId, { eventSource, dataListeners });

    // Wait for SSE handshake before allowing writes
    await sseReady;

    const exitPromise = new Promise<number>((resolve) => {
      let resolved = false;

      const doResolve = (code: number) => {
        if (!resolved) {
          resolved = true;
          resolve(code);
          eventSource.removeEventListener('message', exitListener);
        }
      };

      const exitListener = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data);

          if (parsed.type === 'exit') {
            doResolve(parsed.exitCode ?? 1);
          }
        } catch {
          // Ignore parse errors
        }
      };

      eventSource.addEventListener('message', exitListener);

      /*
       * If the SSE connection permanently closes (readyState === CLOSED),
       * resolve the promise so callers like action-runner don't hang forever.
       * EventSource auto-reconnects on transient errors but enters CLOSED
       * state when the server returns a non-retryable response.
       */
      eventSource.addEventListener('error', () => {
        if (eventSource.readyState === EventSource.CLOSED) {
          logger.warn(`SSE connection closed for session ${sessionId}, resolving exit promise`);
          doResolve(1);
        }
      });
    });

    return {
      id: sessionId,
      pid,

      write: (data: string) => {
        fetch('/api/runtime/terminal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'write', sessionId, data }),
        }).catch((err) => logger.error('Failed to write to terminal:', err));
      },

      kill: (signal?: string) => {
        fetch('/api/runtime/terminal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'kill', sessionId, signal }),
        }).catch((err) => logger.error('Failed to kill terminal:', err));
      },

      resize: (dimensions: { cols: number; rows: number }) => {
        fetch('/api/runtime/terminal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'resize', sessionId, ...dimensions }),
        }).catch((err) => logger.error('Failed to resize terminal:', err));
      },

      onExit: exitPromise,

      onData: (callback: (data: string) => void): Disposer => {
        dataListeners.push(callback);

        return () => {
          const idx = dataListeners.indexOf(callback);

          if (idx !== -1) {
            dataListeners.splice(idx, 1);
          }
        };
      },
    };
  }

  async exec(command: string, options: SpawnOptions = {}): Promise<ProcessResult> {
    const response = await fetch('/api/runtime/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'exec',
        projectId: this.#projectId,
        command,
        cwd: options.cwd,
        env: options.env,
        ...(options.timeout ? { timeout: options.timeout } : {}),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exec command: ${error}`);
    }

    return response.json();
  }

  getPreviewUrl(port: number): string {
    return `http://localhost:${port}`;
  }

  onPortEvent(callback: (event: PortEvent) => void): Disposer {
    this.#portListeners.push(callback);

    return () => {
      const idx = this.#portListeners.indexOf(callback);

      if (idx !== -1) {
        this.#portListeners.splice(idx, 1);
      }
    };
  }

  async teardown(): Promise<void> {
    // Close all SSE connections
    for (const [, session] of this.#activeSessions) {
      session.eventSource?.close();
    }

    this.#activeSessions.clear();

    // Close port event SSE
    if (this.#portEventSource) {
      this.#portEventSource.close();
      this.#portEventSource = null;
    }

    this.#portListeners = [];

    // Tell the server to tear down
    if (this.#projectId) {
      await fetch('/api/runtime/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'teardown', projectId: this.#projectId }),
      }).catch((err) => logger.error('Failed to tear down runtime:', err));
    }

    logger.info(`RuntimeClient torn down for project "${this.#projectId}"`);
  }

  /*
   * -------------------------------------------------------------------------
   * Private Helpers
   * -------------------------------------------------------------------------
   */

  /** Start listening for port events via SSE. */
  #startPortListener(): void {
    if (this.#portEventSource) {
      this.#portEventSource.close();
    }

    const params = new URLSearchParams({
      projectId: this.#projectId,
      op: 'portEvents',
    });

    this.#portEventSource = new EventSource(`/api/runtime/exec?${params}`);

    this.#portEventSource.onmessage = (event) => {
      try {
        const portEvent: PortEvent = JSON.parse(event.data);

        for (const listener of this.#portListeners) {
          try {
            listener(portEvent);
          } catch (err) {
            logger.error('Port event listener error:', err);
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    this.#portEventSource.onerror = () => {
      logger.warn('Port event SSE connection error');
    };
  }
}
