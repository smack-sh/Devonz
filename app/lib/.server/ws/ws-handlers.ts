/**
 * @module ws-handlers
 * Message handlers for the WebSocket server.
 *
 * Routes incoming messages by `type` to the appropriate handler:
 * - `chat` — LLM streaming events (text deltas, errors, completions)
 * - `terminal` — Terminal session events (output, resize, input)
 * - `filesystem` — File system change events (add, change, unlink)
 *
 * Each handler processes the payload and may send responses back
 * to the originating client or broadcast to all clients.
 */

import { createScopedLogger } from '~/utils/logger';
import { sendMessage, sendError, type AuthenticatedWebSocket } from './ws-server';

const logger = createScopedLogger('WebSocket');

/*
 * ---------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------------
 */

/** Valid message types in the WebSocket protocol. */
export type WsMessageType = 'chat' | 'terminal' | 'filesystem' | 'system';

/** Chat message payload sent from client. */
export interface ChatPayload {
  action: 'subscribe' | 'unsubscribe';
  streamId?: string;
}

/** Terminal message payload sent from client. */
export interface TerminalPayload {
  action: 'subscribe' | 'input' | 'resize';
  sessionId: string;
  data?: string;
  dimensions?: { cols: number; rows: number };
}

/** Filesystem message payload sent from client. */
export interface FilesystemPayload {
  action: 'subscribe' | 'unsubscribe';
  projectId: string;
  glob?: string;
}

/*
 * ---------------------------------------------------------------------------
 * Active subscriptions
 * ---------------------------------------------------------------------------
 */

/** Clients subscribed to chat streaming events. */
const chatSubscribers = new Set<AuthenticatedWebSocket>();

/** Clients subscribed to terminal events, keyed by session ID. */
const terminalSubscribers = new Map<string, Set<AuthenticatedWebSocket>>();

/** Clients subscribed to filesystem events, keyed by project ID. */
const filesystemSubscribers = new Map<string, Set<AuthenticatedWebSocket>>();

/*
 * ---------------------------------------------------------------------------
 * Message Router
 * ---------------------------------------------------------------------------
 */

/**
 * Route an incoming WebSocket message to the appropriate handler.
 */
export function routeMessage(client: AuthenticatedWebSocket, type: string, payload: unknown): void {
  switch (type) {
    case 'chat':
      handleChatMessage(client, payload as ChatPayload);
      break;
    case 'terminal':
      handleTerminalMessage(client, payload as TerminalPayload);
      break;
    case 'filesystem':
      handleFilesystemMessage(client, payload as FilesystemPayload);
      break;
    default:
      sendError(client, `Unknown message type: "${type}"`);
      logger.warn(`Unknown message type "${type}" from ${client.clientId}`);
  }
}

/*
 * ---------------------------------------------------------------------------
 * Chat Handlers
 * ---------------------------------------------------------------------------
 */

function handleChatMessage(client: AuthenticatedWebSocket, payload: ChatPayload): void {
  if (!payload || !payload.action) {
    sendError(client, 'Chat message requires an "action" field');

    return;
  }

  switch (payload.action) {
    case 'subscribe':
      chatSubscribers.add(client);
      logger.debug(`Client ${client.clientId} subscribed to chat events`);

      // Clean up on disconnect
      client.once('close', () => {
        chatSubscribers.delete(client);
      });

      sendMessage(client, {
        type: 'chat',
        payload: { status: 'subscribed' },
      });
      break;

    case 'unsubscribe':
      chatSubscribers.delete(client);
      logger.debug(`Client ${client.clientId} unsubscribed from chat events`);
      sendMessage(client, {
        type: 'chat',
        payload: { status: 'unsubscribed' },
      });
      break;

    default:
      sendError(client, `Unknown chat action: "${payload.action}"`);
  }
}

/**
 * Push a chat streaming event to all subscribed clients.
 * Called by the LLM streaming pipeline when data is available.
 */
export function pushChatEvent(event: {
  streamId: string;
  partType: string;
  textDelta?: string;
  error?: string;
  finished?: boolean;
}): void {
  const message = { type: 'chat' as const, payload: event };

  for (const client of chatSubscribers) {
    sendMessage(client, message);
  }
}

