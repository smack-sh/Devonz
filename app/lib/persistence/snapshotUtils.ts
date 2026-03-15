/**
 * Global snapshot utilities for persisting file state
 *
 * This module provides functions to take snapshots of the current file state
 * that can be called from anywhere in the app (e.g., after accepting staged changes).
 */

import { workbenchStore } from '~/lib/stores/workbench';
import { setSnapshot, openDatabase, getLatestCheckpoint } from './db';
import { chatId, db } from './useChatHistory';
import type { Snapshot } from './types';
import type { AgentCheckpoint, TokenBudgetState } from '~/lib/agent/types';
import { processStreamEvent } from '~/lib/stores/stream-event-router';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('SnapshotUtils');

/**
 * Takes a snapshot of the current workbench files and saves it to the database.
 * This should be called after staged changes are accepted and applied to WebContainer.
 *
 * @param chatIndex Optional chat index (message ID) to associate with the snapshot
 * @param chatSummary Optional summary of the chat for this snapshot
 * @returns Promise that resolves when snapshot is saved, or rejects on error
 */
export async function takeGlobalSnapshot(chatIndex?: string, chatSummary?: string): Promise<void> {
  const currentChatId = chatId.get();
  const database = db;

  if (!currentChatId) {
    logger.warn('Cannot take snapshot: No chat ID available');
    return;
  }

  if (!database) {
    logger.warn('Cannot take snapshot: Database not available');
    return;
  }

  const files = workbenchStore.files.get();
  const snapshotIndex = chatIndex || `snapshot-${Date.now()}`;

  const snapshot: Snapshot = {
    chatIndex: snapshotIndex,
    files,
    summary: chatSummary,
  };

  try {
    await setSnapshot(database, currentChatId, snapshot);
    logger.info(`Snapshot saved for chat ${currentChatId} with ${Object.keys(files).length} files`);
  } catch (error) {
    logger.error('Failed to save snapshot:', error);
    throw error;
  }
}

/**
 * Takes a snapshot after a brief delay to ensure WebContainer has synced.
 * This is useful after accepting changes since WebContainer file watcher
 * may need a moment to update the files store.
 *
 * @param delayMs Delay in milliseconds before taking snapshot (default: 100ms)
 * @param chatIndex Optional chat index to associate with the snapshot
 * @param chatSummary Optional summary of the chat
 * @returns Promise that resolves when snapshot is saved
 */
export async function takeDelayedSnapshot(
  delayMs: number = 100,
  chatIndex?: string,
  chatSummary?: string,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return takeGlobalSnapshot(chatIndex, chatSummary);
}

/**
 * Deserialized checkpoint state returned by restoreAgentCheckpoint.
 */
export interface RestoredCheckpointState {
  /** The raw checkpoint record */
  checkpoint: AgentCheckpoint;

  /** Deserialized conversation messages */
  messages: unknown[];

  /** Deserialized agent execution state */
  agentState: Record<string, unknown>;

  /** Token budget snapshot at checkpoint time */
  tokenBudget: TokenBudgetState;
}

/**
 * Retrieve the latest agent checkpoint for a chat and return the deserialized state.
 *
 * When a checkpoint is found, an `agent_checkpoint` event with `action: 'restored'`
 * is emitted through the stream event router so the UI can react.
 *
 * @param targetChatId - The chat ID to restore a checkpoint for.
 *   Falls back to the current active chatId atom if not provided.
 * @returns The deserialized checkpoint state, or null if none exists.
 */
export async function restoreAgentCheckpoint(targetChatId?: string): Promise<RestoredCheckpointState | null> {
  const resolvedChatId = targetChatId || chatId.get();

  if (!resolvedChatId) {
    logger.warn('Cannot restore checkpoint: No chat ID available');
    return null;
  }

  const database = await openDatabase();

  if (!database) {
    logger.warn('Cannot restore checkpoint: Database not available');
    return null;
  }

  const checkpoint = await getLatestCheckpoint(database, resolvedChatId);

  if (!checkpoint) {
    logger.debug(`No checkpoint found for chat ${resolvedChatId}`);
    return null;
  }

  let messages: unknown[] = [];

  try {
    messages = JSON.parse(checkpoint.messages);
  } catch {
    logger.warn('Failed to parse checkpoint messages — using empty array');
  }

  let agentState: Record<string, unknown> = {};

  try {
    agentState = JSON.parse(checkpoint.agentState);
  } catch {
    logger.warn('Failed to parse checkpoint agentState — using empty object');
  }

  // Emit restored event through the stream event router
  processStreamEvent({
    type: 'agent_checkpoint',
    timestamp: new Date().toISOString(),
    checkpointId: checkpoint.id,
    phase: checkpoint.phase,
    chatId: resolvedChatId,
    action: 'restored',
  });

  logger.info(
    `Checkpoint ${checkpoint.id} restored for chat ${resolvedChatId} ` +
      `(phase: ${checkpoint.phase}, messages: ${messages.length})`,
  );

  return {
    checkpoint,
    messages,
    agentState,
    tokenBudget: checkpoint.tokenBudget,
  };
}
