import { useEffect, useRef } from 'react';
import { memoryStore, type MemoryStoreState } from '~/lib/stores/agentMemory';
import { useFileContent } from '~/lib/hooks/useFileContent';
import { runtime } from '~/lib/runtime';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('MemorySync');

/** Absolute path where MEMORY.md lives inside WebContainer */
const MEMORY_MD_PATH = '/home/project/MEMORY.md';

/** Relative path (from workdir) used by runtime.fs.writeFile */
const MEMORY_MD_RELATIVE = 'MEMORY.md';

/** Debounce interval for write-back to filesystem (ms) */
const DEBOUNCE_MS = 300;

/**
 * Parse MEMORY.md content into structured memory entries.
 *
 * Expected format:
 * ```markdown
 * ---
 * version: 1
 * lastUpdated: "2024-01-01T00:00:00.000Z"
 * ---
 * ## preferences
 * - **key1**: value1
 * - **key2**: value2
 *
 * ## decisions
 * - **key3**: value3
 * ```
 *
 * Lines that don't match the `## heading` or `- **key**: value`
 * patterns are silently ignored.
 */
export function parseMemoryMd(content: string): MemoryStoreState {
  const entries: MemoryStoreState = {};

  // Strip YAML frontmatter (delimited by --- on its own line)
  const frontmatterMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  const body = frontmatterMatch ? frontmatterMatch[1] : content;

  const now = new Date().toISOString();
  let currentCategory: string | null = null;

  for (const line of body.split('\n')) {
    // Detect category heading: ## category_name
    const headingMatch = line.match(/^##\s+(.+)/);

    if (headingMatch) {
      currentCategory = headingMatch[1].trim();

      if (!entries[currentCategory]) {
        entries[currentCategory] = [];
      }

      continue;
    }

    // Parse entry: - **key**: summary
    if (currentCategory) {
      const entryMatch = line.match(/^[\s]*[-*]\s+\*\*(.+?)\*\*:\s*(.+)/);

      if (entryMatch) {
        const key = entryMatch[1].trim();
        const summary = entryMatch[2].trim();

        entries[currentCategory].push({
          key,
          category: currentCategory,
          summary,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  return entries;
}

/**
 * Serialize memory store state into MEMORY.md content with YAML
 * frontmatter and one `## category` section per key.
 *
 * Categories are sorted alphabetically for stable diffs.
 */
export function serializeMemoryMd(state: MemoryStoreState): string {
  const now = new Date().toISOString();
  const lines: string[] = ['---', 'version: 1', `lastUpdated: "${now}"`, '---'];

  const categories = Object.keys(state).sort();

  for (const category of categories) {
    const categoryEntries = state[category];

    if (!categoryEntries || categoryEntries.length === 0) {
      continue;
    }

    lines.push('', `## ${category}`);

    for (const entry of categoryEntries) {
      lines.push(`- **${entry.key}**: ${entry.summary}`);
    }
  }

  // Trailing newline for POSIX compliance
  lines.push('');

  return lines.join('\n');
}

/**
 * Write MEMORY.md to the WebContainer filesystem.
 *
 * Resolves the runtime singleton and writes the content at the
 * project-relative path. Errors are logged but not thrown so callers
 * can fire-and-forget.
 */
async function writeMemoryFile(content: string): Promise<void> {
  try {
    const rt = await runtime;
    await rt.fs.writeFile(MEMORY_MD_RELATIVE, content);
    logger.debug('MEMORY.md written successfully');
  } catch (error) {
    logger.error('Failed to write MEMORY.md:', error);
  }
}

/**
 * Hook that watches MEMORY.md via {@link useFileContent} and syncs
 * its content bidirectionally with {@link memoryStore}.
 *
 * **Read path** — When MEMORY.md changes on disk (e.g. the LLM edits
 * it), the content is parsed into the store.
 *
 * **Write path** — When the store is mutated programmatically (via
 * `addMemoryEntry` / `removeMemoryEntry`), the store state is
 * serialised back to MEMORY.md after a 300 ms debounce.
 *
 * Circular updates are suppressed via a `writeSuppressed` flag that
 * is raised while the store is being populated from file content.
 *
 * Follows the same WebContainer file subscription pattern as
 * `usePlanSync`.
 */
export function useMemorySync(): void {
  const memoryContent = useFileContent(MEMORY_MD_PATH);
  const prevContentRef = useRef<string | null>(null);
  const writeSuppressedRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * ---- Read path: file → store ----
   *
   * Mirrors the usePlanSync pattern: compare against previous content,
   * skip no-ops, and parse into the store on real changes.
   */
  useEffect(() => {
    if (memoryContent === undefined) {
      // MEMORY.md doesn't exist or was deleted — clear if data was active
      if (prevContentRef.current !== null) {
        logger.info('MEMORY.md removed — clearing memory store');
        writeSuppressedRef.current = true;
        memoryStore.set({});
        writeSuppressedRef.current = false;
        prevContentRef.current = null;
      }

      return;
    }

    // Skip if content hasn't changed
    if (memoryContent === prevContentRef.current) {
      return;
    }

    prevContentRef.current = memoryContent;

    const parsed = parseMemoryMd(memoryContent);
    const categoryCount = Object.keys(parsed).length;
    const totalEntries = Object.values(parsed).reduce((sum, arr) => sum + arr.length, 0);

    if (totalEntries === 0) {
      logger.debug('MEMORY.md has no entries — ignoring');
      return;
    }

    logger.info(`MEMORY.md updated — ${categoryCount} categories, ${totalEntries} entries`);

    /*
     * Suppress write-back while updating from file content.
     * memoryStore.listen fires synchronously within .set(), so the
     * flag is guaranteed to be true during the listener callback.
     */
    writeSuppressedRef.current = true;
    memoryStore.set(parsed);
    writeSuppressedRef.current = false;
  }, [memoryContent]);

  /*
   * ---- Write path: store → file (debounced) ----
   *
   * Uses nanostores `.listen()` (skips the initial-value callback from
   * `.subscribe()`) so we only react to actual mutations.
   */
  useEffect(() => {
    const unsub = memoryStore.listen((state) => {
      // Suppress writes triggered by the read path above
      if (writeSuppressedRef.current) {
        return;
      }

      /*
       * Nothing to persist for an empty store (avoids writing a
       * MEMORY.md that contains only frontmatter)
       */
      if (Object.keys(state).length === 0) {
        return;
      }

      // Debounce: cancel any previously scheduled write
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;

        const serialized = serializeMemoryMd(state);
        prevContentRef.current = serialized;
        writeMemoryFile(serialized);
      }, DEBOUNCE_MS);
    });

    return () => {
      unsub();

      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);
}