/*
 * ---------------------------------------------------------------------------
 * Terminal Handlers
 * ---------------------------------------------------------------------------
 */

function handleTerminalMessage(client: AuthenticatedWebSocket, payload: TerminalPayload): void {
  if (!payload || !payload.action || !payload.sessionId) {
    sendError(client, 'Terminal message requires "action" and "sessionId" fields');

    return;
  }

  switch (payload.action) {
    case 'subscribe': {
      let subscribers = terminalSubscribers.get(payload.sessionId);

      if (!subscribers) {
        subscribers = new Set();
        terminalSubscribers.set(payload.sessionId, subscribers);
      }

      subscribers.add(client);
      logger.debug(`Client ${client.clientId} subscribed to terminal session ${payload.sessionId}`);

      // Clean up on disconnect
      client.once('close', () => {
        const subs = terminalSubscribers.get(payload.sessionId);

        if (subs) {
          subs.delete(client);

          if (subs.size === 0) {
            terminalSubscribers.delete(payload.sessionId);
          }
        }
      });

      sendMessage(client, {
        type: 'terminal',
        payload: { status: 'subscribed', sessionId: payload.sessionId },
      });
      break;
    }

    case 'input':
      /*
       * Forward terminal input — the actual terminal session handling remains
       * in the HTTP-based runtime API; this just acknowledges receipt.
       */
      logger.debug(`Terminal input from ${client.clientId} for session ${payload.sessionId}`);
      break;

    case 'resize':
      if (payload.dimensions) {
        logger.debug(
          `Terminal resize from ${client.clientId} for session ${payload.sessionId}: ` +
            `${payload.dimensions.cols}x${payload.dimensions.rows}`,
        );
      }

      break;

    default:
      sendError(client, `Unknown terminal action: "${payload.action}"`);
  }
}

/*
 * ---------------------------------------------------------------------------
 * Filesystem Handlers
 * ---------------------------------------------------------------------------
 */

function handleFilesystemMessage(client: AuthenticatedWebSocket, payload: FilesystemPayload): void {
  if (!payload || !payload.action || !payload.projectId) {
    sendError(client, 'Filesystem message requires "action" and "projectId" fields');

    return;
  }

  switch (payload.action) {
    case 'subscribe': {
      let subscribers = filesystemSubscribers.get(payload.projectId);

      if (!subscribers) {
        subscribers = new Set();
        filesystemSubscribers.set(payload.projectId, subscribers);
      }

      subscribers.add(client);
      logger.debug(`Client ${client.clientId} subscribed to filesystem events for project ${payload.projectId}`);

      // Clean up on disconnect
      client.once('close', () => {
        const subs = filesystemSubscribers.get(payload.projectId);

        if (subs) {
          subs.delete(client);

          if (subs.size === 0) {
            filesystemSubscribers.delete(payload.projectId);
          }
        }
      });

      sendMessage(client, {
        type: 'filesystem',
        payload: { status: 'subscribed', projectId: payload.projectId },
      });
      break;
    }

    case 'unsubscribe': {
      const subs = filesystemSubscribers.get(payload.projectId);

      if (subs) {
        subs.delete(client);

        if (subs.size === 0) {
          filesystemSubscribers.delete(payload.projectId);
        }
      }

      logger.debug(`Client ${client.clientId} unsubscribed from filesystem events for project ${payload.projectId}`);
      sendMessage(client, {
        type: 'filesystem',
        payload: { status: 'unsubscribed', projectId: payload.projectId },
      });
      break;
    }

    default:
      sendError(client, `Unknown filesystem action: "${payload.action}"`);
  }
}

/*
 * ---------------------------------------------------------------------------
 * Cleanup (for tests)
 * ---------------------------------------------------------------------------
 */

/**
 * Reset all subscriptions. Used in tests to ensure clean state.
 * @internal
 */
export function _resetSubscriptions(): void {
  chatSubscribers.clear();
  terminalSubscribers.clear();
  filesystemSubscribers.clear();
}
