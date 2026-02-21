/**
 * @module local-runtime
 * Server-side runtime implementation using Node.js `child_process` and native `fs`.
 *
 * This is the core execution engine that replaces WebContainer. It manages:
 * - A project working directory on the local filesystem
 * - Shell process spawning via `child_process.spawn`
 * - Terminal session lifecycle (create, write, resize, kill)
 * - Port detection from process stdout
 *
 * @remarks SERVER-ONLY — imports `node:child_process`, `node:os`, etc.
 */

import { spawn, exec } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import { initGitRepo } from './git-manager';
import { randomUUID } from 'node:crypto';
import type {
  RuntimeProvider,
  RuntimeType,
  RuntimeFileSystem,
  ProcessResult,
  SpawnedProcess,
  SpawnOptions,
  PortEvent,
  Disposer,
} from './runtime-provider';
import { isValidProjectId } from './runtime-provider';
import { LocalFileSystem } from './local-filesystem';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('LocalRuntime');

/** Default base directory for project workspaces. */
const DEFAULT_PROJECTS_DIR = nodePath.join(os.homedir(), '.devonz', 'projects');

/**
 * Detect the default shell for the current OS.
 * Returns `bash` on Unix, `powershell.exe` on Windows.
 */
function detectShell(): string {
  if (os.platform() === 'win32') {
    return process.env.COMSPEC ?? 'cmd.exe';
  }

  return process.env.SHELL ?? '/bin/bash';
}

/** Regex patterns to detect port announcements in process output. */
const PORT_PATTERNS = [
  /(?:Local|Server|App|http):?\s*(?:running\s+(?:at|on)\s+)?https?:\/\/[^:/\s]+:(\d+)/i,
  /(?:listening|started|running)\s+(?:at|on)\s+(?:port\s+)?(\d+)/i,
  /localhost:(\d+)/i,
  /0\.0\.0\.0:(\d+)/i,
  /127\.0\.0\.1:(\d+)/i,

  /*
   * Broad "port XXXX" pattern — uses \b after the digits to prevent
   * regex backtracking, and a negative lookahead to skip messages
   * like "Port 5173 is in use" which are NOT server announcements.
   */
  /port\s+(\d+)\b(?!\s+is\b)/i,
];

/** Internal representation of a terminal session on the server. */
interface TerminalSession {
  id: string;
  process: ChildProcess;
  projectId: string;

  /** Callbacks listening for data from this session. */
  dataListeners: Array<(data: string) => void>;

  /** Resolves when the process exits. */
  exitPromise: Promise<number>;
}

/*
 * ---------------------------------------------------------------------------
 * LocalRuntime
 * ---------------------------------------------------------------------------
 */

/**
 * Local Node.js runtime — executes code directly on the host machine.
 *
 * Designed as a singleton-per-project on the server side. The `RuntimeManager`
 * maps project IDs to `LocalRuntime` instances.
 */
export class LocalRuntime implements RuntimeProvider {
  readonly type: RuntimeType = 'local';
  readonly fs: RuntimeFileSystem;

  #projectId = '';
  #workdir = '';
  #shell: string;
  #projectsDir: string;
  #sessions = new Map<string, TerminalSession>();
  #portListeners: Array<(event: PortEvent) => void> = [];
  #detectedPorts = new Set<number>();

