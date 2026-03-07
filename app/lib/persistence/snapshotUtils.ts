/**
 * Global snapshot utilities for persisting file state
 *
 * This module provides functions to take snapshots of the current file state
 * that can be called from anywhere in the app (e.g., after accepting staged changes).
 */

import { workbenchStore } from '~/lib/stores/workbench';
import { setSnapshot } from './db';
import { chatId, db } from './useChatHistory';
import type { Snapshot } from './types';
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
