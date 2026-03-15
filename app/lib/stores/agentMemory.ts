import { map } from 'nanostores';
import type { MemoryRef } from '~/lib/agent/types';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('AgentMemory');

/** Maximum entries allowed per memory category before FIFO rotation */
const MAX_ENTRIES_PER_CATEGORY = 20;

/** Memory store state: category name → ordered list of memory entries */
export type MemoryStoreState = Record<string, MemoryRef[]>;

/**
 * Main memory store — keyed by category, each value is a chronologically
 * ordered array of {@link MemoryRef} entries (oldest first).
 *
 * Uses nanostores `map()` so individual categories can be updated
 * via `setKey()` without replacing the entire store.
 */
export const memoryStore = map<MemoryStoreState>({});

/**
 * Add or update a memory entry in the specified category.
 *
 * - If the key already exists in the category, updates `summary` and `updatedAt`.
 * - If the category reaches {@link MAX_ENTRIES_PER_CATEGORY}, the oldest
 *   entry is evicted (FIFO rotation).
 */
export function addMemoryEntry(category: string, key: string, summary: string): void {
  const state = memoryStore.get();
  const entries = state[category] ? [...state[category]] : [];
  const now = new Date().toISOString();

  const existingIndex = entries.findIndex((e) => e.key === key);

  if (existingIndex !== -1) {
    entries[existingIndex] = {
      ...entries[existingIndex],
      summary,
      updatedAt: now,
    };
    logger.info(`Updated memory entry: ${category}/${key}`);
  } else {
    const newEntry: MemoryRef = {
      key,
      category,
      summary,
      createdAt: now,
      updatedAt: now,
    };

    entries.push(newEntry);

    // FIFO rotation: evict oldest entries while over limit
    while (entries.length > MAX_ENTRIES_PER_CATEGORY) {
      const removed = entries.shift();

      if (removed) {
        logger.info(`FIFO rotation: evicted oldest entry "${removed.key}" from category "${category}"`);
      }
    }

    logger.info(`Added memory entry: ${category}/${key}`);
  }

  memoryStore.setKey(category, entries);
}

/**
 * Remove a memory entry by category and key.
 *
 * @returns `true` if the entry was found and removed, `false` otherwise.
 */
export function removeMemoryEntry(category: string, key: string): boolean {
  const state = memoryStore.get();
  const entries = state[category];

  if (!entries) {
    logger.debug(`No entries in category "${category}" — nothing to remove`);
    return false;
  }

  const index = entries.findIndex((e) => e.key === key);

  if (index === -1) {
    logger.debug(`Entry "${key}" not found in category "${category}"`);
    return false;
  }

  const updated = entries.filter((e) => e.key !== key);

  if (updated.length === 0) {
    // Remove the category key entirely when it becomes empty
    const next = { ...memoryStore.get() };
    delete next[category];
    memoryStore.set(next);
  } else {
    memoryStore.setKey(category, updated);
  }

  logger.info(`Removed memory entry: ${category}/${key}`);

  return true;
}

/**
 * Retrieve all memory entries for a specific category.
 *
 * @returns A (possibly empty) array of {@link MemoryRef} entries.
 */
export function getMemoryByCategory(category: string): MemoryRef[] {
  return memoryStore.get()[category] ?? [];
}