  constructor(options?: { projectsDir?: string; shell?: string }) {
    this.#projectsDir = options?.projectsDir ?? DEFAULT_PROJECTS_DIR;
    this.#shell = options?.shell ?? detectShell();

    /*
     * Filesystem is initialized with a temporary root;
     * replaced on boot() with the actual project directory.
     */
    this.fs = new LocalFileSystem(this.#projectsDir);
  }

  get projectId(): string {
    return this.#projectId;
  }

  get workdir(): string {
    return this.#workdir;
  }

  async boot(projectId: string): Promise<void> {
    if (!isValidProjectId(projectId)) {
      throw new Error(`Invalid project ID: "${projectId}". Must be alphanumeric with hyphens/underscores, 1-64 chars.`);
    }

    this.#projectId = projectId;
    this.#workdir = nodePath.join(this.#projectsDir, projectId);

    // Ensure project directory exists
    await fs.mkdir(this.#workdir, { recursive: true });

    // Replace filesystem with one scoped to the project
    (this as { fs: RuntimeFileSystem }).fs = new LocalFileSystem(this.#workdir);

    // Initialize git repo for version history (non-blocking, best-effort)
    try {
      initGitRepo(this.#workdir);
    } catch {
      logger.debug('Git init skipped (git may not be installed)');
    }

    logger.info(`Runtime booted for project "${projectId}" at ${this.#workdir}`);
  }

  async spawn(command: string, args: string[] = [], options: SpawnOptions = {}): Promise<SpawnedProcess> {
    this.#ensureBooted();

    const sessionId = randomUUID();
    const cwd = options.cwd ? nodePath.resolve(this.#workdir, options.cwd) : this.#workdir;

    const env = {
      ...process.env,
      ...options.env,
      FORCE_COLOR: '1',
      TERM: 'xterm-256color',
    };

    const proc = spawn(command, args, {
      cwd,
      env,
      shell: this.#shell,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const dataListeners: Array<(data: string) => void> = [];

    const exitPromise = new Promise<number>((resolve) => {
      proc.on('exit', (code) => {
        this.#sessions.delete(sessionId);
        resolve(code ?? 1);
      });

      proc.on('error', (err) => {
        logger.error(`Process error [${sessionId}]:`, err);
        this.#sessions.delete(sessionId);
        resolve(1);
      });
    });

    // Pipe stdout
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      this.#detectPorts(text);

      for (const listener of dataListeners) {
        listener(text);
      }
    });

    // Pipe stderr
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      this.#detectPorts(text);

      for (const listener of dataListeners) {
        listener(text);
      }
    });

    const session: TerminalSession = {
      id: sessionId,
      process: proc,
      projectId: this.#projectId,
      dataListeners,
      exitPromise,
    };

    this.#sessions.set(sessionId, session);

    logger.debug(`Spawned process [${sessionId}]: ${command} ${args.join(' ')}`);

    return {
      id: sessionId,
      pid: proc.pid ?? 0,

      write(data: string) {
        proc.stdin?.write(data);
      },

      kill(signal?: string) {
        try {
          proc.kill(signal as NodeJS.Signals | undefined);
        } catch {
          // Process may have already exited
        }
      },

      resize(_dimensions: { cols: number; rows: number }) {
        /*
         * Basic child_process doesn't support resize.
         * Phase 2 can add node-pty for proper PTY support.
         */
      },

      onExit: exitPromise,

      onData(callback: (data: string) => void): Disposer {
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
    this.#ensureBooted();

    const cwd = options.cwd ? nodePath.resolve(this.#workdir, options.cwd) : this.#workdir;

    const env = {
      ...process.env,
      ...options.env,
    };

    return new Promise<ProcessResult>((resolve) => {
      exec(
        command,
        {
          cwd,
          env,
          maxBuffer: 10 * 1024 * 1024, // 10 MB
          shell: this.#shell,
          ...(options.timeout ? { timeout: options.timeout } : {}),
        },
        (error, stdout, stderr) => {
          const killed = error && 'killed' in error && (error as { killed?: boolean }).killed;

          resolve({
            exitCode: killed ? 124 : (error?.code ?? (error ? 1 : 0)),
            output: killed
              ? `${stdout}${stderr}\n[Process killed: exceeded ${Math.round((options.timeout ?? 0) / 1000)}s timeout]`
              : stdout + stderr,
          });
        },
      );
    });
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
    logger.info(`Tearing down runtime for project "${this.#projectId}"`);

    // Kill all running sessions
    for (const [id, session] of this.#sessions) {
      try {
        session.process.kill('SIGTERM');
      } catch {
        // Process may have already exited
      }

      logger.debug(`Killed session ${id}`);
    }

    this.#sessions.clear();
    this.#portListeners = [];
    this.#detectedPorts.clear();
  }

  /*
   * -------------------------------------------------------------------------
   * Terminal Session Management (used by API routes)
   * -------------------------------------------------------------------------
   */

  /** Get a terminal session by ID. */
  getSession(sessionId: string): TerminalSession | undefined {
    return this.#sessions.get(sessionId);
  }

  /** List all active session IDs for this runtime. */
  listSessions(): string[] {
    return Array.from(this.#sessions.keys());
  }

  /** Write data to a terminal session's stdin. */
  writeToSession(sessionId: string, data: string): void {
    const session = this.#sessions.get(sessionId);

    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }

    session.process.stdin?.write(data);
  }

  /** Kill a terminal session. */
  killSession(sessionId: string, signal = 'SIGTERM'): void {
    const session = this.#sessions.get(sessionId);

    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }

    try {
      session.process.kill(signal as NodeJS.Signals);
    } catch {
      // Process may have already exited
    }
  }

  /*
   * -------------------------------------------------------------------------
   * Private Helpers
   * -------------------------------------------------------------------------
   */

  #ensureBooted(): void {
    if (!this.#projectId) {
      throw new Error('Runtime not booted. Call boot(projectId) first.');
    }
  }

  /** Detect port numbers from process output and fire port events. */
  #detectPorts(output: string): void {
    /*
     * Strip ANSI escape codes so color sequences don't break regex matching.
     * Vite (and other tools) wrap URLs in color codes like \x1b[36m...\x1b[0m
     * which can insert non-digit characters between "localhost:" and the port number.
     */
    const cleaned = output.replace(/\x1b\[[0-9;]*m/g, '');

    for (const pattern of PORT_PATTERNS) {
      const match = cleaned.match(pattern);

      if (match?.[1]) {
        const port = parseInt(match[1], 10);

        if (port > 0 && port < 65536 && !this.#detectedPorts.has(port)) {
          this.#detectedPorts.add(port);

          const event: PortEvent = {
            port,
            type: 'open',
            url: `http://localhost:${port}`,
          };

          logger.info(`Detected port open: ${port}`);

          for (const listener of this.#portListeners) {
            try {
              listener(event);
            } catch (err) {
              logger.error('Port event listener error:', err);
            }
          }
        }
      }
    }
  }
}

/*
 * ---------------------------------------------------------------------------
 * Runtime Manager (Singleton)
 * ---------------------------------------------------------------------------
 */

/**
 * Server-side singleton that manages `LocalRuntime` instances per project.
 *
 * API routes use `RuntimeManager.get(projectId)` to obtain a runtime,
 * creating one on demand if it doesn't exist.
 */
export class RuntimeManager {
  static #instance: RuntimeManager | null = null;

  #runtimes = new Map<string, LocalRuntime>();
  #projectsDir: string;
  #shell: string;

  private constructor(options?: { projectsDir?: string; shell?: string }) {
    this.#projectsDir = options?.projectsDir ?? process.env.DEVONZ_PROJECTS_DIR ?? DEFAULT_PROJECTS_DIR;
    this.#shell = options?.shell ?? detectShell();
  }

  /** Get the singleton instance. */
  static getInstance(): RuntimeManager {
    if (!RuntimeManager.#instance) {
      RuntimeManager.#instance = new RuntimeManager();
    }

    return RuntimeManager.#instance;
  }

  /**
   * Get or create a runtime for the given project ID.
   * Automatically boots the runtime if it's new.
   */
  async getRuntime(projectId: string): Promise<LocalRuntime> {
    let runtime = this.#runtimes.get(projectId);

    if (!runtime) {
      runtime = new LocalRuntime({
        projectsDir: this.#projectsDir,
        shell: this.#shell,
      });
      await runtime.boot(projectId);
      this.#runtimes.set(projectId, runtime);
      logger.info(`Created runtime for project "${projectId}"`);
    }

    return runtime;
  }

  /** Tear down and remove a runtime. */
  async removeRuntime(projectId: string): Promise<void> {
    const runtime = this.#runtimes.get(projectId);

    if (runtime) {
      await runtime.teardown();
      this.#runtimes.delete(projectId);
    }
  }

  /** Tear down all runtimes. Called on server shutdown. */
  async teardownAll(): Promise<void> {
    const teardownPromises = Array.from(this.#runtimes.values()).map((rt) => rt.teardown());
    await Promise.allSettled(teardownPromises);
    this.#runtimes.clear();
    logger.info('All runtimes torn down');
  }

  /** Get the projects directory path. */
  get projectsDir(): string {
    return this.#projectsDir;
  }

  /** List all active project IDs. */
  listProjects(): string[] {
    return Array.from(this.#runtimes.keys());
  }
}
